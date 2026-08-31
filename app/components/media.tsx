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

import { Link } from "react-router";

import type { ImageSource } from "~/content/imagery";
import type { AssetCredit } from "~/content/types";

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

/**
 * A link supplied by content, reduced to one this site is willing to render.
 *
 * The `link` on a credit is authored data: it comes from the content set, and
 * once there is an authoring UI it will come from whatever a contributor typed
 * into a form. The schema asks for a URI, and `javascript:alert(1)` is a
 * perfectly valid URI — so validating the shape of the string is not the same
 * as deciding it is safe to put in an `href`. Everything except http and https
 * is dropped, which turns a hostile link into a plain name rather than into
 * script running on this origin.
 *
 * This is here now, before the write path exists, because the moment it exists
 * this becomes reachable by anyone with a Contributor role.
 */
export function safeExternalHref(link: string | null): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    // Not an absolute URL at all. Relative links are not what this field is
    // for, and resolving one against the current page would be a surprise.
    return null;
  }
}

/**
 * The credit for one picture, shown with the picture rather than only in a
 * list somewhere else.
 *
 * An artist is owed credit for the specific work of theirs on this page. A
 * bulk roll of every artist who ever contributed does not do that: it tells a
 * reader that one of fifty-seven people drew this, which is not an
 * attribution.
 *
 * The unattributed case is drawn, not hidden. Every picture inherited from the
 * original site is in it — that site credited its artists as one alphabetical
 * list and never recorded which of them made which image — and saying so
 * plainly is the honest answer and the useful one: a reader who recognises
 * their own work can come forward, which is exactly how this gets fixed.
 * Guessing would foreclose that and misattribute somebody at the same time.
 */
export function ImageCredit({ credit }: { credit: AssetCredit | null }) {
  if (!credit) return null;

  if (credit.status === "cited") {
    const attribution = credit.artist ?? "an unnamed artist";
    const href = safeExternalHref(credit.link);
    return (
      <p className="image-credit">
        <span className="image-credit-label">Art by</span>{" "}
        {href ? (
          <a href={href} rel="noopener noreferrer">
            {attribution}
          </a>
        ) : (
          attribution
        )}
        {credit.workTitle ? <span className="image-credit-work"> — {credit.workTitle}</span> : null}
      </p>
    );
  }

  return (
    <p className="image-credit is-unattributed">
      <span className="image-credit-label">Artist not recorded.</span>{" "}
      Inherited from the original site's artwork, which was credited as a whole
      rather than image by image. <Link to="/credits#art-asset">See the artists</Link>.
    </p>
  );
}
