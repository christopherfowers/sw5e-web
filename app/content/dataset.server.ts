/**
 * Build-time access to the content dataset.
 *
 * Every content route is pre-rendered, so its `loader` runs during the build
 * and never in a browser. That is the whole reason this module is
 * server-only: the full dataset is several megabytes, and keeping it behind a
 * `loader` means a visitor downloads one page's worth of data, embedded in
 * that page, instead of the entire library.
 *
 * Two datasets can satisfy this module. `app/data/generated/` is the full
 * archive-derived set and is gitignored; `app/data/fixture/` is the small
 * curated set that is committed so tests and CI pass without the archive.
 * Generated wins when present. Both are matched with `import.meta.glob`, which
 * quietly yields nothing when a directory is absent — the mechanism that lets
 * one build work in both situations.
 */

import type {
  AnySummary,
  ContentItem,
  ContentTypeId,
  Manifest,
  SummaryFor,
} from "./types";

type JsonModules = Record<string, unknown>;

const generated: JsonModules = import.meta.glob("../data/generated/*.json", {
  eager: true,
  import: "default",
});

const fixture: JsonModules = import.meta.glob("../data/fixture/*.json", {
  eager: true,
  import: "default",
});

const usingGenerated = Object.keys(generated).length > 0;
const dataset = usingGenerated ? generated : fixture;

if (Object.keys(dataset).length === 0) {
  throw new Error(
    "No content dataset found. Run `node scripts/build-content-fixture.mjs` " +
      "to generate one, or check that app/data/fixture is present.",
  );
}

function read<T>(fileName: string): T {
  const entry = Object.entries(dataset).find(([path]) =>
    path.endsWith(`/${fileName}`),
  );
  if (!entry) throw new Error(`Content dataset is missing ${fileName}`);
  return entry[1] as T;
}

/** True when the site is rendering the small committed fixture. */
export function isCuratedDataset(): boolean {
  return !usingGenerated;
}

export function getManifest(): Manifest {
  return read<Manifest>("manifest.json");
}

export function getSummaries<T extends ContentTypeId>(
  type: T,
): SummaryFor<T>[] {
  return read<SummaryFor<T>[]>(`${type}.summaries.json`);
}

export function getItems(type: ContentTypeId): ContentItem[] {
  return read<ContentItem[]>(`${type}.items.json`);
}

export function getItem(
  type: ContentTypeId,
  slug: string,
): ContentItem | undefined {
  return getItems(type).find((item) => item.slug === slug);
}

/**
 * The item before and after this one in the type's list order, so a reader can
 * page through creatures or powers without going back to the index.
 */
export function getNeighbours(
  type: ContentTypeId,
  slug: string,
): { previous: AnySummary | null; next: AnySummary | null } {
  const summaries = getSummaries(type) as AnySummary[];
  const index = summaries.findIndex((summary) => summary.slug === slug);
  if (index === -1) return { previous: null, next: null };
  return {
    previous: index > 0 ? summaries[index - 1] : null,
    next: index < summaries.length - 1 ? summaries[index + 1] : null,
  };
}
