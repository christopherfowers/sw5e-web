/**
 * Small coloured marks that carry information rather than decoration.
 *
 * Every hue on this site means something and means the same thing everywhere:
 * a Force power is violet on its index row, on its own page and in a search
 * result. Colour is never the only signal — each badge also carries its own
 * words, so the meaning survives greyscale printing, a colour-vision
 * difference, and a screen reader.
 */

import { Link } from "react-router";

import { SOURCE_META } from "~/content/source-meta";
import type { Accent } from "~/content/type-meta";

export function Badge({
  accent,
  title,
  className,
  children,
}: {
  accent?: Accent | null;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={["badge", className].filter(Boolean).join(" ")}
      data-accent={accent ?? undefined}
      title={title}
    >
      {children}
    </span>
  );
}

/**
 * The book a row came from. On a detail page it links to that book; in a dense
 * table it does not, because 500 links to four destinations is noise for
 * anyone tabbing through.
 */
export function SourceBadge({
  code,
  linked = false,
}: {
  code: string | null;
  linked?: boolean;
}) {
  if (!code) return null;
  const meta = SOURCE_META[code];
  const label = meta?.name ?? code;

  if (linked && meta) {
    return (
      <Link
        className="badge badge-link"
        data-accent={meta.accent}
        to={`/sources/${meta.slug}`}
        /*
          The unlinked badge below has carried a `title` since it was written,
          and this one did not — so on a detail page, where the badge is a
          link, a reader who did not already know that EC means Expanded
          Content had no way to find out short of following it. The screen
          reader was told and the eye was not.
        */
        title={label}
      >
        <span aria-hidden="true">{code}</span>
        <span className="sr-only">{label}</span>
      </Link>
    );
  }

  return (
    <Badge accent={meta?.accent ?? "steel"} title={label}>
      <span aria-hidden="true">{code}</span>
      <span className="sr-only">{label}</span>
    </Badge>
  );
}

/** Force is violet, tech is cyan, everywhere the distinction is drawn. */
export function powerTypeAccent(powerType: string | null): Accent | null {
  if (powerType === "Force") return "violet";
  if (powerType === "Tech") return "cyan";
  return null;
}

/** Light side, dark side, or neither. */
export function alignmentAccent(alignment: string | null): Accent | null {
  if (alignment === "Light") return "cyan";
  if (alignment === "Dark") return "red";
  if (alignment === "Universal") return "steel";
  return null;
}

export function maneuverAccent(kind: string | null): Accent | null {
  if (kind === "Physical") return "amber";
  if (kind === "Mental") return "violet";
  if (kind === "General") return "steel";
  return null;
}

/**
 * Three bands of danger, so a creature list can be read at a glance: anything
 * a starting party can face, anything that needs a plan, anything that is a
 * campaign event.
 */
export function challengeAccent(value: number | null): Accent | null {
  if (value == null) return null;
  if (value < 5) return "green";
  if (value < 11) return "amber";
  return "red";
}
