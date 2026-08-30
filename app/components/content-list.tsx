/**
 * A content type's index: filter, sort, and scan.
 *
 * Two layouts share one set of controls, because the eight types are not one
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
 */

import { useId, useMemo, useState } from "react";
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

export function ContentList({ type, typeLabel, rows, config }: ContentListProps) {
  const filterId = useId();
  const [nameFilter, setNameFilter] = useState("");
  const [facetValues, setFacetValues] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState(config.defaultSort);
  const [direction, setDirection] = useState<SortDirection>("ascending");

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

  function toggleSort(column: Column<AnySummary>) {
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
            onChange={(event) => setNameFilter(event.target.value)}
          />
        </div>

        {facets.map((facet) => (
          <div className="filter-field" key={facet.key}>
            <label htmlFor={`${filterId}-${facet.key}`}>{facet.label}</label>
            <select
              id={`${filterId}-${facet.key}`}
              value={facetValues[facet.key] ?? ""}
              onChange={(event) =>
                setFacetValues((current) => ({
                  ...current,
                  [facet.key]: event.target.value,
                }))
              }
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
                onChange={(event) => setSortKey(event.target.value)}
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
              onClick={() =>
                setDirection((current) =>
                  current === "ascending" ? "descending" : "ascending",
                )
              }
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
              setNameFilter("");
              setFacetValues({});
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      <p className="result-count" role="status">
        {visible.length === rows.length
          ? `${rows.length} ${typeLabel.toLowerCase()}`
          : `${visible.length} of ${rows.length} ${typeLabel.toLowerCase()}`}
      </p>

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
        <Gallery type={type} typeLabel={typeLabel} rows={visible} config={config} />
      ) : (
        <ContentTable
          type={type}
          typeLabel={typeLabel}
          rows={visible}
          config={config}
          sortKey={sortKey}
          direction={direction}
          onSort={toggleSort}
        />
      )}
    </>
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
                <Link to={`/${type}/${row.slug}`}>
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
                          <Link to={`/${type}/${row.slug}`}>
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
