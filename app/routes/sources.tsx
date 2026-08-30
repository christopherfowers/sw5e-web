import { Link } from "react-router";

import { AssetImage, MonogramPlate } from "~/components/media";
import { Breadcrumbs } from "~/components/site-chrome";
import { totalForSource } from "~/content/dataset.server";
import { sourceCover } from "~/content/imagery";
import { SOURCE_META, SOURCE_ORDER } from "~/content/source-meta";
import type { Route } from "./+types/sources";

export function meta() {
  return [
    { title: "Source books — Star Wars 5e" },
    {
      name: "description",
      content:
        "The books this Star Wars 5e reference draws from: the Player's Handbook, Expanded Content, Wretched Hives and Scum and Villainy.",
    },
  ];
}

export async function loader() {
  return {
    totals: Object.fromEntries(
      SOURCE_ORDER.map((code) => [code, totalForSource(code)]),
    ) as Record<string, number>,
  };
}

export default function Sources({ loaderData }: Route.ComponentProps) {
  const { totals } = loaderData;

  return (
    <div className="page">
      <Breadcrumbs trail={[{ label: "Sources" }]} />
      <div className="page-head">
        <p className="page-eyebrow">Reference</p>
        <h1>Source books</h1>
        <p className="lede">
          Every entry on this site carries the book it came from. These are those
          books, and what each one contributes.
        </p>
      </div>

      <ul className="book-grid">
        {SOURCE_ORDER.map((code) => {
          const source = SOURCE_META[code];
          const cover = sourceCover(code);
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
                  <p className="book-card-blurb">{source.blurb}</p>
                  <p className="book-card-count">
                    {(totals[code] ?? 0).toLocaleString("en-US")} entries
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
