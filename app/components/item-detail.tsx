/**
 * A content item, whatever shape it happens to be.
 *
 * The eight types are not uniform — a feat carries six fields and a creature
 * carries forty-seven — so this renders four open-ended collections rather
 * than a fixed field list: key/value stats, prose sections, named entries
 * (traits, actions, features) and roll tables. A type that has none of a given
 * collection simply renders nothing for it.
 */

import type { ContentItem, Entry } from "~/content/types";
import { SOURCE_NAMES } from "~/content/types";
import { LostValue, SourceText } from "./source-text";
import { Prose } from "./prose";

export function ItemDetail({ item }: { item: ContentItem }) {
  const groups = groupEntries(item.entries);

  return (
    <article className="item-detail">
      <header className="item-header">
        <h1>
          <SourceText value={item.name} />
        </h1>
        {item.tagline ? (
          <p className="item-tagline">
            <SourceText value={item.tagline} />
          </p>
        ) : null}
        {item.source ? (
          <p className="item-source">
            <span className="source-badge">{item.source}</span>
            {SOURCE_NAMES[item.source] ?? item.sourceName ?? item.source}
          </p>
        ) : null}
      </header>

      {item.stats.length > 0 ? (
        <div className="stat-block">
          <h2 className="sr-only">At a glance</h2>
          <dl>
            {item.stats.map((stat) => (
              <div className="stat-row" key={stat.label}>
                <dt>{stat.label}</dt>
                <dd>
                  {stat.lost || stat.value == null ? (
                    <LostValue />
                  ) : (
                    <SourceText value={stat.value} />
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {item.abilityScores && item.abilityScores.length > 0 ? (
        <section aria-labelledby="ability-scores" className="ability-scores">
          <h2 id="ability-scores">Ability scores</h2>
          <ul>
            {item.abilityScores.map((ability) => (
              <li key={ability.ability}>
                <span className="ability-name">{ability.ability.slice(0, 3)}</span>
                <span className="ability-score">{ability.score}</span>
                <span className="ability-modifier">
                  {ability.modifier >= 0 ? `+${ability.modifier}` : ability.modifier}
                </span>
                <span className="sr-only">
                  {ability.ability} {ability.score}, modifier{" "}
                  {ability.modifier >= 0 ? "plus" : "minus"}{" "}
                  {Math.abs(ability.modifier)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {item.sections.map((section, index) =>
        section.heading ? (
          <section key={index} className="item-section">
            <h2>{section.heading}</h2>
            <Prose markdown={section.body} startLevel={3} />
          </section>
        ) : (
          <section key={index} className="item-section">
            <Prose markdown={section.body} startLevel={2} />
          </section>
        ),
      )}

      {groups.map((group) => (
        <section key={group.name} className="item-section" aria-labelledby={`group-${slugifyLabel(group.name)}`}>
          <h2 id={`group-${slugifyLabel(group.name)}`}>{group.name}</h2>
          <dl className="entry-list">
            {group.entries.map((entry, index) => (
              <div className="entry" key={`${entry.name ?? "entry"}-${index}`}>
                {entry.name ? (
                  <dt>
                    <SourceText value={entry.name} />
                  </dt>
                ) : null}
                <dd>
                  {entry.body ? (
                    <Prose markdown={entry.body} startLevel={3} />
                  ) : (
                    <LostValue />
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      {item.tables.map((table) => (
        <section key={table.caption} className="item-section">
          <div className="table-scroll">
            <table className="roll-table">
              <caption>{table.caption}</caption>
              <thead>
                <tr>
                  {table.columns.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <th scope="row">{row[0]}</th>
                    {row.slice(1).map((cell, cellIndex) => (
                      <td key={cellIndex}>
                        <SourceText value={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </article>
  );
}

function slugifyLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** Keeps entry groups in first-seen order: traits, then actions, then the rest. */
function groupEntries(entries: Entry[]): { name: string; entries: Entry[] }[] {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const existing = groups.get(entry.group);
    if (existing) existing.push(entry);
    else groups.set(entry.group, [entry]);
  }
  return [...groups.entries()].map(([name, grouped]) => ({
    name,
    entries: grouped,
  }));
}
