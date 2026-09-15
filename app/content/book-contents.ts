/**
 * Each book's table of contents.
 *
 * A reader who opens the Player's Handbook wants its chapters in the rail, the
 * way the site this replaces did it — not a list of the other books, which is
 * what the rail showed before: standing inside a book and being offered the
 * shelf it came from.
 *
 * ## Why this is not read from the dataset
 *
 * The rail is part of the site's chrome and is drawn by `root.tsx`, which has
 * no loader and cannot reach `dataset.server.ts` — that module is server-only
 * because the dataset beside it is several megabytes. Forty-eight chapters
 * across four books is about four kilobytes, so the contents are their own
 * small file, exactly like `books.ts`.
 *
 * ## Ordering
 *
 * The builder orders these by the authored reading path where a book has one,
 * and by the printed chapter number where it does not. Two of the four are
 * placed today. This module does not sort: whoever owns the corpus decides the
 * order, and re-deriving it here would be a second opinion that could disagree.
 */

export interface BookChapter {
  /** Which index the chapter lives under: `rules` or `starship-rules`. */
  type: "rules" | "starship-rules";
  slug: string;
  name: string;
  /** The heading it is read under, or null for a book with no authored path. */
  group: string | null;
}

/*
  Matched the way `books.ts` matches its two datasets: the generated set is
  gitignored and absent in CI, the fixture is committed and present.
*/
const generated: Record<string, unknown> = import.meta.glob(
  "../data/generated/book-contents.json",
  { eager: true, import: "default" },
);

const fixture: Record<string, unknown> = import.meta.glob(
  "../data/fixture/book-contents.json",
  { eager: true, import: "default" },
);

function read(): Record<string, BookChapter[]> {
  const found = Object.values(generated)[0] ?? Object.values(fixture)[0];

  // An archive build ships none of this, which is a supported state: the rail
  // falls back to what it showed before rather than rendering an empty book.
  return found && typeof found === "object"
    ? (found as Record<string, BookChapter[]>)
    : {};
}

const CONTENTS = read();

/** A book's chapters in reading order, or an empty list for one with none. */
export function chaptersOf(code: string | null | undefined): BookChapter[] {
  if (!code) return [];
  return CONTENTS[code] ?? [];
}

/**
 * The chapters collapsed into the headings they are read under.
 *
 * A book with no authored path yields one unnamed run holding everything,
 * which is what the rail wants: it draws a heading only when there is one, so
 * the Player's Handbook gets four and Wretched Hives gets a plain list.
 */
export function readingStepsOf(
  code: string | null | undefined,
): { group: string | null; chapters: BookChapter[] }[] {
  const steps: { group: string | null; chapters: BookChapter[] }[] = [];

  for (const chapter of chaptersOf(code)) {
    const last = steps.at(-1);

    if (last && last.group === chapter.group) {
      last.chapters.push(chapter);
      continue;
    }

    steps.push({ group: chapter.group, chapters: [chapter] });
  }

  return steps;
}
