/**
 * A small line mark for each content type.
 *
 * These are inline SVG rather than an icon font or a sprite file for three
 * reasons: nothing extra is fetched, `currentColor` lets each mark inherit its
 * type's accent in either theme without a second asset, and there is no
 * third-party origin involved. They are decorative — every one of them sits
 * beside the type's name in text — so each is `aria-hidden` and adds nothing
 * for a screen reader to read twice.
 */

import type { ContentTypeId } from "~/content/types";

const PATHS: Record<ContentTypeId, React.ReactNode> = {
  species: (
    <>
      <circle cx="12" cy="7.5" r="3.75" />
      <path d="M4.75 20.5c0-3.5 3.25-6 7.25-6s7.25 2.5 7.25 6" />
    </>
  ),
  // A level table: three rungs, each longer than the last.
  classes: (
    <>
      <path d="M4.75 18.5h6" />
      <path d="M4.75 12h9.5" />
      <path d="M4.75 5.5h14.5" />
    </>
  ),
  // Two paths converging into one, which is what multiclassing is.
  "class-improvements": (
    <>
      <path d="M4.75 4.75c0 5 3.5 7.25 7.25 7.25" />
      <path d="M4.75 19.25c0-5 3.5-7.25 7.25-7.25" />
      <path d="M12 12h7.25" />
      <path d="m16.25 8.75 3.25 3.25-3.25 3.25" />
    </>
  ),
  archetypes: (
    <>
      <path d="M12 20.5v-6" />
      <path d="M12 14.5 6.75 9.25" />
      <path d="m12 14.5 5.25-5.25" />
      <circle cx="5.25" cy="7.75" r="2.25" />
      <circle cx="18.75" cy="7.75" r="2.25" />
    </>
  ),
  // A ribbon: one thing awarded, at one level.
  features: (
    <>
      <circle cx="12" cy="8.75" r="4.75" />
      <path d="m8.75 12.75-2 7.75L12 18l5.25 2.5-2-7.75" />
    </>
  ),
  backgrounds: (
    <>
      <path d="M12 7.25C10.4 6 8.4 5.25 5.75 5.25H3.5v12.5h2.25c2.65 0 4.65.75 6.25 2 1.6-1.25 3.6-2 6.25-2h2.25V5.25h-2.25c-2.65 0-4.65.75-6.25 2Z" />
      <path d="M12 7.25v12.5" />
    </>
  ),
  feats: (
    <path d="m12 3.25 2.45 5.7 6.18.52-4.69 4.05 1.4 6.03L12 16.4l-5.34 3.15 1.4-6.03-4.69-4.05 6.18-.52Z" />
  ),
  powers: (
    <>
      <circle cx="12" cy="12" r="2.75" />
      <path d="M12 3.25v2.5M12 18.25v2.5M3.25 12h2.5M18.25 12h2.5" />
      <path d="m5.9 5.9 1.75 1.75M16.35 16.35l1.75 1.75M18.1 5.9l-1.75 1.75M7.65 16.35 5.9 18.1" />
    </>
  ),
  maneuvers: (
    <>
      <path d="M4.5 19.5 16.25 7.75" />
      <path d="M19.5 19.5 7.75 7.75" />
      <path d="m14.5 6 3.5 3.5" />
      <path d="M9.5 6 6 9.5" />
    </>
  ),
  // The five marks below sit next to the crossed blades of `maneuvers` in the
  // navigation, so each has to be legible against the others at 1em and not
  // just against the rest of the set. Styles and masteries take one chevron
  // and three, which is the relationship between them; focuses and
  // supremacies take a target and a target already struck.
  "fighting-styles": (
    <>
      <path d="M4.75 14.25 12 7.5l7.25 6.75" />
      <path d="M4.75 19.25h14.5" />
    </>
  ),
  "fighting-masteries": (
    <>
      <path d="M4.75 9.5 12 4.25l7.25 5.25" />
      <path d="M4.75 14.5 12 9.25l7.25 5.25" />
      <path d="M4.75 19.5 12 14.25l7.25 5.25" />
    </>
  ),
  "lightsaber-forms": (
    <>
      <rect x="10.25" y="15" width="3.5" height="5.5" rx="1.25" />
      <path d="M10.25 17.5h3.5" />
      <path d="M12 15V3.5" />
    </>
  ),
  "weapon-focuses": (
    <>
      <circle cx="12" cy="12" r="5.75" />
      <circle cx="12" cy="12" r="1.25" />
      <path d="M12 3.5v2.5M12 18v2.5M3.5 12H6M18 12h2.5" />
    </>
  ),
  "weapon-supremacies": (
    <>
      <circle cx="10.5" cy="13.5" r="5.75" />
      <circle cx="10.5" cy="13.5" r="1.25" />
      <path d="m14.75 9.25 4.75-4.75" />
      <path d="M17.25 4.5h2.25v2.25" />
    </>
  ),
  equipment: (
    <>
      <rect x="3.25" y="7.5" width="17.5" height="12.25" rx="1.75" />
      <path d="M3.25 11.75h17.5" />
      <path d="M8.5 7.5V4.25h7V7.5" />
    </>
  ),
  // A cased gem: enhanced gear is what a party finds rather than buys, so the
  // mark is a stone in a setting rather than another crate.
  "enhanced-items": (
    <>
      <path d="M8.25 4.75h7.5l4 5.25L12 20 4.25 10Z" />
      <path d="M4.25 10h15.5" />
      <path d="m8.25 4.75 1.75 5.25L12 20" />
      <path d="m15.75 4.75-1.75 5.25L12 20" />
    </>
  ),
  // The two glossaries share a mark with a tag on it, because both are a label
  // clipped to something else rather than a thing in their own right. The
  // weapon one is the blade, the armour one the plate.
  "weapon-properties": (
    <>
      <path d="M6.75 17.25 17 7" />
      <path d="M14.5 4.75h4.75V9.5" />
      <path d="M4.5 19.5h3.25v-3.25" />
      <circle cx="9.25" cy="9.25" r="1.6" />
    </>
  ),
  "armor-properties": (
    <>
      <path d="M12 3.75 5.25 6v6.25c0 4 2.9 6.6 6.75 8 3.85-1.4 6.75-4 6.75-8V6Z" />
      <circle cx="12" cy="10.75" r="1.6" />
    </>
  ),
  monsters: (
    <>
      <circle cx="6.5" cy="10.25" r="1.9" />
      <circle cx="10.75" cy="6.75" r="1.9" />
      <circle cx="15.25" cy="6.75" r="1.9" />
      <circle cx="18.5" cy="10.75" r="1.9" />
      <path d="M12.5 12.5c-3.1 0-5.6 2.2-5.6 4.7 0 1.8 1.4 3.05 3.2 3.05.95 0 1.55-.4 2.4-.4s1.45.4 2.4.4c1.8 0 3.2-1.25 3.2-3.05 0-2.5-2.5-4.7-5.6-4.7Z" />
    </>
  ),
  // A hull seen from above, with its two wings: the shape that distinguishes
  // one ship size from another at a glance.
  "starship-base-sizes": (
    <>
      <path d="M12 3.5c1.9 2.2 2.9 5 2.9 8.5s-1 6.3-2.9 8.5c-1.9-2.2-2.9-5-2.9-8.5s1-6.3 2.9-8.5Z" />
      <path d="M9.1 10.25 3.5 14v3.25l5.6-2.5" />
      <path d="M14.9 10.25 20.5 14v3.25l-5.6-2.5" />
    </>
  ),
  // A crew station: a seat at a console.
  "starship-deployments": (
    <>
      <rect x="3.5" y="4.25" width="17" height="9" rx="1.5" />
      <path d="M7.25 7.5h9.5M7.25 10.25h5.5" />
      <path d="M8 16.5v3.25M16 16.5v3.25M6 16.5h12" />
    </>
  ),
  // A weapon mount on a hull plate.
  "starship-equipment": (
    <>
      <path d="M3.5 14.25h17" />
      <path d="M6.75 14.25v-3a2.5 2.5 0 0 1 2.5-2.5h5.5a2.5 2.5 0 0 1 2.5 2.5v3" />
      <path d="M12 8.75V3.5" />
      <path d="M5 17.5h14" />
    </>
  ),
  // A part being bolted on: the whole idea of a modification.
  "starship-modifications": (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" />
      <path d="m6.4 6.4 2.1 2.1M15.5 15.5l2.1 2.1M17.6 6.4l-2.1 2.1M8.5 15.5l-2.1 2.1" />
    </>
  ),
  // A chevron rank mark: ventures arrive one per rank.
  "starship-ventures": (
    <>
      <path d="m5 10 7-5 7 5" />
      <path d="m5 14.5 7-5 7 5" />
      <path d="m5 19 7-5 7 5" />
    </>
  ),
  // A rulebook, closed: the chapters rather than the items in them.
  "starship-rules": (
    <>
      <path d="M5.5 3.75h11a2 2 0 0 1 2 2v14.5H7.5a2 2 0 0 1-2-2Z" />
      <path d="M5.5 17.25h13" />
      <path d="M9 7.75h6M9 11h4" />
    </>
  ),
  // An open book. The rules type is the only one whose pages are the content.
  rules: (
    <>
      <path d="M12 7.5C10.4 6.25 8.5 5.5 5.75 5.5H3.75v12h2c2.75 0 4.65.75 6.25 2 1.6-1.25 3.5-2 6.25-2h2v-12h-2c-2.75 0-4.65.75-6.25 2Z" />
      <path d="M12 7.5v12" />
      <path d="M6 9.25h3M6 12.25h3M15 9.25h3M15 12.25h3" />
    </>
  ),
  // A grid: a reference table is a grid and nothing else.
  "reference-tables": (
    <>
      <rect x="3.75" y="4.75" width="16.5" height="14.5" rx="1.5" />
      <path d="M3.75 9.25h16.5" />
      <path d="M3.75 14.25h16.5" />
      <path d="M9.75 9.25v10" />
    </>
  ),
};

export function TypeIcon({
  type,
  className,
}: {
  type: ContentTypeId;
  className?: string;
}) {
  return (
    <svg
      className={["type-icon", className].filter(Boolean).join(" ")}
      viewBox="0 0 24 24"
      /*
        Attribute dimensions as well as the `.type-icon` rule in app.css, and
        they are not redundant. An inline `<svg>` that carries only a `viewBox`
        has no intrinsic size, so until the stylesheet has arrived and applied,
        the browser lays it out at the CSS default for a replaced element with
        no dimensions — 300x150, or the full width of its container. Every one
        of these marks sits in the header and beside a heading, so the first
        paint of a page whose main thread is busy is a screenful of enormous
        line art. `width`/`height` give it an intrinsic size in the markup
        itself; the stylesheet still overrides both the moment it lands.
      */
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[type]}
    </svg>
  );
}
