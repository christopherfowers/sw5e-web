/**
 * The full search results page.
 *
 * ## Two searches, and which one answers
 *
 * The service searches every word of every document. The index this site
 * downloads searches names, statistics, headings and the first 240 characters
 * of each item's prose — which is the whole of a feat and almost none of a
 * rules chapter.
 *
 * So this page asks the service, and falls back to the index when the service
 * cannot be reached. Not the other way round: the fallback is genuinely worse
 * at the thing this page is for, and a reader who came here rather than taking
 * one of the suggestions in the header is looking for something the quick
 * answer did not have.
 *
 * The fallback exists because everything else on this site is a static file. A
 * search box that goes down with a service would take the catalogue's only
 * index with it, and the page says plainly when it is answering from the
 * smaller one rather than quietly returning less.
 *
 * ## Why it is still prerendered as a shell
 *
 * Both searches run in the browser — one over a downloaded index, one over
 * `fetch` — so there is nothing to render at build time. The address is the
 * point: `/search?q=lightsaber` is shareable and the results are reproducible.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { SearchResults } from "~/components/search-results";
import { Breadcrumbs } from "~/components/site-chrome";
import { search, type SearchMatch } from "~/content/search";
import {
  asMatches,
  MIN_QUERY_LENGTH,
  searchContent,
  type ServerSearch,
} from "~/content/search-api";
import { loadSearchIndex } from "~/content/search-index.client";
import type { SearchRecord } from "~/content/types";

const RESULT_LIMIT = 100;

/**
 * How long to wait after the last keystroke before asking the service.
 *
 * The field rewrites the address as it is typed, so without this every
 * character is a request. Long enough that a typed word is one query, short
 * enough that it does not feel like waiting.
 */
const SETTLE_MS = 200;

export function meta() {
  return [
    { title: "Search — Star Wars 5e" },
    {
      name: "description",
      content:
        "Search every Star Wars 5e species, archetype, background, feat, power, maneuver, item and creature at once.",
    },
  ];
}

type Answer =
  | { from: "pending" }
  | { from: "service"; results: ServerSearch }
  | { from: "index" };

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const trimmed = query.trim();
  const ready = trimmed.length >= MIN_QUERY_LENGTH;

  const [index, setIndex] = useState<SearchRecord[] | null>(null);
  const [indexFailed, setIndexFailed] = useState(false);
  /*
    The answer, and the query it answers.

    Kept as a pair so that "no answer for what is currently typed" needs no
    state change at all: the moment the query moves on, the stored answer stops
    matching and the page is pending again. Resetting it from an effect instead
    would be a render just to un-say something.
  */
  const [answered, setAnswered] = useState<{ for: string; value: Answer } | null>(
    null,
  );

  const answer: Answer =
    answered && answered.for === trimmed ? answered.value : { from: "pending" };

  /*
    The index is fetched whatever happens, because it is the fallback and a
    fallback fetched only once the service has already failed makes the reader
    wait for two round trips to find that out.
  */
  useEffect(() => {
    let cancelled = false;

    loadSearchIndex().then(
      (records) => !cancelled && setIndex(records),
      () => !cancelled && setIndexFailed(true),
    );

    return () => {
      cancelled = true;
    };
  }, []);

  const settling = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ready) return;

    const controller = new AbortController();

    if (settling.current) clearTimeout(settling.current);
    settling.current = setTimeout(() => {
      searchContent(trimmed, { signal: controller.signal }).then(
        (results) => setAnswered({ for: trimmed, value: { from: "service", results } }),
        (error: unknown) => {
          // An abort is this component's own doing — the query changed, or the
          // reader left — and must not be reported as the service being down.
          if (error instanceof DOMException && error.name === "AbortError") return;

          // Everything else falls back, including a refusal. Whatever the
          // reason the service did not answer, this page still has one to give.
          setAnswered({ for: trimmed, value: { from: "index" } });
        },
      );
    }, SETTLE_MS);

    return () => {
      controller.abort();
      if (settling.current) clearTimeout(settling.current);
    };
  }, [trimmed, ready]);

  const local = useMemo(
    () => (index ? search(index, query, RESULT_LIMIT) : []),
    [index, query],
  );

  const matches: SearchMatch[] =
    answer.from === "service" ? asMatches(answer.results, trimmed) : local;

  return (
    <div className="page">
      <Breadcrumbs trail={[{ label: "Search" }]} />
      <h1>Search</h1>

      <form
        role="search"
        className="search-page-form"
        onSubmit={(event) => event.preventDefault()}
      >
        <label htmlFor="search-page-input">Search all content</label>
        <input
          id="search-page-input"
          type="search"
          name="q"
          value={query}
          autoComplete="off"
          autoFocus
          onChange={(event) =>
            setSearchParams(
              event.target.value ? { q: event.target.value } : {},
              { replace: true, preventScrollReset: true },
            )
          }
        />
      </form>

      <p className="result-count" role="status">
        {describe({ query, trimmed, ready, answer, matches, indexFailed, index })}
      </p>

      {ready && answer.from === "index" && !indexFailed ? (
        <p className="search-degraded">
          The search service could not be reached, so this is the offline index:
          it covers names, statistics and every heading, but not the body of the
          rules text.
        </p>
      ) : null}

      {ready && answer.from !== "pending" && matches.length === 0 ? (
        <p className="empty-state">
          Nothing matched. Try a shorter query, or browse a category from the
          navigation above.
        </p>
      ) : null}

      {matches.length > 0 ? <SearchResults matches={matches} /> : null}
    </div>
  );
}

/** The one line above the results, for each state the page can be in. */
function describe({
  query,
  trimmed,
  ready,
  answer,
  matches,
  indexFailed,
  index,
}: {
  query: string;
  trimmed: string;
  ready: boolean;
  answer: Answer;
  matches: SearchMatch[];
  indexFailed: boolean;
  index: SearchRecord[] | null;
}): string {
  if (!ready) {
    return trimmed.length === 0
      ? "Type to search."
      : `Type at least ${MIN_QUERY_LENGTH} characters.`;
  }

  if (answer.from === "pending") return "Searching…";

  if (answer.from === "index" && indexFailed) {
    return "Search is unavailable: neither the service nor the offline index could be reached.";
  }

  if (answer.from === "index" && !index) return "Searching…";

  const total =
    answer.from === "service" ? answer.results.totalMatches : matches.length;
  const shown = matches.length;
  const more = shown < total ? ` (showing ${shown})` : "";

  return `${total} result${total === 1 ? "" : "s"} for “${query}”${more}`;
}
