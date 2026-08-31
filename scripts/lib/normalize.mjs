/**
 * Turns the legacy archive's Azure Table Storage dumps into the shape the UI
 * actually consumes.
 *
 * Three classes of legacy noise are stripped here so that no legacy field name
 * ever reaches a component:
 *
 *   - Storage plumbing: `partitionKey`, `rowKey`, `timestamp`, `eTag`.
 *   - Stringified duplicates: every `fooJson` field is a JSON-encoded copy of
 *     its `foo` sibling.
 *   - Paired enums: every `fooEnum` integer duplicates a human-readable `foo`.
 *     The readable sibling wins; the integer is dropped.
 *
 * What comes out is a small, uniform envelope (`stats`, `sections`, `entries`,
 * `tables`) that a detail page can render without knowing which of the eight
 * content types it is looking at. That matters because the types are wildly
 * uneven: a feat carries six fields and a monster carries forty-seven.
 */

import { repairText } from "./repair-text.mjs";

/** Content sources, expanded from the archive's abbreviations. */
const SOURCE_NAMES = {
  PHB: "Player's Handbook",
  EC: "Expanded Content",
  WH: "Wretched Hives",
  SnV: "Scum and Villainy",
};


export function slugify(name) {
  return String(name)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const LOWERCASE_JOINERS = new Set(["or", "and", "of", "the", "to"]);

/**
 * Expands the archive's PascalCase enum labels into prose: `MartialBlaster`
 * becomes `Martial blaster`, `WeaponOrArmorAccessory` becomes
 * `Weapon or armor accessory`.
 */
export function humanize(value) {
  if (value == null) return null;
  const words = String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return null;
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index === 0) return word[0].toUpperCase() + word.slice(1);
      if (LOWERCASE_JOINERS.has(lower)) return lower;
      return lower;
    })
    .join(" ");
}

/** Repairs a string field, collapsing "unknown" placeholders to null. */
function text(value) {
  const repaired = repairText(value);
  if (typeof repaired !== "string") return null;
  const trimmed = repaired.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "unknown") return null;
  return trimmed;
}

/**
 * Restores whitespace the scrape swallowed inside long prose fields.
 *
 * The 2022 scraper concatenated the PDF's text runs without separators, so 252
 * sentence boundaries in the corpus read as `torture.It was quarantined` and
 * every run-in heading is welded to the end of the previous sentence as
 * `protocol droids.***0-0-0.*** The Triple-Zero`.
 *
 * Two rules, both conservative:
 *
 *   - A lower-case letter, a period, then a capitalised word is a sentence
 *     boundary that lost its space. Only a space is restored — whether the
 *     original had a paragraph break there is unknowable, and inventing one
 *     would invent structure.
 *   - A bold-italic run before which a sentence ended is a run-in heading, and
 *     those always open a block in the source books, so that one does get a
 *     paragraph break.
 *
 * Applied only to prose, never to names or stat values, where a period between
 * two letters can be an abbreviation rather than a lost boundary.
 */
function restoreLostWhitespace(prose) {
  return splitRunInHeadings(prose).replace(
    /([a-z])\.([A-Z][a-z])/g,
    "$1. $2",
  );
}

/**
 * Puts a paragraph break in front of a run-in heading that the scrape welded
 * to the end of the previous sentence.
 *
 * This walks the delimiters rather than pattern-matching them. A regular
 * expression cannot tell an opening `***` from a closing one, and headings in
 * this corpus end with a period — `***History.***` — so a naive pattern reads
 * the closing delimiter as the start of the next run and cuts the heading in
 * half.
 */
function splitRunInHeadings(prose) {
  const parts = prose.split("***");
  for (let index = 1; index < parts.length; index += 2) {
    const preceding = parts[index - 1];
    if (/[.!?]$/.test(preceding)) parts[index - 1] = `${preceding}\n\n`;
  }
  return parts.join("***");
}

/** A long prose field: repaired, then given back the whitespace it lost. */
function proseText(value) {
  const repaired = text(value);
  return repaired == null ? null : restoreLostWhitespace(repaired);
}

function list(values) {
  if (!Array.isArray(values)) return null;
  const cleaned = values.map((value) => text(value)).filter(Boolean);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Marks the difference between "this creature has no languages" and "the
 * language line was destroyed in the scrape". Every one of the 103 fields in
 * the archive that holds nothing but a replacement character is an element of
 * a monster's `languages` or `senses` array, and the honest rendering is a
 * labelled absence rather than a silently missing row — or, worse, a guess
 * that the lost character meant "none".
 */
const LOST = Symbol("lost-in-source");

function listOrLost(values) {
  const cleaned = list(values);
  if (cleaned) return cleaned;
  const hadContent = Array.isArray(values) && values.length > 0;
  return hadContent ? LOST : null;
}

/**
 * Rewrites the archive's in-page anchors into real routes. Monster stat blocks
 * reference powers as `[force push](#force%20push)`, which pointed at an anchor
 * on the old single-page site. Anything that resolves to a known power becomes
 * a link to that power's page; anything else loses its link and keeps its text,
 * so a dead reference degrades to plain prose instead of a broken link.
 */
function rewriteReferences(markdown, powerSlugs) {
  if (!markdown) return markdown;
  return markdown
    .replace(/\[\s*\]\(#[^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\(#([^)]*)\)/g, (whole, label, target) => {
      let decoded;
      try {
        decoded = decodeURIComponent(target);
      } catch {
        decoded = target;
      }
      const slug = slugify(decoded);
      return powerSlugs.has(slug) ? `[${label}](/powers/${slug})` : label;
    })
    .replace(/[ \t]{2,}/g, " ");
}

/** Collects `{ label, value }` pairs, skipping anything empty. */
function statCollector() {
  const stats = [];
  return {
    /**
     * `href` is optional and is only ever supplied where the value names
     * exactly one document the site publishes, so a linked stat is a resolved
     * cross-reference rather than a guess at one.
     */
    add(label, value, href) {
      if (value == null) return;
      if (value === LOST) {
        stats.push({ label, value: null, lost: true });
        return;
      }
      if (Array.isArray(value)) {
        if (value.length === 0) return;
        stats.push({ label, value: value.join(", ") });
        return;
      }
      const asText = typeof value === "string" ? value.trim() : String(value);
      if (asText === "") return;
      stats.push(href ? { label, value: asText, href } : { label, value: asText });
    },
    stats,
  };
}

function section(heading, body) {
  return body ? { heading, body } : null;
}

function compact(values) {
  return values.filter(Boolean);
}

/** `[[{abilities:["Intelligence"],amount:2}]]` becomes `Intelligence +2`. */
function formatAbilityIncreases(raw) {
  if (!Array.isArray(raw)) return null;
  const parts = raw
    .flat()
    .filter((entry) => entry && Array.isArray(entry.abilities))
    .map((entry) => `${entry.abilities.join(" or ")} +${entry.amount}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Roll tables: `[{roll, name, description}]` becomes a captioned table. */
function rollTable(caption, options, valueHeader) {
  if (!Array.isArray(options) || options.length === 0) return null;
  const rows = options
    .map((option) => {
      const name = text(option?.name);
      const description = text(option?.description);
      const value = name ?? description;
      if (!value) return null;
      const detail = name ? description : null;
      return [
        String(option?.roll ?? ""),
        detail ? `${value} — ${detail}` : value,
      ];
    })
    .filter(Boolean);
  if (rows.length === 0) return null;
  return { caption, columns: [`d${rows.length}`, valueHeader], rows };
}

function challengeRatingValue(raw) {
  if (typeof raw !== "string") return null;
  if (raw.includes("/")) {
    const [numerator, denominator] = raw.split("/").map(Number);
    return denominator ? numerator / denominator : null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function numeric(raw) {
  if (raw == null || raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function common(record) {
  const source = text(record.contentSource);
  return {
    name: text(record.name) ?? String(record.name ?? "").trim(),
    slug: slugify(record.name),
    source,
    sourceName: source ? (SOURCE_NAMES[source] ?? source) : null,
  };
}

/* ---------------------------------------------------------------- species */

function normalizeSpecies(record) {
  const base = common(record);
  const { add, stats } = statCollector();
  const abilityIncreases = formatAbilityIncreases(record.abilitiesIncreased);

  add("Size", text(record.size));
  add("Homeworld", text(record.homeworld));
  add("Language", text(record.language));
  add("Ability increases", abilityIncreases);
  add("Distinctions", text(record.distinctions));
  add("Average height", text(record.heightAverage));
  add("Height modifier", text(record.heightRollMod));
  add("Average weight", text(record.weightAverage));
  add("Weight modifier", text(record.weightRollMod));
  add("Skin colors", text(record.skinColorOptions));
  add("Hair colors", text(record.hairColorOptions));
  add("Eye colors", text(record.eyeColorOptions));
  add("Color scheme", text(record.colorScheme));
  add("Manufacturer", text(record.manufacturer));

  return {
    ...base,
    tagline:
      compact([text(record.size), text(record.homeworld)]).join(" · ") || null,
    summary: {
      size: text(record.size),
      homeworld: text(record.homeworld),
      language: text(record.language),
      abilityIncreases,
    },
    stats,
    sections: compact([section(null, proseText(record.flavorText))]),
    entries: (record.traits ?? [])
      .map((trait) => ({
        group: "Traits",
        name: text(trait?.name),
        body: proseText(trait?.description),
      }))
      .filter((entry) => entry.name || entry.body),
    tables: [],
  };
}

/* --------------------------------------------------------------- monsters */

const ABILITIES = [
  ["Strength", "strength", "strengthModifier"],
  ["Dexterity", "dexterity", "dexterityModifier"],
  ["Constitution", "constitution", "constitutionModifier"],
  ["Intelligence", "intelligence", "intelligenceModifier"],
  ["Wisdom", "wisdom", "wisdomModifier"],
  ["Charisma", "charisma", "charismaModifier"],
];

function normalizeMonster(record, powerSlugs) {
  const base = common(record);
  const { add, stats } = statCollector();

  // The archive stores a literal "CR" for one creature whose table header
  // leaked into the data. It is not a rating, so it is dropped.
  const rawRating = text(record.challengeRating);
  const challengeRating = rawRating === "CR" ? null : rawRating;
  const kind = text((record.types ?? [])[0]);
  const armorClass = numeric(record.armorClass);
  const hitPoints = numeric(record.hitPoints);
  const armorType = text(record.armorType);
  const hitPointRoll = text(record.hitPointRoll);

  add(
    "Armor Class",
    armorClass == null
      ? null
      : armorType
        ? `${armorClass} (${armorType})`
        : String(armorClass),
  );
  add(
    "Hit Points",
    hitPoints == null
      ? null
      : hitPointRoll
        ? `${hitPoints} (${hitPointRoll})`
        : String(hitPoints),
  );
  add("Speed", text(record.speeds));
  add("Saving Throws", list(record.savingThrows));
  add("Skills", list(record.skills));
  add("Damage Vulnerabilities", list(record.damageVulnerabilities));
  add("Damage Resistances", list(record.damageResistances));
  add("Damage Immunities", list(record.damageImmunities));
  add("Condition Immunities", list(record.conditionImmunities));
  add("Senses", listOrLost(record.senses));
  add("Languages", listOrLost(record.languages));
  add(
    "Challenge",
    challengeRating == null
      ? null
      : record.experiencePoints
        ? `${challengeRating} (${Number(record.experiencePoints).toLocaleString("en-US")} XP)`
        : challengeRating,
  );

  const alignment = text(record.alignment);

  return {
    ...base,
    tagline:
      compact([text(record.size), kind]).join(" ") +
      (alignment ? `, ${alignment}` : ""),
    summary: {
      size: text(record.size),
      kind,
      alignment,
      challengeRating,
      challengeRatingValue: challengeRatingValue(challengeRating),
      armorClass,
      hitPoints,
    },
    abilityScores: ABILITIES.map(([label, scoreKey, modifierKey]) => ({
      ability: label,
      score: numeric(record[scoreKey]),
      modifier: numeric(record[modifierKey]),
    })).filter((entry) => entry.score != null),
    stats,
    sections: compact([
      section(null, rewriteReferences(proseText(record.flavorText), powerSlugs)),
      section(
        "About this creature",
        rewriteReferences(proseText(record.sectionText), powerSlugs),
      ),
    ]),
    entries: (record.behaviors ?? [])
      .map((behavior) => ({
        group: humanizeGroup(behavior?.monsterBehaviorType),
        name: text(behavior?.name),
        body: rewriteReferences(
          proseText(behavior?.descriptionWithLinks) ?? proseText(behavior?.description),
          powerSlugs,
        ),
      }))
      .filter((entry) => entry.name || entry.body),
    tables: [],
  };
}

/** Stat-block section headings are plural: `Trait` becomes `Traits`. */
function humanizeGroup(value) {
  const label = humanize(value);
  if (!label) return "Traits";
  const capitalized = label[0].toUpperCase() + label.slice(1);
  return capitalized.endsWith("s") ? capitalized : `${capitalized}s`;
}

/* ----------------------------------------------------------------- powers */

function normalizePower(record) {
  const base = common(record);
  const { add, stats } = statCollector();
  const level = numeric(record.level);
  const powerType = text(record.powerType);
  const castingPeriod = humanize(record.castingPeriod);
  const forceAlignment = text(record.forceAlignment);

  add("Casting time", text(record.castingPeriodText) ?? castingPeriod);
  add("Range", text(record.range));
  add("Duration", text(record.duration));
  add("Concentration", record.concentration ? "Yes" : "No");
  if (powerType === "Force" && forceAlignment && forceAlignment !== "None") {
    add("Force alignment", forceAlignment);
  }
  add("Prerequisite", text(record.prerequisite));

  return {
    ...base,
    tagline:
      level === 0
        ? `At-will ${(powerType ?? "").toLowerCase()} power`.trim()
        : `Level ${level} ${(powerType ?? "").toLowerCase()} power`.trim(),
    summary: {
      level,
      powerType,
      castingPeriod,
      range: text(record.range),
      duration: text(record.duration),
      concentration: Boolean(record.concentration),
      forceAlignment:
        powerType === "Force" && forceAlignment !== "None"
          ? forceAlignment
          : null,
    },
    stats,
    sections: compact([
      section(null, proseText(record.description)),
      section("At higher levels", proseText(record.higherLevelDescription)),
    ]),
    entries: [],
    tables: [],
  };
}

/* -------------------------------------------------------------- equipment */

function formatDamage(record) {
  const dice = numeric(record.damageNumberOfDice);
  const die = numeric(record.damageDieType);
  if (!dice || !die) return null;
  const modifier = numeric(record.damageDieModifier);
  const damageType = text(record.damageType);
  const roll = `${dice}d${die}${modifier ? ` + ${modifier}` : ""}`;
  return damageType ? `${roll} ${damageType.toLowerCase()}` : roll;
}

function normalizeEquipment(record) {
  const base = common(record);
  const { add, stats } = statCollector();
  const category = humanize(record.equipmentCategory);
  const damage = formatDamage(record);
  const cost = numeric(record.cost);
  const weight = numeric(record.weight);
  const armorClass = text(record.ac);
  const properties = list(record.properties);
  const weaponType = humanize(record.weaponClassification);
  const armorType = humanize(record.armorClassification);

  add("Category", category);
  add("Cost", cost == null ? null : `${cost.toLocaleString("en-US")} cr`);
  add("Weight", weight == null ? null : `${weight} lb.`);
  add("Damage", damage);
  add("Weapon type", weaponType);
  add("Armor type", armorType);
  add("Armor Class", armorClass);
  add("Strength requirement", text(record.strengthRequirement));
  if (record.stealthDisadvantage) add("Stealth", "Disadvantage");
  add("Properties", properties);

  return {
    ...base,
    tagline: compact([category, weaponType, armorType]).join(" · ") || null,
    summary: {
      category,
      cost,
      weight,
      damage,
      armorClass,
      properties: properties ? properties.join(", ") : null,
    },
    stats,
    sections: compact([section(null, proseText(record.description))]),
    entries: [],
    tables: [],
  };
}

/* ------------------------------------------------------------------ feats */

function normalizeFeat(record) {
  const base = common(record);
  const { add, stats } = statCollector();
  const prerequisite = text(record.prerequisite);
  const abilityIncreases = list(record.attributesIncreased);

  add("Prerequisite", prerequisite);
  add("Ability increases", abilityIncreases);

  return {
    ...base,
    tagline: prerequisite ? `Requires ${prerequisite}` : "No prerequisite",
    summary: {
      prerequisite,
      abilityIncreases: abilityIncreases ? abilityIncreases.join(", ") : null,
    },
    stats,
    sections: compact([section(null, proseText(record.text))]),
    entries: [],
    tables: [],
  };
}

/* ------------------------------------------------------------ backgrounds */

function normalizeBackground(record) {
  const base = common(record);
  const { add, stats } = statCollector();
  const skillProficiencies = text(record.skillProficiencies);
  const featureName = text(record.featureName);
  const languages = text(record.languages);

  add("Skill proficiencies", skillProficiencies);
  add("Tool proficiencies", text(record.toolProficiencies));
  add("Languages", languages);
  add("Equipment", text(record.equipment));

  return {
    ...base,
    tagline: featureName ? `Feature: ${featureName}` : null,
    summary: { feature: featureName, skillProficiencies, languages },
    stats,
    sections: compact([
      section(null, proseText(record.flavorText)),
      section(
        "Suggested characteristics",
        proseText(record.suggestedCharacteristics),
      ),
    ]),
    entries: compact([
      featureName && proseText(record.featureText)
        ? { group: "Feature", name: featureName, body: proseText(record.featureText) }
        : null,
    ]),
    tables: compact([
      rollTable(
        text(record.flavorName) ?? "Specialty",
        record.flavorOptions,
        "Specialty",
      ),
      rollTable("Personality traits", record.personalityTraitOptions, "Trait"),
      rollTable("Ideals", record.idealOptions, "Ideal"),
      rollTable("Bonds", record.bondOptions, "Bond"),
      rollTable("Flaws", record.flawOptions, "Flaw"),
      rollTable("Feat options", record.featOptions, "Feat"),
    ]),
  };
}

/* ------------------------------------------------------------- archetypes */

function normalizeArchetype(record) {
  const base = common(record);
  const { add, stats } = statCollector();
  const className = text(record.className);
  const rawCasterType = text(record.casterType);
  const casterType = rawCasterType === "None" ? null : rawCasterType;

  add("Class", className);
  add("Casting", casterType);

  return {
    ...base,
    tagline: className ? `${className} archetype` : null,
    summary: { className, casterType },
    stats,
    sections: compact([
      section(null, proseText(record.text)),
      section(null, proseText(record.text2)),
    ]),
    entries: [],
    tables: [],
  };
}

/* ---------------------------------------------------------------- classes */

/**
 * The class level table, out of the archive's shape.
 *
 * The archive stores it as an object keyed by level, each value an object keyed
 * by printed column heading, in printed column order. Two of those columns are
 * dropped: "Level" duplicates the row's own key, and "Features" is pulled out
 * ahead of the rest so it keeps its place immediately after the proficiency
 * bonus whatever else the class prints.
 */
function classProgressionTable(levelChanges) {
  if (!levelChanges || typeof levelChanges !== "object") return null;

  const levels = Object.keys(levelChanges)
    .filter((key) => /^\d+$/.test(key))
    .sort((left, right) => Number(left) - Number(right));

  if (levels.length === 0) return null;

  const fixed = new Set(["Level", "Proficiency Bonus", "Features"]);
  const labels = [];
  for (const level of levels) {
    for (const label of Object.keys(levelChanges[level] ?? {})) {
      if (!fixed.has(label) && !labels.includes(label)) labels.push(label);
    }
  }

  const rows = levels.map((level) => {
    const row = levelChanges[level] ?? {};
    return [
      ordinal(Number(level)),
      text(row["Proficiency Bonus"]) ?? "—",
      text(row.Features) ?? "—",
      ...labels.map((label) => text(row[label]) ?? "—"),
    ];
  });

  return {
    caption: "Class progression",
    columns: ["Level", "Proficiency Bonus", "Features", ...labels],
    rows,
  };
}

/** `1` becomes `1st`. Levels are printed as ordinals throughout the corpus. */
function ordinal(level) {
  if (level == null || !Number.isFinite(level)) return null;
  const rest = level % 100;
  if (rest >= 11 && rest <= 13) return `${level}th`;
  return `${level}${["th", "st", "nd", "rd"][level % 10] ?? "th"}`;
}

/**
 * One printed proficiency line, rebuilt from the commas the scrape split it on.
 * "None" is how the archive writes an empty line.
 */
function proficiencyLine(values) {
  const parts = list(values);
  if (!parts || (parts.length === 1 && parts[0] === "None")) return null;
  return parts.join(", ");
}

function normalizeClass(record) {
  const base = common(record);
  const { add, stats } = statCollector();
  const primaryAbility = text(record.primaryAbility);
  const hitDie = numeric(record.hitDiceDieType);
  const rawCasterType = text(record.casterType);
  const casterType = rawCasterType === "None" ? null : rawCasterType;

  add("Primary ability", primaryAbility);
  add("Hit die", hitDie == null ? null : `d${hitDie}`);
  add("Hit points at 1st level", text(record.hitPointsAtFirstLevel));
  add("Hit points at higher levels", text(record.hitPointsAtHigherLevels));
  add("Saving throws", list(record.savingThrows));
  add("Armor", proficiencyLine(record.armorProficiencies));
  add("Weapons", proficiencyLine(record.weaponProficiencies));
  add("Tools", proficiencyLine(record.toolProficiencies));
  add("Skills", text(record.skillChoices));
  add("Starting wealth", text(record.startingWealthVariant));
  add("Casting", casterType);
  add("Multiclass proficiencies", proficiencyLine(record.multiClassProficiencies));

  return {
    ...base,
    tagline:
      compact([
        hitDie == null ? null : `d${hitDie} hit die`,
        primaryAbility,
        casterType ? `${casterType} casting` : null,
      ]).join(" · ") || null,
    summary: { primaryAbility, hitDie, casterType, archetypeCount: null },
    stats,
    sections: compact([
      section(null, proseText(record.flavorText)),
      section(null, proseText(record.classFeatureText)),
      section(text(record.archetypeFlavorName), proseText(record.archetypeFlavorText)),
      section(`Creating a ${base.name.toLowerCase()}`, proseText(record.creatingText)),
      section("Quick build", proseText(record.quickBuildText)),
      section("Starting equipment", proseText((list(record.equipmentLines) ?? []).join("\n"))),
    ]),
    entries: [],
    tables: compact([classProgressionTable(record.levelChanges)]),
  };
}

/* ------------------------------------------------------- class improvements */

const IMPROVEMENT_LABELS = {
  class: "Class Improvement",
  multiclass: "Multiclass Improvement",
  splashclass: "Splashclass Improvement",
};

const IMPROVEMENT_TAGLINES = {
  class: "Taken while advancing in the class",
  multiclass: "What the class contributes to a multiclassed character",
  splashclass: "Available without any levels in the class",
};

/**
 * One of the three per-class improvement rules.
 *
 * The archive puts the class name in `name` and records the kind nowhere at
 * all — the file it came from is the only thing that says which of the three
 * this is, so the reader tags each record with `improvementType` before it
 * reaches here. Both the display name and the slug are rebuilt from the pair,
 * because ten records called "Berserker" across three files would otherwise
 * collide into one URL and read as three copies of one entry.
 */
function normalizeClassImprovement(record) {
  const className = text(record.name);
  const improvementType = text(record.improvementType);
  const name = `${className} ${IMPROVEMENT_LABELS[improvementType] ?? "Improvement"}`;
  const source = text(record.contentSource);
  const { add, stats } = statCollector();
  const prerequisite = text(record.prerequisite);

  add("Class", className);
  add("Kind", improvementType ? humanize(improvementType) : null);
  add("Prerequisite", prerequisite);

  return {
    name,
    slug: slugify(name),
    source,
    sourceName: source ? (SOURCE_NAMES[source] ?? source) : null,
    tagline: improvementType ? (IMPROVEMENT_TAGLINES[improvementType] ?? null) : null,
    summary: {
      className,
      improvementType: improvementType ? humanize(improvementType) : null,
      prerequisite,
    },
    stats,
    sections: compact([section(null, proseText(record.description))]),
    entries: [],
    tables: [],
  };
}

/* --------------------------------------------------------------- features */

/**
 * One granted ability.
 *
 * The archive has no key for a feature and its name is nowhere near unique —
 * "Ability Score Improvement" appears forty times — so the URL is built the way
 * the canonical set builds its key: from the granting kind, the granting entry,
 * the name and the level.
 *
 * Nothing here links back to the class or archetype that grants it, which the
 * canonical mapping does do. That link needs a stable key on both ends, and the
 * archive has one on neither; this path exists to keep a dataset buildable
 * without the canonical set, not to reproduce everything it can express.
 */
function normalizeFeature(record) {
  const source = text(record.source);
  const grantedByName = text(record.sourceName);
  const level = numeric(record.level);
  const { add, stats } = statCollector();

  add("Granted by", grantedByName);
  add("Level", ordinal(level));

  return {
    name: text(record.name) ?? String(record.name ?? "").trim(),
    slug: slugify(
      [source, grantedByName, record.name, level == null ? null : String(level)]
        .filter(Boolean)
        .join(" "),
    ),
    // A feature record carries no provenance of its own. The canonical import
    // derives it from the granting entry; this path leaves it unattributed
    // rather than guessing, and the badge is simply absent.
    source: null,
    sourceName: null,
    tagline:
      compact([grantedByName, level == null ? null : `${ordinal(level)} level`]).join(" · ") ||
      null,
    summary: {
      grantedBy: source ? humanize(source) : null,
      grantedByName,
      level,
    },
    stats,
    sections: compact([section(null, proseText(record.text))]),
    entries: [],
    tables: [],
  };
}

/* -------------------------------------------------------------- maneuvers */

/**
 * The archive stores every combat option as one prose blob, while the site's
 * rows and pages want the structure that is written inside it. The four rules
 * below each key off a marker the source prints — the phrase that spends a die,
 * the parenthesised tier on an upgrade's name, the italic prerequisite run-in,
 * the markdown bullet — so nothing here interprets a sentence, and each one
 * produces the same fields the canonical mapping in `canonical.mjs` reads
 * straight out of a document. That correspondence is the point: a dataset built
 * from the archive and one built from the canonical set have to be
 * interchangeable, and these types are where the two inputs are furthest apart.
 */
const EXPENDS_SUPERIORITY_DIE =
  /expend(?:ing)?(?:\s+and\s+roll(?:ing)?)?\s+(?:a|one)\s+superiority\s+(?:die|dice)/i;

const MANEUVER_TIER = /\s*\((?:Improved|Greater)\)$/;

const PREREQUISITE_RUN_IN = /^_\*\*Prerequisite:\*\*\s*(.+?)_\s*\n/;

/** Splits the italic prerequisite line off the front of an entry. */
function takePrerequisite(prose) {
  if (!prose) return { prerequisite: null, body: "" };
  const match = PREREQUISITE_RUN_IN.exec(prose);
  if (!match) return { prerequisite: null, body: prose };
  return { prerequisite: text(match[1]), body: prose.slice(match[0].length) };
}

/** Lead prose, then one entry per printed bullet. */
function takeBenefits(prose) {
  const lines = (prose ?? "").split("\n");
  const first = lines.findIndex((line) => line.startsWith("- "));
  if (first < 0) return { lead: text(prose), benefits: [] };
  return {
    lead: text(lines.slice(0, first).join("\n")),
    benefits: lines
      .slice(first)
      .filter((line) => line.startsWith("- "))
      .map((line) => ({ group: "Benefits", name: null, body: text(line.slice(2)) }))
      .filter((entry) => entry.body),
  };
}

function normalizeManeuver(record) {
  const base = common(record);
  const { add, stats } = statCollector();
  const kind = text(record.type);
  const prerequisite = text(record.prerequisite);
  const description = proseText(record.description);
  const name = base.name;
  const improved = MANEUVER_TIER.test(name) ? name.replace(MANEUVER_TIER, "") : null;
  const superiorityDice =
    description && EXPENDS_SUPERIORITY_DIE.test(description) ? 1 : 0;

  add("Type", kind);
  add("Cost", superiorityDice === 0 ? "No superiority die" : "1 superiority die");
  add("Prerequisite", prerequisite);
  add("Improves", improved);

  return {
    ...base,
    tagline: improved
      ? `Improves ${improved}`
      : kind
        ? `${kind} maneuver`
        : null,
    summary: { kind, prerequisite, superiorityDice, improves: improved },
    stats,
    sections: compact([section(null, description)]),
    entries: [],
    tables: [],
  };
}

function normalizeFightingOption(record) {
  const base = common(record);
  const { add, stats } = statCollector();
  // Fighting styles keep their rules in `description`; fighting masteries keep
  // theirs in `text`. The archive is not consistent about which name a prose
  // field gets, so both are read rather than one being assumed.
  const { prerequisite, body } = takePrerequisite(
    proseText(record.description ?? record.text),
  );
  const { lead, benefits } = takeBenefits(body);

  add("Prerequisite", prerequisite);
  add("Benefits", benefits.length === 0 ? null : String(benefits.length));

  return {
    ...base,
    tagline: prerequisite ? `Requires ${prerequisite}` : "No prerequisite",
    summary: { prerequisite, benefits: benefits.length },
    stats,
    sections: compact([section(null, lead)]),
    entries: benefits,
    tables: [],
  };
}

/**
 * The eight weapon groups, read off the entry's name. Three carry the word
 * "Weapon" in print and five do not, so the group comes from a table rather
 * than from lower-casing whatever is left.
 */
const WEAPON_GROUPS = {
  Blade: "Blade",
  Carbine: "Carbine",
  "Crushing Weapon": "Crushing",
  "Heavy Weapon": "Heavy",
  Polearm: "Polearm",
  Rifle: "Rifle",
  Sidearm: "Sidearm",
  "Trip Weapon": "Trip",
};

function normalizeWeaponTraining(suffix) {
  return (record) => {
    const base = common(record);
    const { add, stats } = statCollector();
    const stem = base.name.endsWith(suffix)
      ? base.name.slice(0, -suffix.length)
      : base.name;
    const weaponGroup = WEAPON_GROUPS[stem] ?? null;
    const { lead, benefits } = takeBenefits(proseText(record.description));

    add("Weapon group", weaponGroup);
    add("Benefits", benefits.length === 0 ? null : String(benefits.length));

    return {
      ...base,
      tagline: weaponGroup ? `${weaponGroup} weapons` : null,
      summary: { weaponGroup, benefits: benefits.length },
      stats,
      sections: compact([section(null, lead)]),
      entries: benefits,
      tables: [],
    };
  };
}

/**
 * A lightsaber form does one thing as part of the bonus action that adopts it
 * and another for as long as it is held. The books tie the first kind to that
 * bonus action with a fixed sentence, and the paragraph break separates the
 * two, so the split is read off the page rather than judged.
 */
const FORM_ADOPTION_CLAUSE = "As a part of the bonus action to adopt this form";

const FORM_TIMINGS = {
  onAdopt: "As you adopt this form",
  active: "While this form is held",
};

function normalizeLightsaberForm(record) {
  const base = common(record);
  const { add, stats } = statCollector();
  const { prerequisite, body } = takePrerequisite(proseText(record.description));
  const paragraphs = (body ?? "")
    .split("\n\n")
    .map((paragraph) => text(paragraph))
    .filter(Boolean);
  const onAdopt = paragraphs.some((paragraph) =>
    paragraph.startsWith(FORM_ADOPTION_CLAUSE),
  );

  add("Prerequisite", prerequisite);
  add("Adopted as", "Bonus action");

  return {
    ...base,
    tagline: onAdopt ? "Acts as you adopt it" : "Active while held",
    summary: { prerequisite, onAdopt },
    stats,
    sections: paragraphs.map((paragraph) =>
      section(
        paragraph.startsWith(FORM_ADOPTION_CLAUSE)
          ? FORM_TIMINGS.onAdopt
          : FORM_TIMINGS.active,
        paragraph,
      ),
    ),
    entries: [],
    tables: [],
  };
}

/* --------------------------------------------------------- enhanced items */

/**
 * Rarity in ascending order. The archive spells it four ways — a one-element
 * `rarityOptions` array, a stringified `rarityOptionsJson` duplicate, an
 * inconsistently cased `rarityText`, and a `searchableRarity` left over from
 * the old site's search box — and the array is the one that is uniform across
 * all 1,918 records.
 *
 * The order is the game's ladder rather than the alphabet, because rarity is
 * this corpus's substitute for a price: nothing in it has a cost in credits,
 * so rarity is the only column a reader can rank items by.
 */
const RARITY_ORDER = [
  "standard",
  "premium",
  "prototype",
  "advanced",
  "legendary",
  "artifact",
];

/**
 * An enhanced item.
 *
 * Ten `*Type` discriminator fields are dropped in favour of `subtype`. At most
 * one of the ten is ever set on a record and all ten are "None" on more than
 * half of them, while `subtype` is populated wherever the item has a kind at
 * all — and says it more precisely: `itemModificationType` records "Augment"
 * or nothing, where `subtype` records the wristpad, blaster or suit of armour
 * the modification actually goes into.
 */
function normalizeEnhancedItem(record, _powerSlugs, graph) {
  const base = common(record);
  const { add, stats } = statCollector();
  const itemType = humanize(record.type);
  const rarityKey = (record.rarityOptions?.[0] ?? "").toLowerCase();
  const rarity = humanize(rarityKey);
  const subtype = text(record.subtype)?.toLowerCase() ?? null;
  // Every archived prerequisite carries a stray leading space, and a third of
  // them lower-case a first word the rest capitalise.
  const prerequisiteText = text(record.prerequisite);
  const prerequisite = prerequisiteText
    ? prerequisiteText[0].toUpperCase() + prerequisiteText.slice(1)
    : null;
  const requiresAttunement = Boolean(record.requiresAttunement);

  add("Rarity", rarity);
  add("Item type", itemType);
  add(
    record.type === "ItemModification" ? "Installed in" : "Kind",
    subtype ? subtype[0].toUpperCase() + subtype.slice(1) : null,
    // The one link between the two gear types. See `equipmentRoute` in
    // canonical.mjs for why the match has to be a whole name and nothing
    // looser.
    graph?.equipmentRoute?.(subtype) ?? null,
  );
  add("Attunement", requiresAttunement ? "Required" : "Not required");
  add("Prerequisite", prerequisite);

  return {
    ...base,
    tagline: compact([rarity, itemType?.toLowerCase()]).join(" ") || null,
    summary: {
      itemType,
      rarity,
      rarityRank: RARITY_ORDER.indexOf(rarityKey),
      subtype,
      requiresAttunement,
      prerequisite,
    },
    stats,
    sections: compact([section(null, proseText(record.text))]),
    entries: [],
    tables: [],
  };
}

/* ------------------------------------------- weapon and armour properties */

/**
 * A weapon or armour property glossary entry.
 *
 * These records have no usable provenance: the archive gives all seventy-six a
 * `contentSource` of "None", and the file they came from names the kind of
 * property rather than a book. `common` would turn that into a source badge
 * reading "None", so the fields are built here instead and the badge is left
 * off. A guessed citation on a rules page is worse than no citation.
 */
function normalizeProperty(record) {
  const name = text(record.name) ?? String(record.name ?? "").trim();
  // The archived text opens with a level-four heading repeating the property's
  // name. The page prints the name as its own heading, so keeping it would
  // show the title twice.
  const description = stripLeadingHeading(proseText(record.content), name);

  return {
    name,
    slug: slugify(record.name),
    source: null,
    sourceName: null,
    tagline: null,
    summary: { summaryLine: firstSentence(description) },
    stats: [],
    sections: compact([section(null, description)]),
    entries: [],
    tables: [],
  };
}

/** Drops a leading markdown heading that says nothing but the given title. */
function stripLeadingHeading(body, title) {
  if (!body) return body;
  const match = /^\s*#{1,6}\s*([^\n]*?)\s*(?:\n|$)/.exec(body);
  if (!match) return body;
  const comparable = (value) => value.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const heading = match[1].replace(/^chapter\s+-?\d+\s*[:.]?\s*/i, "");
  if (comparable(heading) !== comparable(title)) return body;
  return body.slice(match[0].length).replace(/^\n+/, "");
}

/** The opening sentence of a rule, which is what a glossary is scanned by. */
function firstSentence(markdown) {
  if (!markdown) return null;
  const paragraph = markdown.split("\n\n")[0].replace(/\s+/g, " ").trim();
  const stop = paragraph.search(/\.(?:\s|$)/);
  return stop === -1 ? paragraph : paragraph.slice(0, stop + 1);
}

/* ------------------------------------------------------------------ rules */

/**
 * Which book each archive file of rules records belongs to, and whether its
 * records are chapters of that book or free-standing variant rules.
 *
 * This table is the whole provenance story for the rules corpus. Every one of
 * the 76 records has a `contentSource` of "None", so nothing inside a record
 * says which book printed it; the file it sits in is unambiguous and is the
 * only evidence there is. `VariantRule` is attributed to the Expanded Content
 * supplement because that is the book whose "Variant Rules" chapter prints
 * them, and because every one of its records is already marked as expanded
 * content.
 */
const RULE_BOOKS = {
  phb: { source: "PHB", ruleType: "Chapter" },
  wh: { source: "WH", ruleType: "Chapter" },
  ec: { source: "EC", ruleType: "Chapter" },
  variant: { source: "EC", ruleType: "Variant" },
};

/**
 * Splits a passage of rules prose into the sections a reader navigates it by.
 *
 * Rules are the one content type in the corpus that is prose rather than a
 * catalogue row, and the passages are long: the Expanded Content archetypes
 * chapter is close to half a megabyte. Rendered as one undivided block it is
 * hard to read and, worse, hard to find anything in — the search index keeps a
 * fixed-length excerpt of an item's prose, so without this only a chapter's
 * first paragraph would ever match a query.
 *
 * The split is on the shallowest heading level the passage actually uses,
 * because the corpus is not consistent about depth: a Player's Handbook
 * chapter divides at `##`, the conditions appendix at `####`, and a short
 * variant rule may have no headings at all. Taking the shallowest level gives
 * each passage its own top-level divisions at whatever depth it wrote them.
 * Level 1 is excluded — a lone `#` is the chapter's own title, which the
 * import strips from the front of a body but which two passages carry in the
 * middle of one.
 */
export function splitIntoSections(body) {
  const lines = body.split("\n");
  const depths = lines
    .map((line) => /^(#{2,6})\s+\S/.exec(line))
    .filter(Boolean)
    .map((match) => match[1].length);

  if (depths.length === 0) return [{ heading: null, body }];

  const pattern = new RegExp(`^#{${Math.min(...depths)}}\\s+(.*)$`);
  const sections = [];
  let heading = null;
  let buffer = [];

  const flush = () => {
    const collected = buffer.join("\n").trim();
    if (heading || collected) sections.push({ heading, body: collected });
    buffer = [];
  };

  for (const line of lines) {
    const match = pattern.exec(line);
    if (match) {
      flush();
      heading = match[1].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();

  return sections;
}

/**
 * A chapter's position in its book, as a label, or null when printing it would
 * mislead. The archive numbers the Player's Handbook preface -2 and both
 * changelogs 99, and neither is a chapter number a reader would recognise.
 */
function chapterLabel(chapterNumber) {
  const value = numeric(chapterNumber);
  if (value == null || value < 1 || value > 90) return null;
  return `Chapter ${value}`;
}

/**
 * A chapter of a book, or one optional variant rule.
 *
 * This is the only normalizer that needs to know which file its record came
 * from, and `normalizeAll` is what passes it down. Chapter slugs carry the
 * book's abbreviation because seven chapter titles are printed in more than
 * one book — all three print one called "Equipment" — and an unqualified slug
 * would collide.
 */
function normalizeRule(record) {
  const book = RULE_BOOKS[record.ruleBook];
  if (!book) {
    throw new Error(
      `A rule record's book is decided by the archive file it came from, and ` +
        `"${record.ruleBook}" is not one of the four that hold rules.`,
    );
  }

  const name = text(record.chapterName) ?? "";
  const isVariant = book.ruleType === "Variant";
  const sourceName = SOURCE_NAMES[book.source] ?? book.source;
  const body = stripLeadingHeading(proseText(record.contentMarkdown), name);
  const sections = splitIntoSections(body ?? "");
  const { add, stats } = statCollector();

  add("Book", sourceName);
  add("Kind", isVariant ? "Variant rule" : "Chapter");
  add("Position", chapterLabel(record.chapterNumber));

  return {
    name,
    slug: isVariant
      ? slugify(name)
      : `${slugify(book.source)}-${slugify(name)}`,
    source: book.source,
    sourceName,
    tagline: isVariant
      ? "Optional variant rule"
      : compact([sourceName, chapterLabel(record.chapterNumber)]).join(" · ") ||
        null,
    summary: {
      ruleType: book.ruleType,
      chapterNumber: isVariant ? null : numeric(record.chapterNumber),
      sectionCount: sections.filter((each) => each.heading).length,
    },
    stats,
    sections,
    entries: [],
    tables: [],
  };
}

/* ------------------------------------------------------- reference tables */

/**
 * Keywords that place a table under a subject, tried in order; the first match
 * wins. Thirty-three tables is too many to present as one flat list and too
 * few to justify a taxonomy, and the captions are consistent enough that the
 * subject can be read straight off them. The starship terms come first because
 * "Modification Capacity by Ship Size" is a starship table and would otherwise
 * be caught by nothing at all.
 */
const TABLE_SUBJECTS = [
  ["starship", "Starships"],
  ["ship size", "Starships"],
  ["ship tier", "Starships"],
  ["hyperspace", "Starships"],
  ["realspace", "Starships"],
  ["deployment", "Starships"],
  ["by tier", "Starships"],
  ["modification", "Starships"],
  ["ability score", "Character creation"],
  ["multiclassing", "Character creation"],
  ["xp and pb", "Character creation"],
  ["lifestyle", "Downtime"],
  ["slowed", "Conditions"],
];

function tableSubject(name) {
  const lowered = name.toLowerCase();
  for (const [keyword, subject] of TABLE_SUBJECTS) {
    if (lowered.includes(keyword)) return subject;
  }
  return null;
}

/**
 * A standalone lookup table. Like the property glossaries these carry no
 * source, and unlike the rule chapters there is no file name to infer one
 * from: the thirty-three come from at least three different books.
 */
function normalizeReferenceTable(record) {
  const name = text(record.name) ?? String(record.name ?? "").trim();
  const subject = tableSubject(name);
  const { add, stats } = statCollector();

  add("Subject", subject);

  return {
    name,
    slug: slugify(record.name),
    source: null,
    sourceName: null,
    tagline: subject,
    summary: { subject },
    stats,
    sections: compact([section(null, proseText(record.content))]),
    entries: [],
    tables: [],
  };
}

/**
 * Every content type, in the order the site presents them. `file` names the
 * archive dump; `id` is the URL segment and the key everything else uses.
 *
 * `class-improvements` is the one type with more than one dump behind it. The
 * three files hold identical records and become one type, and nothing in a
 * record says which file it came from, so `files` pairs each dump with the kind
 * it holds and the reader tags every record with it.
 * `rules` is the one entry whose `file` is a list. The archive keeps each
 * book's chapters in a dump of its own, plus a fifth for the optional variant
 * rules, and all four hold records of identical shape — the book is a value on
 * the item rather than a type of its own. Which file a record came from is
 * passed through to the normalizer, because for that type it is the only
 * record of provenance there is.
 */
export const CONTENT_TYPES = [
  { id: "species", file: "Species", normalize: normalizeSpecies },
  { id: "classes", file: "Class", normalize: normalizeClass },
  {
    id: "class-improvements",
    files: [
      { file: "ClassImprovement", improvementType: "class" },
      { file: "MulticlassImprovement", improvementType: "multiclass" },
      { file: "SplashclassImprovement", improvementType: "splashclass" },
    ],
    normalize: normalizeClassImprovement,
  },
  { id: "archetypes", file: "Archetype", normalize: normalizeArchetype },
  { id: "features", file: "Feature", normalize: normalizeFeature },
  { id: "backgrounds", file: "Background", normalize: normalizeBackground },
  { id: "feats", file: "Feat", normalize: normalizeFeat },
  { id: "powers", file: "Power", normalize: normalizePower },
  { id: "maneuvers", file: "Maneuvers", normalize: normalizeManeuver },
  { id: "fighting-styles", file: "FightingStyle", normalize: normalizeFightingOption },
  { id: "fighting-masteries", file: "FightingMastery", normalize: normalizeFightingOption },
  { id: "lightsaber-forms", file: "LightsaberForm", normalize: normalizeLightsaberForm },
  {
    id: "weapon-focuses",
    file: "WeaponFocus",
    normalize: normalizeWeaponTraining(" Focus"),
  },
  {
    id: "weapon-supremacies",
    file: "WeaponSupremacy",
    normalize: normalizeWeaponTraining(" Supremacy"),
  },
  { id: "equipment", file: "Equipment", normalize: normalizeEquipment },
  { id: "enhanced-items", file: "EnhancedItem", normalize: normalizeEnhancedItem },
  { id: "weapon-properties", file: "WeaponProperty", normalize: normalizeProperty },
  { id: "armor-properties", file: "ArmorProperty", normalize: normalizeProperty },
  { id: "monsters", file: "Monster", normalize: normalizeMonster },

  /*
   * The starship types are canonical-only, which is what `file: null` says.
   *
   * The archive does contain their six files, so this is a choice rather than
   * a gap. Three of them lost their structured columns to the 2022 scrape and
   * kept only prose: every numeric field on all six base-size records is zero,
   * and every piece of ammunition carries a name and a price and nothing else.
   * The canonical documents have the hull dice, the tier tables, the roles and
   * the ammunition damage because the import read them back out of the rules
   * chapters — work that belongs in the content repository, not in a second
   * copy here. Mapping the flat records instead would publish a starship
   * section that cannot say how much hull a Small ship has, which is worse
   * than an archive build that admits it has no starships.
   */
  { id: "starship-base-sizes", file: null, normalize: null },
  { id: "starship-deployments", file: null, normalize: null },
  { id: "starship-equipment", file: null, normalize: null },
  { id: "starship-modifications", file: null, normalize: null },
  { id: "starship-ventures", file: null, normalize: null },
  { id: "starship-rules", file: null, normalize: null },
  {
    id: "rules",
    // Four dumps, one type. Which book printed a chapter is not in the record
    // — every rules record in the archive has a contentSource of "None" — so
    // the file it came from is stamped onto it as it is read, the same way a
    // class improvement is stamped with its kind.
    files: [
      { file: "playerHandbookRule", ruleBook: "phb" },
      { file: "wretchedHivesRule", ruleBook: "wh" },
      { file: "ExpandedContent", ruleBook: "ec" },
      { file: "VariantRule", ruleBook: "variant" },
    ],
    normalize: normalizeRule,
  },
  { id: "reference-tables", file: "ReferenceTable", normalize: normalizeReferenceTable },
];

/**
 * Normalizes one type's records. Slugs must be unique because they are the
 * URL; the archive contains a few genuine name collisions (two distinct
 * `Bo-rifle` weapons), so later collisions take a numbered suffix in the
 * archive's own order, which is stable across runs.
 *
 * `graph` is what the caller knows about the rest of the build. Only the
 * enhanced items read it, to turn the name of the gear an item is built on
 * into a link, and only when exactly one equipment document answers to it.
 */
export function normalizeAll(typeId, records, powerSlugs = new Set(), graph = {}) {
  const definition = CONTENT_TYPES.find((type) => type.id === typeId);
  if (!definition) throw new Error(`Unknown content type: ${typeId}`);

  const seen = new Map();
  return records.map((record) => {
    const item = definition.normalize(record, powerSlugs, graph);
    const count = (seen.get(item.slug) ?? 0) + 1;
    seen.set(item.slug, count);
    return {
      type: typeId,
      ...item,
      slug: count === 1 ? item.slug : `${item.slug}-${count}`,
    };
  });
}
