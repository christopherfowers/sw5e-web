/**
 * A content type's index: filter, sort, and scan.
 *
 * Two layouts share one set of controls, because the content types are not one
 * kind of thing. A table is right for 507 pieces of equipment that a reader
 * compares by cost and damage. It is wrong for 141 species, which a reader
 * recognises by silhouette long before they read a name — those get a gallery
 * of portraits. Which layout a type uses is declared in its list config, so
 * this component holds the behaviour and the config holds the judgement.
 *
 * The table is a real `<table>` with a `<caption>`, `<th scope="col">` headers
 * and `aria-sort` on the active column, because that is what lets a screen
 * reader announce "Challenge rating, column 2, sorted ascending" instead of
 * reading a wall of unlabelled cells. Sorting is triggered by a `<button>`
 * inside the header cell, so it is reachable by keyboard without any custom
 * key handling. The gallery has no columns to click, so it gets an equivalent
 * pair of controls — a sort field and a direction button — in the toolbar.
 *
 * On a phone most table columns are hidden and their values are folded into a
 * compact second line under each name, which keeps one DOM tree rather than
 * shipping a duplicate card layout that a screen reader would have to skip.
 *
 * ---------------------------------------------------------------------------
 * Why only part of the list is drawn
 *
 * `/features` published 2,682 rows as 2.1 MB of HTML. The bytes were the small
 * half of that problem: each row is a `<tr>` with five cells, a link, a compact
 * line and a badge, so the page was 40,342 elements that the browser had to
 * parse, lay out, and then hand to React to hydrate — on the main thread, in one
 * go, before anything on the page could respond. The page did not load slowly.
 * It arrived and then froze.
 *
 * Nothing about that is fixed by a faster network, and it gets worse on its
 * own: enhanced items are 1,918 rows and are next.
 *
 * So the rich list draws `WINDOW` rows and reveals more on request. That is
 * chosen over the two alternatives because of what this site is. Real
 * pagination needs either a server to read `?page=` or one prerendered route
 * per page; there is no server, and routes are the build's whole cost — 5,129
 * of them already. Virtualisation needs measured scroll geometry, which does
 * not exist during a prerender, so the static HTML would contain nothing at
 * all and the site's entire reason for being static would go with it.
 *
 * Windowing has none of that. The first `WINDOW` rows are real markup in the
 * static file, hydration matches because the server and the client both start
 * from the same constant, and every reveal is ordinary React state.
 *
 * The one thing it would cost is completeness — an index that shows 100 of
 * 2,682 has stopped being an index — so `FullIndex` below publishes every
 * entry as a plain link underneath. It is deliberately cheap, and deliberately
 * not hydrated; see the comment on it.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import type { Column, ListConfig } from "~/content/list-config";
import type { AnySummary, ContentTypeId } from "~/content/types";
import { TYPE_META } from "~/content/type-meta";
import { AssetImage, MonogramPlate } from "./media";
import { SourceText } from "./source-text";

type SortDirection = "ascending" | "descending";

interface ContentListProps {
  type: ContentTypeId;
  typeLabel: string;
  rows: AnySummary[];
  config: ListConfig<AnySummary>;
}

/** Facet options, derived from the rows actually present. */
function facetOptions(
  config: ListConfig<AnySummary>,
  rows: AnySummary[],
): { key: string; label: string; options: string[] }[] {
  return config.facets
    .map((facet) => {
      const values = new Set<string>();
      for (const row of rows) {
        const value = facet.valueOf(row);
        if (value) values.add(value);
      }
      const options = [...values].sort(
        facet.compare ?? ((left, right) => left.localeCompare(right, "en")),
      );
      return { key: facet.key, label: facet.label, options };
    })
    .filter((facet) => facet.options.length > 1);
}

function compareValues(
  left: string | number | null,
  right: string | number | null,
): number {
  if (left == null && right == null) return 0;
  // Rows with no value for the sorted column sink to the bottom either way,
  // rather than clumping at the top of a descending sort.
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "en");
}

/**
 * How many rows the rich list draws before a reader asks for more, and how many
 * each reveal adds.
 *
 * One number for every type rather than a per-type budget. The cost being
 * managed is DOM elements on the main thread, and a row is roughly the same
 * size whichever type it belongs to, so a per-type figure would be a knob with
 * nothing behind it. A hundred is comfortably more than fits on a screen — a
 * reader who wants the next few scrolls rather than clicking — and small enough
 * that the largest index in the corpus costs the same as the smallest.
 */
export const WINDOW = 100;

export function ContentList({ type, typeLabel, rows, config }: ContentListProps) {
  const filterId = useId();
  const [nameFilter, setNameFilter] = useState("");
  const [facetValues, setFacetValues] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState(config.defaultSort);
  const [direction, setDirection] = useState<SortDirection>("ascending");
  const [shown, setShown] = useState(WINDOW);

  const resultsRef = useRef<HTMLDivElement>(null);
  /*
    Where the last reveal started, so focus can be sent to the first row that
    was not there before. Without it, "Show 100 more" leaves a keyboard reader
    at the bottom of the page with a hundred new rows above them and no way to
    know it, and leaves them on nothing at all when the button that had focus
    was the last one and has now gone.
  */
  const revealedFrom = useRef<number | null>(null);

  useEffect(() => {
    const from = revealedFrom.current;
    revealedFrom.current = null;
    if (from == null) return;
    const anchors =
      resultsRef.current?.querySelectorAll<HTMLElement>("[data-row-anchor]");
    anchors?.[from]?.focus();
  }, [shown]);

  const facets = useMemo(() => facetOptions(config, rows), [config, rows]);
  const isGallery = config.layout === "gallery";

  const visible = useMemo(() => {
    const needle = nameFilter.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (needle && !row.name.toLowerCase().includes(needle)) return false;
      return config.facets.every((facet) => {
        const selected = facetValues[facet.key];
        if (!selected) return true;
        return facet.valueOf(row) === selected;
      });
    });

    const column = config.columns.find((each) => each.key === sortKey);
    const sortValue = column?.sortValue;
    if (!sortValue) return filtered;

    return [...filtered].sort((left, right) => {
      const result = compareValues(sortValue(left), sortValue(right));
      if (result !== 0) return direction === "ascending" ? result : -result;
      return left.name.localeCompare(right.name, "en");
    });
  }, [rows, nameFilter, facetValues, sortKey, direction, config]);

  /*
    Every control that changes which rows qualify puts the window back to the
    top. A reader who has revealed six hundred rows and then types a name is
    asking a new question, and answering it six hundred rows deep would hand
    back the cost the window exists to avoid.
  */
  const windowed = visible.slice(0, shown);
  const hidden = visible.length - windowed.length;

  function reveal(count: number) {
    revealedFrom.current = shown;
    setShown((current) => current + count);
  }

  function toggleSort(column: Column<AnySummary>) {
    setShown(WINDOW);
    if (column.key === sortKey) {
      setDirection((current) =>
        current === "ascending" ? "descending" : "ascending",
      );
      return;
    }
    setSortKey(column.key);
    // Numbers are almost always most interesting at the top: the toughest
    // creature, the most expensive weapon.
    setDirection(column.numeric ? "descending" : "ascending");
  }

  const hasFilters =
    nameFilter.trim() !== "" || Object.values(facetValues).some(Boolean);
  const sortableColumns = config.columns.filter((column) => column.sortValue);

  return (
    <>
      <div className="list-toolbar">
        <div className="filter-field">
          <label htmlFor={`${filterId}-name`}>Filter by name</label>
          <input
            id={`${filterId}-name`}
            type="search"
            value={nameFilter}
            autoComplete="off"
            onChange={(event) => {
              setShown(WINDOW);
              setNameFilter(event.target.value);
            }}
          />
        </div>

        {facets.map((facet) => (
          <div className="filter-field" key={facet.key}>
            <label htmlFor={`${filterId}-${facet.key}`}>{facet.label}</label>
            <select
              id={`${filterId}-${facet.key}`}
              value={facetValues[facet.key] ?? ""}
              onChange={(event) => {
                setShown(WINDOW);
                setFacetValues((current) => ({
                  ...current,
                  [facet.key]: event.target.value,
                }));
              }}
            >
              <option value="">All</option>
              {facet.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        ))}

        {/*
          A gallery has no column headers to click, so sorting moves into the
          toolbar as a labelled select and a direction button. Both are native
          controls: no key handling, no roles to get wrong.
        */}
        {isGallery && sortableColumns.length > 1 ? (
          <>
            <div className="filter-field">
              <label htmlFor={`${filterId}-sort`}>Sort by</label>
              <select
                id={`${filterId}-sort`}
                value={sortKey}
                onChange={(event) => {
                  setShown(WINDOW);
                  setSortKey(event.target.value);
                }}
              >
                {sortableColumns.map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.header}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="sort-direction"
              aria-pressed={direction === "descending"}
              onClick={() => {
                setShown(WINDOW);
                setDirection((current) =>
                  current === "ascending" ? "descending" : "ascending",
                );
              }}
            >
              <span aria-hidden="true">
                {direction === "ascending" ? "↑" : "↓"}
              </span>{" "}
              {direction === "ascending" ? "A–Z" : "Z–A"}
            </button>
          </>
        ) : null}

        {hasFilters ? (
          <button
            type="button"
            className="filter-reset"
            onClick={() => {
              setShown(WINDOW);
              setNameFilter("");
              setFacetValues({});
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      <p className="result-count" role="status">
        {describeCount(visible.length, windowed.length, rows.length, typeLabel)}
      </p>

      <div ref={resultsRef}>
        {visible.length === 0 ? (
          <p className="empty-state">
            {/*
              A type can be empty for two different reasons, and telling a
              reader to clear a filter they never set is a dead end. The
              canonical content set does not carry every type the site
              publishes, so a type index can legitimately have nothing in it.
            */}
            {rows.length === 0
              ? `No ${typeLabel.toLowerCase()} in this build of the reference yet.`
              : "Nothing matches those filters. Try clearing one."}
          </p>
        ) : isGallery ? (
          <Gallery
            type={type}
            typeLabel={typeLabel}
            rows={windowed}
            config={config}
          />
        ) : (
          <ContentTable
            type={type}
            typeLabel={typeLabel}
            rows={windowed}
            config={config}
            sortKey={sortKey}
            direction={direction}
            onSort={toggleSort}
          />
        )}
      </div>

      {hidden > 0 ? (
        <div className="list-more">
          <button type="button" className="button" onClick={() => reveal(WINDOW)}>
            Show {Math.min(WINDOW, hidden).toLocaleString("en-US")} more
          </button>
          <button
            type="button"
            className="list-more-all"
            onClick={() => reveal(hidden)}
          >
            Show all {visible.length.toLocaleString("en-US")}
          </button>
        </div>
      ) : null}

      <FullIndex type={type} typeLabel={typeLabel} rows={rows} />
    </>
  );
}

/**
 * The line above the list. It has to distinguish three states that a single
 * "N of M" cannot: everything is here, a filter has narrowed it, and the list
 * is longer than what is drawn.
 */
function describeCount(
  matching: number,
  drawn: number,
  total: number,
  typeLabel: string,
): string {
  const noun = typeLabel.toLowerCase();
  const shown = drawn.toLocaleString("en-US");

  if (drawn < matching) {
    return `Showing ${shown} of ${matching.toLocaleString("en-US")} ${noun}`;
  }
  if (matching === total) return `${total.toLocaleString("en-US")} ${noun}`;
  return `${shown} of ${total.toLocaleString("en-US")} ${noun}`;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ESCAPES[character]!);
}

/**
 * Every entry in the type, as a plain link, whether or not the rich list above
 * has drawn it.
 *
 * This is what makes windowing safe to do at all. A crawler that does not run
 * JavaScript, and a reader who has it switched off, both see the whole
 * catalogue here rather than the first hundred rows of it — which is the
 * property this site prerenders in order to have. It is also what the container
 * job in CI counts when it asserts that the image renders as many items as the
 * content it was built from.
 *
 * It is written as one `dangerouslySetInnerHTML` string on purpose, and the
 * purpose is the same as the window's. React does not walk the children of such
 * an element during hydration, so 2,682 anchors here cost one node of
 * hydration work instead of eight thousand. Rendering them as JSX would hand
 * back a large part of what the window just saved, for markup that is inert:
 * these are ordinary links to prerendered pages, they have no state, and
 * nothing on the page ever changes one.
 *
 * The only thing that string interpolation puts at risk is escaping, so the
 * names go through `escapeHtml` and `app/components/content-list.test.tsx`
 * asserts it against a name containing markup. Slugs are generated by
 * `scripts/build-content-fixture.mjs` and are `[a-z0-9-]` by construction, and
 * are escaped anyway rather than trusted.
 */
function FullIndex({
  type,
  typeLabel,
  rows,
}: {
  type: ContentTypeId;
  typeLabel: string;
  rows: AnySummary[];
}) {
  // Nothing to add when the list already fits inside one window: the table
  // above is the complete index, and a second copy of it would be noise.
  const html = useMemo(() => {
    if (rows.length <= WINDOW) return null;
    return [...rows]
      .sort((left, right) => left.name.localeCompare(right.name, "en"))
      .map(
        (row) =>
          `<li><a href="/${type}/${escapeHtml(row.slug)}">${escapeHtml(row.name)}</a></li>`,
      )
      .join("");
  }, [type, rows]);

  if (!html) return null;

  return (
    <details className="full-index">
      <summary>
        All {rows.length.toLocaleString("en-US")} {typeLabel.toLowerCase()}, A–Z
      </summary>
      <ul
        className="full-index-list"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </details>
  );
}

/**
 * How many tiles are asked for eagerly. Everything past this is lazy, which is
 * what keeps a 141-portrait index from costing a megabyte before a reader has
 * scrolled: only the tiles near the viewport are ever fetched.
 */
const EAGER_TILES = 8;

function Gallery({
  type,
  typeLabel,
  rows,
  config,
}: {
  type: ContentTypeId;
  typeLabel: string;
  rows: AnySummary[];
  config: ListConfig<AnySummary>;
}) {
  const accent = TYPE_META[type].accent;

  return (
    <ul className="gallery" aria-label={typeLabel}>
      {rows.map((row, index) => {
        const tile = config.tile?.(row);
        return (
          <li className="gallery-tile" key={row.slug} data-accent={accent}>
            {tile?.image ? (
              <AssetImage
                className="gallery-tile-media"
                image={tile.image}
                alt={tile.alt ?? row.name}
                sizes="(min-width: 48rem) 168px, 45vw"
                loading={index < EAGER_TILES ? "eager" : "lazy"}
              />
            ) : (
              <MonogramPlate name={row.name} />
            )}
            <div className="gallery-tile-body">
              <p className="gallery-tile-name">
                <Link to={`/${type}/${row.slug}`} data-row-anchor="">
                  <SourceText value={row.name} />
                </Link>
              </p>
              {tile?.meta ? (
                <p className="gallery-tile-meta">{tile.meta}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ContentTable({
  type,
  typeLabel,
  rows,
  config,
  sortKey,
  direction,
  onSort,
}: {
  type: ContentTypeId;
  typeLabel: string;
  rows: AnySummary[];
  config: ListConfig<AnySummary>;
  sortKey: string;
  direction: SortDirection;
  onSort: (column: Column<AnySummary>) => void;
}) {
  return (
    <div className="table-scroll">
      <table
        className="content-table"
        data-striped={config.striped ? "true" : undefined}
      >
        <caption className="sr-only">{typeLabel}, sortable by column</caption>
        <thead>
          <tr>
            {config.columns.map((column) => {
              const isSorted = column.key === sortKey;
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={[
                    column.className,
                    column.numeric ? "is-numeric" : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-sort={
                    column.sortValue ? (isSorted ? direction : "none") : undefined
                  }
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      className="sort-button"
                      onClick={() => onSort(column)}
                    >
                      {column.header}
                      <span aria-hidden="true" className="sort-indicator">
                        {isSorted ? (direction === "ascending" ? "↑" : "↓") : "↕"}
                      </span>
                      <span className="sr-only">
                        {isSorted
                          ? `, sorted ${direction}. Activate to reverse.`
                          : ", not sorted. Activate to sort by this column."}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const compact = config.compactLine(row);
            const media = config.rowMedia?.(row);
            return (
              <tr key={row.slug}>
                {config.columns.map((column, columnIndex) =>
                  columnIndex === 0 ? (
                    <th key={column.key} scope="row" className="name-cell">
                      <span className={media ? "row-media" : undefined}>
                        {media?.image ? (
                          <AssetImage
                            className="row-thumb"
                            image={media.image}
                            alt={media.alt}
                            sizes="28px"
                          />
                        ) : null}
                        <span>
                          <Link to={`/${type}/${row.slug}`} data-row-anchor="">
                            <SourceText value={row.name} />
                          </Link>
                          {compact ? (
                            <span className="compact-line">{compact}</span>
                          ) : null}
                        </span>
                      </span>
                    </th>
                  ) : (
                    <td
                      key={column.key}
                      className={[
                        column.className,
                        column.numeric ? "is-numeric" : null,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {column.render(row)}
                    </td>
                  ),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
