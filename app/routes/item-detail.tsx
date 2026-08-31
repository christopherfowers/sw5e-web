import { ItemDetail } from "~/components/item-detail";
import { Breadcrumbs, Pager } from "~/components/site-chrome";
import { assetCredit } from "~/content/credits.server";
import { getItem, getNeighbours } from "~/content/dataset.server";
import { TYPE_META } from "~/content/type-meta";
import { isContentTypeId } from "~/content/types";
import type { Route } from "./+types/item-detail";

/** A plain-text summary for search engines, drawn from whatever the item has. */
function describe(item: { tagline: string | null; sections: { body: string }[] }) {
  const prose = item.sections[0]?.body ?? "";
  const plain = prose
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>|`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const summary = [item.tagline, plain].filter(Boolean).join(". ");
  return summary.length > 300 ? `${summary.slice(0, 297).trimEnd()}…` : summary;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not found — Star Wars 5e" }];
  const label = TYPE_META[loaderData.type].singular;
  return [
    { title: `${loaderData.item.name} — ${label} — Star Wars 5e` },
    { name: "description", content: describe(loaderData.item) },
  ];
}

export async function loader({ params }: Route.LoaderArgs) {
  const type = params.type;
  if (!isContentTypeId(type)) throw new Response("Not Found", { status: 404 });

  const item = getItem(type, params.slug);
  if (!item) throw new Response("Not Found", { status: 404 });

  const { previous, next } = getNeighbours(type, params.slug);

  /*
   * The citation for this page's picture, resolved here because the credits
   * document is build-time data and only this one entry of it should end up
   * in the page. Species are keyed by slug and archetypes by the class their
   * illustration belongs to, matching how `imagery.ts` resolves the files
   * themselves — so an item with no picture asks for no citation.
   */
  const className = item.summary.className;
  const artCredit =
    type === "species"
      ? assetCredit("species", params.slug)
      : type === "archetypes" && typeof className === "string"
        ? assetCredit("classes", className.toLowerCase())
        : null;

  return {
    type,
    item,
    artCredit,
    previous: previous ? { slug: previous.slug, name: previous.name } : null,
    next: next ? { slug: next.slug, name: next.name } : null,
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

export default function ItemDetailRoute({ loaderData }: Route.ComponentProps) {
  const { type, item, artCredit, previous, next } = loaderData;
  const meta = TYPE_META[type];

  return (
    <div className="page" data-accent={meta.accent}>
      <Breadcrumbs
        trail={[
          { label: meta.plural, to: `/${type}` },
          { label: item.name },
        ]}
      />
      <ItemDetail item={item} artCredit={artCredit} />
      <Pager
        type={type}
        typeLabel={meta.plural}
        previous={previous}
        next={next}
      />
    </div>
  );
}
