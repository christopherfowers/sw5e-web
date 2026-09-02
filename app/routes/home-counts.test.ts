/**
 * The number on each card of the front page's grid, which is four different
 * questions wearing one shape.
 *
 * The grid is the header's menus drawn as cards, and the menus hold four kinds
 * of destination: a type index, a slice of a type, a book, and a hub standing
 * for several of the first two. Only the first is a lookup. A slice has no
 * entry in the manifest and has to be counted by running its own predicate over
 * the rows; a hub is the sum of what it holds, which means both sums.
 *
 * That last clause is the one this file exists for, and it is the one nothing
 * else would notice. `/customization-options` holds six type indexes and the
 * three cuts of the class improvements. Add up the six alone and the card in
 * front of the hub reads 190 while the hub's own lede, one click later, reads
 * 219 — two numbers for one chapter, neither obviously wrong, on two pages
 * that never appear side by side. `home.test.tsx` renders the grid from
 * loader data it writes itself and would go on passing.
 *
 * The loader is exercised rather than the arithmetic, because the arithmetic is
 * not exported and should not be: what is worth holding is that the page ships
 * the right number, not that a private function adds up.
 */

import { describe, expect, it, vi } from "vitest";

import type { AnySummary, ContentTypeId } from "~/content/types";

/**
 * A dataset small enough to do the sums in your head and shaped like the real
 * one where it matters: ten class improvements of each kind, told apart by the
 * printed value of `improvementType` exactly as `humanize` leaves it.
 */
const IMPROVEMENT_KINDS = ["Class", "Multiclass", "Splashclass"];

const IMPROVEMENTS = IMPROVEMENT_KINDS.flatMap((improvementType) =>
  Array.from({ length: 10 }, (_, index) => ({
    slug: `class-${index}-${improvementType.toLowerCase()}`,
    name: `Class ${index} ${improvementType} Improvement`,
    source: "EC",
    tagline: null,
    className: `Class ${index}`,
    improvementType,
    prerequisite: null,
  })),
);

const TYPE_COUNTS: Record<string, number> = {
  feats: 90,
  "fighting-styles": 32,
  "fighting-masteries": 32,
  "lightsaber-forms": 20,
  "weapon-focuses": 8,
  "weapon-supremacies": 8,
  "class-improvements": IMPROVEMENTS.length,
};

vi.mock("~/content/dataset.server", () => ({
  getManifest: () => ({
    types: Object.entries(TYPE_COUNTS).map(([id, count]) => ({ id, count })),
  }),
  getSummaries: (type: ContentTypeId): AnySummary[] =>
    type === "class-improvements" ? (IMPROVEMENTS as AnySummary[]) : [],
  isCuratedDataset: () => true,
  totalForSource: () => 0,
}));

const { loader } = await import("./home");

describe("the count on a destination's card", () => {
  it("adds a hub's type indexes and its slices together", async () => {
    const { destinationCounts } = await loader();

    /*
      Six type indexes (190) plus the three cuts of the class improvements
      (30). The hub's own page sums the same nine and prints 219 in its lede,
      so this is the assertion that keeps the two pages telling a reader the
      same thing about one chapter.
    */
    expect(destinationCounts["/customization-options"]).toBe(220);
  });

  it("counts a slice by running its predicate, not by looking the type up", async () => {
    const { destinationCounts } = await loader();

    // Ten of thirty on each. A manifest lookup would put 30 on all three, and
    // the type index the manifest is counting no longer exists as a page.
    expect(destinationCounts["/class-improvements"]).toBe(10);
    expect(destinationCounts["/multiclass-improvements"]).toBe(10);
    expect(destinationCounts["/splashclass-improvements"]).toBe(10);
  });

  it("leaves a page that holds nothing without a number at all", async () => {
    const { destinationCounts } = await loader();

    // `/sources` is a page about five books rather than a page of anything,
    // and "0 entries" under it would be a claim rather than an omission.
    expect(destinationCounts["/sources"]).toBeUndefined();
  });
});
