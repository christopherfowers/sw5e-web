import { expect, test } from "@playwright/test";

/**
 * The site's pictures, checked the way a reader meets them.
 *
 * Three things about imagery are invisible from the rendered page and so are
 * asserted here instead: that the pictures are in the pre-rendered HTML rather
 * than painted after hydration, that every one of them reserves its own space
 * before it loads, and that a gallery of 141 portraits does not quietly become
 * a multi-megabyte page.
 *
 * Every path used here exists in both datasets — the committed fixture CI
 * builds from and the full archive-derived set a maintainer builds locally.
 */

/** A gallery thumbnail that costs more than this is not a thumbnail. */
const THUMBNAIL_BUDGET = 40 * 1024;

/** The whole species index, first load, before any scrolling. */
const SPECIES_INDEX_BUDGET = 1024 * 1024;

/** The widest variant the gallery is allowed to ask for. */
const GALLERY_THUMB_MAX = 240;

test.describe("pictures in the pre-rendered HTML", () => {
  test("a species page ships its portrait in the served document", async ({
    request,
  }) => {
    const html = await (await request.get("/species/abyssin")).text();

    expect(
      html,
      "the portrait must be in the pre-rendered markup; an <img> that only " +
        "appears after hydration is invisible to a crawler and to a reader " +
        "whose JavaScript has not arrived yet",
    ).toMatch(/<img[^>]+alt="Illustration of the Abyssin species"/);
    expect(html).toMatch(/<img[^>]+srcset="[^"]+\d+w/);
    expect(html).toMatch(/<img[^>]+width="\d+"[^>]*height="\d+"/);
  });

  test("the species index ships its thumbnails in the served document", async ({
    request,
  }) => {
    const html = await (await request.get("/species")).text();

    expect(html).toMatch(/<img[^>]+alt="Illustration of the Abyssin species"/);
  });

  test("the home page ships its branding and hero in the served document", async ({
    request,
  }) => {
    const html = await (await request.get("/")).text();

    // Two <picture> sources, one per theme, plus the logo.
    expect(html).toMatch(/<source[^>]+prefers-color-scheme: dark/);
    expect(html).toMatch(/class="home-hero-logo"/);
    expect(html).toMatch(/class="home-hero-media"/);
  });

  test("a source page ships its cover art", async ({ request }) => {
    const html = await (await request.get("/sources/phb")).text();

    expect(html).toMatch(/<img[^>]+alt="Cover of Player's Handbook"/);
  });
});

test.describe("what a species index actually costs", () => {
  test("no picture on the page is missing its dimensions", async ({ page }) => {
    await page.goto("/species");

    const missing = await page.$$eval("img", (images) =>
      images
        .filter((image) => !image.getAttribute("width") || !image.getAttribute("height"))
        .map((image) => image.getAttribute("src") ?? "(no src)"),
    );

    expect(
      missing,
      "an image without width and height reflows the page under the reader " +
        "when it finally loads",
    ).toEqual([]);
  });

  test("every portrait says what it is a picture of", async ({ page }) => {
    await page.goto("/species");

    const alts = await page.$$eval(".gallery-tile-media", (images) =>
      images.map((image) => image.getAttribute("alt") ?? ""),
    );

    expect(alts.length).toBeGreaterThan(0);
    for (const alt of alts) {
      expect(alt).toMatch(/^Illustration of the .+ species$/);
    }
  });

  test("the gallery never asks for a full-size portrait", async ({ page }) => {
    const oversized: string[] = [];

    page.on("request", (request) => {
      // Built file names carry the pixel size and then Vite's content hash:
      // `aleena-224x332-B1fgoeht.webp`. The size is what matters here.
      const match = /-(\d+)x\d+(?:-[\w-]+)?\.webp/.exec(request.url());
      if (match && Number(match[1]) > GALLERY_THUMB_MAX) {
        oversized.push(request.url());
      }
    });

    await page.goto("/species", { waitUntil: "networkidle" });

    expect(
      oversized,
      "a species tile is about 112 CSS pixels wide; pulling the 300px " +
        "portrait for each of 141 of them is how this page becomes megabytes",
    ).toEqual([]);
  });

  test("the index stays inside its weight budget on first load", async ({
    page,
  }) => {
    let total = 0;
    let largestImage = 0;

    page.on("response", async (response) => {
      let body: Buffer;
      try {
        body = await response.body();
      } catch {
        // A response whose body the browser did not keep — a redirect, or one
        // served from the memory cache — contributes nothing to measure.
        return;
      }
      total += body.length;
      if ((response.headers()["content-type"] ?? "").startsWith("image/")) {
        largestImage = Math.max(largestImage, body.length);
      }
    });

    await page.goto("/species", { waitUntil: "networkidle" });

    // The per-thumbnail cap is the assertion that bites in every dataset: the
    // committed fixture has four species, so only this one would notice a
    // thumbnail regenerated at full quality.
    expect(largestImage).toBeLessThanOrEqual(THUMBNAIL_BUDGET);
    expect(total).toBeLessThanOrEqual(SPECIES_INDEX_BUDGET);
  });
});
