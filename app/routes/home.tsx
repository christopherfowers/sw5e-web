import { Link } from "react-router";

import { AssetImage, MonogramPlate } from "~/components/media";
import {
  getManifest,
  getSummaries,
  isCuratedDataset,
  totalForSource,
} from "~/content/dataset.server";
import { brandImage, sourceCover } from "~/content/imagery";
import { BOOKS, coreRulebook } from "~/content/books";
import { SOURCE_ORDER } from "~/content/source-meta";
import { TYPE_ORDER } from "~/content/type-meta";
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
        // Names the game, then says what it is. The hero can lead with the
        // description because the heading above it carries the name; a search
        // result has no heading, so this has to do both jobs itself.
        "Star Wars 5e is a roleplaying game built on the mechanics of " +
        "Dungeons & Dragons 5th edition, expanded for the galaxy. Every book " +
        `of it, searchable in one place: ${corpus}, including classes, ` +
        "archetypes, features, powers, starships, enhanced items and creature " +
        "stat blocks.",
    },
  ];
}

/**
 * The book that teaches the game, as opposed to the ones that extend it.
 *
 * This used to be the constant `"PHB"`, with a comment explaining that nothing
 * in the data marked it. Something does now: a source sets `isCoreRulebook`,
 * and the content repository holds the invariant that exactly one does.
 *
 * The distinction is editorial and it is the whole point of the page — a reader
 * arriving with no idea what this is needs to be sent to one book, not offered
 * five — which is precisely why it belongs to whoever owns the content rather
 * than to this file.
 *
 * Null when no book is marked, which an archive build always is. The page
 * copes: it draws no opening button and no reading path, which is a smaller
 * page rather than a broken one.
 */
const HOW_TO_PLAY = coreRulebook()?.code ?? null;

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

export async function loader() {
  const manifest = getManifest();

  /*
    The handbook's chapters in the order somebody authored, which is how the
    page knows which one to open with. Only the first is rendered — the rest
    are returned because the order itself is the invariant worth holding, and
    `home-path.test.ts` asserts it here rather than somewhere it could drift
    from what the page actually reads.

    Variant rules are counted separately: they are rules, so they belong with
    the books, but they are optional and must not sit in the path a new reader
    is walked down.
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

  return {
    chapters,
    variantRules: rules.filter((rule) => rule.ruleType === "Variant").length,
    total: manifest.types.reduce((sum, type) => sum + type.count, 0),
    curated: isCuratedDataset(),
    sourceTotals: Object.fromEntries(
      SOURCE_ORDER.map((code) => [code, totalForSource(code)]),
    ) as Record<string, number>,
    /*
      The shelf, straight from the corpus: which books exist, what they are
      called, the line under each and the hue it is drawn in, in the order
      somebody authored. Nothing here is decided by this file, which is the
      point — adding a book, renaming one or reordering the shelf is an edit to
      content and needs no deploy.
    */
    books: BOOKS.map((book) => ({
      key: book.key,
      code: book.code,
      name: book.name,
      blurb: book.blurb,
      accent: book.accent,
    })),
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { total, curated, sourceTotals, chapters, variantRules, books } =
    loaderData;

  // Whatever the path opens with. Somebody reordering the content moves this
  // button with it, which is the point of authoring the order at all.
  const start = chapters[0];

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
          {/*
            What the game is, before what this site does.

            This used to read "every book of the Star Wars 5e conversion,
            searchable in one place", which is true and tells somebody who does
            not already know absolutely nothing: it never says what the game is,
            and "conversion" carries the whole explanation without unpacking it.
            The site it replaces opened by saying plainly that this is an
            overhaul of Dungeons & Dragons 5th edition for a Star Wars
            campaign, built on the same mechanics and expanded — which is both
            more welcoming and more honest about what the rules rest on.
          */}
          <p className="lede">
            A Star Wars roleplaying game, built on the mechanics of Dungeons
            &amp; Dragons 5th edition and expanded for the galaxy. Every book of
            it, searchable in one place.
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
        {/*
          The command in this notice has to be one the reader can actually run.

          It said "against the legacy archive", which is a private directory
          almost nobody reading it has — so the honest next step looked
          impossible and the sample looked broken instead of small. The content
          repository is public and sits beside this one, and building from it
          produces the whole library.

          Worth knowing while looking at a sample build: the shipped
          `book-contents.json` lists every chapter of every book, while the rest
          of the sample is four items per type. So a book's rail offers chapters
          whose pages are not in the sample and answers 404. That is the sample
          being small rather than the site being wrong, and the command below is
          the cure.
        */}
        {curated ? (
          <p className="notice">
            This build is showing the small sample dataset that ships with the
            repository, so most links lead to pages it does not contain. Run{" "}
            <code>
              node scripts/build-content-fixture.mjs
              --content=../sw5e-database/content --out=app/data/generated
            </code>{" "}
            to render the full library from the content repository.
          </p>
        ) : null}

        {/*
          The books, first and whole.

          The order of this page used to be how to play, then the other books,
          then the lists. The books are now the first thing under the hero,
          which is how the site this replaces opened and what its owner asked
          for: somebody arriving wants to see what this is made of before they
          are told where to start.

          All of them, including the handbook. The old arrangement called this
          "Supplemental rules" and left the handbook out, because the section
          above it was the handbook — which made the row a list of leftovers
          rather than a shelf. A reader looking for the Player's Handbook
          should find it among the books.

          The covers carry this rather than the text. Two of the five have no
          artwork and fall back to a monogram plate, which is the same shape and
          holds the row's rhythm.
        */}
        <section className="home-shelf" aria-labelledby="the-books">
          <h2 className="section-heading" id="the-books">
            The rulebooks
          </h2>
          <p className="section-lede">
            {books.length === 1
              ? "Everything in this reference comes from one book."
              : `Everything in this reference comes from one of these ${books.length} books.`}
          </p>

          <ul className="shelf">
            {books.map((book) => {
              const cover = sourceCover(book.code);
              const entries = sourceTotals[book.code] ?? 0;
              return (
                <li key={book.code}>
                  <div className="shelf-book" data-accent={book.accent ?? undefined}>
                    {cover ? (
                      <AssetImage
                        className="shelf-cover"
                        image={cover}
                        alt={`Cover of ${book.name}`}
                        sizes="(max-width: 40rem) 40vw, 12rem"
                      />
                    ) : (
                      <span className="shelf-cover shelf-plate">
                        <MonogramPlate name={book.name} />
                      </span>
                    )}
                    <p className="shelf-title">
                      <Link to={`/sources/${book.key}`}>{book.name}</Link>
                    </p>
                    {book.blurb ? <p className="shelf-blurb">{book.blurb}</p> : null}
                    <p className="shelf-count">
                      {entries.toLocaleString("en-US")}{" "}
                      {entries === 1 ? "entry" : "entries"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/*
          The optional rules, which are the only thing left of what used to be
          a "How to play" section here.

          That section reproduced all fifteen chapters of the Player's
          Handbook, grouped by heading. It was the right answer while a book's
          own page was a grid of content-type counts and there was nowhere else
          to read a table of contents. Now the handbook's page is its chapters,
          and the hero's first button goes straight there — so the front page
          was saying the same thing twice, at length, above the books it was
          describing.

          The variants stay because they belong to no single book's path: they
          are options a table turns on, spread across the corpus, and the front
          page is the only place that speaks for the whole of it.
        */}
        {variantRules > 0 ? (
          <p className="home-variants">
            <Link to="/rules">
              {variantRules.toLocaleString("en-US")} optional and variant rules
            </Link>{" "}
            a table can turn on.
          </p>
        ) : null}

      </div>
    </div>
  );
}
