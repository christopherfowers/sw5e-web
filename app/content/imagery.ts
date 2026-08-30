/**
 * Where the site's pictures are and what shape they are.
 *
 * `scripts/build-image-assets.mjs` writes every derived image into
 * `app/assets/<group>/<key>-<width>x<height>.webp`. The dimensions are in the
 * file name deliberately: this module parses them back out, so every `<img>`
 * the site renders can carry a real `width` and `height` and reserve its space
 * before a single byte of the picture arrives. Nothing here needs a manifest
 * file that could drift away from what is on disk.
 *
 * The globs are eager and resolve to URLs only, so what reaches the browser is
 * a table of fingerprinted paths, not the images themselves. Vite rewrites
 * each one to a content-hashed file that can be cached forever.
 */

const SPECIES_FILES = import.meta.glob("../assets/species/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const CLASS_FILES = import.meta.glob("../assets/classes/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const SOURCE_FILES = import.meta.glob("../assets/sources/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const BRAND_FILES = import.meta.glob("../assets/brand/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** One rendered size of one picture. */
export interface Variant {
  url: string;
  width: number;
  height: number;
}

/** Everything an `<img>` needs: a fallback `src`, a `srcSet`, and dimensions. */
export interface ImageSource {
  src: string;
  srcSet: string;
  width: number;
  height: number;
}

const NAME_PATTERN = /\/([^/]+)-(\d+)x(\d+)\.webp$/;

/** Groups the flat glob result by image key, widest variant last. */
function indexVariants(files: Record<string, string>): Map<string, Variant[]> {
  const byKey = new Map<string, Variant[]>();
  for (const [filePath, url] of Object.entries(files)) {
    const match = NAME_PATTERN.exec(filePath);
    if (!match) continue;
    const [, key, width, height] = match;
    const variant = { url, width: Number(width), height: Number(height) };
    const existing = byKey.get(key);
    if (existing) existing.push(variant);
    else byKey.set(key, [variant]);
  }
  for (const variants of byKey.values()) {
    variants.sort((left, right) => left.width - right.width);
  }
  return byKey;
}

const SPECIES = indexVariants(SPECIES_FILES);
const CLASSES = indexVariants(CLASS_FILES);
const SOURCES = indexVariants(SOURCE_FILES);
const BRAND = indexVariants(BRAND_FILES);

/**
 * Turns a set of variants into an `<img>`'s attributes.
 *
 * `maxWidth` caps which variants are offered. A 112px gallery thumbnail should
 * never be allowed to pull the 330px portrait just because a device has a
 * high pixel ratio, so the gallery passes a cap and the detail page does not.
 * The largest offered variant is the `src`, which is what a browser too old
 * for `srcset` gets, and its dimensions are what reserve the layout box — the
 * aspect ratio is identical across variants, so any of them would do.
 */
function toImageSource(
  variants: Variant[] | undefined,
  maxWidth?: number,
): ImageSource | null {
  if (!variants || variants.length === 0) return null;
  const offered =
    maxWidth === undefined
      ? variants
      : (variants.filter((variant) => variant.width <= maxWidth).length > 0
          ? variants.filter((variant) => variant.width <= maxWidth)
          : [variants[0]]);
  const largest = offered[offered.length - 1];
  return {
    src: largest.url,
    srcSet: offered.map((variant) => `${variant.url} ${variant.width}w`).join(", "),
    width: largest.width,
    height: largest.height,
  };
}

/** The widest thumbnail a species gallery tile is ever allowed to request. */
export const GALLERY_THUMB_MAX = 240;

export function speciesPortrait(slug: string): ImageSource | null {
  return toImageSource(SPECIES.get(slug));
}

export function speciesThumbnail(slug: string): ImageSource | null {
  return toImageSource(SPECIES.get(slug), GALLERY_THUMB_MAX);
}

export function hasSpeciesPortrait(slug: string): boolean {
  return SPECIES.has(slug);
}

/** How many species portraits this build actually carries. */
export function speciesPortraitCount(): number {
  return SPECIES.size;
}

/**
 * Class illustrations are keyed by the lowercased class name the archetype
 * dataset carries — "Guardian" resolves to `classes/guardian-*.webp`.
 */
export function classArt(className: string | null): ImageSource | null {
  if (!className) return null;
  return toImageSource(CLASSES.get(className.toLowerCase()));
}

/** A book cover, keyed by the source abbreviation the dataset uses. */
export function sourceCover(code: string | null): ImageSource | null {
  if (!code) return null;
  return toImageSource(SOURCES.get(code.toLowerCase()));
}

export function brandImage(key: string, maxWidth?: number): ImageSource | null {
  return toImageSource(BRAND.get(key), maxWidth);
}
