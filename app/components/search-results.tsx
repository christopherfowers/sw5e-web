/**
 * Shared rendering for search results: the grouped list and the evidence line
 * that says why each item matched.
 */

import { Link } from "react-router";

import { excerptAround, groupByType, type SearchMatch } from "~/content/search";
import { TYPE_META } from "~/content/type-meta";
import { SourceText } from "./source-text";

/**
 * The matched fragment with the matching run marked. `<mark>` is the element
 * that carries this meaning, and it needs no extra ARIA to do so.
 */
function Evidence({ match }: { match: SearchMatch }) {
  if (!match.evidence) return null;
  const { label, text, start, end } = match.evidence;
  const excerpt = excerptAround(text, start, end);

  return (
    <p className="result-evidence">
      <span className="result-evidence-label">{label}</span>
      <span>
        <SourceText value={excerpt.text.slice(0, excerpt.start)} />
        <mark>
          <SourceText value={excerpt.text.slice(excerpt.start, excerpt.end)} />
        </mark>
        <SourceText value={excerpt.text.slice(excerpt.end)} />
      </span>
    </p>
  );
}

interface SearchResultsProps {
  matches: SearchMatch[];
  /**
   * Whether group labels are real headings. The full results page wants them
   * in the document outline; the header's suggestion panel must not inject
   * headings into the outline of whatever page you happen to be reading, so
   * there the group is labelled with `aria-label` instead.
   */
  groupLabelAs?: "h2" | "p";
  onNavigate?: () => void;
}

export function SearchResults({
  matches,
  groupLabelAs = "h2",
  onNavigate,
}: SearchResultsProps) {
  const groups = groupByType(matches);

  return (
    <div className="search-results">
      {groups.map((group) => {
        const label = TYPE_META[group.type].plural;
        const headingId = `results-${group.type}`;
        const isHeading = groupLabelAs === "h2";
        const Label = isHeading ? "h2" : "p";

        return (
          <section
            key={group.type}
            aria-labelledby={isHeading ? headingId : undefined}
            aria-label={isHeading ? undefined : label}
          >
            <Label
              id={isHeading ? headingId : undefined}
              className="search-group-heading"
              aria-hidden={isHeading ? undefined : true}
            >
              {label}
              <span className="search-group-count">{group.matches.length}</span>
            </Label>
            <ul className="search-group-list">
              {group.matches.map((match) => (
                <li key={`${match.record.type}/${match.record.slug}`}>
                  <Link
                    to={`/${match.record.type}/${match.record.slug}`}
                    className="result-link"
                    onClick={onNavigate}
                  >
                    <span className="result-name">
                      <SourceText value={match.record.name} />
                    </span>
                    {match.record.source ? (
                      <span className="result-source">{match.record.source}</span>
                    ) : null}
                  </Link>
                  <Evidence match={match} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
