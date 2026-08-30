import { Link } from "react-router";

import { AssetImage, MonogramPlate } from "~/components/media";
import { TypeIcon } from "~/components/type-icon";
import { getManifest, isCuratedDataset, totalForSource } from "~/content/dataset.server";
import { brandImage, sourceCover } from "~/content/imagery";
import { SOURCE_META, SOURCE_ORDER } from "~/content/source-meta";
import { TYPE_META, TYPE_ORDER } from "~/content/type-meta";
import type { Route } from "./+types/home";

export function meta() {
  return [
    { title: "Star Wars 5e — Community Reference" },
    {
      name: "description",
      content:
        "A community reference for Star Wars 5e: species, archetypes, backgrounds, feats, powers, maneuvers, equipment and creature stat blocks, searchable in one place.",
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

  const logo = brandImage("logo");
  const heroLight = brandImage("hero-light");
  const heroDark = brandImage("hero-dark");

  return (
    <div className="page-home">
      {/*
        The hero photograph is a ground, not a subject — a table with dice on
        it, behind a scrim heavy enough that the type above it keeps its
        contrast in either theme. It carries no information a reader needs, so
        it is marked decorative rather than described. The logo above the
        heading is decorative for the same reason: the heading says the same
        four characters in text.
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
          {logo ? (
            <AssetImage
              className="home-hero-logo"
              image={logo}
              alt=""
              sizes="(min-width: 40rem) 152px, 20vw"
              loading="eager"
            />
          ) : null}
          <h1>Star Wars 5e</h1>
          <p className="lede">
            A community reference for the Star Wars 5e tabletop roleplaying game.
            Every species, power, creature and piece of gear in one searchable
            place, built to be read at the table.
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
