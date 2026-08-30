import { ContentList } from "~/components/content-list";
import { Breadcrumbs } from "~/components/site-chrome";
import { getSummaries } from "~/content/dataset.server";
import { getListConfig } from "~/content/list-config";
import { TYPE_META } from "~/content/type-meta";
import { isContentTypeId, type AnySummary, type ContentTypeId } from "~/content/types";
import type { Route } from "./+types/type-index";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not found — Star Wars 5e" }];
  const meta = TYPE_META[loaderData.type];
  return [
    { title: `${meta.plural} — Star Wars 5e` },
    {
      name: "description",
      content: `${loaderData.rows.length} ${meta.plural.toLowerCase()} for Star Wars 5e. ${meta.blurb}`,
    },
  ];
}

export async function loader({ params }: Route.LoaderArgs) {
  const type = params.type;
  if (!isContentTypeId(type)) {
    throw new Response("Not Found", { status: 404 });
  }
  return {
    type: type as ContentTypeId,
    rows: getSummaries(type) as AnySummary[],
  };
}

/**
 * Only pre-rendered paths have a data file beside them, so a client-side
 * navigation to a slug that does not exist fails the fetch rather than
 * returning a 404. Left alone that surfaces as "an unexpected error
 * occurred", which tells a reader nothing; converting it here makes a
 * mistyped URL read as the missing page it is.
 *
 * Deliberately without a hydrate flag on this clientLoader: setting it makes
 * the build pre-render the hydration fallback instead of the page, which
 * empties every content page of the markup this site exists to publish.
 */
export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  try {
    return await serverLoader();
  } catch {
    throw new Response("Not Found", { status: 404 });
  }
}

export default function TypeIndex({ loaderData }: Route.ComponentProps) {
  const { type, rows } = loaderData;
  const meta = TYPE_META[type];
  const config = getListConfig(type);

  return (
    <div className="page">
      <Breadcrumbs trail={[{ label: meta.plural }]} />
      <h1>{meta.plural}</h1>
      <p className="lede">{meta.blurb}</p>
      <ContentList
        type={type}
        typeLabel={meta.plural}
        rows={rows}
        config={config}
      />
    </div>
  );
}
