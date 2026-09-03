/**
 * The reading path the front page is handed, built by the loader.
 *
 * `home.test.tsx` renders the path from loader data it writes itself, which is
 * the right way to test the rendering and no way at all to test the ordering:
 * the fixture arrives already sorted, so the loader could sort by anything —
 * or by nothing — and every one of those tests would go on passing. Reverting
 * the sort to `chapterNumber` did exactly that.
 *
 * So this runs the real loader over a dataset shaped like the corpus, with the
 * documents deliberately out of order and with the printed numbers disagreeing
 * with the authored ones. That disagreement is the whole point: it is the case
 * the authored path exists for, and a fixture where the two agreed would prove
 * nothing about which one was read.
 */

import { describe, expect, it, vi } from "vitest";

import type { AnySummary, ContentTypeId } from "~/content/types";

/**
 * Five passages of the handbook, plus two that are not on the path.
 *
 * Shuffled on purpose, and the printed numbers are the ones the archive really
 * carries: "What's Different?" at -1, ahead of an introduction numbered 0. A
 * loader reading `chapterNumber` puts the comparison with another game before
 * the explanation of this one, which is the mistake being guarded against.
 */
const RULES = [
  {
    slug: "phb-combat",
    name: "Combat",
    source: "PHB",
    tagline: null,
    ruleType: "Chapter",
    readingGroup: "Playing the game",
    order: 4,
    chapterNumber: 9,
    sectionCount: 9,
  },
  {
    slug: "phb-whats-different",
    name: "What's Different?",
    source: "PHB",
    tagline: null,
    ruleType: "Chapter",
    readingGroup: "Start here",
    order: 2,
    chapterNumber: -1,
    sectionCount: 1,
  },
  {
    slug: "phb-species",
    name: "Species",
    source: "PHB",
    tagline: null,
    ruleType: "Chapter",
    readingGroup: "Creating a character",
    order: 3,
    chapterNumber: 2,
    sectionCount: 2,
  },
  {
    slug: "phb-introduction",
    name: "Introduction",
    source: "PHB",
    tagline: null,
    ruleType: "Chapter",
    readingGroup: "Start here",
    order: 1,
    chapterNumber: 0,
    sectionCount: 1,
  },
  {
    slug: "phb-casting",
    name: "Casting",
    source: "PHB",
    tagline: null,
    ruleType: "Chapter",
    readingGroup: "Playing the game",
    order: 5,
    chapterNumber: 10,
    sectionCount: 4,
  },
  /*
    A handbook chapter nobody has placed.

    This one carries the weight. The two below it are from other books, so the
    source check alone keeps them out and they prove nothing about the filter
    that matters — removing the order test entirely left every assertion green
    until this was added. Being unplaced is the only thing keeping this one off
    the path.
  */
  {
    slug: "phb-changelog",
    name: "Changelog",
    source: "PHB",
    tagline: null,
    ruleType: "Chapter",
    readingGroup: null,
    order: null,
    chapterNumber: 99,
    sectionCount: 1,
  },
  // Not on the path for a second reason: another book, and an optional rule.
  {
    slug: "wh-equipment",
    name: "Equipment",
    source: "WH",
    tagline: null,
    ruleType: "Chapter",
    readingGroup: null,
    order: null,
    chapterNumber: 5,
    sectionCount: 7,
  },
  {
    slug: "flanking",
    name: "Flanking",
    source: "EC",
    tagline: null,
    ruleType: "Variant",
    readingGroup: null,
    order: null,
    chapterNumber: null,
    sectionCount: 1,
  },
];

vi.mock("~/content/dataset.server", () => ({
  getManifest: () => ({ types: [] }),
  getSummaries: (type: ContentTypeId): AnySummary[] =>
    type === "rules" ? (RULES as unknown as AnySummary[]) : [],
  isCuratedDataset: () => true,
  totalForSource: () => 0,
}));

const { loader } = await import("./home");

describe("the reading path the front page is given", () => {
  it("is in the authored order, not the order the book printed", async () => {
    const { chapters } = await loader();

    expect(chapters.map((chapter) => chapter.slug)).toEqual([
      "phb-introduction",
      "phb-whats-different",
      "phb-species",
      "phb-combat",
      "phb-casting",
    ]);
  });

  /**
   * The same list, sorted the way it used to be. Stated as its own expectation
   * so the difference is visible rather than implied: if these two ever
   * produced the same answer, the test above would be pinning a coincidence
   * and would keep passing after the authored order stopped being read.
   */
  it("differs from what the printed numbers would give", async () => {
    const { chapters } = await loader();

    const byPrintedNumber = [...RULES]
      .filter((rule) => rule.source === "PHB")
      .sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0))
      .map((rule) => rule.slug);

    expect(chapters.map((chapter) => chapter.slug)).not.toEqual(byPrintedNumber);
  });

  it("carries the heading each passage is read under", async () => {
    const { chapters } = await loader();

    expect(chapters.map((chapter) => chapter.group)).toEqual([
      "Start here",
      "Start here",
      "Creating a character",
      "Playing the game",
      "Playing the game",
    ]);
  });

  /**
   * A passage with no position is not on the path, whatever else it has.
   *
   * Both of the excluded fixtures carry something that looks orderable — the
   * Wretched Hives chapter has a chapter number, the variant rule has a name —
   * so a loader that fell back to either would include them.
   */
  it("leaves out what nobody placed", async () => {
    const { chapters } = await loader();

    const slugs = chapters.map((chapter) => chapter.slug);

    // The handbook chapter with no position. Nothing else excludes it.
    expect(slugs).not.toContain("phb-changelog");

    expect(slugs).not.toContain("wh-equipment");
    expect(slugs).not.toContain("flanking");
  });
});
