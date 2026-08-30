/**
 * The full search results page.
 *
 * Search runs entirely in the browser over an index fetched on demand, so this
 * page is pre-rendered as an empty shell and fills itself in. That keeps the
 * 1,800-item index out of every other page while still giving results a real,
 * shareable URL: `/search?q=lightsaber`.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { SearchResults } from "~/components/search-results";
import { Breadcrumbs } from "~/components/site-chrome";
import { search } from "~/content/search";
import { loadSearchIndex } from "~/content/search-index.client";
import type { SearchRecord } from "~/content/types";

const RESULT_LIMIT = 100;

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

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const [index, setIndex] = useState<SearchRecord[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSearchIndex().then(
      (records) => {
        if (!cancelled) setIndex(records);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const matches = useMemo(
    () => (index ? search(index, query, RESULT_LIMIT) : []),
    [index, query],
  );

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
        {failed
          ? "The search index could not be loaded."
          : !index
            ? "Loading the search index…"
            : query.trim().length < 2
              ? "Type at least two characters."
              : `${matches.length}${matches.length === RESULT_LIMIT ? "+" : ""} result${
                  matches.length === 1 ? "" : "s"
                } for “${query}”`}
      </p>

      {index && query.trim().length >= 2 && matches.length === 0 ? (
        <p className="empty-state">
          Nothing matched. Try a shorter query, or browse a category from the
          navigation above.
        </p>
      ) : null}

      {matches.length > 0 ? <SearchResults matches={matches} /> : null}
    </div>
  );
}
