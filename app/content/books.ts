/**
 * The books this reference draws from, as the corpus describes them.
 *
 * Each source document carries its own shelf name, the line under it, the hue
 * it is drawn in and where it sits among the others. That used to be a table
 * in this repository, which meant a new book (a supplement, or eventually
 * somebody's homebrew) could be added to the corpus and still not appear as a
 * book until the site was edited and deployed.
 *
 * ## The fallback is the point
 *
 * Every field except the code is allowed to be missing, and a book missing all
 * of them still works: it draws as a plain badge rather than as an empty page
 * with a heading and nothing under it. That degradation is what lets somebody
 * add a supplement before anybody has written a sentence about it, and it is
 * the property the hand-written table had that this must not lose.
 *
 * So `bookFor` answers `null` rather than a placeholder, and every caller is
 * written to cope with null. Which they already were, because the old table
 * could be missing an abbreviation too.
 *
 * ## Why this is not in `dataset.server.ts`
 *
 * That module is server-only because the dataset beside it is several
 * megabytes, and shipping it to a browser would send the whole library to
 * render one page. The books are about a kilobyte, and a book's name and colour
 * are needed while rendering a row on the client, so they are their own file,
 * imported directly. Keeping them separate is what makes that safe to see at a
 * glance rather than something to reason about.
 */

import type { Accent } from "./type-meta";

export interface Book {
  /** The source document's key, and the segment of its page's address. */
  key: string;
  /** The abbreviation that appears on a content row: `PHB`, `SnV`. */
  code: string;
  /** What the book is called on the site. */
  name: string;
  /** One line a reader can use to decide whether they care. Absent is fine. */
  blurb: string | null;
  /** The hue it is drawn in. Absent means it is drawn in none. */
  accent: Accent | null;
  /** Where it sits on the shelf. Absent means nobody has placed it. */
  order: number | null;
  /**
   * Whether the front page shelves this book.
   *
   * Off is not the same as gone. The book keeps its page, stays searchable
   * and stays linked to from every item that cites it; only its place on the
   * front page goes away. Absent means shown, so a book added to the corpus
   * appears without anybody editing the front page.
   */
  showOnHomePage: boolean;
  /**
   * True for the one book that teaches the game.
   *
   * The front page opens with this book and walks a new reader down its
   * chapters. Exactly one source sets it, and the content repository has a test
   * saying so. Neither failure is loud enough to notice otherwise.
   */
  isCoreRulebook: boolean;
}

/*
  Matched the way `dataset.server.ts` matches its two datasets, and for the same
  reason: the generated set is gitignored and absent in CI, the fixture is
  committed and present. `import.meta.glob` yields nothing for a directory that
  is not there, which is the mechanism that lets one build work in both cases.
*/
const generated: Record<string, unknown> = import.meta.glob("../data/generated/books.json", {
  eager: true,
  import: "default",
});

const fixture: Record<string, unknown> = import.meta.glob("../data/fixture/books.json", {
  eager: true,
  import: "default",
});

function read(): Book[] {
  const found = Object.values(generated)[0] ?? Object.values(fixture)[0];

  // An archive build ships no shelf at all, which is a supported state rather
  // than a broken one: every book falls back to a plain badge.
  if (!Array.isArray(found)) return [];

  /*
    `showOnHomePage` is normalised here rather than trusted, because a dataset
    built before the flag existed carries no such field and a missing hide flag
    has to mean shown.

    The two failure directions are not symmetrical. Read as "not shown", one
    stale dataset empties the shelf and the page announces that it draws on
    none of these 0 books. Read as "shown", the worst case is that a book
    somebody took off the shelf comes back.
  */

  return (found as Book[]).map((book) => ({
    ...book,
    showOnHomePage: book.showOnHomePage !== false,
  }));
}

/** Every described book, in the order the corpus shelves them. */
export const BOOKS: readonly Book[] = read();

const BY_CODE = new Map(BOOKS.map((book) => [book.code, book]));
const BY_KEY = new Map(BOOKS.map((book) => [book.key, book]));

/** The book a content row's source code names, or null for one nobody has described. */
export function bookFor(code: string | null | undefined): Book | null {
  if (!code) return null;
  return BY_CODE.get(code) ?? null;
}

/** The book at a `/sources/{slug}` address, or null. */
export function bookBySlug(slug: string): Book | null {
  return BY_KEY.get(slug) ?? null;
}

/**
 * What to call a book, given only the code on a row.
 *
 * Falls back to the code itself, which is the honest answer: "SnV" is what the
 * document says, and inventing a title for a book nobody has described would be
 * worse than showing the abbreviation a reader can at least search for.
 */
export function bookName(code: string | null | undefined): string | null {
  if (!code) return null;
  return BY_CODE.get(code)?.name ?? code;
}

/**
 * The book that teaches the game, or null.
 *
 * Null is a real state and callers must cope: an archive build ships no shelf
 * at all, and a corpus nobody has marked has no teaching book either. The front
 * page answers by not drawing the button that opens with it, which is better
 * than opening with an arbitrary one.
 */
export function coreRulebook(): Book | null {
  return BOOKS.find((book) => book.isCoreRulebook) ?? null;
}

/** The hue a book is drawn in, or null when it has none. */
export function bookAccent(code: string | null | undefined): Accent | null {
  if (!code) return null;
  return BY_CODE.get(code)?.accent ?? null;
}
