/**
 * Client-side search across every content type.
 *
 * The whole corpus is roughly 1,800 items, which is small enough that a linear
 * scan over a prepared index beats the complexity of a real inverted index —
 * and it keeps the "why did this match" evidence trivially available, which a
 * scored bag-of-words index would throw away.
 *
 * Ranking, in order: an exact name match, a name that starts with the query, a
 * name that contains it, then a match in the item's fields. Within a tier,
 * shorter names win, then alphabetical order, so results are stable.
 */

import type { ContentTypeId, SearchField, SearchRecord } from "./types";

export interface SearchMatch {
  record: SearchRecord;
  score: number;
  /** The field the match was found in, and where, so the UI can show why. */
  evidence: { label: string; text: string; start: number; end: number } | null;
}

export interface SearchGroup {
  type: ContentTypeId;
  matches: SearchMatch[];
}

const SCORE_EXACT_NAME = 1000;
const SCORE_NAME_PREFIX = 500;
const SCORE_NAME_CONTAINS = 250;
const SCORE_FIELD = 100;

/** Case- and punctuation-insensitive, so `bo rifle` finds `Bo-rifle`. */
export function normalizeQuery(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Folds punctuation to spaces one character at a time. Collapsing runs would
 * shift every later character, and the evidence excerpt needs indices that
 * still point at the right place in the original text.
 */
function loosen(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, " ");
}

/** The same folding, collapsed, for comparing whole names against a query. */
function collapse(value: string): string {
  return loosen(value).replace(/\s+/g, " ").trim();
}

/**
 * Scores one record. Every query term must appear somewhere in the record, so
 * `force push` does not return everything mentioning "force".
 */
function scoreRecord(record: SearchRecord, terms: string[], query: string): SearchMatch | null {
  const collapsedName = collapse(record.name);
  const haystacks = [
    loosen(record.name),
    ...record.fields.map((field) => loosen(field.text)),
  ];

  for (const term of terms) {
    if (!haystacks.some((haystack) => haystack.includes(term))) return null;
  }

  if (collapsedName === query) {
    return { record, score: SCORE_EXACT_NAME, evidence: null };
  }
  if (collapsedName.startsWith(query)) {
    return { record, score: SCORE_NAME_PREFIX, evidence: null };
  }
  if (collapsedName.includes(query)) {
    return { record, score: SCORE_NAME_CONTAINS, evidence: null };
  }

  const evidence = findEvidence(record.fields, terms);
  return { record, score: SCORE_FIELD, evidence };
}

/**
 * The first field containing a query term, with the term's position, so the
 * result can quote the sentence that matched instead of asserting a match.
 */
function findEvidence(
  fields: SearchField[],
  terms: string[],
): SearchMatch["evidence"] {
  for (const field of fields) {
    const loosened = loosen(field.text);
    for (const term of terms) {
      const start = loosened.indexOf(term);
      if (start !== -1) {
        return {
          label: field.label,
          text: field.text,
          start,
          end: start + term.length,
        };
      }
    }
  }
  return null;
}

export function search(
  records: SearchRecord[],
  rawQuery: string,
  limit = 40,
): SearchMatch[] {
  const query = normalizeQuery(rawQuery);
  if (query.length < 2) return [];
  const terms = query.split(" ").filter(Boolean);

  const matches: SearchMatch[] = [];
  for (const record of records) {
    const match = scoreRecord(record, terms, query);
    if (match) matches.push(match);
  }

  matches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.record.name.length !== right.record.name.length) {
      return left.record.name.length - right.record.name.length;
    }
    return left.record.name.localeCompare(right.record.name, "en");
  });

  return matches.slice(0, limit);
}

/**
 * Groups results by content type, keeping the types in the order their best
 * result appeared, so the strongest match stays at the top of the list.
 */
export function groupByType(matches: SearchMatch[]): SearchGroup[] {
  const groups = new Map<ContentTypeId, SearchMatch[]>();
  for (const match of matches) {
    const existing = groups.get(match.record.type);
    if (existing) existing.push(match);
    else groups.set(match.record.type, [match]);
  }
  return [...groups.entries()].map(([type, typeMatches]) => ({
    type,
    matches: typeMatches,
  }));
}

/**
 * Trims a matched field down to a readable excerpt centred on the match, and
 * reports where the match sits inside the excerpt so it can be marked up.
 */
export function excerptAround(
  text: string,
  start: number,
  end: number,
  radius = 60,
): { text: string; start: number; end: number } {
  if (text.length <= radius * 2) return { text, start, end };

  let from = Math.max(0, start - radius);
  let to = Math.min(text.length, end + radius);

  if (from > 0) {
    const space = text.indexOf(" ", from);
    if (space !== -1 && space < start) from = space + 1;
  }
  if (to < text.length) {
    const space = text.lastIndexOf(" ", to);
    if (space !== -1 && space > end) to = space;
  }

  const prefix = from > 0 ? "… " : "";
  const suffix = to < text.length ? " …" : "";
  return {
    text: `${prefix}${text.slice(from, to)}${suffix}`,
    start: start - from + prefix.length,
    end: end - from + prefix.length,
  };
}
