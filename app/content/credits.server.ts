/**
 * Build-time access to the credits and to per-image attribution.
 *
 * Server-only for the same reason `dataset.server.ts` is: every page here is
 * prerendered, so a `loader` runs on a build machine and only what it returns
 * is written into the page. This document carries a citation for all 150 of
 * the site's pictures, and a species page needs exactly one of them — so the
 * whole document stays on the build machine and each page ships its own share.
 *
 * Generated from the canonical content set by `scripts/build-credits.mjs` and
 * committed. Unlike the game-content dataset there is no curated sample: four
 * patrons out of three hundred and eighty-four is not a smaller credits list,
 * it is a wrong one, and wrong in the way that matters here — it leaves people
 * out.
 */

import credits from "../data/credits.json";
import type { AssetCredit, AssetGroup, CreditCategory } from "./types";

const CATEGORIES = credits.categories as CreditCategory[];
const ASSETS = credits.assets as Record<string, AssetCredit>;

/** Every category in its authored order, each holding its own people. */
export function creditCategories(): CreditCategory[] {
  return CATEGORIES;
}

/** How many people are credited in total, across every category. */
export function creditedPeopleCount(): number {
  return CATEGORIES.reduce((total, category) => total + category.people.length, 0);
}

/**
 * The citation for one picture, or null when the site holds no record of it.
 *
 * Null and `inherited-unattributed` are different answers and callers must not
 * conflate them. Null means nobody has written anything down about this file,
 * which is a bug — the generator and `credits.test.ts` exist to keep it from
 * happening. `inherited-unattributed` means somebody did write it down, and
 * what they wrote is that the author is not known.
 *
 * A gallery thumbnail is a crop of the portrait it came from rather than a
 * work of its own, so callers resolve `species-thumbs` against `species`.
 */
export function assetCredit(group: AssetGroup, key: string): AssetCredit | null {
  return ASSETS[`${group}/${key}`] ?? null;
}

/** Every citation key the document carries, as "<group>/<key>". */
export function assetCreditKeys(): string[] {
  return Object.keys(ASSETS);
}

/** Citations that name an artist, for the credits page's own summary. */
export function citedAssetCount(): number {
  return Object.values(ASSETS).filter((asset) => asset.status === "cited").length;
}
