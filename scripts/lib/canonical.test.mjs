import { describe, expect, it } from "vitest";

import {
  CANONICAL_DIRECTORIES,
  buildClassGraph,
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
  { key: "wh", abbreviation: "WH", title: "Wretched Hives" },
  { key: "sotg", abbreviation: "SotG", title: "Starships of the Galaxy" },
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

  it("gives every site type a canonical directory to read", () => {
    // This used to record maneuvers as the one site type the canonical set
    // could not feed, which is why /maneuvers rendered an empty index while
    // sitting in the site's navigation. Nothing is unmapped now, and this
    // assertion is what notices if a type is ever added to the site without
    // content behind it — the empty-index machinery still exists for that
    // case, but it must be a decision rather than an accident.
    for (const [type, directory] of Object.entries(CANONICAL_DIRECTORIES)) {
      expect(directory, `${type} has no canonical directory`).toBeTruthy();
    }

    expect(CANONICAL_DIRECTORIES.species).toBe("species");
    expect(CANONICAL_DIRECTORIES.monsters).toBe("monster");
  });

  it("maps the plural route segments onto the singular canonical directories", () => {
    // The site's ids are URL segments and the canonical directories are not.
    // /maneuvers in particular is a published address that predates the
    // content, so the two spellings have to stay pinned to each other.
    expect(CANONICAL_DIRECTORIES.maneuvers).toBe("maneuver");
    expect(CANONICAL_DIRECTORIES["fighting-styles"]).toBe("fighting-style");
    expect(CANONICAL_DIRECTORIES["fighting-masteries"]).toBe("fighting-mastery");
    expect(CANONICAL_DIRECTORIES["lightsaber-forms"]).toBe("lightsaber-form");
    expect(CANONICAL_DIRECTORIES["weapon-focuses"]).toBe("weapon-focus");
    expect(CANONICAL_DIRECTORIES["weapon-supremacies"]).toBe("weapon-supremacy");
  });
});

describe("combat options", () => {
  it("puts a maneuver's list and die cost where a row can read them", () => {
    const item = normalizeOne("maneuvers", {
      key: "parry",
      name: "Parry",
      sourceKey: "phb",
      maneuverType: "physical",
      superiorityDice: 1,
      description:
        "When another creature damages you with a melee attack, you can use " +
        "your reaction and expend one superiority die to reduce the damage.",
    });

    expect(item.summary).toEqual({
      kind: "Physical",
      prerequisite: null,
      superiorityDice: 1,
      improves: null,
    });
    expect(item.tagline).toBe("Physical maneuver");
    expect(item.stats).toContainEqual({ label: "Cost", value: "1 superiority die" });
  });

  it("says what a tiered maneuver improves, in the tagline and in the row", () => {
    const item = normalizeOne("maneuvers", {
      key: "administer-aid-greater",
      name: "Administer Aid (Greater)",
      sourceKey: "phb",
      maneuverType: "mental",
      superiorityDice: 0,
      prerequisite: "Administer Aid (Improved) maneuver",
      improves: "Administer Aid",
      description: "You can use your Administer Aid maneuver as an action.",
    });

    // "Administer Aid (Greater)" says nothing on its own; what it upgrades is
    // the whole of what the name means.
    expect(item.tagline).toBe("Improves Administer Aid");
    expect(item.summary.improves).toBe("Administer Aid");
    expect(item.summary.superiorityDice).toBe(0);

    // Zero dice is a fact about the maneuver, not a missing value, so it is
    // spelled out rather than left off the stat block.
    expect(item.stats).toContainEqual({
      label: "Cost",
      value: "No superiority die",
    });
  });

  it("renders a fighting style's benefits as a list, not as a paragraph", () => {
    const item = normalizeOne("fighting-styles", {
      key: "duelist-style",
      name: "Duelist Style",
      sourceKey: "phb",
      description: "You are skilled with a single weapon. You gain the following benefits:",
      benefits: [
        "You gain a +1 bonus to attack rolls.",
        "You can draw a weapon without using your object interaction.",
      ],
    });

    expect(item.summary).toEqual({ prerequisite: null, benefits: 2 });
    expect(item.entries).toEqual([
      {
        group: "Benefits",
        name: null,
        body: "You gain a +1 bonus to attack rolls.",
      },
      {
        group: "Benefits",
        name: null,
        body: "You can draw a weapon without using your object interaction.",
      },
    ]);

    // The lead sentence is the only prose. Repeating the bullets underneath it
    // would show the same rules twice on one page.
    expect(item.sections).toHaveLength(1);
    expect(item.sections[0].body).not.toContain("+1 bonus");
  });

  it("carries a style's prerequisite as a field rather than a line of prose", () => {
    const item = normalizeOne("fighting-masteries", {
      key: "formfighting-mastery",
      name: "Formfighting Mastery",
      sourceKey: "phb",
      prerequisite: "The ability to cast force powers",
      description: "You've mastered the basics of lightsaber combat. You gain:",
      benefits: ["You learn two additional lightsaber forms."],
    });

    expect(item.tagline).toBe("Requires The ability to cast force powers");
    expect(item.stats).toContainEqual({
      label: "Prerequisite",
      value: "The ability to cast force powers",
    });
  });

  it("heads a lightsaber form's two halves by when each applies", () => {
    const item = normalizeOne("lightsaber-forms", {
      key: "shii-cho-form",
      name: "Shii-Cho Form",
      sourceKey: "phb",
      effects: [
        {
          timing: "onAdopt",
          description:
            "As a part of the bonus action to adopt this form, you can engage " +
            "in Two-Weapon Fighting.",
        },
        {
          timing: "active",
          description:
            "The first time you hit a creature before the end of your next " +
            "turn, it must make a Strength saving throw.",
        },
      ],
    });

    expect(item.summary).toEqual({ prerequisite: null, onAdopt: true });
    expect(item.tagline).toBe("Acts as you adopt it");
    expect(item.sections.map((each) => each.heading)).toEqual([
      "As you adopt this form",
      "While this form is held",
    ]);
    expect(item.stats).toContainEqual({
      label: "Adopted as",
      value: "Bonus action",
    });
  });

  it("marks a form that only does something while it is held", () => {
    const item = normalizeOne("lightsaber-forms", {
      key: "juyo-form",
      name: "Juyo Form",
      sourceKey: "phb",
      effects: [
        {
          timing: "active",
          description:
            "Until the start of your next turn, your critical hit range " +
            "increases by 1.",
        },
      ],
    });

    expect(item.summary.onAdopt).toBe(false);
    expect(item.tagline).toBe("Active while held");
    expect(item.sections[0].heading).toBe("While this form is held");
  });

  it("keys a weapon focus on the group it applies to", () => {
    const item = normalizeOne("weapon-focuses", {
      key: "crushing-weapon-focus",
      name: "Crushing Weapon Focus",
      sourceKey: "wh",
      weaponGroup: "crushing",
      description: "You've focused your training on crushing weapons:",
      benefits: ["You gain a +1 bonus to the weapon's damage rolls."],
    });

    // The group is not derivable from the name — three of the eight carry the
    // word "Weapon" in print and five do not — so the field is what a row and
    // a filter both read.
    expect(item.summary).toEqual({ weaponGroup: "Crushing", benefits: 1 });
    expect(item.tagline).toBe("Crushing weapons");
    expect(item.source).toBe("WH");
  });

  it("gives a weapon supremacy the same shape as its focus", () => {
    const item = normalizeOne("weapon-supremacies", {
      key: "blade-supremacy",
      name: "Blade Supremacy",
      sourceKey: "wh",
      weaponGroup: "blade",
      description: "You've specialized your training with blade weapons:",
      benefits: ["You gain a +1 bonus to the weapon's attack rolls."],
    });

    expect(item.summary.weaponGroup).toBe("Blade");
    expect(item.entries[0].group).toBe("Benefits");
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

  it("shows every proficiency group a weapon belongs to, not just the first", () => {
    // A bo-rifle is both an exotic blaster and an exotic vibroweapon, and
    // proficiency with either is enough to use it. Showing only the first
    // would tell a reader they cannot use a weapon they can.
    const item = normalizeOne("equipment", {
      key: "bo-rifle",
      name: "Bo-rifle",
      sourceKey: "phb",
      category: "weapon",
      costInCredits: 1075,
      weight: 0,
      weaponClassification: "exoticBlaster",
      additionalWeaponClassifications: ["exoticVibroweapon"],
      stealthDisadvantage: false,
    });

    expect(item.stats).toContainEqual({
      label: "Weapon type",
      value: "Exotic blaster, Exotic vibroweapon",
    });
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

/**
 * The class graph. These four types are the only part of the corpus where a
 * page is worth less on its own than it is joined to its neighbours, so what
 * the tests below pin down is the joins: that a class's table survives the trip
 * intact, that its features are reachable from it, and that a feature can be
 * reached at all — which needs a slug that its name cannot supply.
 */
describe("the class graph", () => {
  const berserker = {
    key: "berserker",
    name: "Berserker",
    sourceKey: "phb",
    contentSet: "core",
    summary: "Melee combatant who utilizes rage to increase prowess",
    primaryAbility: "strength",
    hitPoints: {
      dieFaces: 12,
      atFirstLevel: "12 + your Constitution modifier",
      atHigherLevels: "1d12 (or 7) + your Constitution modifier per berserker level after 1st",
    },
    proficiencies: {
      armor: "Light armor, medium armor",
      weapons: "All vibroweapons, simple blasters",
      savingThrows: ["strength", "constitution"],
      skills: { choose: 2, from: ["Athletics", "Survival"], text: "Choose two from Athletics, Survival" },
    },
    multiclassProficiencies: "Light armor, all vibroweapons",
    startingWealth: "5d4 x 100 cr",
    casterType: "none",
    casterRatio: 0,
    archetypeLabel: "Berserker Approaches",
    description: "### Rage\nYou fight with primal ferocity.",
    progression: [
      {
        level: 1,
        proficiencyBonus: 2,
        features: ["Rage", "Unarmored Defense"],
        // No Berserker Instincts cell: the book prints an em dash at 1st level
        // and the content set stores nothing rather than a broken glyph.
        entries: [
          { label: "Rages", value: "2" },
          { label: "Rage Damage", value: "+2" },
        ],
      },
      {
        level: 2,
        proficiencyBonus: 2,
        features: ["Reckless Attack"],
        entries: [
          { label: "Rages", value: "2" },
          { label: "Rage Damage", value: "+2" },
          { label: "Berserker Instincts", value: "2" },
        ],
      },
    ],
  };

  const rage = {
    key: "class-berserker-rage-1",
    name: "Rage",
    sourceKey: "phb",
    grantedBy: "class",
    grantedByName: "Berserker",
    level: 1,
    description: "You fight with primal ferocity.",
  };

  const recklessAttack = {
    key: "class-berserker-reckless-attack-2",
    name: "Reckless Attack",
    sourceKey: "phb",
    grantedBy: "class",
    grantedByName: "Berserker",
    level: 2,
    description: "You throw aside all concern for defence.",
  };

  const marauder = {
    key: "marauder-approach",
    name: "Marauder Approach",
    sourceKey: "phb",
    className: "Berserker",
    casterType: "none",
    description: "You revel in the fight.",
  };

  const multiclass = {
    key: "berserker-multiclass-improvement",
    name: "Berserker Multiclass Improvement",
    sourceKey: "phb",
    className: "Berserker",
    improvementType: "multiclass",
    prerequisite: "At least 3 levels in berserker",
    description: "You can add half your other class's levels.",
  };

  const graph = buildClassGraph({
    classes: [berserker],
    classImprovements: [multiclass],
    archetypes: [marauder],
    features: [rage, recklessAttack],
  });

  const normalizeInGraph = (type, record) =>
    normalizeAllCanonical(type, [record], sources, graph)[0];

  it("prints the class table with the three columns every class shares", () => {
    const item = normalizeInGraph("classes", berserker);

    expect(item.tables[0]).toEqual({
      caption: "Class progression",
      columns: ["Level", "Proficiency Bonus", "Features", "Rages", "Rage Damage", "Berserker Instincts"],
      rows: [
        ["1st", "+2", "Rage, Unarmored Defense", "2", "+2", "—"],
        ["2nd", "+2", "Reckless Attack", "2", "+2", "2"],
      ],
    });
  });

  it("reads the stat block out of the nested proficiency object", () => {
    const item = normalizeInGraph("classes", berserker);

    expect(item.summary).toEqual({
      primaryAbility: "Strength",
      hitDie: 12,
      casterType: null,
      archetypeCount: 1,
    });
    expect(item.tagline).toBe("d12 hit die · Strength");
    expect(item.stats).toContainEqual({ label: "Hit die", value: "d12" });
    expect(item.stats).toContainEqual({
      label: "Saving throws",
      value: "Strength, Constitution",
    });
    expect(item.stats).toContainEqual({
      label: "Skills",
      value: "Choose two from Athletics, Survival",
    });
  });

  it("links a class to everything that hangs off it", () => {
    const item = normalizeInGraph("classes", berserker);
    const bodies = item.sections.map((each) => each.body).join("\n");

    // The archetype introduction and the list of archetypes are one
    // section. They were two under the same heading, which printed
    // "Berserker Approaches" twice with a paragraph between them.
    const headings = item.sections.map((each) => each.heading).filter(Boolean);
    expect(headings).toEqual([...new Set(headings)]);
    expect(headings).toContain("Berserker Approaches");

    // The features index is by level, because that is the question a reader
    // levelling up is asking.
    expect(bodies).toContain("| 1st | [Rage](/features/class-berserker-rage-1) |");
    expect(bodies).toContain(
      "| 2nd | [Reckless Attack](/features/class-berserker-reckless-attack-2) |",
    );
    expect(bodies).toContain("- [Marauder Approach](/archetypes/marauder-approach)");
    expect(bodies).toContain(
      "- [Berserker Multiclass Improvement](/class-improvements/berserker-multiclass-improvement)",
    );
  });

  it("gives an archetype a linked index of what it grants and a way back", () => {
    const withFeature = buildClassGraph({
      classes: [berserker],
      archetypes: [marauder],
      features: [
        {
          key: "archetype-marauder-approach-furious-force-3",
          name: "Furious Force",
          grantedBy: "archetype",
          grantedByName: "Marauder Approach",
          level: 3,
        },
      ],
    });

    const bodies = normalizeAllCanonical("archetypes", [marauder], sources, withFeature)[0]
      .sections.map((each) => each.body)
      .join("\n");

    expect(bodies).toContain(
      "| 3rd | [Furious Force](/features/archetype-marauder-approach-furious-force-3) |",
    );
    expect(bodies).toContain("An archetype of the [Berserker](/classes/berserker) class.");
  });

  it("gives a feature the URL its name cannot", () => {
    // "Ability Score Improvement" is granted forty times over. A slug built
    // from the name would collide with all of them and be resolved by a
    // numeric suffix that moves as the corpus grows, so the URL is the
    // canonical key, which is stable and unique by construction.
    const item = normalizeInGraph("features", rage);

    expect(item.slug).toBe("class-berserker-rage-1");
    expect(item.tagline).toBe("Berserker · 1st level");
    expect(item.summary).toEqual({
      grantedBy: "Class",
      grantedByName: "Berserker",
      level: 1,
    });
    expect(item.sections.at(-1).body).toBe(
      "Granted by [Berserker](/classes/berserker) at 1st level.",
    );
  });

  it("says what a class improvement is for rather than repeating its name", () => {
    const item = normalizeInGraph("class-improvements", multiclass);

    expect(item.tagline).toBe(
      "What the class contributes to a multiclassed character",
    );
    expect(item.summary).toEqual({
      className: "Berserker",
      improvementType: "Multiclass",
      prerequisite: "At least 3 levels in berserker",
    });
    expect(item.sections.at(-1).body).toBe(
      "Part of the [Berserker](/classes/berserker) class.",
    );
  });

  it("publishes features rather than hiding them inside their parent", () => {
    // The reversal this change is about. `feature` was a canonical directory
    // with no site type; it is now a browsable one, and the fixture and the
    // prerender list both derive from this map.
    expect(CANONICAL_DIRECTORIES.features).toBe("feature");
    expect(CANONICAL_DIRECTORIES.classes).toBe("class");
    expect(CANONICAL_DIRECTORIES["class-improvements"]).toBe("class-improvement");
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

/**
 * The starship types are the only ones whose canonical documents were never a
 * flat row, so they are the only place this module does real shaping. Each
 * test below sits on one of those crossings: a nested pool becoming a dice
 * expression, a table of rows becoming a rendered table with a heading that
 * comes out of the data, a resolved prerequisite becoming a column a reader
 * can filter on.
 */
describe("starship base sizes", () => {
  const small = {
    key: "small",
    name: "Small",
    sourceKey: "sotg",
    contentSet: "core",
    lore: "Snubfighters are the smallest crewed ships.",
    abilityScoreAdjustments: [
      { ability: "dexterity", modifier: 2 },
      { ability: "constitution", modifier: -2 },
    ],
    hull: {
      diceAtTier0: { number: 3, faces: 6 },
      firstDiePoints: "6 + your ship's Constitution modifier",
      subsequentDiePoints:
        "1d6 (or 4) + your ship's Constitution modifier per Hull Die after 1st",
    },
    shields: {
      diceAtTier0: { number: 3, faces: 6 },
      firstDiePoints: "6 + your ship's Strength modifier",
      subsequentDiePoints:
        "1d6 (or 4) + your ship's Strength modifier per Shield Die after 1st",
    },
    modifications: {
      maximumSuiteSystems: "-1 + your ship's Constitution modifier",
      baseModificationSlots: 20,
      stockModifications: "Your choice of two non-suite modifications.",
    },
    savingThrows: "Strength, Dexterity",
    tierProgression: {
      dieName: "Pinpoint Strike Die",
      tiers: [
        { tier: 0, features: ["Role"], hullAndShieldDice: "3d6", armorClassBonus: 0 },
        {
          tier: 2,
          features: ["Role Specialization", "Retro Thrusters"],
          die: "d6",
          hullAndShieldDice: "5d6",
          armorClassBonus: 1,
        },
      ],
    },
    roles: [
      {
        name: "Bomber",
        abilityScoreAdjustments: [{ ability: "constitution", modifier: 1 }],
        armor: "Reinforced",
        reactor: "Fuel Cell",
        powerCoupling: "Direct",
        speed: 250,
        turning: 100,
      },
    ],
    features: [
      { name: "Pinpoint Strike", description: "Your ship finds the seam in a larger hull." },
    ],
  };

  it("renders the tier table under the size's own name for its signature die", () => {
    const item = normalizeOne("starship-base-sizes", small);

    // Every size names this die differently — a Tiny ship rolls Swarm Tactics,
    // a Gargantuan one Superior Firepower — so the heading has to come out of
    // the document rather than out of this module.
    expect(item.tables[0]).toEqual({
      caption: "Tier progression",
      columns: ["Tier", "Features", "Pinpoint Strike Die", "Hull & shield dice", "AC"],
      rows: [
        ["0", "Role", "—", "3d6", "—"],
        ["2", "Role Specialization, Retro Thrusters", "d6", "5d6", "+1"],
      ],
    });
  });

  it("drops the shields column for a size whose roles are launched without them", () => {
    const item = normalizeOne("starship-base-sizes", small);

    expect(item.tables[1]).toEqual({
      caption: "Roles",
      columns: [
        "Role",
        "Ability scores",
        "Armor",
        "Reactor",
        "Power coupling",
        "Speed / turning",
      ],
      rows: [
        ["Bomber", "Constitution +1", "Reinforced", "Fuel Cell", "Direct", "250/100 ft."],
      ],
    });
  });

  it("turns the nested hull pool into the expression a sheet prints", () => {
    const item = normalizeOne("starship-base-sizes", small);

    expect(item.summary.hullDice).toBe("3d6");
    expect(item.summary.modificationSlots).toBe(20);
    expect(item.summary.roles).toBe("Bomber");
    expect(item.stats).toContainEqual({
      label: "Ability adjustments",
      value: "Dexterity +2, Constitution -2",
    });
    expect(item.entries).toEqual([
      {
        group: "Features",
        name: "Pinpoint Strike",
        body: "Your ship finds the seam in a larger hull.",
      },
    ]);
  });

  it("says a Tiny hull holds no suites rather than leaving the line off", () => {
    // The printed table writes it as a dash, so the field is simply absent. A
    // missing line here would read as "not recorded" instead of "none".
    const item = normalizeOne("starship-base-sizes", {
      ...small,
      key: "tiny",
      name: "Tiny",
      modifications: { baseModificationSlots: 10 },
    });

    expect(item.stats).toContainEqual({ label: "Maximum suite systems", value: "None" });
  });
});

describe("starship deployments", () => {
  it("renders the rank table and keeps the station line as the tagline", () => {
    const item = normalizeOne("starship-deployments", {
      key: "gunner",
      name: "Gunner",
      sourceKey: "sotg",
      role: "Controls one or more weapon emplacements",
      rankProgression: [
        { rank: 1, features: ["Venture", "Gunner Techniques"] },
        { rank: 2, features: ["Gunning Style", "Improved Critical"] },
      ],
      features: [{ name: "Venture", description: "You choose a venture." }],
    });

    expect(item.tagline).toBe("Controls one or more weapon emplacements");
    expect(item.summary).toEqual({ role: "Controls one or more weapon emplacements" });
    expect(item.stats).toContainEqual({ label: "Ranks", value: "2" });
    expect(item.tables[0]).toEqual({
      caption: "Rank progression",
      columns: ["Rank", "Features"],
      rows: [
        ["1", "Venture, Gunner Techniques"],
        ["2", "Gunning Style, Improved Critical"],
      ],
    });
  });
});

describe("starship equipment", () => {
  it("carries both damage scales and the launcher for a piece of ammunition", () => {
    const item = normalizeOne("starship-equipment", {
      key: "proton-torpedo",
      name: "Proton torpedo",
      sourceKey: "sotg",
      category: "ammunition",
      costInCredits: 650,
      damage: { numberOfDice: 2, dieFaces: 10, type: "energy" },
      damageForLargerShips: { numberOfDice: 4, dieFaces: 10, type: "energy" },
      weightInPounds: 65,
      weightInPoundsForLargerShips: 130,
      range: { normal: 1200, long: 4800 },
      properties: ["explosive", "keen 1"],
      firedBy: ["Torpedo launcher", "Assault torpedo launcher"],
    });

    expect(item.summary.damage).toBe("2d10 energy");
    expect(item.stats).toContainEqual({
      label: "Damage, Huge and larger",
      value: "4d10 energy",
    });
    expect(item.stats).toContainEqual({ label: "Range", value: "1,200/4,800 ft." });
    expect(item.stats).toContainEqual({
      label: "Fired by",
      value: "Torpedo launcher, Assault torpedo launcher",
    });
  });

  it("says which weapon table a part belongs to rather than repeating a size word", () => {
    // The document's `small` and `huge` are the two printed weapon tables, not
    // the size of the gun. Shown verbatim they would read as a claim about the
    // weapon that is simply false.
    const item = normalizeOne("starship-equipment", {
      key: "assault-turbolaser-battery",
      name: "Assault turbolaser battery",
      sourceKey: "sotg",
      category: "weapon",
      costInCredits: 4150,
      weapon: { mounting: "secondary", weaponSize: "huge" },
      properties: ["power", "constitution 15"],
      damage: { numberOfDice: 6, dieFaces: 6, type: "energy" },
      range: { normal: 1200, long: 4800 },
    });

    expect(item.summary.mounting).toBe("Secondary");
    expect(item.tagline).toBe("Weapon · Secondary");
    expect(item.stats).toContainEqual({
      label: "Weapon table",
      value: "Huge and Gargantuan hulls",
    });
  });

  it("gives each system category only the lines that category has", () => {
    const shield = normalizeOne("starship-equipment", {
      key: "fortress-shield",
      name: "Fortress shield",
      sourceKey: "sotg",
      category: "shield",
      costInCredits: 4650,
      shield: { capacityMultiplier: "x 3/2", regenerationRateCoefficient: "x 2/3" },
    });
    const hyperdrive = normalizeOne("starship-equipment", {
      key: "hyperdrive-class-0-5",
      name: "Hyperdrive, class 0.5",
      sourceKey: "sotg",
      category: "hyperdrive",
      costInCredits: 50000,
      hyperdriveClass: "0.5",
    });

    expect(shield.stats.map((stat) => stat.label)).toEqual([
      "Category",
      "Cost",
      "Shield capacity",
      "Shield regeneration",
    ]);
    expect(hyperdrive.stats.map((stat) => stat.label)).toEqual([
      "Category",
      "Cost",
      "Hyperdrive class",
    ]);
  });
});

describe("starship modifications and ventures", () => {
  it("shows a prerequisite in the words the book used, not the resolved target", () => {
    const item = normalizeOne("starship-modifications", {
      key: "plating-reinforced-mk-iii",
      name: "Plating, Reinforced Mk III",
      sourceKey: "sotg",
      modificationType: "universal",
      grade: 3,
      prerequisites: [
        { kind: "equipment", text: "Reinforced Armor", equipmentName: "Reinforced armor" },
        {
          kind: "modification",
          text: "Plating, Reinforced MK II",
          modificationName: "Plating, Reinforced Mk II",
        },
      ],
      description: "You substantially upgrade your ship's armor plating.",
    });

    // The document carries the wording and the resolved name side by side, so a
    // link can be built without the page paraphrasing the book.
    expect(item.summary.prerequisite).toBe("Reinforced Armor, Plating, Reinforced MK II");
    expect(item.summary.grade).toBe(3);
    expect(item.tagline).toBe("Universal modification · grade 3");
  });

  it("lifts the hull requirement out of the prerequisite so 257 rows can be filtered", () => {
    const item = normalizeOne("starship-modifications", {
      key: "anti-boarding-system",
      name: "Anti-Boarding System",
      sourceKey: "sotg",
      modificationType: "universal",
      grade: 0,
      prerequisites: [
        {
          kind: "shipSize",
          text: "Ship size Medium or larger",
          shipSizes: ["medium", "large", "huge", "gargantuan"],
        },
        { kind: "modification", text: "Armory", modificationName: "Armory" },
      ],
      description: "Boarders are met by automated defences.",
    });

    // The leading words are identical on every one of these clauses, so the
    // facet lists only the tail that distinguishes them.
    expect(item.summary.requiresShipSize).toBe("Medium or larger");

    // And it is not repeated in the prerequisite column, which is the widest
    // one in the table.
    expect(item.summary.prerequisite).toBe("Armory");
    expect(item.stats).toContainEqual({ label: "Ship size", value: "Medium or larger" });
  });

  it("leaves the hull requirement empty for a modification any ship can fit", () => {
    const item = normalizeOne("starship-modifications", {
      key: "frame-mk-i",
      name: "Frame, Mk I",
      sourceKey: "sotg",
      modificationType: "universal",
      grade: 1,
      description: "Your ship's Constitution score increases by 1.",
    });

    expect(item.summary.requiresShipSize).toBeNull();
    expect(item.summary.prerequisite).toBeNull();
  });

  it("pulls the deployment out of a venture's prerequisite so it can be filtered on", () => {
    const item = normalizeOne("starship-ventures", {
      key: "lock-on-target",
      name: "Lock on Target",
      sourceKey: "sotg",
      prerequisites: [
        { kind: "casting", text: "The ability to cast tech powers" },
        {
          kind: "deploymentRank",
          text: "at least 1 rank in gunner",
          deploymentName: "Gunner",
          rank: 1,
        },
      ],
      description: "You mark the target.",
    });

    expect(item.summary.deployment).toBe("Gunner");
    expect(item.summary.characterClass).toBeNull();
    expect(item.summary.prerequisite).toBe(
      "The ability to cast tech powers, at least 1 rank in gunner",
    );
  });

  it("leaves the deployment empty for a venture gated on a class instead", () => {
    const item = normalizeOne("starship-ventures", {
      key: "analytical-coordinator",
      name: "Analytical Coordinator",
      sourceKey: "sotg",
      prerequisites: [
        {
          kind: "classLevel",
          text: "at least 1 level in scholar",
          className: "scholar",
          level: 1,
        },
      ],
      description: "Your ally rolls a d6.",
    });

    expect(item.summary.deployment).toBeNull();
    // Gated on a class instead, which is the other filter the list offers.
    expect(item.summary.characterClass).toBe("Scholar");
    expect(item.tagline).toBe("Requires at least 1 level in scholar");
  });
});

describe("rules", () => {
  /**
   * What a rules page says about a passage above the prose.
   *
   * The stat line used to read "Position: Chapter 3" and the tagline
   * "Player's Handbook · Chapter 3". Both were the last places on a rules page
   * still telling a reader where a passage fell in a PDF — a fact they cannot
   * act on, since there is no book in their hands to turn to page 3 of.
   */
  it("places a chapter by the heading it is read under, not by its page", () => {
    const item = normalizeOne("rules", {
      key: "phb-classes",
      name: "Classes",
      sourceKey: "phb",
      ruleType: "chapter",
      chapterNumber: 3,
      readingGroup: "Creating a character",
      order: 5,
      body: "# Classes\n\nA class is the primary definition of what a character can do.",
    });

    expect(item.stats).toContainEqual({
      label: "Position",
      value: "Creating a character",
    });
    expect(item.tagline).toBe(
      "Star Wars 5e Player's Handbook · Creating a character",
    );

    // Still carried in the summary. It is true about the archive and the
    // export needs it; it is simply not what a reader is shown.
    expect(item.summary.chapterNumber).toBe(3);
    expect(item.summary.order).toBe(5);
  });

  /**
   * The window the old label needed, and no longer does.
   *
   * `chapterLabel` suppressed anything outside 1..90 because the archive
   * numbers the handbook preface -2 and both changelogs 99, and "Chapter 99"
   * is not a chapter number a reader would recognise. An authored heading
   * needs no such window — it was written to be read rather than derived from
   * a page count — so the changelog now says where it sits instead of being
   * blank.
   */
  it("labels a passage the printed numbering could not", () => {
    const item = normalizeOne("rules", {
      key: "phb-changelog",
      name: "Changelog",
      sourceKey: "phb",
      ruleType: "chapter",
      chapterNumber: 99,
      readingGroup: "Reference",
      order: 15,
      body: "# Changelog\n\nCorrections since the last printing.",
    });

    expect(item.tagline).toBe("Star Wars 5e Player's Handbook · Reference");
    expect(item.stats).toContainEqual({ label: "Position", value: "Reference" });
  });

  /**
   * A variant rule is on no path at all, and says so instead.
   */
  it("says a variant rule is optional rather than placing it", () => {
    const item = normalizeOne("rules", {
      key: "flanking",
      name: "Flanking",
      sourceKey: "phb",
      ruleType: "variant",
      chapterNumber: null,
      body: "# Flanking\n\nA creature has advantage when it flanks.",
    });

    expect(item.tagline).toBe("Optional variant rule");
    expect(item.summary.ruleType).toBe("Variant");
    expect(item.summary.readingGroup).toBeNull();
    expect(item.summary.order).toBeNull();
  });

  /**
   * A chapter nobody has placed still renders, with no position rather than a
   * wrong one.
   */
  it("survives a chapter with no place on the path", () => {
    const item = normalizeOne("rules", {
      key: "wh-equipment",
      name: "Equipment",
      sourceKey: "wh",
      ruleType: "chapter",
      chapterNumber: 5,
      body: "# Equipment\n\nWhat you can buy in the lower levels.",
    });

    expect(item.tagline).toBe("Wretched Hives");
    expect(item.stats).not.toContainEqual(
      expect.objectContaining({ label: "Position" }),
    );
  });

  /**
   * The slug comes from the key, not the name.
   *
   * All three books have a chapter called "Equipment". Deriving from the name
   * would hand them the same slug and leave a collision handler to number
   * them, so which book `/rules/equipment` showed would depend on directory
   * order.
   */
  it("takes a chapter's slug from its key so three books can share a title", () => {
    const item = normalizeOne("rules", {
      key: "wh-equipment",
      name: "Equipment",
      sourceKey: "wh",
      ruleType: "chapter",
      chapterNumber: 5,
      body: "# Equipment\n\nWhat you can buy.",
    });

    expect(item.slug).toBe("wh-equipment");
  });
});

describe("starship rules", () => {
  it("takes a chapter's identity from its title and drops its duplicated heading", () => {
    const item = normalizeOne("starship-rules", {
      key: "combat",
      title: "Combat",
      sourceKey: "sotg",
      chapterNumber: 9,
      readingGroup: "Flying it",
      order: 10,
      body: "# Chapter 9: Combat\n\nAs the light freighter exits hyperspace.",
    });

    expect(item.name).toBe("Combat");
    expect(item.slug).toBe("combat");
    // The page prints the title as its own h1, so the body's copy of it would
    // be a second top-level heading saying the same thing.
    expect(item.sections).toEqual([
      { heading: null, body: "As the light freighter exits hyperspace." },
    ]);
  });

  /**
   * The authored path, carried through and shown instead of a page number.
   *
   * The fixture's two positions disagree on purpose — printed 9, tenth on the
   * path — because a chapter where they agreed would pass whichever field the
   * projection actually read.
   */
  it("carries the authored path and labels the chapter with its heading", () => {
    const item = normalizeOne("starship-rules", {
      key: "combat",
      title: "Combat",
      sourceKey: "sotg",
      chapterNumber: 9,
      readingGroup: "Flying it",
      order: 10,
      body: "# Combat\n\nAs the light freighter exits hyperspace.",
    });

    expect(item.summary).toEqual({
      readingGroup: "Flying it",
      order: 10,
      // Still carried. It is true about the archive and the export needs it;
      // it is simply not what the site navigates by.
      chapterNumber: 9,
    });

    // Not "Chapter 9". There is no book in the reader's hands to turn to.
    expect(item.tagline).toBe("Starships of the Galaxy · Flying it");
  });

  /**
   * A chapter nobody has placed still renders.
   *
   * Every chapter of this book is placed today and a test in the content
   * repository says so, but that is a fact about the corpus rather than a
   * guarantee about this function, and the two can drift the moment somebody
   * adds a fourteenth chapter.
   */
  it("survives a chapter with no place on the path", () => {
    const item = normalizeOne("starship-rules", {
      key: "errata",
      title: "Errata",
      sourceKey: "sotg",
      chapterNumber: 14,
      body: "# Errata\n\nCorrections.",
    });

    expect(item.summary.readingGroup).toBeNull();
    expect(item.summary.order).toBeNull();
    expect(item.tagline).toBe("Starships of the Galaxy");
  });
});
