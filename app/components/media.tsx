/**
 * Pictures, and what to draw when there is no picture.
 *
 * Two rules hold everywhere in here.
 *
 * An `<img>` is only ever emitted for an asset this build actually contains —
 * `app/content/imagery.ts` returns `null` rather than a guessed path — so a
 * missing file cannot produce a broken-image icon. Every `<img>` also carries
 * its real `width` and `height`, so the box is reserved before the bytes
 * arrive and nothing below it jumps.
 *
 * And an absence is drawn, not left blank. 133 of the 141 species have a
 * portrait in the archive; the other eight get a monogram plate of the same
 * proportions, so a gallery stays on its grid and a detail page keeps its
 * shape. The plate is decorative and hidden from assistive technology — the
 * species' name is already the page's heading, and a screen reader gaining
 * "W" from a picture of nothing is noise.
 */

import type { ImageSource } from "~/content/imagery";

interface AssetImageProps {
  image: ImageSource;
  /** Describes the subject. Never "image" — see the callers. */
  alt: string;
  /** Layout width hint for the browser's `srcset` choice. */
  sizes: string;
  className?: string;
  /** Above-the-fold pictures pass "eager"; everything else stays lazy. */
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "low" | "auto";
}

export function AssetImage({
  image,
  alt,
  sizes,
  className,
  loading = "lazy",
  fetchPriority,
}: AssetImageProps) {
  return (
    <img
      className={className}
      src={image.src}
      srcSet={image.srcSet}
      sizes={sizes}
      width={image.width}
      height={image.height}
      alt={alt}
      loading={loading}
      decoding="async"
      fetchPriority={fetchPriority}
    />
  );
}

/**
 * Eight hues, chosen from the name so that a species without a portrait still
 * looks like itself in a list rather than like every other gap.
 */
const PLATE_HUES = 8;

function plateHue(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 100003;
  }
  return hash % PLATE_HUES;
}

/** The first letter of each of the first two words, e.g. "Kel Dor" -> "KD". */
function monogram(name: string): string {
  const letters = name
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

/**
 * The stand-in for a picture that does not exist. Same box, same rhythm, no
 * broken icon, and no announcement to a screen reader.
 */
export function MonogramPlate({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={["monogram-plate", className].filter(Boolean).join(" ")}
      data-plate-hue={plateHue(name)}
    >
      <span className="monogram-plate-mark">{monogram(name)}</span>
    </span>
  );
}
