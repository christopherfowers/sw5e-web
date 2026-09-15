/**
 * The files this reference hosts, as the corpus describes them.
 *
 * The sheets used to be four links to somebody else's Google Drive. The site
 * did not hold them, and knew nothing about them — not their size, not their
 * page count, not whether the link still answered. They are content now: a
 * document in the content repository describes each one, the bytes sit beside
 * it, and adding a sheet is an edit to content rather than to this file.
 *
 * ## Why this is not in `dataset.server.ts`
 *
 * Same reason as `books.ts`: that module is server-only because the dataset
 * beside it is several megabytes, and the front page needs a name and a hue
 * per row while rendering on the client. Four sheets is well under a kilobyte.
 *
 * ## The fallback
 *
 * An empty list is a supported state and every caller copes: a build whose
 * content carries no resources draws no resources section at all, rather than
 * a heading with nothing under it. That is the same degradation the shelf
 * makes for a build with no books, and it is what lets the section exist
 * before anybody has added a second sheet.
 */

import type { Accent } from "./type-meta";

export interface Resource {
  /** The document's key, and the stem of its preview image. */
  key: string;
  /** What it is called on the shelf. */
  name: string;
  /** One line to decide by. Absent is fine. */
  blurb: string | null;
  /** The file's name, which is also its address under `/resources`. */
  file: string;
  /** How many pages, so a reader knows before downloading. Absent is fine. */
  pages: number | null;
  /** True when it carries form fields rather than blanks to write on. */
  fillable: boolean;
  /**
   * True when what the site serves is a rebuild rather than the original.
   *
   * Carried to the page rather than kept as a build-time note. A file that has
   * been altered, however safely, must not be presented as the author's
   * untouched work.
   */
  sanitized: boolean;
  /** What the rebuild took out, in the words a reader gets. */
  removed: string[];
  /** The hue it is drawn in. */
  accent: Accent | null;
  /** Who made it. */
  credit: string | null;
  /** Where it sits among the others. */
  order: number;
}

/*
  Matched the way `books.ts` matches its two datasets: the generated set is
  gitignored and absent in CI, the fixture is committed and present.
*/
const generated: Record<string, unknown> = import.meta.glob(
  "../data/generated/resources.json",
  { eager: true, import: "default" },
);

const fixture: Record<string, unknown> = import.meta.glob(
  "../data/fixture/resources.json",
  { eager: true, import: "default" },
);

function read(): Resource[] {
  const found = Object.values(generated)[0] ?? Object.values(fixture)[0];
  return Array.isArray(found) ? (found as Resource[]) : [];
}

/** Every described resource, in the order the corpus puts them. */
export const RESOURCES: readonly Resource[] = read();

/**
 * Where a resource's file is served from.
 *
 * Under `public/`, so the name a document gives is the name on the wire. The
 * site's other assets are content-hashed by the build, which is right for a
 * stylesheet nobody links to by hand and wrong here: a resource document names
 * its file, and a hashed name would not resolve.
 */
export function resourceHref(file: string): string {
  return `/resources/${file}`;
}
