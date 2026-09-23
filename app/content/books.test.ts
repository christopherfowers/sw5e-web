/**
 * How the site treats a book the corpus has not described.
 *
 * The behaviour worth guarding, and the one most likely to be lost. Moving the
 * books out of a hand-written table and into the corpus is only safe while an
 * undescribed source still degrades to a plain badge. That is what lets
 * somebody add a supplement, or eventually their own homebrew, before anybody
 * has written a sentence about it.
 *
 * The old table had the property for free, because a code it did not list
 * simply was not found. Deriving the table from data makes it easy to lose by
 * accident: a version that admitted every source with a placeholder name would
 * pass every other test on this file and quietly start drawing empty books.
 */

import { describe, expect, it } from "vitest";

import { bookAccent, BOOKS, bookFor, bookName, type Book } from "./books";

describe("a book the corpus describes", () => {
  it("is found by the code on a content row", () => {
    const book = bookFor("PHB");

    expect(book?.name).toBe("Player's Handbook");
    expect(book?.accent).toBe("indigo");
  });

  /**
   * The shelf name, not the title.
   *
   * The handbook is titled "Star Wars 5e Player's Handbook" in the corpus and
   * is called "Player's Handbook" everywhere a reader meets it. Asserting the
   * shorter one pins which of the two fields the site reads. The two differ
   * for exactly one book, so a version reading the wrong field breaks only
   * here.
   */
  it("is called what the corpus says it is called on the shelf", () => {
    expect(bookName("PHB")).toBe("Player's Handbook");
  });
});

describe("a book the corpus has not described", () => {
  const UNKNOWN = "HB1";

  it("is not found, rather than found with a placeholder", () => {
    expect(bookFor(UNKNOWN)).toBeNull();
  });

  /**
   * Its abbreviation is the honest answer.
   *
   * A reader shown "HB1" can at least search for it. A reader shown "Unknown
   * source" has been told something that is both useless and slightly wrong.
   * The source is not unknown, it is undescribed.
   */
  it("keeps its abbreviation as its name", () => {
    expect(bookName(UNKNOWN)).toBe(UNKNOWN);
  });

  it("is drawn in no colour rather than a default one", () => {
    expect(bookAccent(UNKNOWN)).toBeNull();
  });
});

describe("no book at all", () => {
  it.each([null, undefined, ""])("is null for %p rather than throwing", (code) => {
    expect(bookFor(code)).toBeNull();
    expect(bookName(code)).toBeNull();
    expect(bookAccent(code)).toBeNull();
  });
});

describe("the shelf", () => {
  /**
   * Ordered by the corpus, and demonstrably not by the alphabet.
   *
   * Alphabetically these read EC, PHB, SnV, SotG, WH. Which puts Expanded
   * Content ahead of the core rulebook. Stated as its own expectation so the
   * order above is pinning a decision somebody made rather than a coincidence
   * of how the five happen to be named.
   */
  it("puts the handbook first, which the alphabet does not", async () => {
    const { BOOKS } = await import("./books");

    expect(BOOKS[0]?.code).toBe("PHB");

    const alphabetical = [...BOOKS]
      .map((book) => book.code)
      .sort((left, right) => left.localeCompare(right, "en"));

    expect(BOOKS.map((book: Book) => book.code)).not.toEqual(alphabetical);
  });
});
describe("a dataset built before the flag existed", () => {
  it("shelves every book, because a missing hide flag means shown", () => {
    // The committed fixture predates `showOnHomePage` and carries no such
    // field. Read as falsy it empties the shelf completely, and the front page
    // announces that it draws on none of these 0 books, which is what happened
    // the first time this ran in a browser. The two failure directions are not
    // symmetrical, so absent has to mean shown.
    expect(BOOKS.length).toBeGreaterThan(0);
    expect(BOOKS.every((book) => book.showOnHomePage)).toBe(true);
  });
});
