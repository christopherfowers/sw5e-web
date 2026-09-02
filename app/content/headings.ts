/**
 * Naming every heading on an item's page, once, before any of it renders.
 *
 * ## Why this is not done while rendering
 *
 * It was. `ItemDetail` made a slugger and handed it down, and each heading
 * asked it for a name as it drew. That reads well and is wrong: asking is a
 * mutation, so rendering was not a pure function of the item, and React is
 * entitled to render a component more than once for the same state. In
 * development it does exactly that — every id on a page reached by a
 * client-side navigation came out as `time-2`, `difficult-terrain-2`, because
 * the children had run twice against one slugger. Every link the search index
 * pointed at was dead.
 *
 * That it only showed up in development is the worst part of it: the
 * prerendered HTML was right, a hard refresh was right, and only a navigation
 * inside the site was wrong.
 *
 * So the names are worked out here, from the item alone, and rendering only
 * reads them. Run it twice and it answers the same thing.
 *
 * ## Why headings are found with a regular expression rather than the parser
 *
 * The parser detects a heading with `/^(#{1,6})\s+(.*)$/` on a trimmed line and
 * there are no fenced code blocks in this dialect, so a line scan finds exactly
 * the headings the parser will render — no more, no fewer. Parsing to find them
 * and parsing again to draw them would double the work on a rules chapter that
 * runs to hundreds of kilobytes, for an answer the cheap pass already has.
 *
 * If the parser ever learns about fenced code, this has to learn with it, and
 * `prose.test.tsx` is where that would show up: the ids it asserts come from
 * here and the headings it counts come from the parser.
 */

import { uniqueSlugger } from "./slug";
import type { ContentItem } from "./types";

/** Matches the parser's own heading rule. See the note above. */
const HEADING = /^(#{1,6})\s+(.*)$/;

/** The heading text in a markdown body, in document order. */
function headingsIn(markdown: string): string[] {
  const found: string[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const match = HEADING.exec(line.trim());
    if (match?.[2]) found.push(match[2].trim());
  }

  return found;
}

export interface ItemHeadingIds {
  /**
   * Per section, in the order the item lists them: the id for the section's
   * own heading when it has one, and an id for each heading inside its body.
   */
  sections: { heading: string | null; prose: string[] }[];
  /**
   * Per entry, in the order the page draws them — grouped, groups in
   * first-seen order — an id for each heading inside the entry's body.
   */
  entries: string[][];
}

/**
 * Every id the page will render, in the order it renders them.
 *
 * The order is the whole contract. Two headings with the same words get `-2`
 * on the second, so a plan built in a different order than the page draws in
 * puts the suffix on the wrong one — and the links are then subtly wrong
 * rather than obviously broken, which is worse.
 */
export function nameItemHeadings(item: ContentItem): ItemHeadingIds {
  const slug = uniqueSlugger();

  const sections = item.sections.map((section) => ({
    heading: section.heading ? slug(section.heading) : null,
    prose: headingsIn(section.body).map(slug),
  }));

  // Entries after sections, grouped, groups in first-seen order — which is
  // what `groupEntries` in item-detail.tsx produces and what the page draws.
  const groups = new Map<string, (string | null)[]>();
  for (const entry of item.entries) {
    const existing = groups.get(entry.group);
    if (existing) existing.push(entry.body);
    else groups.set(entry.group, [entry.body]);
  }

  // An entry with no body draws no prose at all, so it takes no slot here
  // either — the page only counts the entries it actually draws one for, and a
  // slot for a skipped entry would shift every entry after it onto the wrong
  // list of ids.
  const entries = [...groups.values()]
    .flat()
    .filter((body): body is string => Boolean(body))
    .map((body) => headingsIn(body).map(slug));

  return { sections, entries };
}
