/**
 * Fetches the search index into the browser, once, on first use.
 *
 * Search is the one feature that needs the whole corpus client-side, so the
 * index is deliberately kept out of the initial bundle and pulled in the first
 * time someone opens search. Everything else on the site is served as
 * pre-rendered HTML with only its own page's data.
 */

import type { SearchRecord } from "./types";

type IndexLoader = () => Promise<SearchRecord[]>;

const generated = import.meta.glob<SearchRecord[]>(
  "../data/generated/search-index.json",
  { import: "default" },
);

const fixture = import.meta.glob<SearchRecord[]>(
  "../data/fixture/search-index.json",
  { import: "default" },
);

function pickLoader(): IndexLoader {
  const generatedLoader = Object.values(generated)[0];
  if (generatedLoader) return generatedLoader;
  const fixtureLoader = Object.values(fixture)[0];
  if (fixtureLoader) return fixtureLoader;
  throw new Error("No search index found in app/data");
}

let pending: Promise<SearchRecord[]> | null = null;

export function loadSearchIndex(): Promise<SearchRecord[]> {
  pending ??= pickLoader()();
  return pending;
}
