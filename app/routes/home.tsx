import { Link } from "react-router";

import { AssetImage, MonogramPlate } from "~/components/media";
import { TypeIcon } from "~/components/type-icon";
import { getManifest, isCuratedDataset, totalForSource } from "~/content/dataset.server";
import { brandImage, sourceCover } from "~/content/imagery";
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

export async function loader() {
  const manifest = getManifest();
  return {
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
  const { counts, total, curated, sourceTotals } = loaderData;

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
          <div className="home-hero-actions">
            <Link className="button button-primary" to="/species">
              Browse species
            </Link>
            <Link className="button" to="/monsters">
              Creature stat blocks
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

        <h2 className="section-heading">Browse by category</h2>
        <ul className="type-grid">
          {TYPE_ORDER.map((type) => (
            <li key={type}>
              <Link
                to={`/${type}`}
                className="type-card"
                data-accent={TYPE_META[type].accent}
              >
                <TypeIcon type={type} />
                <span className="type-card-name">{TYPE_META[type].plural}</span>
                <span className="type-card-count">
                  {(counts[type] ?? 0).toLocaleString("en-US")}
                  <span className="sr-only"> entries</span>
                </span>
                <span className="type-card-blurb">{TYPE_META[type].blurb}</span>
              </Link>
            </li>
          ))}
        </ul>

        <h2 className="section-heading">Source books</h2>
        <ul className="book-grid">
          {SOURCE_ORDER.map((code) => {
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
      </div>
    </div>
  );
}
