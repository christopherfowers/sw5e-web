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
    add(label, value) {
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
      stats.push({ label, value: asText });
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

/* -------------------------------------------------------------- maneuvers */

function normalizeManeuver(record) {
  const base = common(record);
  const { add, stats } = statCollector();
  const kind = text(record.type);
  const prerequisite = text(record.prerequisite);

  add("Type", kind);
  add("Prerequisite", prerequisite);

  return {
    ...base,
    tagline: kind ? `${kind} maneuver` : null,
    summary: { kind, prerequisite },
    stats,
    sections: compact([section(null, proseText(record.description))]),
    entries: [],
    tables: [],
  };
}

/**
 * Every content type, in the order the site presents them. `file` names the
 * archive dump; `id` is the URL segment and the key everything else uses.
 */
export const CONTENT_TYPES = [
  { id: "species", file: "Species", normalize: normalizeSpecies },
  { id: "archetypes", file: "Archetype", normalize: normalizeArchetype },
  { id: "backgrounds", file: "Background", normalize: normalizeBackground },
  { id: "feats", file: "Feat", normalize: normalizeFeat },
  { id: "powers", file: "Power", normalize: normalizePower },
  { id: "maneuvers", file: "Maneuvers", normalize: normalizeManeuver },
  { id: "equipment", file: "Equipment", normalize: normalizeEquipment },
  { id: "monsters", file: "Monster", normalize: normalizeMonster },
];

/**
 * Normalizes one type's records. Slugs must be unique because they are the
 * URL; the archive contains a few genuine name collisions (two distinct
 * `Bo-rifle` weapons), so later collisions take a numbered suffix in the
 * archive's own order, which is stable across runs.
 */
export function normalizeAll(typeId, records, powerSlugs = new Set()) {
  const definition = CONTENT_TYPES.find((type) => type.id === typeId);
  if (!definition) throw new Error(`Unknown content type: ${typeId}`);

  const seen = new Map();
  return records.map((record) => {
    const item = definition.normalize(record, powerSlugs);
    const count = (seen.get(item.slug) ?? 0) + 1;
    seen.set(item.slug, count);
    return {
      type: typeId,
      ...item,
      slug: count === 1 ? item.slug : `${item.slug}-${count}`,
    };
  });
}
