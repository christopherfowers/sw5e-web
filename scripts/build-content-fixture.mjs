#!/usr/bin/env node
/**
 * Builds the site's content dataset, from either of the two sources that can
 * supply one.
 *
 *   node scripts/build-content-fixture.mjs --content ../sw5e-database/content
 *   node scripts/build-content-fixture.mjs --archive ../sw5e-legacy-archive/api
 *   node scripts/build-content-fixture.mjs --curated
 *
 * `--content` reads the canonical, schema-validated content set maintained in
 * the sw5e-database repository — one JSON document per item. This is what the
 * container image builds from, so the site publishes the same corpus the API
 * serves.
 *
 * `--archive` reads the 2022 legacy archive: six megabytes of unmaintained
 * JSON with known encoding corruption, one dump per type. It is never
 * committed here and is kept working because it is still the only source for
 * the types the canonical set has not reached yet.
 *
 * Either run writes the full dataset to `app/data/generated/`. The `--curated`
 * run writes a handful of items per type to `app/data/fixture/`, which IS
 * committed, so that tests and CI pass for a contributor who has neither
 * source to hand. The app renders from whichever dataset is present.
 *
 * Emitted per content type, identically whichever source was read:
 *   <type>.summaries.json   list-page rows, small enough to ship to a browser
 *   <type>.items.json       full detail records, read at build time only
 * Plus:
 *   manifest.json           type ids, labels and counts
 *   search-index.json       one searchable record per item, loaded on demand
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  CANONICAL_DIRECTORIES,
  buildClassGraph,
  indexSources,
  normalizeAllCanonical,
} from "./lib/canonical.mjs";
import { CONTENT_TYPES, normalizeAll, slugify } from "./lib/normalize.mjs";
import { REPLACEMENT, countRepairs } from "./lib/repair-text.mjs";

const TYPE_LABELS = {
  species: { singular: "Species", plural: "Species" },
  classes: { singular: "Class", plural: "Classes" },
  "class-improvements": { singular: "Class improvement", plural: "Class improvements" },
  archetypes: { singular: "Archetype", plural: "Archetypes" },
  features: { singular: "Feature", plural: "Features" },
  backgrounds: { singular: "Background", plural: "Backgrounds" },
  feats: { singular: "Feat", plural: "Feats" },
  powers: { singular: "Power", plural: "Powers" },
  maneuvers: { singular: "Maneuver", plural: "Maneuvers" },
  "fighting-styles": { singular: "Fighting Style", plural: "Fighting Styles" },
  "fighting-masteries": {
    singular: "Fighting Mastery",
    plural: "Fighting Masteries",
  },
  "lightsaber-forms": {
    singular: "Lightsaber Form",
    plural: "Lightsaber Forms",
  },
  "weapon-focuses": { singular: "Weapon Focus", plural: "Weapon Focuses" },
  "weapon-supremacies": {
    singular: "Weapon Supremacy",
    plural: "Weapon Supremacies",
  },
  equipment: { singular: "Equipment", plural: "Equipment" },
  monsters: { singular: "Creature", plural: "Creatures" },
  "starship-base-sizes": { singular: "Hull", plural: "Starship hulls" },
  "starship-deployments": { singular: "Deployment", plural: "Deployments" },
  "starship-equipment": { singular: "Ship part", plural: "Ship equipment" },
  "starship-modifications": { singular: "Modification", plural: "Modifications" },
  "starship-ventures": { singular: "Venture", plural: "Ventures" },
  "starship-rules": { singular: "Rules chapter", plural: "Starship rules" },
};

/** How many items per type the committed fixture carries. */
const CURATED_PER_TYPE = 4;

/** Longest description excerpt kept in the search index, in characters. */
const SEARCH_EXCERPT_LENGTH = 240;

function parseArguments(argv) {
  const options = { curated: false, archive: null, content: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--curated") options.curated = true;
    else if (argument === "--archive") options.archive = argv[++index];
    else if (argument.startsWith("--archive=")) options.archive = argument.slice(10);
    else if (argument === "--content") options.content = argv[++index];
    else if (argument.startsWith("--content=")) options.content = argument.slice(10);
    else if (argument === "--out") options.out = argv[++index];
    else if (argument.startsWith("--out=")) options.out = argument.slice(6);
    else throw new Error(`Unrecognized argument: ${argument}`);
  }

  if (options.content && options.archive) {
    throw new Error(
      "Pass either --content or --archive, not both: they read different " +
        "sources and the dataset has to come from one of them.",
    );
  }
  if (options.content && options.curated) {
    throw new Error(
      "--curated builds the committed sample in app/data/fixture from the " +
        "legacy archive, which is where every item in it came from. Use " +
        "--content --out <dir> to write a canonical dataset somewhere else.",
    );
  }

  return options;
}

/** Markdown reduced to the words a reader would actually see. */
function toPlainText(markdown) {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*_{3,}\s*$/gm, "")
    .replace(/[*_`|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(value, limit) {
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * One search record per item. `fields` is what makes a result explainable:
 * each entry is a labelled fragment, so a hit can say which part of the item
 * matched and show it, rather than asserting a match with no evidence.
 */
function toSearchRecord(item) {
  const fields = [];
  if (item.tagline) fields.push({ label: "Summary", text: item.tagline });
  for (const stat of item.stats) {
    if (stat.value && stat.value.length <= 80) fields.push({ label: stat.label, text: stat.value });
  }
  const prose = item.sections.map((each) => toPlainText(each.body)).join(" ");
  if (prose) {
    fields.push({ label: "Description", text: excerpt(prose, SEARCH_EXCERPT_LENGTH) });
  }
  for (const entry of item.entries) {
    if (entry.name) fields.push({ label: entry.group, text: entry.name });
  }
  return {
    type: item.type,
    slug: item.slug,
    name: item.name,
    source: item.source,
    fields,
  };
}

/** Everything a list page needs for one row. */
function toSummary(item) {
  return {
    slug: item.slug,
    name: item.name,
    source: item.source,
    tagline: item.tagline,
    ...item.summary,
  };
}

/**
 * The committed fixture must render the whole UI without the archive, so it
 * takes the first few items of each type that carry prose and survived repair
 * with no residual corruption. Selection is deterministic — alphabetical by
 * name — so the fixture only changes when someone means to change it.
 */
function selectCurated(items) {
  const usable = items
    .filter((item) => renderedProseLength(item) > 120)
    .filter((item) => !hasResidualCorruption(item))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  return usable.slice(0, CURATED_PER_TYPE);
}

/**
 * How much prose an item would actually put on the page.
 *
 * Sections used to be the whole of this, which worked while every type kept
 * its rules text in one blob. The combat options do not: a fighting style's
 * page is a one-line lead and then its benefits, which are entries, so
 * measuring sections alone found no fighting style worth committing and the
 * fixture would have shipped that type empty — the exact failure the fixture
 * exists to rule out.
 */
function renderedProseLength(item) {
  return (
    item.sections.reduce((total, each) => total + each.body.length, 0) +
    item.entries.reduce((total, each) => total + (each.body?.length ?? 0), 0)
  );
}

function hasResidualCorruption(item) {
  return JSON.stringify(item).includes(REPLACEMENT);
}

async function readArchiveType(archiveDirectory, fileName) {
  const file = path.join(archiveDirectory, `${fileName}.json`);
  const raw = await readFile(file, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${file} is not a JSON array`);
  return parsed;
}

/**
 * Every archive record for one content type.
 *
 * Most types are one dump. `class-improvements` is three, and which of the
 * three a record came from is the only thing that says what kind of
 * improvement it is — the records themselves are identical in shape and carry
 * nothing to tell them apart. So the reader stamps the kind on each record as
 * it is read, and the normalizer treats it as a field like any other.
 */
async function readArchiveRecords(archiveDirectory, type) {
  if (!type.files) return readArchiveType(archiveDirectory, type.file);

  const records = [];
  for (const { file, improvementType } of type.files) {
    for (const record of await readArchiveType(archiveDirectory, file)) {
      records.push({ ...record, improvementType });
    }
  }
  return records;
}

async function writeJson(directory, name, value) {
  const file = path.join(directory, name);
  await writeFile(file, `${JSON.stringify(value)}\n`, "utf8");
  return file;
}

/**
 * Writes one complete dataset: two files per content type, plus the manifest
 * and the search index.
 *
 * Both sources funnel through here, which is what guarantees that a canonical
 * build and an archive build are interchangeable as far as the app, the tests
 * and the prerender list are concerned. A type with no items still gets its
 * files, so `getSummaries` finds an empty list rather than throwing.
 */
async function writeDataset(outputDirectory, types, { curated }) {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const manifest = { generatedAt: new Date().toISOString(), curated, types: [] };
  const searchIndex = [];

  for (const { id, items } of types) {
    await writeJson(outputDirectory, `${id}.items.json`, items);
    await writeJson(outputDirectory, `${id}.summaries.json`, items.map(toSummary));
    searchIndex.push(...items.map(toSearchRecord));

    manifest.types.push({ id, ...TYPE_LABELS[id], count: items.length });
    process.stdout.write(`${id.padEnd(12)} ${String(items.length).padStart(4)} items\n`);
  }

  await writeJson(outputDirectory, "search-index.json", searchIndex);
  await writeJson(outputDirectory, "manifest.json", manifest);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const outputDirectory = path.resolve(
    options.out ?? (options.curated ? "app/data/fixture" : "app/data/generated"),
  );

  if (options.content) {
    await buildFromCanonicalContent(
      path.resolve(options.content),
      outputDirectory,
    );
    return;
  }

  await buildFromArchive(options, outputDirectory);
}

/**
 * The canonical path: one JSON document per item, under a directory per type.
 *
 * Nothing here repairs text or strips legacy fields, because the canonical set
 * has neither problem. What it does have is a shape of its own, mapped in
 * `scripts/lib/canonical.mjs`.
 */
async function buildFromCanonicalContent(contentDirectory, outputDirectory) {
  const present = await readDirectoryNames(contentDirectory);
  if (present === null) {
    throw new Error(
      `Cannot read the canonical content set at ${contentDirectory}. Pass ` +
        "--content <dir> pointing at the `content` directory of a " +
        "sw5e-database checkout, or at /opt/sw5e/content inside the " +
        "published content image.",
    );
  }

  // An empty or wrong directory has to fail here rather than three steps
  // later as a site that renders nothing. This is the failure the container
  // build exists to catch: a copy that silently produced no content.
  const sourceRecords = await readCanonicalType(contentDirectory, "source");
  if (sourceRecords.length === 0) {
    throw new Error(
      `${contentDirectory} holds no content/source documents, so no item in ` +
        "it could be attributed to a book. It is not a canonical content set.",
    );
  }
  const sources = indexSources(sourceRecords);

  // Every document is read once, before anything is normalized, because four
  // of the types are a graph rather than a catalogue: a class page links to
  // its archetypes, its improvements and everything it grants, and a feature
  // page links back. None of those links can be resolved from one type's
  // documents alone.
  const records = new Map();
  for (const type of CONTENT_TYPES) {
    const directory = CANONICAL_DIRECTORIES[type.id];
    records.set(
      type.id,
      directory ? await readCanonicalType(contentDirectory, directory) : [],
    );
  }

  const graph = buildClassGraph({
    classes: records.get("classes") ?? [],
    classImprovements: records.get("class-improvements") ?? [],
    archetypes: records.get("archetypes") ?? [],
    features: records.get("features") ?? [],
  });

  const types = [];
  for (const type of CONTENT_TYPES) {
    // A type the canonical set does not carry still gets its files and its
    // manifest entry, so the site keeps the route and renders an empty index
    // instead of 404ing on a link its own navigation offers.
    if (!CANONICAL_DIRECTORIES[type.id]) {
      types.push({ id: type.id, items: [] });
      continue;
    }

    const items = normalizeAllCanonical(
      type.id,
      records.get(type.id) ?? [],
      sources,
      graph,
    ).sort((left, right) => left.name.localeCompare(right.name, "en"));

    types.push({ id: type.id, items });
  }

  const total = types.reduce((sum, type) => sum + type.items.length, 0);
  if (total === 0) {
    throw new Error(
      `${contentDirectory} produced no items at all. Nothing downstream can ` +
        "tell that apart from a site with no content, so it fails here.",
    );
  }

  await writeDataset(outputDirectory, types, { curated: false });

  process.stdout.write(
    `\n${total} items written to ${path.relative(process.cwd(), outputDirectory)}\n`,
  );
  process.stdout.write(
    `read from the canonical content set at ${contentDirectory}, ` +
      `covering ${sources.size} sources\n`,
  );
}

/** Every JSON document in one canonical type directory. */
async function readCanonicalType(contentDirectory, directory) {
  const typeDirectory = path.join(contentDirectory, directory);
  const names = await readDirectoryNames(typeDirectory);
  if (names === null) return [];

  const records = [];
  for (const name of names.filter((each) => each.endsWith(".json")).sort()) {
    const file = path.join(typeDirectory, name);
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${file} is not a JSON object`);
    }
    records.push(parsed);
  }
  return records;
}

/** The names in a directory, or null when there is no such directory. */
async function readDirectoryNames(directory) {
  try {
    return await readdir(directory);
  } catch {
    return null;
  }
}

/** The legacy path, unchanged: one dump per type, repaired on the way through. */
async function buildFromArchive(options, outputDirectory) {
  const archiveDirectory = path.resolve(
    options.archive ??
      process.env.SW5E_ARCHIVE ??
      "../sw5e-legacy-archive/api",
  );

  try {
    await readdir(archiveDirectory);
  } catch {
    throw new Error(
      `Cannot read the legacy archive at ${archiveDirectory}. Pass --archive ` +
        "<path> or set SW5E_ARCHIVE to the directory holding Species.json, " +
        "Monster.json and friends.",
    );
  }

  // Power slugs are resolved first: monster stat blocks reference powers by
  // name, and those references become real links only if the target exists.
  const powerRecords = await readArchiveType(archiveDirectory, "Power");
  const powerSlugs = new Set(powerRecords.map((record) => slugify(record.name)));

  const repairs = {
    quotes: 0,
    apostrophes: 0,
    spacedDashes: 0,
    weldedDashes: 0,
    unrepaired: 0,
    totalLoss: 0,
  };

  const types = [];
  for (const type of CONTENT_TYPES) {
    // A type the archive path does not carry still gets its files and its
    // manifest entry, the same way the canonical path treats a directory it
    // has not been given: the route stays and renders an empty index, so the
    // gap is visible rather than being a link the navigation offers and
    // nothing answers.
    if (!type.file && !type.files) {
      types.push({ id: type.id, items: [] });
      continue;
    }

    const records = await readArchiveRecords(archiveDirectory, type);
    countRepairsDeep(records, repairs);

    // Alphabetical by name is the canonical order: it decides the default
    // list order and, with it, what "previous" and "next" mean on a detail
    // page. The archive's own order is arbitrary for several types.
    const normalized = normalizeAll(type.id, records, powerSlugs).sort(
      (left, right) => left.name.localeCompare(right.name, "en"),
    );
    types.push({
      id: type.id,
      items: options.curated ? selectCurated(normalized) : normalized,
    });
  }

  await writeDataset(outputDirectory, types, { curated: options.curated });

  const total = types.reduce((sum, type) => sum + type.items.length, 0);
  process.stdout.write(
    `\n${total} items written to ${path.relative(process.cwd(), outputDirectory)}\n`,
  );
  process.stdout.write(
    "encoding repairs: " +
      `${repairs.apostrophes} apostrophes, ${repairs.quotes} quotation marks, ` +
      `${repairs.spacedDashes + repairs.weldedDashes} em dashes; ` +
      `${repairs.totalLoss} fields dropped as total losses; ` +
      `${repairs.unrepaired} characters left unrepaired as ambiguous\n`,
  );
}

/** Walks raw archive records tallying what the repair rules would fix. */
function countRepairsDeep(value, totals) {
  if (typeof value === "string") {
    const counts = countRepairs(value);
    for (const key of Object.keys(totals)) totals[key] += counts[key];
    return;
  }
  if (Array.isArray(value)) {
    for (const element of value) countRepairsDeep(element, totals);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (key.endsWith("Json")) continue;
      countRepairsDeep(nested, totals);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
