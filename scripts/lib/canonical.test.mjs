import { describe, expect, it } from "vitest";

import {
  CANONICAL_DIRECTORIES,
  indexSources,
  normalizeAllCanonical,
} from "./canonical.mjs";

/**
 * The records here are trimmed copies of real canonical documents, kept in
 * the canonical shape rather than the archive's: nested `armor.class`,
 * camelCase enums, `sourceKey` instead of an abbreviation. What each test
 * pins down is the crossing point — the place where a canonical field becomes
 * something the UI renders — because that is what silently breaks if either
 * side of the mapping moves.
 */
const sources = indexSources([
  { key: "phb", abbreviation: "PHB", title: "Star Wars 5e Player's Handbook" },
  { key: "snv", abbreviation: "SnV", title: "Scum and Villainy" },
]);

function normalizeOne(type, record) {
  return normalizeAllCanonical(type, [record], sources)[0];
}

describe("what the canonical mapping guarantees for every type", () => {
  it("resolves a sourceKey into the abbreviation the site's badges use", () => {
    const item = normalizeOne("feats", {
      key: "brawny",
      name: "Brawny",
      sourceKey: "phb",
      description: "You are exceptionally strong.",
    });

    expect(item.source).toBe("PHB");
    expect(item.sourceName).toBe("Star Wars 5e Player's Handbook");
    expect(item.type).toBe("feats");
    expect(item.slug).toBe("brawny");
  });

  it("refuses a sourceKey no source document declares", () => {
    expect(() =>
      normalizeOne("feats", {
        key: "brawny",
        name: "Brawny",
        sourceKey: "not-a-book",
        description: "You are exceptionally strong.",
      }),
    ).toThrow(/not-a-book/);
  });

  it("gives colliding slugs a stable numbered suffix", () => {
    const items = normalizeAllCanonical(
      "equipment",
      [
        { key: "bo-rifle", name: "Bo-rifle", sourceKey: "phb", category: "weapon" },
        { key: "bo-rifle-2", name: "Bo-rifle", sourceKey: "phb", category: "weapon" },
      ],
      sources,
    );

    expect(items.map((item) => item.slug)).toEqual(["bo-rifle", "bo-rifle-2"]);
  });

  it("carries no site type that the canonical set cannot feed, except maneuvers", () => {
    // The canonical set has no maneuvers directory. That is a gap in the
    // content, not a bug in the mapping, and it has to stay visible.
    expect(CANONICAL_DIRECTORIES.maneuvers).toBeNull();
    expect(CANONICAL_DIRECTORIES.species).toBe("species");
    expect(CANONICAL_DIRECTORIES.monsters).toBe("monster");
  });
});

describe("species", () => {
  const bothan = {
    key: "bothan",
    name: "Bothan",
    sourceKey: "phb",
    size: "medium",
    homeworld: "Bothawui",
    nativeLanguage: "Bothese",
    lore: "### Biology\nBothans are a short species of furry humanoids.",
    traits: [
      { name: "Shrewd", description: "You are proficient in Insight." },
    ],
    abilityScoreIncreaseOptions: [
      {
        increases: [
          { amount: 2, abilities: ["intelligence"] },
          { amount: 1, abilities: ["dexterity"] },
        ],
      },
    ],
    physique: { heightAverage: "4'3\"", heightModifier: "+2d4\"" },
    appearance: { distinctions: "Mood-sensitive fur", eyeColorOptions: "Brown" },
  };

  it("reads its list-page fields out of four different canonical objects", () => {
    const item = normalizeOne("species", bothan);

    expect(item.summary).toEqual({
      size: "Medium",
      homeworld: "Bothawui",
      language: "Bothese",
      abilityIncreases: "Intelligence +2, Dexterity +1",
    });
    expect(item.tagline).toBe("Medium · Bothawui");
    expect(item.stats).toContainEqual({
      label: "Distinctions",
      value: "Mood-sensitive fur",
    });
    expect(item.stats).toContainEqual({
      label: "Average height",
      value: "4'3\"",
    });
  });

  it("keeps the lore as prose and the traits as named entries", () => {
    const item = normalizeOne("species", bothan);

    expect(item.sections).toEqual([
      { heading: null, body: "### Biology\nBothans are a short species of furry humanoids." },
    ]);
    expect(item.entries).toEqual([
      {
        group: "Traits",
        name: "Shrewd",
        body: "You are proficient in Insight.",
      },
    ]);
  });

  it("spells out an open-ended ability increase and separates the options", () => {
    const item = normalizeOne("species", {
      ...bothan,
      abilityScoreIncreaseOptions: [
        {
          increases: [
            { amount: 2, anyAbilityCount: 1 },
            { amount: 1, anyAbilityCount: 2 },
          ],
        },
        { increases: [{ amount: 1, anyAbilityCount: 4 }] },
      ],
    });

    expect(item.summary.abilityIncreases).toBe(
      "1 ability of your choice +2, 2 abilities of your choice +1; " +
        "or 4 abilities of your choice +1",
    );
  });
});

describe("monsters", () => {
  const acklay = {
    key: "acklay-adult",
    name: "Acklay, Adult",
    sourceKey: "snv",
    size: "huge",
    types: ["beast"],
    alignment: "unaligned",
    armor: { class: 14, type: "natural armor" },
    hitPoints: { average: 149, roll: "13d12 + 65" },
    speed: { walk: 40, text: "40 ft." },
    abilities: {
      strength: { score: 25, modifier: 7 },
      dexterity: { score: 10, modifier: 0 },
    },
    senses: ["passive Perception 10"],
    languages: ["—"],
    damageResistances: { types: ["necrotic"], other: ["disease"] },
    challengeRating: "8",
    experiencePoints: 3900,
    behaviors: [
      { name: "Trampling Charge", behaviorType: "trait", description: "It charges." },
      { name: "Bite", behaviorType: "action", description: "Melee Weapon Attack." },
      { name: "Parry", behaviorType: "reaction", description: "It parries." },
      { name: "Roar", behaviorType: "legendary", description: "It roars." },
    ],
    sectionText: "The acklay is a non-sentient mix of crustacean and reptile.",
  };

  it("rebuilds the stat block lines out of the nested canonical objects", () => {
    const item = normalizeOne("monsters", acklay);
    const labelled = Object.fromEntries(
      item.stats.map((stat) => [stat.label, stat.value]),
    );

    expect(labelled["Armor Class"]).toBe("14 (natural armor)");
    expect(labelled["Hit Points"]).toBe("149 (13d12 + 65)");
    expect(labelled.Speed).toBe("40 ft.");
    expect(labelled.Challenge).toBe("8 (3,900 XP)");
    // Validated damage types and free text are one line in a stat block.
    expect(labelled["Damage Resistances"]).toBe("necrotic, disease");
  });

  it("keeps size, kind and alignment reading as a printed stat block", () => {
    const item = normalizeOne("monsters", acklay);

    expect(item.tagline).toBe("Huge beast, unaligned");
    expect(item.summary.challengeRatingValue).toBe(8);
    expect(item.abilityScores).toEqual([
      { ability: "Strength", score: 25, modifier: 7 },
      { ability: "Dexterity", score: 10, modifier: 0 },
    ]);
  });

  it("groups behaviors under the headings a stat block prints", () => {
    const item = normalizeOne("monsters", acklay);

    expect(item.entries.map((entry) => entry.group)).toEqual([
      "Traits",
      "Actions",
      "Reactions",
      "Legendary actions",
    ]);
  });

  it("reads a fractional challenge rating as a number for sorting", () => {
    const item = normalizeOne("monsters", { ...acklay, challengeRating: "1/4" });

    expect(item.summary.challengeRatingValue).toBe(0.25);
  });
});

describe("powers", () => {
  const power = {
    key: "affect-mind",
    name: "Affect Mind",
    sourceKey: "phb",
    powerType: "force",
    level: 1,
    forceAlignment: "light",
    castingTime: { period: "bonusAction", text: "1 bonus action" },
    range: "30 feet",
    duration: "1 minute",
    concentration: true,
    description: "You touch a mind.",
  };

  it("expands the casting period into the label the filter sorts on", () => {
    const item = normalizeOne("powers", power);

    expect(item.summary.castingPeriod).toBe("Bonus action");
    expect(item.summary.powerType).toBe("Force");
    expect(item.summary.forceAlignment).toBe("Light");
    expect(item.tagline).toBe("Level 1 force power");
  });

  it("reads a level-zero power as at-will", () => {
    const item = normalizeOne("powers", { ...power, level: 0 });

    expect(item.tagline).toBe("At-will force power");
    expect(item.summary.level).toBe(0);
  });

  it("drops the alignment of a tech power and of an unaligned force power", () => {
    expect(
      normalizeOne("powers", { ...power, powerType: "tech" }).summary
        .forceAlignment,
    ).toBeNull();
    expect(
      normalizeOne("powers", { ...power, forceAlignment: "none" }).summary
        .forceAlignment,
    ).toBeNull();
  });
});

describe("equipment", () => {
  it("assembles a damage expression and expands the camelCase classifications", () => {
    const item = normalizeOne("equipment", {
      key: "assault-cannon",
      name: "Assault cannon",
      sourceKey: "phb",
      category: "weapon",
      costInCredits: 1550,
      weight: 15,
      properties: ["burst 4", "two-handed"],
      weaponClassification: "martialBlaster",
      damage: { numberOfDice: 1, dieFaces: 12, type: "energy" },
      stealthDisadvantage: false,
    });

    expect(item.summary.damage).toBe("1d12 energy");
    expect(item.summary.category).toBe("Weapon");
    expect(item.tagline).toBe("Weapon · Martial blaster");
    expect(item.stats).toContainEqual({ label: "Cost", value: "1,550 cr" });
  });

  it("marks armor that gives away a wearer trying to hide", () => {
    const item = normalizeOne("equipment", {
      key: "battle-armor",
      name: "Battle armor",
      sourceKey: "phb",
      category: "armor",
      costInCredits: 750,
      weight: 55,
      armorClassification: "heavy",
      armorClass: "16",
      stealthDisadvantage: true,
    });

    expect(item.stats).toContainEqual({ label: "Stealth", value: "Disadvantage" });
    expect(item.summary.armorClass).toBe("16");
  });
});

describe("backgrounds", () => {
  const mandalorian = {
    key: "mandalorian",
    name: "Mandalorian",
    sourceKey: "phb",
    lore: "You are a child of Mandalore.",
    skillProficiencies: "Choose two from Athletics, Intimidation",
    languageProficiencies: "Mando'a",
    startingEquipment: "A set of traveler's clothes",
    feature: { name: "Child of Mandalore", description: "You are recognised." },
    suggestedCharacteristics: "Mandalorians are a meritocracy.",
    personalityTraitOptions: [
      { roll: 1, description: "I speak plainly." },
      { roll: 2, description: "I keep my helmet on." },
    ],
    idealOptions: [{ roll: 1, name: "Honor", description: "The Resol'nare." }],
    variant: {
      name: "Mandalorian Clan",
      description: "Choose a clan.\n\n|d8|Clan|\n|:---:|:---:|\n|1|Vizsla|",
      options: [{ roll: 1, name: "Vizsla" }],
    },
  };

  it("turns the granted feature into a tagline and a named entry", () => {
    const item = normalizeOne("backgrounds", mandalorian);

    expect(item.tagline).toBe("Feature: Child of Mandalore");
    expect(item.entries).toEqual([
      {
        group: "Feature",
        name: "Child of Mandalore",
        body: "You are recognised.",
      },
    ]);
  });

  it("builds a roll table whose die is the number of rows", () => {
    const item = normalizeOne("backgrounds", mandalorian);
    const traits = item.tables.find((table) => table.caption === "Personality traits");
    const ideals = item.tables.find((table) => table.caption === "Ideals");

    expect(traits.columns).toEqual(["d2", "Trait"]);
    expect(traits.rows).toEqual([
      ["1", "I speak plainly."],
      ["2", "I keep my helmet on."],
    ]);
    // A named option keeps its name and its explanation together.
    expect(ideals.rows).toEqual([["1", "Honor — The Resol'nare."]]);
  });

  it("prints a variant once, as the prose that already contains its table", () => {
    const item = normalizeOne("backgrounds", mandalorian);

    expect(item.sections).toContainEqual({
      heading: "Mandalorian Clan",
      body: "Choose a clan.\n\n|d8|Clan|\n|:---:|:---:|\n|1|Vizsla|",
    });
    expect(item.tables.map((table) => table.caption)).not.toContain(
      "Mandalorian Clan",
    );
  });
});

describe("archetypes and feats", () => {
  it("lays the level progression out as a table with the labels it uses", () => {
    const item = normalizeOne("archetypes", {
      key: "beguiler-practice",
      name: "Beguiler Practice",
      sourceKey: "phb",
      className: "Operative",
      casterType: "force",
      description: "You learn to charm.",
      progression: [
        {
          level: 3,
          entries: [
            { label: "Force Powers Known", value: "4" },
            { label: "Force Points", value: "3" },
          ],
        },
        { level: 4, entries: [{ label: "Force Powers Known", value: "6" }] },
      ],
    });

    expect(item.summary).toEqual({ className: "Operative", casterType: "Force" });
    expect(item.tagline).toBe("Operative archetype");
    expect(item.tables[0]).toEqual({
      caption: "Progression",
      columns: ["Level", "Force Powers Known", "Force Points"],
      rows: [
        ["3", "4", "3"],
        ["4", "6", "—"],
      ],
    });
  });

  it("drops the casting line for an archetype that grants none", () => {
    const item = normalizeOne("archetypes", {
      key: "ataru-form",
      name: "Ataru Form",
      sourceKey: "phb",
      className: "Guardian",
      casterType: "none",
      description: "You leap.",
    });

    expect(item.summary.casterType).toBeNull();
    expect(item.stats).toEqual([{ label: "Class", value: "Guardian" }]);
  });

  it("says a feat has no prerequisite rather than leaving the line blank", () => {
    const withOut = normalizeOne("feats", {
      key: "ace-pilot",
      name: "Ace Pilot",
      sourceKey: "phb",
      abilityScoreIncreases: ["intelligence"],
      description: "You fly.",
    });
    const withOne = normalizeOne("feats", {
      key: "force-sensitive",
      name: "Force Sensitive",
      sourceKey: "phb",
      prerequisite: "The ability to cast at least one force power",
      description: "You feel the Force.",
    });

    expect(withOut.tagline).toBe("No prerequisite");
    expect(withOut.summary.abilityIncreases).toBe("Intelligence");
    expect(withOne.tagline).toBe(
      "Requires The ability to cast at least one force power",
    );
  });
});
