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
import {
  NAVIGATION,
  faceOf,
  type NavDestination,
} from "~/content/nav-groups";
import { SOURCE_META, SOURCE_ORDER } from "~/content/source-meta";
import { selectSubcategoryRows } from "~/content/subcategory-views";
import { TYPE_ORDER } from "~/content/type-meta";
import type { AnySummary } from "~/content/types";
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
 * A step of the reading path, and the heading it is read under.
 *
 * The path is authored in the content repository — `readingGroup` and `order`
 * on each passage — and this page renders it rather than deciding it. Nothing
 * here consults `chapterNumber`: that records where a passage fell in a printed
 * book, and ordering by it puts "What's Different?" ahead of the introduction
 * it is different from, which is the right answer for a reader holding the book
 * and the wrong one for the reader this section exists for.
 */
interface PathStep {
  slug: string;
  name: string;
  group: string;
}

/**
 * How many entries sit behind one destination in the header's menus.
 *
 * The category cards used to be one per content type, so the count was one
 * lookup in the manifest. It is four different questions now, because the menu
 * holds four different kinds of thing: a type index is still a manifest lookup,
 * a slice of a type has to be counted by running the slice's own predicate over
 * the rows, a book already has `totalForSource`, and a hub is the sum of what it
 * stands for — which is itself both kinds, so it is both sums.
 *
 * Null rather than zero where there is no honest number. `/sources` is a page
 * about five books and not a page of anything, and a card reading "0 entries"
 * under it would be a claim rather than an omission.
 */
function countBehind(
  destination: NavDestination,
  counts: Record<string, number>,
): number | null {
  switch (destination.kind) {
    /*
      No number, for the same reason `/sources` has none: we do not know how
      many pages a PDF on somebody else's drive has, and inventing a zero
      would read as "this is empty" rather than "this is not ours to count".
    */
    case "external":
      return null;
    case "type":
      return counts[destination.type] ?? 0;
    case "view":
      return selectSubcategoryRows(
        destination.view,
        getSummaries(destination.view.type) as AnySummary[],
      ).length;
    case "book":
      return totalForSource(destination.code);
    case "page": {
      if (destination.covers.length + destination.offers.length === 0) {
        return null;
      }
      /*
        Both halves of what the hub holds, because it holds both: six type
        indexes and the three cuts of the class improvements. Summing `covers`
        alone would put 190 on the card in front of a page whose own lede says
        219 — two numbers for one chapter, on two pages a click apart.
      */
      const indexes = destination.covers.reduce(
        (sum, type) => sum + (counts[type] ?? 0),
        0,
      );
      return destination.offers.reduce(
        (sum, view) =>
          sum +
          selectSubcategoryRows(view, getSummaries(view.type) as AnySummary[])
            .length,
        indexes,
      );
    }
  }
}

export async function loader() {
  const manifest = getManifest();

  /*
    Chapters in the book's order, which is what makes this a table of contents
    rather than another list of links. Variant rules are pulled out separately:
    they are rules, so they belong above the category grid, but they are
    optional and must not sit in the path a new reader is walked down.
  */
  const rules = getSummaries("rules");

  const chapters: PathStep[] = rules
    .filter(
      (rule) =>
        rule.source === HOW_TO_PLAY &&
        rule.order != null &&
        rule.readingGroup != null,
    )
    .sort((a, b) => a.order! - b.order!)
    .map((rule) => ({
      slug: rule.slug,
      name: rule.name,
      group: rule.readingGroup!,
    }));

  const counts = Object.fromEntries(
    manifest.types.map((type) => [type.id, type.count]),
  ) as Record<string, number>;

  return {
    chapters,
    variantRules: rules.filter((rule) => rule.ruleType === "Variant").length,
    counts,
    /*
      Keyed by address rather than by type, because two of the menu's
      destinations are not types and one of them stands for seven. Computed
      here, in a loader that only ever runs at build time, so that a page which
      ships its own data does not also ship the predicate that produced it.
    */
    destinationCounts: Object.fromEntries(
      NAVIGATION.flatMap((group) => [...group.primary, ...group.supporting])
        .map(
          (destination) =>
            [destination.to, countBehind(destination, counts)] as const,
        )
        .filter(
          (entry): entry is readonly [string, number] => entry[1] !== null,
        ),
    ) as Record<string, number>,
    total: manifest.types.reduce((sum, type) => sum + type.count, 0),
    curated: isCuratedDataset(),
    sourceTotals: Object.fromEntries(
      SOURCE_ORDER.map((code) => [code, totalForSource(code)]),
    ) as Record<string, number>,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const {
    destinationCounts,
    total,
    curated,
    sourceTotals,
    chapters,
    variantRules,
  } = loaderData;

  // Whatever the path opens with. Somebody reordering the content moves this
  // button with it, which is the point of authoring the order at all.
  const start = chapters[0];

  /*
    Collapsed into the headings they are read under. The path is already in
    order, so a group ends where the next heading begins — the grouping and the
    sequence cannot disagree, because there is only one sequence.
  */
  const steps: { group: string; chapters: PathStep[] }[] = [];
  for (const chapter of chapters) {
    const current = steps.at(-1);
    if (current?.group === chapter.group) current.chapters.push(chapter);
    else steps.push({ group: chapter.group, chapters: [chapter] });
  }

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
            it in order, or jump to the part you need.
          </p>

          {/*
            Grouped, and unnumbered. Fifteen links in a row is a list somebody
            scans and gives up on; four headings is a shape they can see before
            they start. The numbers are gone with the same reasoning — "9" in
            front of Combat is a page reference to a book nobody reading this is
            holding, and it invites the question of why the list starts at a
            chapter that is not one.
          */}
          {steps.map((step) => (
            <section
              key={step.group}
              className="path-step"
              aria-labelledby={`step-${step.group.replace(/\s+/g, "-").toLowerCase()}`}
            >
              <h3
                className="path-step-heading"
                id={`step-${step.group.replace(/\s+/g, "-").toLowerCase()}`}
              >
                {step.group}
              </h3>
              <ul className="chapter-list">
                {step.chapters.map((chapter) => (
                  <li key={chapter.slug}>
                    <Link className="chapter-link" to={`/rules/${chapter.slug}`}>
                      <span className="chapter-name">{chapter.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
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

        {/*
          A labelled region like the two sections above it, which it was not
          before. The heading existed; nothing tied the content under it to the
          heading, so assistive technology met a run of category groups with no
          statement of what they were groups of — and the page's own tests could
          not say "in the categories" either, which is how it was noticed.
        */}
        <section aria-labelledby="categories">
        <h2 className="section-heading" id="categories">
          Categories
        </h2>
        <p className="section-lede">
          Everything the books list rather than explain — what to choose from
          when you already know the rule.
        </p>
        {/*
          Grouped, not flat, and grouped by the header's own model rather than
          by a second one kept alongside it. Twenty-seven cards in a single grid
          is a wall — seven of them were the customization options, which the
          Player's Handbook introduces together and which a reader has no way to
          see as one answer when they are seven boxes in a run of twenty-seven.

          Because it is the header's model, a card here is a destination rather
          than a content type: three of them are books, eight are slices of a
          type, one is the customization hub. That is the point of sharing the
          model. The front page and the navigation cannot drift into two
          different accounts of where a thing lives, and neither can they drift
          into two different accounts of what a thing is.
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
              {group.primary.map((destination) => {
                const face = faceOf(destination);
                const count = destinationCounts[face.to];
                return (
                  <li key={face.to}>
                    <Link
                      to={face.to}
                      className="type-card"
                      data-accent={face.accent ?? undefined}
                    >
                      {face.icon ? <TypeIcon type={face.icon} /> : null}
                      <span className="type-card-name">{face.label}</span>
                      {count != null ? (
                        <span className="type-card-count">
                          {count.toLocaleString("en-US")}
                          <span className="sr-only"> entries</span>
                        </span>
                      ) : null}
                      <span className="type-card-blurb">{face.blurb}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/*
              The quiet half of the menu, rendered quietly here too: one line of
              links rather than a row of cards. A weapon property is read from
              the weapon that cites it, and the hulls and the rules index are
              destinations the owner's menu simply does not name — neither kind
              should be competing with the cards above for a first-time
              reader's attention, and neither should be unreachable.
            */}
            {group.supporting.length > 0 ? (
              <p className="type-group-supporting">
                {group.supporting.map((destination, index) => (
                  <span key={destination.to}>
                    {index > 0 ? ", " : null}
                    <Link to={destination.to}>{destination.label}</Link>
                  </span>
                ))}
              </p>
            ) : null}
          </section>
        ))}

        </section>
      </div>
    </div>
  );
}
