/**
 * Turns the canonical sw5e-database content set into the shape the UI
 * consumes.
 *
 * This is the sibling of `normalize.mjs`, not a replacement for it. The two
 * read completely different inputs and write the same envelope:
 *
 *   - `normalize.mjs` reads the 2022 legacy archive: Azure Table Storage
 *     dumps, one flat record per row, with storage plumbing, stringified
 *     `*Json` duplicates, paired `*Enum` integers, and encoding damage that
 *     has to be repaired before anything can be rendered.
 *   - This module reads `sw5e-database/content`: one hand-maintained,
 *     schema-validated JSON document per item, nested rather than flat
 *     (`armor.class`, `hitPoints.average`, `castingTime.period`), keyed by a
 *     stable `key`, and clean — there is no corruption to repair and no
 *     legacy vocabulary to strip.
 *
 * Canonical documents are therefore mapped straight into the envelope rather
 * than being pushed back through the archive's normalizers: doing that would
 * mean first translating clean, nested data into the archive's flat legacy
 * field names and then translating it out again, and every canonical field
 * the archive never had — an archetype's level progression, a background's
 * variant table, structured condition immunities — would have nowhere to go
 * in the middle.
 *
 * What the two modules do share is identity. `slugify` decides the URL of
 * every page on the site, so it is imported rather than reimplemented: a
 * canonical Wookiee and an archive Wookiee must resolve to `/species/wookiee`
 * or the two datasets would publish different sites. `humanize` is shared for
 * the same reason — the canonical set stores enums in camelCase
 * (`martialBlaster`, `bonusAction`) exactly as the archive did, and the labels
 * the UI filters on have to come out identical.
 */

import { humanize, slugify } from "./normalize.mjs";

/**
 * Which canonical directory feeds each of the site's content types.
 *
 * The mapping is not the identity, and the mismatches are recorded here rather
 * than discovered at runtime:
 *
 *   - the site's type ids are plural because they are URL segments, while the
 *     canonical directories are singular. `maneuvers` is the one to watch:
 *     `/maneuvers` has been in the site's navigation since before any maneuver
 *     content existed, so the segment is fixed and the directory it reads is
 *     `maneuver`. A rename on either side breaks a published address.
 *   - `feature` is a canonical directory with no site type. Its documents are
 *     the individual class and archetype features, and every one of them is
 *     already written out in the prose of the archetype or class that grants
 *     it. Publishing them as well would show a reader the same text twice
 *     under two different headings.
 *   - `source` is a canonical directory with no site type either. The site
 *     describes its books in `app/content/source-meta.ts`, which carries the
 *     blurb, colour and cover a page needs and a data file cannot supply.
 *     The canonical documents are still read — they are what turns a
 *     `sourceKey` of `phb` into the `PHB` badge every row carries.
 *
 * A `null` here is still meaningful: it says the site publishes a type the
 * canonical set cannot feed, and `build-content-fixture.mjs` writes that type
 * an empty dataset so its index renders an empty state rather than 404ing on a
 * link the header offers. Nothing is null today, which is the point — the gap
 * this mechanism was built for was maneuvers, and it is now closed.
 */
export const CANONICAL_DIRECTORIES = {
  species: "species",
  archetypes: "archetype",
  backgrounds: "background",
  feats: "feat",
  powers: "power",
  maneuvers: "maneuver",
  "fighting-styles": "fighting-style",
  "fighting-masteries": "fighting-mastery",
  "lightsaber-forms": "lightsaber-form",
  "weapon-focuses": "weapon-focus",
  "weapon-supremacies": "weapon-supremacy",
  equipment: "equipment",
  monsters: "monster",
};

/* --------------------------------------------------------------- helpers */

/** A string field, trimmed, with empty collapsed to null. */
function text(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function list(values) {
  if (!Array.isArray(values)) return null;
  const cleaned = values.map((value) => text(value)).filter(Boolean);
  return cleaned.length > 0 ? cleaned : null;
}

function numeric(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compact(values) {
  return values.filter(Boolean);
}

function section(heading, body) {
  return body ? { heading, body } : null;
}

/** Collects `{ label, value }` pairs, skipping anything empty. */
function statCollector() {
  const stats = [];
  return {
    add(label, value) {
      if (value == null) return;
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

/**
 * A roll table: `[{ roll, name, description }]` becomes a captioned table.
 * The die is the number of rows, which is how the published tables are
 * written — a background with eight personality traits is rolled on a d8.
 */
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

/**
 * The fields every item carries, whatever its type.
 *
 * A `sourceKey` that names no canonical source document is a hard error
 * rather than a missing badge: the content set validates its own
 * cross-references, so an unresolvable key means this build is reading a
 * content set and a mapping that disagree, and rendering the library with the
 * provenance quietly stripped off it would hide that.
 */
function common(record, sources) {
  const source = sources.get(record.sourceKey);
  if (!source) {
    throw new Error(
      `${record.name ?? record.key} names source "${record.sourceKey}", ` +
        "which no document in content/source declares",
    );
  }
  return {
    name: text(record.name) ?? String(record.name ?? "").trim(),
    slug: slugify(record.name),
    source: source.abbreviation,
    sourceName: source.title,
  };
}

/* ---------------------------------------------------------------- species */

/**
 * `{ amount: 2, abilities: ["intelligence"] }` becomes `Intelligence +2`, and
 * `{ amount: 1, anyAbilityCount: 4 }` becomes `4 abilities of your choice +1`.
 */
function formatIncrease(increase) {
  const amount = numeric(increase?.amount);
  if (amount == null) return null;
  if (Array.isArray(increase.abilities) && increase.abilities.length > 0) {
    return `${increase.abilities.map((ability) => humanize(ability)).join(" or ")} +${amount}`;
  }
  const count = numeric(increase.anyAbilityCount);
  if (count == null) return null;
  const noun = count === 1 ? "ability" : "abilities";
  return `${count} ${noun} of your choice +${amount}`;
}

/**
 * The options are mutually exclusive — a human picks one row or the other —
 * while the increases inside one option all apply together. Commas separate
 * the increases and a semicolon separates the options, so the two levels stay
 * distinguishable in a species that has both.
 */
function formatAbilityIncreaseOptions(options) {
  if (!Array.isArray(options)) return null;
  const rendered = options
    .map((option) =>
      (option?.increases ?? []).map(formatIncrease).filter(Boolean).join(", "),
    )
    .filter(Boolean);
  return rendered.length > 0 ? rendered.join("; or ") : null;
}

function normalizeSpecies(record, sources) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const physique = record.physique ?? {};
  const appearance = record.appearance ?? {};
  const size = humanize(record.size);
  const homeworld = text(record.homeworld);
  const language = text(record.nativeLanguage);
  const abilityIncreases = formatAbilityIncreaseOptions(
    record.abilityScoreIncreaseOptions,
  );

  add("Size", size);
  add("Homeworld", homeworld);
  add("Language", language);
  add("Ability increases", abilityIncreases);
  add("Distinctions", text(appearance.distinctions));
  add("Average height", text(physique.heightAverage));
  add("Height modifier", text(physique.heightModifier));
  add("Average weight", text(physique.weightAverage));
  add("Weight modifier", text(physique.weightModifier));
  add("Skin colors", text(appearance.skinColorOptions));
  add("Hair colors", text(appearance.hairColorOptions));
  add("Eye colors", text(appearance.eyeColorOptions));
  add("Color scheme", text(appearance.colorScheme));
  add("Manufacturer", text(appearance.manufacturer));

  return {
    ...base,
    tagline: compact([size, homeworld]).join(" · ") || null,
    summary: { size, homeworld, language, abilityIncreases },
    stats,
    sections: compact([section(null, text(record.lore))]),
    entries: (record.traits ?? [])
      .map((trait) => ({
        group: "Traits",
        name: text(trait?.name),
        body: text(trait?.description),
      }))
      .filter((entry) => entry.name || entry.body),
    tables: compact([halfHumanTable(record.halfHumanTraits)]),
  };
}

/** A half-species picks one parent species and inherits that row's trait. */
function halfHumanTable(halfHumanTraits) {
  if (!Array.isArray(halfHumanTraits) || halfHumanTraits.length === 0) {
    return null;
  }
  const rows = halfHumanTraits
    .map((entry) => {
      const speciesName = text(entry?.speciesName);
      const traitName = text(entry?.traitName);
      return speciesName && traitName ? [speciesName, traitName] : null;
    })
    .filter(Boolean);
  if (rows.length === 0) return null;
  return {
    caption: "Inherited traits",
    columns: ["Parent species", "Trait"],
    rows,
  };
}

/* ------------------------------------------------------------- archetypes */

/**
 * The per-level table an archetype prints alongside its features: force
 * powers known, force points, maximum power level. Labels can differ between
 * archetypes, so the columns are the labels this archetype actually uses, in
 * the order it first uses them.
 */
function progressionTable(progression) {
  if (!Array.isArray(progression) || progression.length === 0) return null;
  const labels = [];
  for (const level of progression) {
    for (const entry of level?.entries ?? []) {
      const label = text(entry?.label);
      if (label && !labels.includes(label)) labels.push(label);
    }
  }
  if (labels.length === 0) return null;
  const rows = progression
    .map((level) => {
      const levelNumber = numeric(level?.level);
      if (levelNumber == null) return null;
      const byLabel = new Map(
        (level?.entries ?? []).map((entry) => [
          text(entry?.label),
          text(entry?.value),
        ]),
      );
      return [
        String(levelNumber),
        ...labels.map((label) => byLabel.get(label) ?? "—"),
      ];
    })
    .filter(Boolean);
  if (rows.length === 0) return null;
  return { caption: "Progression", columns: ["Level", ...labels], rows };
}

function normalizeArchetype(record, sources) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const className = text(record.className);
  const casterType =
    record.casterType && record.casterType !== "none"
      ? humanize(record.casterType)
      : null;

  add("Class", className);
  add("Casting", casterType);

  return {
    ...base,
    tagline: className ? `${className} archetype` : null,
    summary: { className, casterType },
    stats,
    sections: compact([section(null, text(record.description))]),
    entries: [],
    tables: compact([progressionTable(record.progression)]),
  };
}

/* ------------------------------------------------------------ backgrounds */

function normalizeBackground(record, sources) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const feature = record.feature ?? {};
  const featureName = text(feature.name);
  const skillProficiencies = text(record.skillProficiencies);
  const languages = text(record.languageProficiencies);
  const variant = record.variant ?? {};
  const variantName = text(variant.name);

  add("Skill proficiencies", skillProficiencies);
  add("Tool proficiencies", text(record.toolProficiencies));
  add("Languages", languages);
  add("Equipment", text(record.startingEquipment));

  return {
    ...base,
    tagline: featureName ? `Feature: ${featureName}` : null,
    summary: { feature: featureName, skillProficiencies, languages },
    stats,
    sections: compact([
      section(null, text(record.lore)),
      section("Suggested characteristics", text(record.suggestedCharacteristics)),
      // A variant's prose already contains its own roll table, written as
      // markdown. Emitting `variant.options` as a table beside it would print
      // the same eight rows twice on the same page, so the structured copy is
      // deliberately left unused here.
      section(variantName, text(variant.description)),
    ]),
    entries: compact([
      featureName && text(feature.description)
        ? {
            group: "Feature",
            name: featureName,
            body: text(feature.description),
          }
        : null,
    ]),
    tables: compact([
      rollTable("Personality traits", record.personalityTraitOptions, "Trait"),
      rollTable("Ideals", record.idealOptions, "Ideal"),
      rollTable("Bonds", record.bondOptions, "Bond"),
      rollTable("Flaws", record.flawOptions, "Flaw"),
      rollTable("Feat options", record.featOptions, "Feat"),
    ]),
  };
}

/* ------------------------------------------------------------------ feats */

function normalizeFeat(record, sources) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const prerequisite = text(record.prerequisite);
  const abilityIncreases = list(record.abilityScoreIncreases)?.map((ability) =>
    humanize(ability),
  );

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
    sections: compact([section(null, text(record.description))]),
    entries: [],
    tables: [],
  };
}

/* ----------------------------------------------------------------- powers */

function normalizePower(record, sources) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const castingTime = record.castingTime ?? {};
  const level = numeric(record.level);
  const powerType = humanize(record.powerType);
  const castingPeriod = humanize(castingTime.period);
  const forceAlignment =
    record.forceAlignment && record.forceAlignment !== "none"
      ? humanize(record.forceAlignment)
      : null;

  add("Casting time", text(castingTime.text) ?? castingPeriod);
  add("Range", text(record.range));
  add("Duration", text(record.duration));
  add("Concentration", record.concentration ? "Yes" : "No");
  if (powerType === "Force" && forceAlignment) {
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
      forceAlignment: powerType === "Force" ? forceAlignment : null,
    },
    stats,
    sections: compact([section(null, text(record.description))]),
    entries: [],
    tables: [],
  };
}

/* --------------------------------------------------------- combat options */

/**
 * The canonical combat-option documents keep their mechanics as fields and
 * lists rather than as one paragraph, so these normalizers are mostly a matter
 * of choosing what goes in the row and what goes in the page. The rule applied
 * throughout: anything that appears in `stats` or in a table is not also
 * repeated as prose, because a reader shown the same rule twice has to work out
 * whether the two copies agree.
 */

function normalizeManeuver(record, sources) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const kind = humanize(record.maneuverType);
  const prerequisite = text(record.prerequisite);
  const improves = text(record.improves);
  const superiorityDice = numeric(record.superiorityDice);

  add("Type", kind);
  add(
    "Cost",
    superiorityDice == null
      ? null
      : superiorityDice === 0
        ? "No superiority die"
        : `${superiorityDice} superiority ${superiorityDice === 1 ? "die" : "dice"}`,
  );
  add("Prerequisite", prerequisite);
  add("Improves", improves);

  return {
    ...base,
    // An upgrade's tagline says what it upgrades, because that is the only
    // thing that makes "Administer Aid (Greater)" mean anything on its own.
    tagline: improves
      ? `Improves ${improves}`
      : kind
        ? `${kind} maneuver`
        : null,
    summary: { kind, prerequisite, superiorityDice, improves },
    stats,
    sections: compact([section(null, text(record.description))]),
    entries: [],
    tables: [],
  };
}

/**
 * Fighting styles, fighting masteries, weapon focuses and weapon supremacies.
 *
 * The benefits are entries rather than prose: each bullet is an independent
 * rules exception a player checks the situation against, and the detail page
 * already renders `entries` as a list of named blocks. They have no names of
 * their own in the books, so only the body is set — which the entry renderer
 * handles, and which is why a bullet is not forced into a heading it never had.
 */
function benefitEntries(record) {
  return (record.benefits ?? [])
    .map((benefit) => ({ group: "Benefits", name: null, body: text(benefit) }))
    .filter((entry) => entry.body);
}

function normalizeFightingOption(record, sources) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const prerequisite = text(record.prerequisite);
  const benefits = benefitEntries(record);

  add("Prerequisite", prerequisite);
  add("Benefits", benefits.length === 0 ? null : String(benefits.length));

  return {
    ...base,
    tagline: prerequisite ? `Requires ${prerequisite}` : "No prerequisite",
    summary: { prerequisite, benefits: benefits.length },
    stats,
    sections: compact([section(null, text(record.description))]),
    entries: benefits,
    tables: [],
  };
}

function normalizeWeaponTraining(record, sources) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const weaponGroup = humanize(record.weaponGroup);
  const benefits = benefitEntries(record);

  add("Weapon group", weaponGroup);
  add("Benefits", benefits.length === 0 ? null : String(benefits.length));

  return {
    ...base,
    tagline: weaponGroup ? `${weaponGroup} weapons` : null,
    summary: { weaponGroup, benefits: benefits.length },
    stats,
    sections: compact([section(null, text(record.description))]),
    entries: benefits,
    tables: [],
  };
}

/** How a form's two kinds of effect are headed on the page. */
const FORM_TIMINGS = {
  onAdopt: "As you adopt this form",
  active: "While this form is held",
};

function normalizeLightsaberForm(record, sources) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const prerequisite = text(record.prerequisite);
  const effects = record.effects ?? [];
  const onAdopt = effects.some((effect) => effect?.timing === "onAdopt");

  add("Prerequisite", prerequisite);
  add("Adopted as", "Bonus action");

  return {
    ...base,
    tagline: onAdopt ? "Acts as you adopt it" : "Active while held",
    summary: { prerequisite, onAdopt },
    stats,
    // The effects are the rules text, and they are headed by when they apply
    // rather than run together: a player who has already adopted the form
    // needs only the second heading, and one paragraph of prose would make
    // them read both to find out which is which.
    sections: compact(
      effects.map((effect) =>
        section(FORM_TIMINGS[effect?.timing] ?? null, text(effect?.description)),
      ),
    ),
    entries: [],
    tables: [],
  };
}

/* -------------------------------------------------------------- equipment */

/** `{ numberOfDice: 1, dieFaces: 12, type: "energy" }` becomes `1d12 energy`. */
function formatDamage(damage) {
  const dice = numeric(damage?.numberOfDice);
  const faces = numeric(damage?.dieFaces);
  if (!dice || !faces) return null;
  const damageType = text(damage.type);
  const roll = `${dice}d${faces}`;
  return damageType ? `${roll} ${damageType.toLowerCase()}` : roll;
}

function normalizeEquipment(record, sources) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const category = humanize(record.category);
  /*
   * Nearly every weapon sits in one proficiency group, but a bo-rifle is both
   * an exotic blaster and an exotic vibroweapon, and a saberstaff is both an
   * exotic lightweapon and an exotic vibroweapon. Proficiency with any one of
   * a weapon's groups is enough to use it, so showing only the first would
   * tell a reader they cannot use a weapon they can.
   */
  const weaponType = list(
    [record.weaponClassification, ...(record.additionalWeaponClassifications ?? [])].map(
      (classification) => humanize(classification),
    ),
  )?.join(", ");
  const armorType = humanize(record.armorClassification);
  const damage = formatDamage(record.damage);
  const cost = numeric(record.costInCredits);
  const weight = numeric(record.weight);
  const armorClass = text(record.armorClass);
  const properties = list(record.properties);

  add("Category", category);
  add("Cost", cost == null ? null : `${cost.toLocaleString("en-US")} cr`);
  add("Weight", weight == null ? null : `${weight} lb.`);
  add("Damage", damage);
  add("Weapon type", weaponType);
  add("Armor type", armorType);
  add("Armor Class", armorClass);
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
    sections: compact([section(null, text(record.description))]),
    entries: [],
    tables: [],
  };
}

/* --------------------------------------------------------------- monsters */

const ABILITIES = [
  ["Strength", "strength"],
  ["Dexterity", "dexterity"],
  ["Constitution", "constitution"],
  ["Intelligence", "intelligence"],
  ["Wisdom", "wisdom"],
  ["Charisma", "charisma"],
];

/**
 * Stat-block section headings. The canonical values are singular and one of
 * them does not pluralise by adding an `s`, so the four are spelled out rather
 * than derived.
 */
const BEHAVIOR_GROUPS = {
  trait: "Traits",
  action: "Actions",
  reaction: "Reactions",
  legendary: "Legendary actions",
};

/**
 * A damage or condition immunity line. The canonical set splits these into
 * the enumerated values it can validate and the free text it cannot — a
 * creature immune to `poison` the damage type and to disease, which is not a
 * damage type at all — and a stat block prints them as one line.
 */
function affinityLine(affinity) {
  if (!affinity) return null;
  const parts = [
    ...(affinity.types ?? []),
    ...(affinity.conditions ?? []),
    ...(affinity.other ?? []),
  ];
  return list(parts);
}

function normalizeMonster(record, sources) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const size = humanize(record.size);
  const kind = text((record.types ?? [])[0]);
  const alignment = text(record.alignment);
  const challengeRating = text(record.challengeRating);
  const armorClass = numeric(record.armor?.class);
  const armorType = text(record.armor?.type);
  const hitPoints = numeric(record.hitPoints?.average);
  const hitPointRoll = text(record.hitPoints?.roll);

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
  add("Speed", text(record.speed?.text));
  add("Saving Throws", list(record.savingThrows));
  add("Skills", list(record.skills));
  add("Damage Vulnerabilities", affinityLine(record.damageVulnerabilities));
  add("Damage Resistances", affinityLine(record.damageResistances));
  add("Damage Immunities", affinityLine(record.damageImmunities));
  add("Condition Immunities", affinityLine(record.conditionImmunities));
  add("Senses", list(record.senses));
  add("Languages", list(record.languages));
  add(
    "Challenge",
    challengeRating == null
      ? null
      : record.experiencePoints
        ? `${challengeRating} (${Number(record.experiencePoints).toLocaleString("en-US")} XP)`
        : challengeRating,
  );

  return {
    ...base,
    tagline:
      compact([size, kind]).join(" ") + (alignment ? `, ${alignment}` : ""),
    summary: {
      size,
      kind,
      alignment,
      challengeRating,
      challengeRatingValue: challengeRatingValue(challengeRating),
      armorClass,
      hitPoints,
    },
    abilityScores: ABILITIES.map(([label, key]) => ({
      ability: label,
      score: numeric(record.abilities?.[key]?.score),
      modifier: numeric(record.abilities?.[key]?.modifier),
    })).filter((entry) => entry.score != null),
    stats,
    sections: compact([
      section(null, text(record.flavorText)),
      section("About this creature", text(record.sectionText)),
    ]),
    entries: (record.behaviors ?? [])
      .map((behavior) => ({
        group: BEHAVIOR_GROUPS[behavior?.behaviorType] ?? "Traits",
        name: text(behavior?.name),
        body: text(behavior?.descriptionWithLinks) ?? text(behavior?.description),
      }))
      .filter((entry) => entry.name || entry.body),
    tables: [],
  };
}

const NORMALIZERS = {
  species: normalizeSpecies,
  archetypes: normalizeArchetype,
  backgrounds: normalizeBackground,
  feats: normalizeFeat,
  powers: normalizePower,
  maneuvers: normalizeManeuver,
  "fighting-styles": normalizeFightingOption,
  "fighting-masteries": normalizeFightingOption,
  "lightsaber-forms": normalizeLightsaberForm,
  "weapon-focuses": normalizeWeaponTraining,
  "weapon-supremacies": normalizeWeaponTraining,
  equipment: normalizeEquipment,
  monsters: normalizeMonster,
};

/**
 * Builds the `sourceKey` lookup every item's badge depends on. The site keys
 * its books by abbreviation — `PHB`, `SnV` — and the canonical documents are
 * the only place that says which abbreviation a key like `snv` stands for.
 */
export function indexSources(records) {
  const sources = new Map();
  for (const record of records) {
    const key = text(record?.key);
    const abbreviation = text(record?.abbreviation);
    if (!key || !abbreviation) continue;
    sources.set(key, { abbreviation, title: text(record.title) });
  }
  return sources;
}

/**
 * Normalizes one type's canonical documents.
 *
 * Slugs must be unique because they are the URL. The canonical set gives every
 * document a unique `key`, but the slug is derived from the display name, so
 * two documents can still collide; later collisions take a numbered suffix in
 * the input order, which the caller keeps stable by sorting.
 */
export function normalizeAllCanonical(typeId, records, sources) {
  const normalize = NORMALIZERS[typeId];
  if (!normalize) {
    throw new Error(`No canonical mapping for content type: ${typeId}`);
  }

  const seen = new Map();
  return records.map((record) => {
    const item = normalize(record, sources);
    const count = (seen.get(item.slug) ?? 0) + 1;
    seen.set(item.slug, count);
    return {
      type: typeId,
      ...item,
      slug: count === 1 ? item.slug : `${item.slug}-${count}`,
    };
  });
}
