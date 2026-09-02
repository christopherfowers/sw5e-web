import { Link } from "react-router";

import { Breadcrumbs } from "~/components/site-chrome";
import { TypeIcon } from "~/components/type-icon";
import { getManifest, getSummaries } from "~/content/dataset.server";
import {
  CUSTOMIZATION_OPTION_DESTINATIONS,
  NAV_GROUP_META,
  faceOf,
} from "~/content/nav-groups";
import { selectSubcategoryRows } from "~/content/subcategory-views";
import type { AnySummary } from "~/content/types";
import type { Route } from "./+types/customization-options";

/**
 * The chapter, as a page.
 *
 * Feats, fighting styles, fighting masteries, lightsaber forms, the two weapon
 * tiers and the three kinds of class improvement were nine cards in a grid of
 * twenty-seven, and nine boxes is nine answers to a question a reader asks
 * once: what else can my character take? The Player's Handbook introduces all
 * of them together under one chapter heading, so the header offers one entry —
 * and this is what is behind it.
 *
 * It is a hub and nothing more: nine links and a sentence each. There is
 * deliberately no merged list of the 219 options themselves. They are chosen
 * from separate lists granted by different features, an entry on one is never a
 * substitute for an entry on another, and a combined table would need a "kind"
 * column whose only job would be to undo the merge. The lists keep their own
 * indexes, their own columns and their own filters; this page exists so that a
 * reader can find out they exist.
 *
 * Three of the nine are not content types. `class-improvements` is one type
 * holding three unrelated answers — what advancing in a class grants, what
 * multiclassing into it grants, what one splashed level is worth — told apart
 * by `improvementType`, and the site this one replaces published them as three
 * pages. So the cards lead to `/class-improvements`, `/multiclass-improvements`
 * and `/splashclass-improvements`, which are filtered views rather than type
 * indexes. See `app/content/subcategory-views.ts`.
 *
 * The list comes from `CUSTOMIZATION_OPTION_DESTINATIONS` rather than being
 * written here, because the menu entry that leads here derives its coverage
 * claims from exactly that array and the reachability check in
 * `nav-groups.test.ts` believes them. Reading the same array is what makes the
 * claim true rather than asserted; `customization-options.test.tsx` holds the
 * rendering to it.
 */
export function meta({ loaderData }: Route.MetaArgs) {
  const total = loaderData?.total;
  return [
    { title: "Customization options — Star Wars 5e" },
    {
      name: "description",
      content:
        (total ? `${total.toLocaleString("en-US")} options ` : "Everything ") +
        "a Star Wars 5e character can take on top of its class: feats, " +
        "fighting styles, fighting masteries, lightsaber forms, weapon " +
        "focuses, weapon supremacies, and the class, multiclass and " +
        "splashclass improvements.",
    },
  ];
}

/**
 * Counts only, keyed by address rather than by type.
 *
 * By address because three of the nine cards are not types: a slice has no
 * entry in the manifest and has to be counted by running its own predicate
 * over the rows, exactly as the front page counts `/weapons`. That happens
 * here, in a loader that only ever runs at build time, so the page ships the
 * number without shipping the predicate that produced it.
 *
 * Which cards the page shows is still not the loader's decision and is still
 * not carried in its payload: the component walks
 * `CUSTOMIZATION_OPTION_DESTINATIONS` itself.
 *
 * That is deliberate, and it is what makes the menu's coverage claim testable.
 * A loader that handed over a list of cards could hand over a short one, and
 * the page would render six cards, look entirely reasonable, and leave content
 * with nothing anywhere leading to it — while every test that fed the component
 * its own fixture stayed green.
 */
export async function loader() {
  const byType = new Map(
    getManifest().types.map((type) => [type.id, type.count]),
  );

  const counts = Object.fromEntries(
    CUSTOMIZATION_OPTION_DESTINATIONS.map((destination) => {
      const count =
        destination.kind === "view"
          ? selectSubcategoryRows(
              destination.view,
              getSummaries(destination.view.type) as AnySummary[],
            ).length
          : destination.kind === "type"
            ? (byType.get(destination.type) ?? 0)
            : 0;
      return [destination.to, count];
    }),
  ) as Record<string, number>;

  return {
    counts,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
}

export default function CustomizationOptions({
  loaderData,
}: Route.ComponentProps) {
  const { counts, total } = loaderData;

  return (
    <div className="page">
      <Breadcrumbs trail={[{ label: "Customization options" }]} />
      <div className="page-head">
        <p className="page-eyebrow">{NAV_GROUP_META.characters.label}</p>
        <h1>Customization options</h1>
        <p className="lede">
          {total.toLocaleString("en-US")} choices a character can take on top of
          its class. Each list is granted by a different feature, so an entry on
          one is never a substitute for an entry on another.
        </p>
      </div>

      <ul className="type-grid">
        {CUSTOMIZATION_OPTION_DESTINATIONS.map((destination) => {
          /*
            The card's face comes from `faceOf` rather than from `TYPE_META`,
            which is the only reason a slice can sit in this grid beside a type
            at all: a view carries its own label and blurb and wears its source
            type's mark and hue, so the three improvement cards read as three
            cards of one family without pretending to be three types.

            It also puts the six type cards into the sentence case the menus
            and the front page's grid already use — "Fighting styles" rather
            than `TYPE_META`'s "Fighting Styles". That is a change of copy on
            this page and it is the right way round: this grid is the same
            component the front page draws its destinations with, and the two
            were capitalising differently.
          */
          const face = faceOf(destination);
          return (
            <li key={face.to}>
              <Link
                to={face.to}
                className="type-card"
                data-accent={face.accent ?? undefined}
              >
                {face.icon ? <TypeIcon type={face.icon} /> : null}
                <span className="type-card-name">{face.label}</span>
                <span className="type-card-count">
                  {(counts[face.to] ?? 0).toLocaleString("en-US")}
                  <span className="sr-only"> entries</span>
                </span>
                <span className="type-card-blurb">{face.blurb}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
