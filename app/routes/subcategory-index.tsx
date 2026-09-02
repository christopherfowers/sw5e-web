import { ContentList } from "~/components/content-list";
import { Breadcrumbs } from "~/components/site-chrome";
import { TypeIcon } from "~/components/type-icon";
import { getSummaries } from "~/content/dataset.server";
import { getListConfig } from "~/content/list-config";
import { groupOfType, NAV_GROUP_META } from "~/content/nav-groups";
import {
  getSubcategoryView,
  requireSubcategoryView,
  selectSubcategoryRows,
} from "~/content/subcategory-views";
import { TYPE_META } from "~/content/type-meta";
import type { AnySummary } from "~/content/types";
import type { Route } from "./+types/subcategory-index";

/**
 * One module behind every subcategory address.
 *
 * `app/routes.ts` declares a route per entry in `SUBCATEGORY_VIEWS` and points
 * every one of them at this file, so what varies between `/weapons` and
 * `/force-powers` is a row of a table rather than a copy of a page. See
 * `app/content/subcategory-views.ts` for why these are paths and not query
 * strings, and why the rows still link into the canonical type.
 */

/**
 * Which one is being rendered, read off the address.
 *
 * Every subcategory route shares this module, so there is no `:param` to carry the answer
 * and no route id available to a loader — the path itself is the only thing
 * that distinguishes the matches. The `.data` suffix is stripped because
 * React Router asks for a route's data at `/weapons.data` on a client
 * navigation, and that request runs this same loader.
 *
 * Anything this cannot resolve throws, which makes the build the test: a route
 * declared here with no entry in the registry fails the prerender by name
 * rather than shipping a page with no heading on it.
 */
function slugFromUrl(url: string): string {
  const { pathname } = new URL(url);
  return pathname.replace(/\.data$/, "").replace(/^\/+|\/+$/g, "");
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not found — Star Wars 5e" }];
  const view = requireSubcategoryView(loaderData.slug);
  return [
    { title: `${view.label} — Star Wars 5e` },
    {
      name: "description",
      content: `${loaderData.rows.length} ${view.counted} for Star Wars 5e. ${view.blurb}`,
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const slug = slugFromUrl(request.url);
  const view = getSubcategoryView(slug);
  if (!view) {
    throw new Response("Not Found", { status: 404 });
  }
  return {
    // The slug rather than the view: a predicate is not serializable, and the
    // component can look the rest up from the same registry the loader used.
    slug: view.slug,
    rows: selectSubcategoryRows(view, getSummaries(view.type) as AnySummary[]),
  };
}

/**
 * The same conversion `type-index.tsx` makes, for the same reason: only
 * prerendered paths have a data file beside them, so a client-side navigation
 * to an address that has none fails the fetch rather than answering 404, and
 * an unconverted failure reads as "an unexpected error occurred".
 *
 * Deliberately without a hydrate flag, which would make the build prerender
 * the hydration fallback instead of the page and empty every one of these of
 * the markup they exist to publish.
 */
export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  try {
    return await serverLoader();
  } catch {
    throw new Response("Not Found", { status: 404 });
  }
}

export default function SubcategoryIndex({ loaderData }: Route.ComponentProps) {
  const { slug, rows } = loaderData;
  const view = requireSubcategoryView(slug);
  const typeMeta = TYPE_META[view.type];
  const config = getListConfig(view.type);
  const group = groupOfType(view.type);

  return (
    <div className="page" data-accent={typeMeta.accent}>
      {/*
        The parent type is a crumb rather than a decoration. This page is a
        shelf inside a type, and `/equipment` is where a reader goes when the
        shelf was the wrong one — without that link the only route back to the
        other 290 items is the header menu.
      */}
      <Breadcrumbs
        trail={[
          { label: typeMeta.plural, to: `/${view.type}` },
          { label: view.label },
        ]}
      />
      <div className="page-head">
        {/*
          The navigation group, exactly as a type index says it — see the note
          in `type-index.tsx`. The icon is the source type's, which is the
          point: a weapons page is drawn in equipment's steel and carries
          equipment's mark, because it is not a new subject.
        */}
        <p className="page-eyebrow">
          <TypeIcon type={view.type} />
          {group ? NAV_GROUP_META[group].label : null}
        </p>
        <h1>{view.label}</h1>
        <p className="lede">{view.blurb}</p>
      </div>
      <ContentList
        type={view.type}
        typeLabel={view.label}
        // The row links, the accent and the empty state all follow `type`, so
        // the only thing this page has to correct is the noun after the
        // numeral: `TypeMeta.counted` would say "215 items" on a page of
        // weapons.
        countedNoun={view.counted}
        rows={rows}
        config={config}
      />
    </div>
  );
}
