import { describe, expect, it } from "vitest";

import {
  GALLERY_THUMB_MAX,
  brandImage,
  classArt,
  sourceCover,
  speciesPortrait,
  speciesPortraitCount,
  speciesThumbnail,
} from "./imagery";

/**
 * These assertions run against the real committed asset set, not a stub. That
 * is deliberate: the failure this file exists to catch is a file being renamed,
 * dropped, or emitted at a size the renderer cannot read, and a stub would be
 * blind to every one of those.
 */

function srcSetWidths(srcSet: string): number[] {
  return srcSet
    .split(", ")
    .map((candidate) => Number(candidate.split(" ")[1].replace("w", "")));
}

describe("the image set", () => {
  it("carries a portrait for the great majority of species", () => {
    // 134 of 141 species have art in the archive. A build that has lost the
    // asset directory would resolve zero and still render — silently going
    // back to the wall of text this work replaced.
    expect(speciesPortraitCount()).toBeGreaterThan(100);
  });

  it("resolves a known species to a picture with real dimensions", () => {
    const portrait = speciesPortrait("wookiee");

    expect(portrait).not.toBeNull();
    expect(portrait!.width).toBeGreaterThan(0);
    expect(portrait!.height).toBeGreaterThan(0);
    expect(portrait!.src).toMatch(/\.webp/);
  });

  /**
   * A guessed path would produce a broken-image icon on seven species pages.
   * Returning null is what lets every caller draw a fallback instead.
   */
  it("returns nothing at all for a species with no art", () => {
    expect(speciesPortrait("quermian")).toBeNull();
    expect(speciesThumbnail("quermian")).toBeNull();
    expect(speciesPortrait("not-a-species")).toBeNull();
  });

  it("resolves class art by class name, whatever its case", () => {
    expect(classArt("Guardian")).not.toBeNull();
    expect(classArt("guardian")).not.toBeNull();
    expect(classArt("Jedi Historian")).toBeNull();
    expect(classArt(null)).toBeNull();
  });

  it("resolves a book cover for every book that has one", () => {
    for (const code of ["PHB", "WH", "SnV"]) {
      expect(sourceCover(code), `${code} must have a cover`).not.toBeNull();
    }
    // Expanded Content is community material with no cover anywhere in the
    // archive; the sources page draws it a plate instead.
    expect(sourceCover("EC")).toBeNull();
  });

  it("resolves the site's own logo and both hero treatments", () => {
    expect(brandImage("logo")).not.toBeNull();
    expect(brandImage("hero-light")).not.toBeNull();
    expect(brandImage("hero-dark")).not.toBeNull();
  });
});

describe("what a srcset offers", () => {
  it("lists its widths smallest first, with the widest as the fallback src", () => {
    for (const slug of ["aleena", "wookiee", "abyssin"]) {
      const portrait = speciesPortrait(slug)!;
      const widths = srcSetWidths(portrait.srcSet);

      expect([...widths].sort((left, right) => left - right), slug).toEqual(widths);
      expect(Math.max(...widths), slug).toBe(portrait.width);
    }
  });

  /**
   * The archive's art is small and uneven — portraits run from 112 pixels wide
   * to over 360 — so sizes are derived from each source rather than taken off
   * a fixed ladder. A wide source has room for a candidate a low-density
   * screen can use.
   */
  it("gives a wide portrait a smaller candidate a low-density screen can take", () => {
    const widths = srcSetWidths(speciesPortrait("aleena")!.srcSet);

    expect(widths.length).toBeGreaterThan(1);
    expect(Math.min(...widths)).toBeLessThan(Math.max(...widths) / 1.5);
  });

  /**
   * A narrow source has no such room, because the detail figure is displayed
   * at around 224 CSS pixels. A 98-pixel copy of a 171-pixel portrait is a
   * file no browser would ever choose and one this repository would carry
   * forever.
   */
  it("gives a narrow portrait one file rather than an unusable copy", () => {
    const widths = srcSetWidths(speciesPortrait("abyssin")!.srcSet);

    expect(widths).toHaveLength(1);
    expect(widths[0]).toBeLessThan(224);
  });

  /**
   * Thumbnails are the opposite case: they are shown at about 190 pixels, so
   * nearly every source is wide enough to be worth offering twice — and 141 of
   * them are on one page, which is where halving a candidate actually pays.
   */
  it("gives a gallery thumbnail two candidates wherever the source allows", () => {
    const single = ["aleena", "wookiee", "abyssin"].filter(
      (slug) => srcSetWidths(speciesThumbnail(slug)!.srcSet).length < 2,
    );

    expect(single).toEqual([]);
  });

  /**
   * Thumbnails and portraits are separate sets in separate directories, which
   * is what makes it structurally impossible for the species index to reach
   * for a full-size portrait — 141 of them at once is how that page would
   * become several megabytes.
   */
  it("never offers a gallery thumbnail wider than the gallery needs", () => {
    // Aleena's portrait is 310 pixels wide, comfortably past the gallery
    // ceiling, so this is a species where the separation has to do something.
    const thumbnail = speciesThumbnail("aleena")!;

    expect(Math.max(...srcSetWidths(thumbnail.srcSet))).toBeLessThanOrEqual(
      GALLERY_THUMB_MAX,
    );
    expect(thumbnail.width).toBeLessThan(speciesPortrait("aleena")!.width);
  });
});
