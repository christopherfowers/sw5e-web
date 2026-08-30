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
describe("the image set", () => {
  it("carries a portrait for the great majority of species", () => {
    // 133 of 141 species have art in the archive. A build that has lost the
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
   * A guessed path would produce a broken-image icon on eight species pages.
   * Returning null is what lets every caller draw a fallback instead.
   */
  it("returns nothing at all for a species with no art", () => {
    expect(speciesPortrait("quermian")).toBeNull();
    expect(speciesThumbnail("quermian")).toBeNull();
    expect(speciesPortrait("not-a-species")).toBeNull();
  });

  it("offers every rendered width in the srcset, smallest first", () => {
    const portrait = speciesPortrait("wookiee")!;
    const widths = portrait.srcSet
      .split(", ")
      .map((candidate) => Number(candidate.split(" ")[1].replace("w", "")));

    expect(widths.length).toBeGreaterThan(1);
    expect([...widths].sort((a, b) => a - b)).toEqual(widths);
    expect(Math.max(...widths)).toBe(portrait.width);
  });

  /**
   * The species index shows 141 thumbnails. If a high-density screen were
   * allowed to pull the full-size portrait for each one, that page would cost
   * several megabytes instead of a few hundred kilobytes.
   */
  it("never offers a gallery thumbnail wider than the gallery needs", () => {
    // Aleena's portrait is 310px wide, comfortably past the gallery cap, so
    // this is a species where capping actually has to do something.
    const thumbnail = speciesThumbnail("aleena")!;
    const widths = thumbnail.srcSet
      .split(", ")
      .map((candidate) => Number(candidate.split(" ")[1].replace("w", "")));

    expect(Math.max(...widths)).toBeLessThanOrEqual(GALLERY_THUMB_MAX);
    expect(thumbnail.width).toBeLessThan(speciesPortrait("aleena")!.width);
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
