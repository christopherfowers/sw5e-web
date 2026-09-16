/**
 * The words a built page carries that are not drawn from the corpus.
 *
 * The front page's hero paragraph, and the heading and sentence above each of
 * its three sections, used to be markup. Which meant that changing a word of
 * the site's own description needed a code edit, a review and a deploy by
 * somebody with commit rights, and an administrator signing in to a CMS that
 * covers thirty-odd content types could not touch the one page every reader
 * arrives on.
 *
 * They are content now: one document per page, keyed by the route it belongs
 * to.
 *
 * ## Every slot is optional, and that is the whole design
 *
 * A page asks for a slot and gets back either a string somebody wrote or
 * nothing at all, and nothing at all means "use the wording you were built
 * with". So a deployment carrying no page documents renders exactly as it did
 * before this file existed, a corpus that has one page described and not
 * another is a supported state, and a slot added to the schema next month is
 * invisible until somebody fills it in.
 *
 * That is the same property the book shelf has, reached the same way, and for
 * the same reason: a section should not need a document to exist before it can
 * be drawn. It is also what makes this safe to introduce at all. The
 * alternative is a release where the front page is blank until an
 * administrator fills a form in.
 *
 * ## Why this is not in `dataset.server.ts`
 *
 * Same reason as `books.ts` and `resources.ts`: that module is server-only
 * because the dataset beside it is several megabytes, and these words are
 * needed while rendering on the client. All of them together are a few hundred
 * bytes.
 */

/** The slots a page can fill in. Every one optional. */
export interface PageCopy {
  /** The paragraph under the site's name. */
  heroLede?: string;
  /** The heading above the shelf of rulebooks. */
  booksHeading?: string;
  /**
   * The sentence under that heading.
   *
   * Absent on purpose in the corpus as it ships: left alone the page counts
   * the books itself, and a counted sentence cannot go stale. Filling it in
   * means owning the wording, including any number in it.
   */
  booksLede?: string;
  /** The heading above the files the site hosts. */
  resourcesHeading?: string;
  /** The sentence under that heading. */
  resourcesLede?: string;
  /** The heading above the community's links. */
  touchHeading?: string;
  /** The sentence under that heading. */
  touchLede?: string;
}

/*
  Matched the way `books.ts` matches its two datasets: the generated set is
  gitignored and absent in CI, the fixture is committed and present.
*/
const generated: Record<string, unknown> = import.meta.glob(
  "../data/generated/pages.json",
  { eager: true, import: "default" },
);

const fixture: Record<string, unknown> = import.meta.glob(
  "../data/fixture/pages.json",
  { eager: true, import: "default" },
);

function read(): Record<string, PageCopy> {
  const found = Object.values(generated)[0] ?? Object.values(fixture)[0];

  return found !== null && typeof found === "object" && !Array.isArray(found)
    ? (found as Record<string, PageCopy>)
    : {};
}

const PAGES = read();

/**
 * The words written for one page, or an empty set if nobody has written any.
 *
 * Never null. A caller reads a slot off the result and falls back where it is
 * missing, so there is no useful difference between "no document" and "a
 * document with nothing filled in", and collapsing them here keeps that
 * distinction out of every call site.
 */
export function pageCopy(key: string): PageCopy {
  return PAGES[key] ?? {};
}
