import { Link } from "react-router";

import { Breadcrumbs } from "~/components/site-chrome";
import { TypeIcon } from "~/components/type-icon";
import { getManifest } from "~/content/dataset.server";
import {
  CUSTOMIZATION_OPTION_TYPES,
  NAV_GROUP_META,
} from "~/content/nav-groups";
import { TYPE_META } from "~/content/type-meta";
import type { Route } from "./+types/customization-options";

/**
 * The chapter, as a page.
 *
 * Feats, fighting styles, fighting masteries, lightsaber forms, the two weapon
 * tiers and the class improvements were seven cards in a grid of twenty-seven,
 * and seven boxes is seven answers to a question a reader asks once: what else
 * can my character take? The Player's Handbook introduces all of them together
 * under one chapter heading, so the header offers one entry — and this is what
 * is behind it.
 *
 * It is a hub and nothing more: seven links and a sentence each. There is
 * deliberately no merged list of the 219 options themselves. They are chosen
 * from seven separate lists granted by seven different features, an entry on
 * one is never a substitute for an entry on another, and a combined table would
 * need a "kind" column whose only job would be to undo the merge. The types
 * keep their own indexes, their own columns and their own filters; this page
 * exists so that a reader can find out the seven exist.
 *
 * The list of types comes from `CUSTOMIZATION_OPTION_TYPES` rather than being
 * written here, because the menu entry that leads here claims to cover exactly
 * those types and the reachability check in `nav-groups.test.ts` believes the
 * claim. Reading the same array is what makes the claim true rather than
 * asserted; `customization-options.test.tsx` holds the rendering to it.
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
        "focuses, weapon supremacies and class improvements.",
    },
  ];
}

export async function loader() {
  const manifest = getManifest();
  const byType = new Map(manifest.types.map((type) => [type.id, type.count]));

  const options = CUSTOMIZATION_OPTION_TYPES.map((type) => ({
    type,
    count: byType.get(type) ?? 0,
  }));

  return {
    options,
    total: options.reduce((sum, option) => sum + option.count, 0),
  };
}

export default function CustomizationOptions({
  loaderData,
}: Route.ComponentProps) {
  const { options, total } = loaderData;

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
        {options.map(({ type, count }) => (
          <li key={type}>
            <Link
              to={`/${type}`}
              className="type-card"
              data-accent={TYPE_META[type].accent}
            >
              <TypeIcon type={type} />
              <span className="type-card-name">{TYPE_META[type].plural}</span>
              <span className="type-card-count">
                {count.toLocaleString("en-US")}
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
