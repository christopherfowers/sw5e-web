/**
 * The books this reference draws from.
 *
 * The dataset only ever carries an abbreviation on each row — "PHB", "SnV" —
 * which is enough for a badge and useless for a reader who has not memorised
 * them. This is where an abbreviation becomes a title, a colour and a page.
 *
 * The list is deliberately not derived from the data: a source has to be
 * described before it can be given a page, and an abbreviation appearing in a
 * future dataset should show up as a plain badge rather than an empty book.
 */

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

export const SOURCE_ORDER = ["PHB", "EC", "WH", "SnV"] as const;

export const SOURCE_META: Record<string, SourceMeta> = {
  PHB: {
    code: "PHB",
    slug: "phb",
    name: "Player's Handbook",
    blurb:
      "The core rulebook. Most of what a player picks at character creation starts here.",
    accent: "indigo",
  },
  EC: {
    code: "EC",
    slug: "ec",
    name: "Expanded Content",
    blurb:
      "Community-maintained material published alongside the core books, broadening every category rather than adding a new one.",
    accent: "green",
  },
  WH: {
    code: "WH",
    slug: "wh",
    name: "Wretched Hives",
    blurb:
      "The galaxy's underworld: the gear and talents that come with a disreputable life.",
    accent: "amber",
  },
  SnV: {
    code: "SnV",
    slug: "snv",
    name: "Scum and Villainy",
    blurb:
      "The bestiary. Every creature, droid and adversary in this reference comes from here.",
    accent: "red",
  },
};

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
