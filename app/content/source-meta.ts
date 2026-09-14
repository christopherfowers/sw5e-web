/**
 * The books this reference draws from.
 *
 * The dataset only ever carries an abbreviation on each row — "PHB", "SnV" —
 * which is enough for a badge and useless for a reader who has not memorised
 * them. This is where an abbreviation becomes a title, a colour and a page.
 *
 * ## These used to be written here
 *
 * A book's shelf name, blurb, colour and position were a literal table in this
 * file, which meant a book could be added to the corpus and still not appear as
 * a book until somebody edited the site and deployed it. They are facts about a
 * publication, so they travel with the publication now, and this module reads
 * them.
 *
 * The shape it exports has not changed. Every caller — the badges, the rules
 * list's grouping, the navigation, the about page — reads exactly what it read
 * before, which is the point: moving where the values come from should not be
 * an opportunity to move anything else at the same time.
 *
 * ## What is deliberately kept
 *
 * The old comment here recorded a property worth keeping: "an abbreviation
 * appearing in a future dataset should show up as a plain badge rather than an
 * empty book". That still holds. A source that describes none of this is simply
 * absent from `SOURCE_META`, and every caller already copes — because the
 * hand-written table could be missing an abbreviation too.
 */

import { BOOKS } from "./books";
import type { Accent } from "./type-meta";

export interface SourceMeta {
  /** The abbreviation as it appears on a content row. */
  code: string;
  /** Lowercase path segment for the source's own page. */
  slug: string;
  /** The book's full title. */
  name: string;
  /** One line a reader can use to decide whether they care. */
  blurb: string;
  /** The hue this source is drawn in wherever it is named. */
  accent: Accent;
}

/*
  Only books the corpus has actually described reach this table.

  A source with no blurb or no colour is left out rather than admitted with a
  placeholder, because everything downstream treats presence here as "this is a
  book we can draw a page for". Admitting a half-described one would produce
  exactly the empty book the fallback exists to avoid.
*/
const DESCRIBED = BOOKS.filter(
  (book): book is typeof book & { blurb: string; accent: Accent } =>
    book.blurb !== null && book.accent !== null,
);

/** The books, in the order the corpus shelves them. */
export const SOURCE_ORDER: readonly string[] = DESCRIBED.map((book) => book.code);

export const SOURCE_META: Record<string, SourceMeta> = Object.fromEntries(
  DESCRIBED.map((book) => [
    book.code,
    {
      code: book.code,
      slug: book.key,
      name: book.name,
      blurb: book.blurb,
      accent: book.accent,
    },
  ]),
);

const BY_SLUG = new Map(
  Object.values(SOURCE_META).map((source) => [source.slug, source]),
);

export function sourceBySlug(slug: string): SourceMeta | undefined {
  return BY_SLUG.get(slug);
}

/** The accent for a source code, falling back to neutral for an unknown one. */
export function sourceAccent(code: string | null): Accent | null {
  if (!code) return null;
  return SOURCE_META[code]?.accent ?? null;
}
