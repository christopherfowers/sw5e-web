import { Link } from "react-router";

import { getManifest, isCuratedDataset } from "~/content/dataset.server";
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
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { counts, total, curated } = loaderData;

  return (
    <div className="page page-home">
      <div className="home-intro">
        <h1>Star Wars 5e</h1>
        <p className="lede">
          A community reference for the Star Wars 5e tabletop roleplaying game.
          Every species, power, creature and piece of gear in one searchable
          place, built to be read at the table.
        </p>
        <p className="home-total">
          {total.toLocaleString("en-US")} entries across{" "}
          {TYPE_ORDER.length} categories. Press{" "}
          <kbd>/</kbd> anywhere to search all of them.
        </p>
        {curated ? (
          <p className="notice">
            This build is showing the small sample dataset that ships with the
            repository. Run{" "}
            <code>node scripts/build-content-fixture.mjs</code> against the
            legacy archive to render the full library.
          </p>
        ) : null}
      </div>

      <h2 className="section-heading">Browse by category</h2>
      <ul className="type-grid">
        {TYPE_ORDER.map((type) => (
          <li key={type}>
            <Link to={`/${type}`} className="type-card">
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
    </div>
  );
}
