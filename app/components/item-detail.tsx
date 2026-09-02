/**
 * A content item, whatever shape it happens to be.
 *
 * The content types are not uniform — a feat carries six fields, a creature
 * carries forty-seven, and a rules chapter carries one field half a megabyte
 * long — so this renders four open-ended collections rather than a fixed field
 * list: key/value stats, prose sections, named entries (traits, actions,
 * features) and roll tables. A type that has none of a given collection simply
 * renders nothing for it.
 *
 * Some types also have a picture. A species has its portrait, an archetype has
 * its class illustration, and both come from `itemFigure` below rather than
 * from the caller, so a route does not have to know which types are
 * illustrated. Types with no art render no figure at all and the page falls
 * back to a single column — there is no empty frame and no broken icon,
 * because an `<img>` is only ever emitted for a file this build contains.
 */

import { Link } from "react-router";

import { Badge, SourceBadge } from "./badges";
import { AssetImage, ImageCredit, MonogramPlate } from "./media";
import { EditControl } from "./edit-control";
import { ReportControl } from "./report-control";
import { classArt, speciesPortrait } from "~/content/imagery";
import { TYPE_META } from "~/content/type-meta";
import type { AssetCredit, ContentItem, Entry } from "~/content/types";
import { LostValue, SourceText } from "./source-text";
import { Prose } from "./prose";

/** The picture for an item, and what to say about it. */
interface Figure {
  image: ReturnType<typeof speciesPortrait>;
  alt: string;
  caption: string;
  /** Shown in place of the picture when the archive has none. */
  fallbackNote: string;
  /**
   * How the picture is named in `app/assets`, and therefore how the service
   * knows which picture is being reported.
   *
   * These two strings are exactly what `app/content/imagery.ts` looks the image
   * up by, and they have to be, because the attribution record for a picture is
   * keyed `{group}-{key}` on the same naming. Deriving them a second way here —
   * from the item's name, say — would produce a report pointing at a record
   * that does not exist, which the service refuses. So they are computed
   * alongside the lookup rather than near it.
   */
  assetGroup: string;
  assetKey: string;
}

function itemFigure(item: ContentItem): Figure | null {
  if (item.type === "species") {
    return {
      image: speciesPortrait(item.slug),
      alt: `Illustration of the ${item.name} species`,
      // The caption describes the picture; who made it is a separate claim and
      // comes from the citation below it. The old caption said "illustration
      // from the Star Wars 5e archive", which read as an attribution while
      // naming nobody.
      caption: `Illustration of the ${item.name}`,
      fallbackNote: `No illustration of the ${item.name} exists in the archive.`,
      assetGroup: "species",
      assetKey: item.slug,
    };
  }

  if (item.type === "classes") {
    return {
      image: classArt(item.name),
      alt: `Illustration of a ${item.name}`,
      caption: `${item.name} — illustration from the Star Wars 5e archive`,
      fallbackNote: `No illustration of the ${item.name} exists in the archive.`,
      assetGroup: "classes",
      assetKey: item.name.toLowerCase(),
    };
  }

  // An archetype and a class improvement are both about one class and neither
  // has art of its own, so both borrow the class illustration — which is also
  // what makes 137 archetypes read as ten families at a glance.
  if (item.type === "archetypes" || item.type === "class-improvements") {
    const className = item.summary.className;
    if (typeof className !== "string") return null;
    return {
      image: classArt(className),
      alt: `Illustration of a ${className}`,
      caption:
        item.type === "archetypes"
          ? `${className} — the class this archetype branches from`
          : `${className} — the class this improvement belongs to`,
      fallbackNote: `No illustration of the ${className} class exists in the archive.`,
      assetGroup: "classes",
      assetKey: className.toLowerCase(),
    };
  }

  return null;
}

/**
 * The line under the heading, or nothing when it would only repeat the table.
 *
 * Taglines are built for index rows, where they are the only summary a reader
 * gets and they earn their place. On a detail page the stats table is four
 * lines below, and for several types the tagline is assembled out of exactly
 * the values it starts with — a species reads "Medium · Byss" directly above a
 * table whose first two rows are Size: Medium and Homeworld: Byss. Read twice
 * in a row like that, it stops looking like a summary and starts looking like
 * a mistake.
 *
 * The test is per-segment and total: every part of the tagline has to appear
 * as a stat value before it is dropped. A monster's "Large droid, unaligned"
 * and a feat's "No prerequisite" say something the table does not, so they
 * stay — which is the point of checking rather than special-casing species by
 * name, since the next type to grow a redundant tagline would not be covered
 * by a list of names.
 */
function subtitleFor(item: ContentItem): string | null {
  if (!item.tagline) return null;

  const shown = new Set(
    item.stats
      .map((stat) => stat.value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );

  if (shown.size === 0) return item.tagline;

  const segments = item.tagline
    .split("·")
    .map((segment) => segment.trim())
    .filter(Boolean);

  // A tagline with no separator is one segment, which is the case this has to
  // get right as much as the multi-part one: "Medium" alone above a Size row
  // is the same duplication.
  const everySegmentIsAlreadyInTheTable =
    segments.length > 0 &&
    segments.every((segment) => shown.has(segment.toLowerCase()));

  return everySegmentIsAlreadyInTheTable ? null : item.tagline;
}

export function ItemDetail({
  item,
  artCredit = null,
}: {
  item: ContentItem;
  /**
   * The citation for this item's picture, supplied by the route's loader
   * because it is build-time data. Null when the item has no picture — and
   * note that a picture whose artist is unknown still has a citation, one
   * that says so.
   */
  artCredit?: AssetCredit | null;
}) {
  const groups = groupEntries(item.entries);
  const figure = itemFigure(item);
  const accent = TYPE_META[item.type].accent;
  const tagline = subtitleFor(item);

  /*
    Order matters more than columns here. On a phone the heading comes first,
    the picture second and the reference text third, because a reader who has
    just tapped a search result needs to know they landed on the right page
    before they look at anything. On a wide screen the picture moves into a
    column of its own beside the text and stays there while the text scrolls.
    One grid, two area maps, no duplicated markup.
  */
  return (
    <article
      className={figure ? "item-layout has-figure" : "item-layout"}
      data-accent={accent}
    >
      <header className="item-header">
        <h1>
          <SourceText value={item.name} />
        </h1>
        {tagline ? (
          <p className="item-tagline">
            <SourceText value={tagline} />
          </p>
        ) : null}
        <p className="item-badges badge-row">
          <Badge accent={accent}>{TYPE_META[item.type].singular}</Badge>
          {item.source ? <SourceBadge code={item.source} linked /> : null}
        </p>
      </header>

      {figure ? (
        <figure className="item-figure">
          {figure.image ? (
            <AssetImage
              image={figure.image}
              alt={figure.alt}
              sizes="(min-width: 58rem) 256px, 288px"
              loading="eager"
            />
          ) : (
            <MonogramPlate name={item.name} />
          )}
          <figcaption>
            {figure.image ? figure.caption : figure.fallbackNote}
            {figure.image ? <ImageCredit credit={artCredit} /> : null}
          </figcaption>

          {/*
            Only when there is a picture. There is nothing to report about art
            that does not exist, and the monogram plate below is this site's own
            drawing rather than anybody's inherited work.

            This is the control that matters most on the whole site right now.
            Around a hundred and fifty of these pictures came from the original
            sw5e.com with no record of who drew them, and the only people who
            can close that gap are readers who recognise the work — which they
            do here, looking at it, rather than on a contact page later.

            The target is the picture's attribution record rather than the page:
            content type `asset-credit`, key `{group}-{key}`. That record is
            what a reviewer edits to write the credit, so the report lands on
            the document that resolves it.
          */}
          {figure.image ? (
            <ReportControl
              target={{
                kind: "image",
                type: "asset-credit",
                key: `${figure.assetGroup}-${figure.assetKey}`,
                name: item.name,
              }}
              /*
                The wording follows the citation directly above it. On the 149
                pictures whose artist was never recorded, the caption has just
                said so — and the next line a reader who recognises the work
                should meet is the question, not a generic offer to complain.
                On the one picture that is properly cited, and on any that
                becomes so, it goes back to the ordinary quiet line.
              */
              label={
                artCredit?.status === "inherited-unattributed"
                  ? "Do you know who made this?"
                  : "Report a problem with this picture"
              }
            />
          ) : null}
        </figure>
      ) : null}

      <div className="item-body">
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
                    ) : stat.href ? (
                      <Link to={stat.href}>
                        <SourceText value={stat.value} />
                      </Link>
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
          <section
            key={group.name}
            className="item-section"
            aria-labelledby={`group-${slugifyLabel(group.name)}`}
          >
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
        {/*
          At the foot of the page, after everything it is about. A reference is
          read from the top; an affordance for reporting it belongs where
          somebody has finished reading and found the thing that is wrong.

          `item.type` is the site's own route segment — `species`,
          `enhanced-items` — which the service resolves against its content
          registry, so no mapping table has to be kept in step here.
        */}
        <ReportControl
          target={{
            kind: "document",
            type: item.type,
            key: item.slug,
            name: item.name,
          }}
        />
        {/*
          Below the report control rather than above it, because reporting is
          for everybody and editing is for the few. It draws nothing for a
          reader who cannot edit, and nothing at all in the prerendered file.
        */}
        <EditControl type={item.type} slug={item.slug} />
      </div>
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
