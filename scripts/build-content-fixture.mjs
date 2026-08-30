#!/usr/bin/env node
/**
 * Builds the site's content dataset from the legacy SW5e archive.
 *
 * The archive itself is six megabytes of unmaintained JSON with known
 * corruption and belongs in its own repository, so it is never committed here.
 * This script reads it from a configurable path and emits a compact, normalized
 * dataset into a gitignored directory.
 *
 *   node scripts/build-content-fixture.mjs --archive ../sw5e-legacy-archive/api
 *   node scripts/build-content-fixture.mjs --curated
 *
 * The default run writes the full dataset to `app/data/generated/`. The
 * `--curated` run writes a handful of items per type to `app/data/fixture/`,
 * which IS committed, so that tests and CI pass for a contributor who does not
 * have the archive. The app renders from whichever dataset is present.
 *
 * Emitted per content type:
 *   <type>.summaries.json   list-page rows, small enough to ship to a browser
 *   <type>.items.json       full detail records, read at build time only
 * Plus:
 *   manifest.json           type ids, labels and counts
 *   search-index.json       one searchable record per item, loaded on demand
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { CONTENT_TYPES, normalizeAll, slugify } from "./lib/normalize.mjs";
import { REPLACEMENT, countRepairs } from "./lib/repair-text.mjs";

const TYPE_LABELS = {
  species: { singular: "Species", plural: "Species" },
  archetypes: { singular: "Archetype", plural: "Archetypes" },
  backgrounds: { singular: "Background", plural: "Backgrounds" },
  feats: { singular: "Feat", plural: "Feats" },
  powers: { singular: "Power", plural: "Powers" },
  maneuvers: { singular: "Maneuver", plural: "Maneuvers" },
  equipment: { singular: "Equipment", plural: "Equipment" },
  monsters: { singular: "Creature", plural: "Creatures" },
};

/** How many items per type the committed fixture carries. */
const CURATED_PER_TYPE = 4;

/** Longest description excerpt kept in the search index, in characters. */
const SEARCH_EXCERPT_LENGTH = 240;

function parseArguments(argv) {
  const options = { curated: false, archive: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--curated") options.curated = true;
    else if (argument === "--archive") options.archive = argv[++index];
    else if (argument.startsWith("--archive=")) options.archive = argument.slice(10);
    else if (argument === "--out") options.out = argv[++index];
    else if (argument.startsWith("--out=")) options.out = argument.slice(6);
    else throw new Error(`Unrecognized argument: ${argument}`);
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
    .filter((item) => item.sections.some((each) => each.body.length > 120))
    .filter((item) => !hasResidualCorruption(item))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  return usable.slice(0, CURATED_PER_TYPE);
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

async function writeJson(directory, name, value) {
  const file = path.join(directory, name);
  await writeFile(file, `${JSON.stringify(value)}\n`, "utf8");
  return file;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const archiveDirectory = path.resolve(
    options.archive ??
      process.env.SW5E_ARCHIVE ??
      "../sw5e-legacy-archive/api",
  );
  const outputDirectory = path.resolve(
    options.out ?? (options.curated ? "app/data/fixture" : "app/data/generated"),
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

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const repairs = {
    quotes: 0,
    apostrophes: 0,
    spacedDashes: 0,
    weldedDashes: 0,
    unrepaired: 0,
    totalLoss: 0,
  };
  const manifest = { generatedAt: new Date().toISOString(), curated: options.curated, types: [] };
  const searchIndex = [];

  for (const type of CONTENT_TYPES) {
    const records = await readArchiveType(archiveDirectory, type.file);
    countRepairsDeep(records, repairs);

    // Alphabetical by name is the canonical order: it decides the default
    // list order and, with it, what "previous" and "next" mean on a detail
    // page. The archive's own order is arbitrary for several types.
    const normalized = normalizeAll(type.id, records, powerSlugs).sort(
      (left, right) => left.name.localeCompare(right.name, "en"),
    );
    const items = options.curated ? selectCurated(normalized) : normalized;

    await writeJson(outputDirectory, `${type.id}.items.json`, items);
    await writeJson(outputDirectory, `${type.id}.summaries.json`, items.map(toSummary));
    searchIndex.push(...items.map(toSearchRecord));

    manifest.types.push({
      id: type.id,
      ...TYPE_LABELS[type.id],
      count: items.length,
    });
    process.stdout.write(`${type.id.padEnd(12)} ${String(items.length).padStart(4)} items\n`);
  }

  await writeJson(outputDirectory, "search-index.json", searchIndex);
  await writeJson(outputDirectory, "manifest.json", manifest);

  const total = manifest.types.reduce((sum, type) => sum + type.count, 0);
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
