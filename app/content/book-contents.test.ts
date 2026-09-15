/**
 * A book's table of contents, as the rail reads it.
 *
 * The rail on a book's page used to show the other books — standing inside the
 * Player's Handbook and being handed the shelf it came from. It now shows the
 * book's own chapters, which is what the site this replaces did and what a
 * reader reaches for.
 *
 * Two of the four books have an authored reading path and two do not, and both
 * cases have to work: the ones with a path get its headings, and the ones
 * without get a plain list rather than an invented grouping.
 */

import { describe, expect, it } from "vitest";

import { chaptersOf, readingStepsOf } from "./book-contents";

describe("a book with an authored path", () => {
  it("is in the order somebody wrote, not the order the book printed", () => {
    const names = chaptersOf("PHB").map((chapter) => chapter.name);

    // The handbook numbers "What's Different?" below its introduction, so the
    // printed order puts the comparison with another game before the
    // explanation of this one. The authored path does not.
    expect(names[0]).toBe("Introduction");
    expect(names.indexOf("Introduction")).toBeLessThan(
      names.indexOf("Whats Different"),
    );
  });

  it("carries every chapter of the book", () => {
    expect(chaptersOf("PHB")).toHaveLength(15);
  });

  /**
   * The headings, collapsed into runs.
   *
   * Each appears once. A heading drawn twice would mean its chapters are
   * interleaved with another's, which the content repository has a test
   * against — this is the rendering half of the same invariant.
   */
  it("groups the chapters under the headings they are read under", () => {
    const groups = readingStepsOf("PHB").map((step) => step.group);

    expect(groups).toEqual([
      "Start here",
      "Creating a character",
      "Playing the game",
      "Reference",
    ]);
    expect(groups).toEqual([...new Set(groups)]);
  });
});

describe("a book with no authored path", () => {
  /**
   * Wretched Hives has chapters and no reading order. It must still get a
   * contents list — a book nobody has laid out is the normal state for
   * everything except the two that have been done, and showing nothing would
   * put the reader back where they started.
   */
  it("still lists its chapters", () => {
    expect(chaptersOf("WH").length).toBeGreaterThan(0);
  });

  it("gets one unnamed run rather than an invented grouping", () => {
    const steps = readingStepsOf("WH");

    expect(steps).toHaveLength(1);
    expect(steps[0]?.group).toBeNull();
  });
});

describe("a book that is not there", () => {
  it.each([null, undefined, "", "HB1"])("is an empty list for %p", (code) => {
    expect(chaptersOf(code)).toEqual([]);
    expect(readingStepsOf(code)).toEqual([]);
  });
});

describe("what the contents exclude", () => {
  /**
   * Chapters, not options.
   *
   * Expanded Content carries ten chapters and forty variant rules. A table of
   * contents lists the former; putting the latter in the same rail would bury
   * ten places a reader goes under four times as many things a table might
   * switch on.
   */
  it("leaves the variant rules out", () => {
    expect(chaptersOf("EC")).toHaveLength(10);
  });

  /**
   * Every chapter knows which index it lives under, so the rail can address it
   * without guessing. The starship book's chapters are a different content
   * type from the handbook's, and a link built on the wrong one is a 404.
   */
  it("says which index each chapter lives under", () => {
    expect(chaptersOf("PHB").every((c) => c.type === "rules")).toBe(true);
    expect(chaptersOf("SotG").every((c) => c.type === "starship-rules")).toBe(true);
  });
});
