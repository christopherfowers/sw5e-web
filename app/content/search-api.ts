/**
 * Searching the whole corpus, on the service.
 *
 * ## Why there are now two searches
 *
 * The index this site downloads holds names, statistics, entry names, every
 * heading, and the first 240 characters of each item's prose. That last number
 * is the problem: an item's prose is not 240 characters. The Expanded Content
 * archetypes chapter is close to half a megabyte, so anything printed after
 * its first paragraph was unfindable, and the whole rules corpus is 2.7 MB of
 * markdown that nobody is going to download to type a word into a box.
 *
 * The service has held the answer all along. Every string in every document is
 * harvested into one column, and the search endpoint ranks against it with the
 * same scoring ladder the client uses. Nothing here is new work on that side —
 * it is a capability the front end simply was not asking for.
 *
 * ## Why the downloaded index stays
 *
 * Two reasons, and neither is nostalgia.
 *
 * The header's suggestions appear as somebody types. That wants an answer in
 * the same frame as the keystroke, not a round trip per character, and it is
 * the case where "the first few obvious matches" is exactly the right answer.
 *
 * And the reference has to work when the service does not. Everything a reader
 * comes here for is a static file; making the search box depend on a service
 * being up would take the whole catalogue down with it. So the results page
 * asks the service and falls back to the index, and says which one answered.
 */

import { apiRequest } from "~/api/http";
import { TYPE_META } from "./type-meta";
import type { SearchMatch } from "./search";
import { isContentTypeId, type ContentTypeId } from "./types";

/** One result, as the service reports it. */
export interface ServerSearchResult {
  type: ContentTypeId;
  slug: string;
  name: string;
  source: string | null;
  /** Which part matched: `name`, `key`, `facet` or `text`. */
  matchedIn: string;
  /** The display field, when a facet matched. */
  matchedField: string | null;
  /** Plain text around the match. Content-authored, never HTML. */
  snippet: string;
}

export interface ServerSearchGroup {
  type: ContentTypeId;
  /** Matches of this type, which may be more than are listed. */
  totalMatches: number;
  results: ServerSearchResult[];
}

export interface ServerSearch {
  query: string;
  totalMatches: number;
  groups: ServerSearchGroup[];
}

/** The wire shapes, named so the checking below reads as checking. */
interface WireItem {
  slug?: unknown;
  name?: unknown;
  source?: unknown;
}

interface WireResult {
  item?: WireItem;
  matchedIn?: unknown;
  matchedField?: unknown;
  snippet?: unknown;
}

interface WireGroup {
  type?: unknown;
  totalMatches?: unknown;
  results?: unknown;
}

interface WireResponse {
  query?: unknown;
  totalMatches?: unknown;
  groups?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Reads the response, discarding anything this build does not understand.
 *
 * The service publishes content types this front end may not have a page for —
 * they are separate deployments and either can be ahead — and a group for a
 * type with no route would render a heading whose every link is a 404. Dropping
 * it is better than showing it, and better than throwing: the rest of the
 * results are still answers.
 */
function read(body: unknown): ServerSearch {
  const wire = (body ?? {}) as WireResponse;
  const groups = Array.isArray(wire.groups) ? (wire.groups as WireGroup[]) : [];

  return {
    query: text(wire.query),
    totalMatches: typeof wire.totalMatches === "number" ? wire.totalMatches : 0,
    groups: groups.flatMap((group) => {
      const type = text(group.type);
      if (!isContentTypeId(type) || !TYPE_META[type]) return [];

      const results = Array.isArray(group.results) ? (group.results as WireResult[]) : [];

      return [
        {
          type,
          totalMatches:
            typeof group.totalMatches === "number" ? group.totalMatches : results.length,
          results: results.flatMap((result) => {
            const slug = text(result.item?.slug);
            if (!slug) return [];

            return [
              {
                type,
                slug,
                name: text(result.item?.name),
                source: typeof result.item?.source === "string" ? result.item.source : null,
                matchedIn: text(result.matchedIn) || "text",
                matchedField:
                  typeof result.matchedField === "string" ? result.matchedField : null,
                snippet: text(result.snippet),
              },
            ];
          }),
        },
      ];
    }),
  };
}

/** Shortest query the service will accept. Below this it answers 400. */
export const MIN_QUERY_LENGTH = 2;

/** The largest per-type limit the service allows. */
export const MAX_PER_TYPE = 25;

/**
 * Asks the service.
 *
 * `limit` bounds each group rather than the whole answer, which is what makes
 * a grouped page readable: a word that appears in six hundred creature
 * descriptions must not push every other kind of result off the page. It is
 * asked for at the service's ceiling, because this is the page somebody
 * reaches when the suggestions in the header were not enough.
 */
export async function searchContent(
  query: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<ServerSearch> {
  const parameters = new URLSearchParams({
    q: query,
    limit: String(options.limit ?? MAX_PER_TYPE),
  });

  const body = await apiRequest<unknown>(`/api/search?${parameters.toString()}`, {
    signal: options.signal,
  });

  return read(body);
}

/**
 * The service's results in the shape the results list already renders.
 *
 * Adapting rather than teaching the component a second shape. The two searches
 * answer the same question and a reader should not be able to tell which one
 * did — the grouping, the evidence line and the highlight are the same either
 * way, and a page that looked different depending on whether a service was up
 * would be worse than one that simply had fewer results.
 *
 * `score` is zero throughout because the service has already ordered these and
 * the component only groups; a number invented here would look like a ranking
 * and be nothing of the kind.
 */
export function asMatches(results: ServerSearch, query: string): SearchMatch[] {
  const needle = query.trim().toLowerCase();

  return results.groups.flatMap((group) =>
    group.results.map((result) => {
      // Where the phrase sits inside the snippet, so the same highlight the
      // local search draws can be drawn here. The service does not report an
      // offset, and finding it is a substring search over one short string.
      const start = result.snippet.toLowerCase().indexOf(needle);

      return {
        record: {
          type: result.type,
          slug: result.slug,
          name: result.name,
          source: result.source,
          // The service sends the evidence rather than the fields it came
          // from, which is all this page needs. Nothing reads these.
          fields: [],
        },
        score: 0,
        evidence:
          result.snippet.length > 0
            ? {
                label: label(result),
                text: result.snippet,
                start: start === -1 ? 0 : start,
                end: start === -1 ? 0 : start + needle.length,
              }
            : null,
      };
    }),
  );
}

/** What to call the place a match was found. */
function label(result: ServerSearchResult): string {
  if (result.matchedIn === "facet" && result.matchedField) return result.matchedField;
  if (result.matchedIn === "name") return "Name";
  if (result.matchedIn === "key") return "Address";
  return "Description";
}
