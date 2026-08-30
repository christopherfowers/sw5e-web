/**
 * A content type's index: filter, sort, and scan.
 *
 * The table is a real `<table>` with a `<caption>`, `<th scope="col">` headers
 * and `aria-sort` on the active column, because that is what lets a screen
 * reader announce "Challenge rating, column 2, sorted ascending" instead of
 * reading a wall of unlabelled cells. Sorting is triggered by a `<button>`
 * inside the header cell, so it is reachable by keyboard without any custom
 * key handling.
 *
 * On a phone most columns are hidden and their values are folded into a
 * compact second line under each name, which keeps one DOM tree rather than
 * shipping a duplicate card layout that a screen reader would have to skip.
 */

import { useId, useMemo, useState } from "react";
import { Link } from "react-router";

import type { Column, ListConfig } from "~/content/list-config";
import type { AnySummary, ContentTypeId } from "~/content/types";
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

  return (
    <>
      <div className="filter-bar">
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
          Nothing matches those filters. Try clearing one.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="content-table">
            <caption className="sr-only">
              {typeLabel}, sortable by column
            </caption>
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
                        column.sortValue
                          ? isSorted
                            ? direction
                            : "none"
                          : undefined
                      }
                    >
                      {column.sortValue ? (
                        <button
                          type="button"
                          className="sort-button"
                          onClick={() => toggleSort(column)}
                        >
                          {column.header}
                          <span aria-hidden="true" className="sort-indicator">
                            {isSorted
                              ? direction === "ascending"
                                ? "↑"
                                : "↓"
                              : "↕"}
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
              {visible.map((row) => {
                const compact = config.compactLine(row);
                return (
                  <tr key={row.slug}>
                    {config.columns.map((column, columnIndex) =>
                      columnIndex === 0 ? (
                        <th key={column.key} scope="row" className="name-cell">
                          <Link to={`/${type}/${row.slug}`}>
                            <SourceText value={row.name} />
                          </Link>
                          {compact ? (
                            <span className="compact-line">{compact}</span>
                          ) : null}
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
      )}
    </>
  );
}
