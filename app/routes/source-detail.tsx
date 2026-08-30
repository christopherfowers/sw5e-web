import { Link } from "react-router";

import { AssetImage, MonogramPlate } from "~/components/media";
import { Breadcrumbs } from "~/components/site-chrome";
import { TypeIcon } from "~/components/type-icon";
import { countsBySource } from "~/content/dataset.server";
import { sourceCover } from "~/content/imagery";
import { sourceBySlug } from "~/content/source-meta";
import { TYPE_META, TYPE_ORDER } from "~/content/type-meta";
import type { ContentTypeId } from "~/content/types";
import type { Route } from "./+types/source-detail";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not found — Star Wars 5e" }];
  return [
    { title: `${loaderData.source.name} — Star Wars 5e` },
    {
      name: "description",
      content: `${loaderData.total} Star Wars 5e entries from ${loaderData.source.name}. ${loaderData.source.blurb}`,
    },
  ];
}

export async function loader({ params }: Route.LoaderArgs) {
  const source = sourceBySlug(params.slug);
  if (!source) throw new Response("Not Found", { status: 404 });

  const counts = countsBySource(source.code);
  return {
    source,
    counts,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
}

/**
 * Only pre-rendered paths have a data file beside them, so a client-side
 * navigation to a book that does not exist fails the fetch rather than
 * returning a 404. Converting it here makes a mistyped URL read as the
 * missing page it is.
 */
export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  try {
    return await serverLoader();
  } catch {
    throw new Response("Not Found", { status: 404 });
  }
}

export default function SourceDetail({ loaderData }: Route.ComponentProps) {
  const { source, counts, total } = loaderData;
  const cover = sourceCover(source.code);
  const present = TYPE_ORDER.filter((type) => (counts[type] ?? 0) > 0);

  return (
    <div className="page" data-accent={source.accent}>
      <Breadcrumbs
        trail={[{ label: "Sources", to: "/sources" }, { label: source.name }]}
      />

      <div className="source-hero">
        {cover ? (
          <AssetImage
            className="source-cover"
            image={cover}
            alt={`Cover of ${source.name}`}
            sizes="(min-width: 46rem) 192px, 60vw"
            loading="eager"
          />
        ) : (
          /*
            Expanded Content is community material and has no cover art
            anywhere in the archive. Rather than an empty frame or a broken
            image, it gets a plate of its own initials in its own colour — the
            same treatment species without a portrait get.
          */
          <span className="source-plate">
            <MonogramPlate name={source.name} />
          </span>
        )}

        <div>
          <p className="page-eyebrow">Source book</p>
          <h1>{source.name}</h1>
          <p className="lede">{source.blurb}</p>
          <p className="home-hero-meta">
            {total.toLocaleString("en-US")} entries in this reference, marked{" "}
            <span className="badge" data-accent={source.accent}>
              {source.code}
            </span>{" "}
            wherever they appear.
          </p>

          <h2 className="section-heading">What it contributes</h2>
          <ul className="source-breakdown">
            {present.map((type: ContentTypeId) => (
              <li key={type}>
                <Link to={`/${type}`} data-accent={TYPE_META[type].accent}>
                  <TypeIcon type={type} />
                  {TYPE_META[type].plural}
                  <span className="source-breakdown-count">
                    {counts[type].toLocaleString("en-US")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
