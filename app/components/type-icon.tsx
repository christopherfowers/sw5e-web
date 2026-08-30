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
  archetypes: (
    <>
      <path d="M12 20.5v-6" />
      <path d="M12 14.5 6.75 9.25" />
      <path d="m12 14.5 5.25-5.25" />
      <circle cx="5.25" cy="7.75" r="2.25" />
      <circle cx="18.75" cy="7.75" r="2.25" />
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
  equipment: (
    <>
      <rect x="3.25" y="7.5" width="17.5" height="12.25" rx="1.75" />
      <path d="M3.25 11.75h17.5" />
      <path d="M8.5 7.5V4.25h7V7.5" />
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
