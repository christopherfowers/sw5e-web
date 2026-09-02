import { Link } from "react-router";

import { AssetImage, MonogramPlate } from "~/components/media";
import { TypeIcon } from "~/components/type-icon";
import {
  getManifest,
  getSummaries,
  isCuratedDataset,
  totalForSource,
} from "~/content/dataset.server";
import { brandImage, sourceCover } from "~/content/imagery";
import { NAVIGATION } from "~/content/nav-groups";
import { SOURCE_META, SOURCE_ORDER } from "~/content/source-meta";
import { TYPE_META, TYPE_ORDER } from "~/content/type-meta";
import type { Route } from "./+types/home";

/**
 * The page's own description of itself, and the two things it has to get right.
 *
 * The first is the article. This used to open "A community reference", and the
 * indefinite article did real damage: it filed the site alongside every other
 * fan project rather than saying what it is. The fix for that overshot in the
 * other direction — "The maintained continuation of sw5e.com" — and traded one
 * wrong self-description for another. A continuation is something that stands
 * outside a project and carries it forward. This is not outside it. It is Star
 * Wars 5e, and the description a search result shows should
 * say what the site is rather than what it succeeded.
 *
 * So the lineage has come out of this description entirely and lives on
 * `/about`, which is the page that can afford the paragraph it needs. That is
 * not a retreat from the claim; it is putting the claim where it is not
 * compressed into a phrase that reads as distance.
 *
 * The second is that the description no longer lists content types by hand.
 * The old one named eight, and was already wrong: classes, features, starships,
 * enhanced items, the property glossaries and the rules text all landed after
 * it was written, and nobody edits a meta tag when they add a content type. It
 * now counts what the build actually holds, so it cannot fall behind the
 * library again. The named examples that remain are chosen to be the ones a
 * reader would doubt were here — not a manifest.
 *
 * `loaderData` is checked rather than trusted because meta also renders when
 * the loader has thrown — the type says it is always there, the error path says
 * otherwise — so there is a sentence that reads without any counts at all.
 */
export function meta({ loaderData }: Route.MetaArgs) {
  const corpus = loaderData
    ? `${loaderData.total.toLocaleString("en-US")} entries across ${TYPE_ORDER.length} categories`
    : "The whole library";

  return [
    // The site's name, and nothing appended to it. Every other page is
    // "Something — Star Wars 5e", so the home page is the bare name, which is
    // both the convention and the only honest answer: a strapline after the
    // dash has been tried twice here and read as filler both times.
    { title: "Star Wars 5e" },
    {
      name: "description",
      content:
        `Every book of the Star Wars 5e conversion, searchable in one place. ` +
        `${corpus}, including classes, archetypes, features, powers, ` +
        "starships, enhanced items and creature stat blocks.",
    },
  ];
}

/**
 * The book that teaches the game, as opposed to the four that extend it.
 *
 * Named here rather than inferred, because nothing in the data marks it: to the
 * dataset the Player's Handbook is a source like any other. The distinction is
 * editorial and it is the whole point of the page — a reader arriving with no
 * idea what this is needs to be sent to one book, not offered five.
 */
const HOW_TO_PLAY = "PHB";

/**
 * The chapter a reader is sent to first.
 *
 * Chapter order is the book's own, and the book opens with two front-matter
 * chapters: "What's Different?" is numbered -1 and the Introduction 0, so
 * sorting by number puts the comparison with D&D 5e before the explanation of
 * what the game is. That is the right order for somebody who already plays 5e
 * and the wrong one for somebody who does not, and it is the second reader this
 * section exists for.
 */
const FIRST_CHAPTER = 0;

export async function loader() {
  const manifest = getManifest();

  /*
    Chapters in the book's order, which is what makes this a table of contents
    rather than another list of links. Variant rules are pulled out separately:
    they are rules, so they belong above the category grid, but they are
    optional and must not sit in the path a new reader is walked down.
  */
  const rules = getSummaries("rules");

  const chapters = rules
    .filter((rule) => rule.source === HOW_TO_PLAY && rule.ruleType === "Chapter")
    .sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0))
    .map((rule) => ({
      slug: rule.slug,
      name: rule.name,
      chapterNumber: rule.chapterNumber,
    }));

  return {
    chapters,
    variantRules: rules.filter((rule) => rule.ruleType === "Variant").length,
    counts: Object.fromEntries(
      manifest.types.map((type) => [type.id, type.count]),
    ) as Record<string, number>,
    total: manifest.types.reduce((sum, type) => sum + type.count, 0),
    curated: isCuratedDataset(),
    sourceTotals: Object.fromEntries(
      SOURCE_ORDER.map((code) => [code, totalForSource(code)]),
    ) as Record<string, number>,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { counts, total, curated, sourceTotals, chapters, variantRules } =
    loaderData;

  const start =
    chapters.find((chapter) => chapter.chapterNumber === FIRST_CHAPTER) ??
    chapters[0];

  const heroLight = brandImage("hero-light");
  const heroDark = brandImage("hero-dark");

  return (
    <div className="page-home">
      {/*
        The hero photograph is a ground, not a subject — a table with dice on
        it, behind a scrim heavy enough that the type above it keeps its
        contrast in either theme. It carries no information a reader needs, so
        it is marked decorative rather than described.

        There was a wordmark above the heading as well, and it has gone. It
        drew the same four characters the heading draws, directly under a
        header that already carries the mark on every page of the site — three
        statements of the name before a single sentence about what the site is.
      */}
      <section className="home-hero">
        {heroLight && heroDark ? (
          <picture>
            <source
              media="(prefers-color-scheme: dark)"
              srcSet={heroDark.srcSet}
              sizes="100vw"
            />
            <img
              className="home-hero-media"
              src={heroLight.src}
              srcSet={heroLight.srcSet}
              sizes="100vw"
              width={heroLight.width}
              height={heroLight.height}
              alt=""
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
          </picture>
        ) : null}

        <div className="home-hero-inner">
          <h1>Star Wars 5e</h1>
          <p className="lede">
            Every book of the Star Wars 5e conversion, searchable in one place.
          </p>
          <p className="home-hero-meta">
            {total.toLocaleString("en-US")} entries across {TYPE_ORDER.length}{" "}
            categories. Press <kbd>/</kbd> anywhere to search all of them.
          </p>
          {/*
            These used to be "Browse species" and "Creature stat blocks", which
            sent every arrival straight into a list of options. That is the
            complaint the page was rebuilt for: readers jump around and never
            learn the system. The first action is now the book that teaches it,
            and browsing is still one click away for the people who came here
            knowing what they wanted.
          */}
          <div className="home-hero-actions">
            {start ? (
              <Link className="button button-primary" to={`/rules/${start.slug}`}>
                Start with the Player&rsquo;s Handbook
              </Link>
            ) : null}
            <Link className="button" to="/species">
              Browse species
            </Link>
          </div>
          {/*
            Below the buttons rather than beside them, and phrased as the
            question the reader is actually holding. Somebody who followed a
            dead bookmark is not looking for an "About" link — they are looking
            for an answer to "is this the same site, and is my stuff here". The
            two browse buttons stay first because most arrivals do not need
            this sentence at all.

            It used to ask "here is what happened", which framed the move as an
            event that befell somebody else. It is a change of address, so it
            now reads as one. The old domain is still named, because that is the
            word the reader is holding in their head and a redirect notice that
            will not say where you came from is no use to anybody.
          */}
          <p className="home-hero-note">
            <Link to="/about">
              Arrived from an sw5e.com link? Here is what moved, and what did
              not.
            </Link>
          </p>
        </div>
      </section>

      <div className="home-section">
        {curated ? (
          <p className="notice">
            This build is showing the small sample dataset that ships with the
            repository. Run{" "}
            <code>node scripts/build-content-fixture.mjs</code> against the
            legacy archive to render the full library.
          </p>
        ) : null}

        {/*
          The order of this page is the order a reader needs it in: how to play,
          then what else there is to play with, then the lists. It used to open
          with twenty-seven category cards, which answers "what do you have"
          before anybody has been told what the game is.
        */}
        <section className="home-start" aria-labelledby="how-to-play">
          <h2 className="section-heading" id="how-to-play">
            How to play
          </h2>
          <p className="section-lede">
            The Player&rsquo;s Handbook is the whole game: how to make a
            character, how to fight, how to cast, and what the dice mean. Read
            it in order, or jump to the chapter you need.
          </p>

          {chapters.length > 0 ? (
            <ol className="chapter-list">
              {chapters.map((chapter) => (
                <li key={chapter.slug}>
                  <Link className="chapter-link" to={`/rules/${chapter.slug}`}>
                    {/*
                      The number is the book's, not the list's, so a chapter
                      keeps the name a reader would cite it by. The front matter
                      is numbered below one and shows no number at all rather
                      than "Chapter -1".
                    */}
                    {chapter.chapterNumber != null && chapter.chapterNumber > 0 ? (
                      <span className="chapter-number">
                        {chapter.chapterNumber}
                      </span>
                    ) : null}
                    <span className="chapter-name">{chapter.name}</span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : null}
        </section>

        {/*
          Everything that is still rules, but is not the book you learn from:
          the three supplements and the optional rules. Above the categories
          because a rule outranks a list of items, below the handbook because
          none of it makes sense before it.
        */}
        <section className="home-supplemental" aria-labelledby="supplemental">
          <h2 className="section-heading" id="supplemental">
            Supplemental rules
          </h2>
          <p className="section-lede">
            The other books, and the optional rules a table can choose to use.
          </p>

          <ul className="book-grid">
            {SOURCE_ORDER.filter((code) => code !== HOW_TO_PLAY).map((code) => {
              const source = SOURCE_META[code];
              const cover = sourceCover(code);
              const entries = sourceTotals[code] ?? 0;
              return (
                <li key={code}>
                  <div className="book-card" data-accent={source.accent}>
                    {cover ? (
                      <AssetImage
                        className="book-cover"
                        image={cover}
                        alt={`Cover of ${source.name}`}
                        sizes="68px"
                      />
                    ) : (
                      <span className="book-plate">
                        <MonogramPlate name={source.name} />
                      </span>
                    )}
                    <div>
                      <p className="book-card-title">
                        <Link to={`/sources/${source.slug}`}>{source.name}</Link>
                      </p>
                      <p className="book-card-count">
                        {entries.toLocaleString("en-US")} entries
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {variantRules > 0 ? (
            <p className="home-variants">
              <Link to="/rules">
                {variantRules.toLocaleString("en-US")} optional and variant
                rules
              </Link>{" "}
              a table can turn on.
            </p>
          ) : null}
        </section>

        <h2 className="section-heading" id="categories">
          Categories
        </h2>
        <p className="section-lede">
          Everything the books list rather than explain — what to choose from
          when you already know the rule.
        </p>
        {/*
          Grouped, not flat. Twenty-seven cards in one grid is a wall: seven of
          them were feats, fighting styles, masteries, lightsaber forms and the
          two weapon tiers, which the Player's Handbook introduces together as
          Customization Options and which a reader has no way to see as one
          answer when they are seven boxes in a run of twenty-seven.

          The grouping is the header's own, so the front page and the navigation
          cannot drift into two different accounts of where a thing lives.
        */}
        {NAVIGATION.map((group) => (
          <section
            key={group.id}
            className="type-group"
            aria-labelledby={`group-${group.id}`}
          >
            <h3 className="type-group-heading" id={`group-${group.id}`}>
              {group.label}
            </h3>
            <p className="type-group-blurb">{group.blurb}</p>

            <ul className="type-grid">
              {group.primary.map((type) => (
                <li key={type}>
                  <Link
                    to={`/${type}`}
                    className="type-card"
                    data-accent={TYPE_META[type].accent}
                  >
                    <TypeIcon type={type} />
                    <span className="type-card-name">
                      {TYPE_META[type].plural}
                    </span>
                    <span className="type-card-count">
                      {(counts[type] ?? 0).toLocaleString("en-US")}
                      <span className="sr-only"> entries</span>
                    </span>
                    <span className="type-card-blurb">
                      {TYPE_META[type].blurb}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            {/*
              Reached from something else rather than browsed — a weapon
              property is read from the weapon that has it. Listed so they are
              findable, sized so they do not compete.
            */}
            {group.supporting.length > 0 ? (
              <p className="type-group-supporting">
                {group.supporting.map((type, index) => (
                  <span key={type}>
                    {index > 0 ? ", " : null}
                    <Link to={`/${type}`}>{TYPE_META[type].plural}</Link>
                  </span>
                ))}
              </p>
            ) : null}
          </section>
        ))}

      </div>
    </div>
  );
}
