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
 * the UI filters on have to come out identical. `splitIntoSections` joins
 * them for a third: a rules chapter divides into the same sections whichever
 * source it was read from, because how it divides is a property of the prose.
 */

import { humanize, slugify, splitIntoSections } from "./normalize.mjs";

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
 *   - `source` is a canonical directory with no site type. The site
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
 *
 * `feature` used to be a third mismatch: 2,682 documents held back on the
 * grounds that every class and archetype feature is already written out in the
 * prose of whatever grants it, so publishing them would show the same text
 * twice. That reasoning was right about the duplication and wrong about the
 * conclusion, and it is reversed here.
 *
 * A feature is the unit a person actually looks up. Nobody asks what Soresu
 * Form says; they ask what Deflection does, in the middle of a turn, and they
 * expect to search for it by name and send someone the link. Unpublished, all
 * 2,682 of them were reachable only by opening one of 288 long pages and
 * reading — search could only answer with the archetype whose prose happened to
 * contain the words, which is the wrong answer to "what does Reckless Attack
 * do". They are also the far end of every level grant in the corpus: a class
 * table that names what arrives at 7th level has nothing to point at unless the
 * thing it names has a page.
 *
 * The duplication is real and is handled rather than avoided. A class or
 * archetype still prints its own page in full, because 38 of these features
 * carry a sentence their parent's prose lost and a parent's own tables and
 * introductions belong to no feature at all — so dropping either side would
 * lose content. What the parent gains is a linked index of what it grants, by
 * level, which is a table of contents rather than a second copy of the text.
 */
export const CANONICAL_DIRECTORIES = {
  species: "species",
  classes: "class",
  "class-improvements": "class-improvement",
  archetypes: "archetype",
  features: "feature",
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
  "enhanced-items": "enhanced-item",
  "weapon-properties": "weapon-property",
  "armor-properties": "armor-property",
  monsters: "monster",
  "starship-base-sizes": "starship-base-size",
  "starship-deployments": "starship-deployment",
  "starship-equipment": "starship-equipment",
  "starship-modifications": "starship-modification",
  "starship-ventures": "starship-venture",
  "starship-rules": "starship-rule",
  rules: "rule",
  "reference-tables": "reference-table",
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
    /**
     * `href` is optional and is only ever supplied where the value names
     * exactly one document the site publishes, so a linked stat is a resolved
     * cross-reference rather than a guess at one.
     */
    add(label, value, href) {
      if (value == null) return;
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

/* ----------------------------------------------------------- the class graph */

/**
 * The edges between a class, its archetypes, its improvement rules and every
 * feature any of them grants.
 *
 * These four types are the only part of the corpus that is a graph rather than
 * a catalogue, and the relationships are already data: an archetype names its
 * class, an improvement names its class, a feature names what grants it and the
 * level it arrives at. This walks them once, up front, so that a page can be
 * rendered with links to its neighbours instead of with their text copied into
 * it — which is what stops "the feature is already written out in the
 * archetype" from being an argument against publishing features.
 *
 * Built from the canonical documents rather than from the normalized items,
 * because the edges are stated on the documents and normalizing throws away
 * the fields that state them.
 */
export function buildClassGraph({ classes = [], classImprovements = [], archetypes = [], features = [], equipment = [] }) {
  const grants = new Map();
  const branches = new Map();

  const grantKey = (kind, name) => `${kind}:${name}`;

  for (const feature of features) {
    const kind = text(feature.grantedBy);
    const parent = text(feature.grantedByName);
    if (!kind || !parent) continue;

    const key = grantKey(kind, parent);
    if (!grants.has(key)) grants.set(key, []);
    grants.get(key).push({
      name: text(feature.name),
      // A feature's URL is its canonical key, not its name. Forty grants are
      // called "Ability Score Improvement" and a dozen classes grant an
      // "Extra Attack"; slugs derived from those names would collide and be
      // resolved by a numeric suffix that moves whenever the corpus grows.
      slug: text(feature.key),
      level: numeric(feature.level),
    });
  }

  // Equipment, by name, for the one edge that crosses out of the class graph:
  // an enhanced item names the gear it is built on or installed in, and that
  // name only becomes a link if exactly one equipment document answers to it.
  // A name two documents share is dropped rather than arbitrated — the point
  // of this index is that a link built from it is certainly right, and an
  // ambiguous name has no certainly-right answer.
  const equipmentByName = new Map();
  const ambiguous = new Set();

  for (const item of equipment) {
    const name = text(item?.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (equipmentByName.has(key)) ambiguous.add(key);
    equipmentByName.set(key, `/equipment/${slugify(name)}`);
  }

  for (const key of ambiguous) equipmentByName.delete(key);

  for (const list of grants.values()) {
    list.sort(
      (left, right) =>
        (left.level ?? 0) - (right.level ?? 0) ||
        left.name.localeCompare(right.name, "en"),
    );
  }

  const branchesFor = (className) => {
    if (!branches.has(className)) {
      branches.set(className, { archetypes: [], improvements: [] });
    }
    return branches.get(className);
  };

  for (const archetype of archetypes) {
    const className = text(archetype.className);
    if (!className) continue;
    branchesFor(className).archetypes.push({
      name: text(archetype.name),
      slug: slugify(archetype.name),
    });
  }

  for (const improvement of classImprovements) {
    const className = text(improvement.className);
    if (!className) continue;
    branchesFor(className).improvements.push({
      name: text(improvement.name),
      slug: slugify(improvement.name),
      improvementType: text(improvement.improvementType),
    });
  }

  for (const entry of branches.values()) {
    entry.archetypes.sort((left, right) => left.name.localeCompare(right.name, "en"));
    entry.improvements.sort((left, right) => left.name.localeCompare(right.name, "en"));
  }

  // Classes are indexed by name because that is how everything else in the
  // corpus refers to one; the slug is what a link needs.
  const classSlugs = new Map(
    classes.map((record) => [text(record.name), slugify(record.name)]),
  );

  return {
    classSlugs,
    grantedBy: (kind, name) => grants.get(grantKey(kind, name)) ?? [],
    branchesOf: (className) => branches.get(className) ?? { archetypes: [], improvements: [] },
    equipmentRoute: (name) =>
      name ? (equipmentByName.get(name.toLowerCase()) ?? null) : null,
  };
}

const EMPTY_GRAPH = buildClassGraph({});

/** `1` becomes `1st`, `13` becomes `13th`. Levels are printed as ordinals. */
function ordinal(level) {
  if (level == null) return null;
  const rest = level % 100;
  if (rest >= 11 && rest <= 13) return `${level}th`;
  return `${level}${["th", "st", "nd", "rd"][level % 10] ?? "th"}`;
}

function markdownLink(label, href) {
  // Square brackets never appear in a name in this corpus, and a stray one
  // would break the link rather than escape anything, so it is dropped.
  return `[${label.replace(/[[\]]/g, "")}](${href})`;
}

/**
 * The linked index of what an entry grants, as a markdown table by level.
 *
 * A table rather than a list because the level is the question: a player
 * levelling up reads down the first column, and a player looking a feature up
 * scans the second. Both halves are links, so this is the page's table of
 * contents as well as its map into the rest of the corpus.
 */
function grantedFeaturesSection(features) {
  if (features.length === 0) return null;

  const byLevel = new Map();
  for (const feature of features) {
    const level = ordinal(feature.level) ?? "—";
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(markdownLink(feature.name, `/features/${feature.slug}`));
  }

  const rows = [...byLevel]
    .map(([level, links]) => `| ${level} | ${links.join(", ")} |`)
    .join("\n");

  return section(
    "Features by level",
    `| Level | Feature |\n|:--|:--|\n${rows}`,
  );
}

/* ---------------------------------------------------------------- classes */

/**
 * The class level table.
 *
 * Unlike an archetype's, this one has three columns every class prints and a
 * handful more that no two classes share, so the fixed three are read from
 * their own fields and the rest from the row's labelled cells. A cell the book
 * prints as an em dash is absent from the document rather than stored, so the
 * placeholder is filled in here — which is what makes a class table with
 * twenty rows and nine columns cost only the cells that say something.
 */
function classProgressionTable(progression) {
  if (!Array.isArray(progression) || progression.length === 0) return null;

  const labels = [];
  for (const row of progression) {
    for (const entry of row?.entries ?? []) {
      const label = text(entry?.label);
      if (label && !labels.includes(label)) labels.push(label);
    }
  }

  const rows = progression
    .map((row) => {
      const level = numeric(row?.level);
      if (level == null) return null;
      const byLabel = new Map(
        (row?.entries ?? []).map((entry) => [text(entry?.label), text(entry?.value)]),
      );
      return [
        ordinal(level),
        row?.proficiencyBonus == null ? "—" : `+${row.proficiencyBonus}`,
        (list(row?.features) ?? []).join(", ") || "—",
        ...labels.map((label) => byLabel.get(label) ?? "—"),
      ];
    })
    .filter(Boolean);

  if (rows.length === 0) return null;

  return {
    caption: "Class progression",
    columns: ["Level", "Proficiency Bonus", "Features", ...labels],
    rows,
  };
}

/** A markdown bullet list of links, or null when there is nothing to link to. */
function linkList(entries, hrefFor) {
  if (entries.length === 0) return null;
  return entries.map((entry) => `- ${markdownLink(entry.name, hrefFor(entry))}`).join("\n");
}

/** Joins the blocks that are present with a blank line, or null when none are. */
function joinBlocks(blocks) {
  const kept = blocks.filter(Boolean);
  return kept.length > 0 ? kept.join("\n\n") : null;
}

function normalizeClass(record, sources, graph) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const hitPoints = record.hitPoints ?? {};
  const proficiencies = record.proficiencies ?? {};
  const skills = proficiencies.skills ?? {};
  const primaryAbility = humanize(record.primaryAbility);
  const hitDie = numeric(hitPoints.dieFaces);
  const casterType =
    record.casterType && record.casterType !== "none" ? humanize(record.casterType) : null;
  const branches = graph.branchesOf(base.name);

  add("Primary ability", primaryAbility);
  add("Hit die", hitDie == null ? null : `d${hitDie}`);
  add("Hit points at 1st level", text(hitPoints.atFirstLevel));
  add("Hit points at higher levels", text(hitPoints.atHigherLevels));
  add(
    "Saving throws",
    list(proficiencies.savingThrows)?.map((ability) => humanize(ability)),
  );
  add("Armor", text(proficiencies.armor));
  add("Weapons", text(proficiencies.weapons));
  add("Tools", text(proficiencies.tools));
  add("Skills", skillLine(skills));
  add("Starting wealth", text(record.startingWealth));
  add("Casting", casterType);
  add("Multiclass proficiencies", text(record.multiclassProficiencies));

  return {
    ...base,
    tagline: compact([
      hitDie == null ? null : `d${hitDie} hit die`,
      primaryAbility,
      casterType ? `${casterType} casting` : null,
    ]).join(" · ") || null,
    summary: {
      primaryAbility,
      hitDie,
      casterType,
      archetypeCount: branches.archetypes.length,
    },
    stats,
    sections: compact([
      section(null, text(record.lore)),
      grantedFeaturesSection(graph.grantedBy("class", base.name)),
      section(null, text(record.description)),
      // The introduction and the list of archetypes are one section, under the
      // name this class gives its archetypes — Berserker Approaches, Monastic
      // Orders. Two sections would print that heading twice.
      section(
        text(record.archetypeLabel) ?? "Archetypes",
        joinBlocks([
          text(record.archetypeIntroduction),
          linkList(branches.archetypes, (entry) => `/archetypes/${entry.slug}`),
        ]),
      ),
      section(
        "Multiclassing and splashclassing",
        linkList(branches.improvements, (entry) => `/class-improvements/${entry.slug}`),
      ),
      section(`Creating a ${base.name.toLowerCase()}`, text(record.creatingCharacter)),
      section("Quick build", text(record.quickBuild)),
      section("Starting equipment", text(record.startingEquipment)),
    ]),
    entries: [],
    tables: compact([classProgressionTable(record.progression)]),
  };
}

/**
 * "Choose two from Athletics, Insight…" — the printed sentence when there is
 * one, and a sentence built from the parts when there is not. An absent list
 * means the class may choose any skill, which is the operative's case.
 */
function skillLine(skills) {
  const printed = text(skills.text);
  if (printed) return printed;

  const choose = numeric(skills.choose);
  if (choose == null) return null;

  const options = list(skills.from);
  return options ? `Choose ${choose} from ${options.join(", ")}` : `Choose any ${choose}`;
}

/* ------------------------------------------------------- class improvements */

const IMPROVEMENT_TAGLINES = {
  class: "Taken while advancing in the class",
  multiclass: "What the class contributes to a multiclassed character",
  splashclass: "Available without any levels in the class",
};

function normalizeClassImprovement(record, sources, graph) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const className = text(record.className);
  const improvementType = text(record.improvementType);
  const prerequisite = text(record.prerequisite);

  add("Class", className);
  add("Kind", humanize(improvementType));
  add("Prerequisite", prerequisite);

  const classSlug = graph.classSlugs.get(className);

  return {
    ...base,
    tagline: improvementType ? IMPROVEMENT_TAGLINES[improvementType] ?? null : null,
    summary: { className, improvementType: humanize(improvementType), prerequisite },
    stats,
    sections: compact([
      section(null, text(record.description)),
      classSlug
        ? section(null, `Part of the ${markdownLink(className, `/classes/${classSlug}`)} class.`)
        : null,
    ]),
    entries: [],
    tables: [],
  };
}

/* --------------------------------------------------------------- features */

const GRANTOR_ROUTES = {
  class: "classes",
  archetype: "archetypes",
  species: "species",
};

function normalizeFeature(record, sources, graph) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const grantedBy = text(record.grantedBy);
  const grantedByName = text(record.grantedByName);
  const level = numeric(record.level);

  add("Granted by", grantedByName);
  add("Level", ordinal(level));

  const route = grantedBy ? GRANTOR_ROUTES[grantedBy] : null;
  const grantorSlug =
    grantedBy === "class" ? graph.classSlugs.get(grantedByName) : slugify(grantedByName ?? "");

  return {
    ...base,
    // The URL is the canonical key rather than the name: "Ability Score
    // Improvement" is granted forty times over and "Extra Attack" a dozen, and
    // a slug derived from the name would put them all on one page or resolve
    // the collision with a suffix that moves as the corpus grows.
    slug: text(record.key) ?? base.slug,
    tagline: compact([
      grantedByName,
      level == null ? null : `${ordinal(level)} level`,
    ]).join(" · ") || null,
    summary: {
      grantedBy: humanize(grantedBy),
      grantedByName,
      level,
    },
    stats,
    sections: compact([
      section(null, text(record.description)),
      route && grantorSlug
        ? section(
            null,
            `Granted by ${markdownLink(grantedByName, `/${route}/${grantorSlug}`)}` +
              `${level == null ? "" : ` at ${ordinal(level)} level`}.`,
          )
        : null,
    ]),
    entries: [],
    tables: [],
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

function normalizeArchetype(record, sources, graph) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const className = text(record.className);
  const casterType =
    record.casterType && record.casterType !== "none"
      ? humanize(record.casterType)
      : null;

  add("Class", className);
  add("Casting", casterType);

  const classSlug = graph.classSlugs.get(className);

  return {
    ...base,
    tagline: className ? `${className} archetype` : null,
    summary: { className, casterType },
    stats,
    sections: compact([
      section(null, text(record.description)),
      grantedFeaturesSection(graph.grantedBy("archetype", base.name)),
      classSlug
        ? section(null, `An archetype of the ${markdownLink(className, `/classes/${classSlug}`)} class.`)
        : null,
    ]),
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

/* --------------------------------------------------------- enhanced items */

/**
 * The rarity ladder, ascending. This is the enhanced-item corpus's substitute
 * for a price — nothing in it carries a cost in credits — so a list page has to
 * be able to sort by it, and sorting by it has to mean sorting by power rather
 * than by spelling. Alphabetical order would put artifact first and standard
 * last, which is close to exactly backwards.
 */
const RARITY_ORDER = [
  "standard",
  "premium",
  "prototype",
  "advanced",
  "legendary",
  "artifact",
];

function normalizeEnhancedItem(record, sources, graph) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const itemType = humanize(record.itemType);
  const rarity = humanize(record.rarity);
  const subtype = text(record.subtype);
  const prerequisite = text(record.prerequisite);
  const requiresAttunement = Boolean(record.requiresAttunement);

  add("Rarity", rarity);
  add("Item type", itemType);
  // The label follows the meaning rather than the field name: what `subtype`
  // holds depends on the item type. For a modification it is the equipment the
  // modification is installed in, for adventuring gear it is the body slot the
  // item occupies, and for a specific weapon it is the base weapon the
  // enhanced version is built on.
  add(
    record.itemType === "itemModification" ? "Installed in" : "Kind",
    subtype ? subtype[0].toUpperCase() + subtype.slice(1) : null,
    equipmentRoute(subtype, graph),
  );
  add("Attunement", requiresAttunement ? "Required" : "Not required");
  add("Prerequisite", prerequisite);

  return {
    ...base,
    tagline: compact([rarity, itemType?.toLowerCase()]).join(" ") || null,
    summary: {
      itemType,
      rarity,
      // -1 for a rarity the ladder does not know, which sorts it below
      // standard rather than throwing. The schema's enum makes that
      // unreachable today; it stops a future rarity from breaking the column.
      rarityRank: RARITY_ORDER.indexOf(record.rarity ?? ""),
      subtype,
      requiresAttunement,
      prerequisite,
    },
    stats,
    sections: compact([section(null, text(record.description))]),
    entries: [],
    tables: [],
  };
}

/**
 * The equipment page an enhanced item's `subtype` names, or null.
 *
 * This is the whole of the relationship between the two types, and it is
 * deliberately the whole of it. An enhanced item is not a piece of equipment
 * with extra fields — it has no price, no weight, no armor class and no damage
 * dice, and it has a rarity band, an attunement requirement and a prerequisite
 * that no mundane item has — so the two are separate types that point at each
 * other rather than one type with half its fields empty.
 *
 * What `subtype` holds varies with `itemType`: a specific base weapon
 * ("bo-rifle"), a family ("any blaster", "vibroweapon"), a body slot ("hands"),
 * or a bare noun ("ammunition"). Nothing on the document says which, so the
 * match has to be the whole string against a whole equipment name, and only
 * where exactly one item answers to it. Twenty of the corpus's 56 subtypes
 * resolve that way, covering 321 enhanced items; the other 36 name something
 * the equipment catalogue has no single entry for, and produce no link. A
 * looser rule — a prefix, a word overlap — would produce links that resolve
 * and are wrong, which is worse than none, because a wrong link is invisible.
 */
function equipmentRoute(subtype, graph) {
  return graph?.equipmentRoute?.(subtype) ?? null;
}

/* ------------------------------------------- weapon and armour properties */

/**
 * The common fields for an item the archive recorded no book for.
 *
 * The two property glossaries and the reference tables are the three content
 * types with no `sourceKey`, and that is a decision rather than an omission:
 * the archive records their source as "None", and unlike the rule chapters —
 * where the file a record sits in names the book — there is nothing to infer
 * one from. A guessed citation on a rules page is worse than none at all.
 *
 * `common` is bypassed here rather than taught to tolerate a missing key,
 * because everywhere else an unresolvable `sourceKey` must stay the hard error
 * it is: it means the build is reading a content set and a mapping that
 * disagree.
 */
function unsourced(record) {
  return {
    name: text(record.name) ?? String(record.name ?? "").trim(),
    slug: slugify(record.name),
    source: null,
    sourceName: null,
  };
}

/**
 * The opening sentence of a rule, which is what a glossary is scanned by. A
 * property's rules text runs to a paragraph or more, and its first sentence is
 * almost always the whole of what the property does; the rest is arithmetic.
 */
function firstSentence(markdown) {
  const prose = text(markdown);
  if (!prose) return null;
  const paragraph = prose.split("\n\n")[0].replace(/\s+/g, " ").trim();
  const stop = paragraph.search(/\.(?:\s|$)/);
  return stop === -1 ? paragraph : paragraph.slice(0, stop + 1);
}

function normalizeProperty(record) {
  const description = text(record.description);

  return {
    ...unsourced(record),
    // No tagline. The badge under the heading already says "Weapon property",
    // and repeating the rule's first sentence directly above the rule itself
    // reads as a stutter.
    tagline: null,
    summary: { summaryLine: firstSentence(description) },
    stats: [],
    sections: compact([section(null, description)]),
    entries: [],
    tables: [],
  };
}

/* ------------------------------------------------------------------ rules */

/**
 * A chapter's position in its book, as a label, or null when printing it would
 * mislead. The archive numbers the Player's Handbook preface -2 and both
 * changelogs 99, and neither is a chapter number a reader would recognise.
 * Both still sort correctly in the table of contents, which is what the number
 * is actually for.
 */
function chapterLabel(chapterNumber) {
  const value = numeric(chapterNumber);
  if (value == null || value < 1 || value > 90) return null;
  return `Chapter ${value}`;
}

function normalizeRule(record, sources) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const isVariant = record.ruleType === "variant";
  const sections = splitIntoSections(text(record.body) ?? "");

  add("Book", base.sourceName);
  add("Kind", isVariant ? "Variant rule" : "Chapter");
  add("Position", chapterLabel(record.chapterNumber));

  return {
    ...base,
    /*
      The one content type whose slug comes from the document's key rather than
      from its display name.

      Slugs are derived from names everywhere else so that a canonical build
      and an archive build publish the same URLs, and that works because names
      are unique within a type. Chapter titles are not: seven of them are
      printed in more than one book, and all three books have a chapter called
      "Equipment". Deriving from the name would hand three of them the same
      slug and leave the collision handler to number them, so which book
      `/rules/equipment` showed would depend on directory order. The key is
      already the book-qualified slug, and the archive path builds the same
      string from the file a record came from.
    */
    slug: text(record.key) ?? base.slug,
    tagline: isVariant
      ? "Optional variant rule"
      : compact([base.sourceName, chapterLabel(record.chapterNumber)]).join(
          " · ",
        ) || null,
    summary: {
      ruleType: isVariant ? "Variant" : "Chapter",
      // The authored path. Both are absent on a variant rule, which is not on
      // a path at all, and on any passage nobody has placed yet.
      readingGroup: text(record.readingGroup),
      order: numeric(record.order),
      chapterNumber: numeric(record.chapterNumber),
      sectionCount: sections.filter((each) => each.heading).length,
    },
    stats,
    sections,
    entries: [],
    tables: [],
  };
}

/* ------------------------------------------------------- reference tables */

function normalizeReferenceTable(record) {
  const subject = text(record.subject);
  const { add, stats } = statCollector();

  add("Subject", subject);

  return {
    ...unsourced(record),
    tagline: subject,
    summary: { subject },
    stats,
    // The table is markdown and is rendered as markdown rather than being
    // parsed into the structured `tables` collection. The archived tables
    // disagree about their own shape — some carry an alignment row, some an
    // empty header, two a merged caption — so parsing them into a grid would
    // need a repair pass per table and would gain a reader nothing.
    sections: compact([section(null, text(record.body))]),
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

/* -------------------------------------------------------------- starships */

/**
 * The starship types are the only ones whose documents were never a flat row,
 * so they are also the only ones where this module does real shaping rather
 * than renaming. A base size arrives with a six-row tier table, six roles and
 * two dice pools; a deployment with a rank table and its features; a
 * modification with a prerequisite list whose entries are already resolved.
 * All of that goes into `tables` and `entries` rather than being flattened
 * into prose, because the tables are the part a player reads at the table.
 */

/** `{ number: 3, faces: 6 }` becomes `3d6`. */
function diceExpression(dice) {
  const number = numeric(dice?.number);
  const faces = numeric(dice?.faces);
  return number && faces ? `${number}d${faces}` : null;
}

/** `[{ ability: "dexterity", modifier: -4 }]` becomes `Dexterity -4`. */
function formatAdjustments(adjustments) {
  if (!Array.isArray(adjustments) || adjustments.length === 0) return null;
  const rendered = adjustments
    .map((adjustment) => {
      const ability = humanize(adjustment?.ability);
      const modifier = numeric(adjustment?.modifier);
      if (!ability || modifier == null) return null;
      return `${ability} ${modifier > 0 ? "+" : ""}${modifier}`;
    })
    .filter(Boolean);
  return rendered.length > 0 ? rendered.join(", ") : null;
}

/**
 * `{ normal: 1200, long: 4800 }` becomes `1,200/4,800 ft.` — the two bands a
 * gunner reads off a weapon, grouped because at this scale the digits run
 * together otherwise.
 */
function formatRange(range) {
  const normal = numeric(range?.normal);
  const long = numeric(range?.long);
  if (normal == null || long == null) return null;
  return `${normal.toLocaleString("en-US")}/${long.toLocaleString("en-US")} ft.`;
}

function normalizeStarshipBaseSize(record, sources) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const hull = record.hull ?? {};
  const shields = record.shields ?? {};
  const modifications = record.modifications ?? {};
  const progression = record.tierProgression ?? {};
  const roles = Array.isArray(record.roles) ? record.roles : [];

  const hullDice = diceExpression(hull.diceAtTier0);
  const modificationSlots = numeric(modifications.baseModificationSlots);
  const savingThrows = text(record.savingThrows);
  const adjustments = formatAdjustments(record.abilityScoreAdjustments);

  add("Ability adjustments", adjustments ?? "None");
  add("Hull dice at tier 0", hullDice);
  add("Hull points, first die", text(hull.firstDiePoints));
  add("Hull points, each die after", text(hull.subsequentDiePoints));
  add("Shield dice at tier 0", diceExpression(shields.diceAtTier0));
  add("Shield points, first die", text(shields.firstDiePoints));
  add("Shield points, each die after", text(shields.subsequentDiePoints));
  add("Base modification slots", modificationSlots);
  // Absent means none: a Tiny ship is unmanned and holds no suites at all,
  // which the printed table says with a dash.
  add("Maximum suite systems", text(modifications.maximumSuiteSystems) ?? "None");
  add("Stock modifications", text(modifications.stockModifications));
  add("Saving throws", savingThrows);

  return {
    ...base,
    tagline: compact([
      hullDice ? `${hullDice} hull` : null,
      `${roles.length} role${roles.length === 1 ? "" : "s"}`,
    ])
      .join(" · "),
    summary: {
      hullDice,
      modificationSlots,
      savingThrows,
      roles: roles.map((role) => text(role?.name)).filter(Boolean).join(", ") || null,
    },
    stats,
    sections: compact([section(null, text(record.lore))]),
    entries: (record.features ?? [])
      .map((feature) => ({
        group: "Features",
        name: text(feature?.name),
        body: text(feature?.description),
      }))
      .filter((entry) => entry.name || entry.body),
    tables: compact([tierTable(progression), rolesTable(roles)]),
  };
}

/**
 * The tier table, with the size's own signature die as a column heading —
 * every size names that die differently, so the heading comes from the data.
 */
function tierTable(progression) {
  const tiers = Array.isArray(progression?.tiers) ? progression.tiers : [];
  if (tiers.length === 0) return null;
  const dieName = text(progression.dieName) ?? "Die";
  return {
    caption: "Tier progression",
    columns: ["Tier", "Features", dieName, "Hull & shield dice", "AC"],
    rows: tiers.map((tier) => [
      String(numeric(tier?.tier) ?? ""),
      (tier?.features ?? []).join(", "),
      text(tier?.die) ?? "—",
      text(tier?.hullAndShieldDice) ?? "—",
      numeric(tier?.armorClassBonus) ? `+${tier.armorClassBonus}` : "—",
    ]),
  };
}

/**
 * The roles a hull can be laid down as. The shields column is dropped for the
 * three sizes whose roles have none, rather than printed as six dashes.
 */
function rolesTable(roles) {
  if (roles.length === 0) return null;
  const withShields = roles.some((role) => text(role?.shields));
  const columns = compact([
    "Role",
    "Ability scores",
    "Armor",
    withShields ? "Shields" : null,
    "Reactor",
    "Power coupling",
    "Speed / turning",
  ]);
  return {
    caption: "Roles",
    columns,
    rows: roles.map((role) => {
      const speed = numeric(role?.speed);
      const turning = numeric(role?.turning);
      return compact([
        text(role?.name) ?? "",
        formatAdjustments(role?.abilityScoreAdjustments) ?? "—",
        text(role?.armor) ?? "—",
        withShields ? (text(role?.shields) ?? "—") : null,
        text(role?.reactor) ?? "—",
        text(role?.powerCoupling) ?? "—",
        speed == null || turning == null ? "—" : `${speed}/${turning} ft.`,
      ]);
    }),
  };
}

function normalizeStarshipDeployment(record, sources) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const role = text(record.role);
  const ranks = Array.isArray(record.rankProgression) ? record.rankProgression : [];

  add("Station", role);
  add("Ranks", ranks.length > 0 ? String(ranks.length) : null);

  return {
    ...base,
    tagline: role,
    summary: { role },
    stats,
    sections: [],
    entries: (record.features ?? [])
      .map((feature) => ({
        group: "Features",
        name: text(feature?.name),
        body: text(feature?.description),
      }))
      .filter((entry) => entry.name || entry.body),
    tables:
      ranks.length === 0
        ? []
        : [
            {
              caption: "Rank progression",
              columns: ["Rank", "Features"],
              rows: ranks.map((rank) => [
                String(numeric(rank?.rank) ?? ""),
                (rank?.features ?? []).join(", "),
              ]),
            },
          ],
  };
}

function normalizeStarshipEquipment(record, sources) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const weapon = record.weapon ?? {};
  const category = humanize(record.category);
  const mounting = humanize(weapon.mounting);
  const cost = numeric(record.costInCredits);
  const damage = formatDamage(record.damage);
  const damageForLargerShips = formatDamage(record.damageForLargerShips);
  const properties = list(record.properties);
  const armor = record.armor ?? {};
  const shield = record.shield ?? {};
  const reactor = record.reactor ?? {};
  const coupling = record.powerCoupling ?? {};

  add("Category", category);
  add("Cost", cost == null ? null : `${cost.toLocaleString("en-US")} cr`);
  add("Mounting", mounting);
  // "Small" and "Huge" here are the two weapon tables, not the size of the
  // gun: a Small weapon is what a Tiny to Large hull carries.
  add(
    "Weapon table",
    weapon.weaponSize
      ? weapon.weaponSize === "huge"
        ? "Huge and Gargantuan hulls"
        : "Tiny to Large hulls"
      : null,
  );
  add("Damage", damage);
  add("Damage, Huge and larger", damageForLargerShips);
  add("Range", formatRange(record.range));
  add(
    "Weight",
    numeric(record.weightInPounds) == null ? null : `${record.weightInPounds} lb.`,
  );
  add(
    "Weight, Huge and larger",
    numeric(record.weightInPoundsForLargerShips) == null
      ? null
      : `${record.weightInPoundsForLargerShips} lb.`,
  );
  add("Properties", properties);
  add("Fired by", list(record.firedBy));
  add("Armor Class", text(armor.armorClass));
  add(
    "Damage reduction",
    numeric(armor.damageReduction) == null ? null : String(armor.damageReduction),
  );
  if (armor.stealthDisadvantage) add("Stealth", "Disadvantage");
  add("Shield capacity", text(shield.capacityMultiplier));
  add("Shield regeneration", text(shield.regenerationRateCoefficient));
  add("Power dice recovered", text(reactor.powerDiceRecovered));
  add("Fuel cost", text(reactor.fuelCostModifier));
  add(
    "Central power storage",
    numeric(coupling.centralStorageCapacity) == null
      ? null
      : String(coupling.centralStorageCapacity),
  );
  add(
    "Per-system power storage",
    numeric(coupling.systemStorageCapacity) == null
      ? null
      : String(coupling.systemStorageCapacity),
  );
  add("Hyperdrive class", text(record.hyperdriveClass));

  return {
    ...base,
    tagline: compact([category, mounting]).join(" · ") || null,
    summary: {
      category,
      cost,
      mounting,
      damage,
      properties: properties ? properties.join(", ") : null,
    },
    stats,
    sections: compact([section(null, text(record.description))]),
    entries: [],
    tables: [],
  };
}

/**
 * A prerequisite list, as one line.
 *
 * The printed wording is what is shown, never the resolved target: the
 * document carries both so that a link can be built without the page having to
 * paraphrase the book.
 */
function formatPrerequisites(prerequisites) {
  if (!Array.isArray(prerequisites)) return null;
  const clauses = prerequisites.map((entry) => text(entry?.text)).filter(Boolean);
  return clauses.length > 0 ? clauses.join(", ") : null;
}

/**
 * The hull requirement, as the short phrase a filter can offer.
 *
 * It is pulled out of the prerequisite list and given a column of its own
 * because it is the question a crew actually arrives with — "what can my Small
 * ship fit?" — and because leaving it inside a prose prerequisite makes it
 * unfilterable across 257 rows. The clause is printed as "Ship size Medium or
 * larger"; the leading words are the same on every one of them and only the
 * tail distinguishes them, so the tail is what the facet lists.
 */
function shipSizeRequirement(prerequisites) {
  if (!Array.isArray(prerequisites)) return null;
  const clause = prerequisites.find((entry) => entry?.kind === "shipSize");
  const printed = text(clause?.text);
  return printed ? printed.replace(/^Ship size\s+/i, "") : null;
}

/** Every prerequisite clause except the hull requirement, which has a column. */
function formatOtherPrerequisites(prerequisites) {
  if (!Array.isArray(prerequisites)) return null;
  return formatPrerequisites(
    prerequisites.filter((entry) => entry?.kind !== "shipSize"),
  );
}

function normalizeStarshipModification(record, sources) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const modificationType = humanize(record.modificationType);
  const grade = numeric(record.grade);
  const prerequisite = formatPrerequisites(record.prerequisites);
  const requiresShipSize = shipSizeRequirement(record.prerequisites);

  add("Type", modificationType);
  add("Grade", grade == null ? null : String(grade));
  add("Ship size", requiresShipSize);
  add("Prerequisite", prerequisite);

  return {
    ...base,
    tagline: compact([
      modificationType ? `${modificationType} modification` : null,
      grade == null ? null : `grade ${grade}`,
    ]).join(" · ") || null,
    summary: {
      modificationType,
      grade,
      requiresShipSize,
      // The hull requirement is already its own column, so repeating it here
      // would spend the widest column in the table on a duplicate.
      prerequisite: formatOtherPrerequisites(record.prerequisites),
    },
    stats,
    sections: compact([section(null, text(record.description))]),
    entries: [],
    tables: [],
  };
}

function normalizeStarshipVenture(record, sources) {
  const base = common(record, sources);
  const { add, stats } = statCollector();
  const prerequisites = Array.isArray(record.prerequisites) ? record.prerequisites : [];
  const prerequisite = formatPrerequisites(prerequisites);

  // A venture gated on a rank in a named station is one a player of that
  // station is shopping for, so it is worth a column of its own.
  const deployment =
    prerequisites.map((entry) => text(entry?.deploymentName)).find(Boolean) ?? null;

  // A venture gated on a class level is one only that class can ever take, so
  // it is the second filter a player reaches for after their station.
  const characterClass = prerequisites
    .map((entry) => text(entry?.className))
    .find(Boolean);

  add("Prerequisite", prerequisite);
  add("Deployment", deployment);
  add("Class", characterClass ? humanize(characterClass) : null);

  return {
    ...base,
    tagline: prerequisite ? `Requires ${prerequisite}` : "No prerequisite",
    summary: {
      prerequisite,
      deployment,
      characterClass: characterClass ? humanize(characterClass) : null,
    },
    stats,
    sections: compact([section(null, text(record.description))]),
    entries: [],
    tables: [],
  };
}

/**
 * A rule chapter is titled rather than named, exactly as a source is, so its
 * identity comes from a different field and `common` cannot be reused whole.
 */
function normalizeStarshipRule(record, sources) {
  const base = common({ ...record, name: record.title }, sources);
  const { add, stats } = statCollector();
  const chapterNumber = numeric(record.chapterNumber);

  add("Chapter", chapterNumber == null ? null : String(chapterNumber));

  return {
    ...base,
    tagline: chapterNumber == null ? null : `Chapter ${chapterNumber}`,
    summary: { chapterNumber },
    stats,
    // The body opens with its own "# Chapter 9: Combat" heading, and the page
    // already prints that as its h1. Left in, every chapter would carry two
    // top-level headings saying the same thing.
    sections: compact([
      section(null, text(String(record.body ?? "").replace(/^#\s+[^\n]*\n+/, ""))),
    ]),
    entries: [],
    tables: [],
  };
}

const NORMALIZERS = {
  species: normalizeSpecies,
  classes: normalizeClass,
  "class-improvements": normalizeClassImprovement,
  archetypes: normalizeArchetype,
  features: normalizeFeature,
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
  "enhanced-items": normalizeEnhancedItem,
  // One mapping for both glossaries. The documents are the same shape, and
  // which glossary an entry belongs to is decided by the directory it sits in.
  "weapon-properties": normalizeProperty,
  "armor-properties": normalizeProperty,
  monsters: normalizeMonster,
  "starship-base-sizes": normalizeStarshipBaseSize,
  "starship-deployments": normalizeStarshipDeployment,
  "starship-equipment": normalizeStarshipEquipment,
  "starship-modifications": normalizeStarshipModification,
  "starship-ventures": normalizeStarshipVenture,
  "starship-rules": normalizeStarshipRule,
  rules: normalizeRule,
  "reference-tables": normalizeReferenceTable,
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
 *
 * `graph` is what the caller knows about the rest of the build: which features
 * a class grants, and which equipment document a name resolves to. A
 * normalizer stays a function of one document plus what it was handed, because
 * the caller is the only thing that knows what else is being published
 * alongside it.
 */
export function normalizeAllCanonical(typeId, records, sources, graph = EMPTY_GRAPH) {
  const normalize = NORMALIZERS[typeId];
  if (!normalize) {
    throw new Error(`No canonical mapping for content type: ${typeId}`);
  }

  const seen = new Map();
  return records.map((record) => {
    const item = normalize(record, sources, graph);
    const count = (seen.get(item.slug) ?? 0) + 1;
    seen.set(item.slug, count);
    return {
      type: typeId,
      ...item,
      slug: count === 1 ? item.slug : `${item.slug}-${count}`,
    };
  });
}
