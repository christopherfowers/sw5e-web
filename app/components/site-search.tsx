/**
 * The header search: type anywhere on the site and get grouped results across
 * every content type.
 *
 * Deliberately built from a real form and real links rather than an ARIA
 * combobox. A combobox would force every suggestion to be a `role="option"`
 * div, which cannot be opened in a new tab, copied as a link, or followed
 * without JavaScript. Instead the input is a plain search field inside a
 * `role="search"` form that falls back to a full page of results, and the
 * suggestions are anchors that arrow keys walk through.
 *
 * Keyboard contract:
 *   /            focus the field from anywhere that is not itself a field
 *   ArrowDown    move from the field into the suggestions, then down them
 *   ArrowUp      move back up, and out of the first suggestion to the field
 *   Enter        follow the focused suggestion, or open the full results page
 *   Escape       close the suggestions and return focus to the field
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { loadSearchIndex } from "~/content/search-index.client";
import { search, type SearchMatch } from "~/content/search";
import type { SearchRecord } from "~/content/types";
import { SearchResults } from "./search-results";

const SUGGESTION_LIMIT = 8;

export function SiteSearch() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const listboxId = useId();
  const statusId = useId();

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const [index, setIndex] = useState<SearchRecord[] | null>(null);
  const [open, setOpen] = useState(false);

  /*
    On the results page, this field holds what the results are for.

    Without it the search page carried two fields for one job and they
    disagreed: the page's own field showed "speeder" and the header's showed a
    placeholder, so refining from the header meant starting again from nothing.

    Seeded rather than controlled by the URL, because the two are the same
    field for one keystroke and then diverge — somebody typing a new query has
    not navigated yet, and yanking their text back to the old one on every
    render would make the field unusable. It re-seeds when the address changes,
    which is what a fresh search or the Back button does.

    Adjusted during render rather than in an effect. An effect would paint the
    stale value first and then correct it, which is a flash of the wrong query
    on every navigation to the results page; setting state during render is
    React's own recipe for this and it re-renders before anything is shown.
  */
  const submitted = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(submitted);
  const [seededFrom, setSeededFrom] = useState(submitted);

  if (seededFrom !== submitted) {
    setSeededFrom(submitted);
    setQuery(submitted);
  }

  // The index is only worth fetching once someone shows an intent to search.
  const ensureIndex = useCallback(() => {
    if (index) return;
    void loadSearchIndex().then(setIndex);
  }, [index]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      const isTyping =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (isTyping) return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const matches: SearchMatch[] = index ? search(index, query, SUGGESTION_LIMIT) : [];
  const showResults = open && query.trim().length >= 2;

  function suggestionLinks(): HTMLAnchorElement[] {
    return Array.from(resultsRef.current?.querySelectorAll("a") ?? []);
  }

  function moveFocus(from: number, delta: number) {
    const links = suggestionLinks();
    if (links.length === 0) return;
    const next = from + delta;
    if (next < 0) {
      inputRef.current?.focus();
      return;
    }
    links[Math.min(next, links.length - 1)]?.focus();
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(-1, 1);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  function onResultsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Escape") {
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.focus();
      return;
    }
    const links = suggestionLinks();
    const current = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (current === -1) return;
    event.preventDefault();
    moveFocus(current, event.key === "ArrowDown" ? 1 : -1);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOpen(false);
    void navigate(`/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <div className="site-search" ref={containerRef}>
      <form role="search" action="/search" method="get" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="site-search-input">
          Search all Star Wars 5e content
        </label>
        <input
          id="site-search-input"
          ref={inputRef}
          type="search"
          name="q"
          value={query}
          autoComplete="off"
          placeholder="Search everything"
          aria-describedby={statusId}
          aria-controls={listboxId}
          onFocus={ensureIndex}
          onChange={(event) => {
            ensureIndex();
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onInputKeyDown}
        />
        <kbd aria-hidden="true">/</kbd>
      </form>

      <p id={statusId} className="sr-only" role="status">
        {showResults
          ? `${matches.length} result${matches.length === 1 ? "" : "s"} for ${query}`
          : "Type at least two characters to search. Press slash to focus this field."}
      </p>

      <div
        id={listboxId}
        ref={resultsRef}
        className="site-search-panel"
        hidden={!showResults}
        onKeyDown={onResultsKeyDown}
      >
        {showResults && index && matches.length === 0 ? (
          <p className="site-search-empty">No matches for “{query}”.</p>
        ) : null}
        {showResults && !index ? (
          <p className="site-search-empty">Loading the search index…</p>
        ) : null}
        {showResults && matches.length > 0 ? (
          <>
            <SearchResults
              matches={matches}
              groupLabelAs="p"
              onNavigate={() => {
                setOpen(false);
                setQuery("");
              }}
            />
            <Link
              className="site-search-all"
              to={`/search?q=${encodeURIComponent(query)}`}
              onClick={() => setOpen(false)}
            >
              See all results for “{query}”
            </Link>
          </>
        ) : null}
      </div>
    </div>
  );
}
