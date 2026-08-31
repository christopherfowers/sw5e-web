import { expect, test } from "@playwright/test";

/**
 * Starship play is half of SW5e and the site published none of it. These tests
 * are about the wiring rather than the data: the committed fixture is built
 * from the legacy archive and carries no starships, so what is asserted here is
 * that all six types exist as real, pre-rendered destinations the moment the
 * canonical content reaches them.
 *
 * That is worth guarding because the failure is silent. A type declared in
 * `app/content/types.ts` but missed in `react-router.config.ts` still appears
 * in the header, still type-checks, and still builds — and then answers every
 * one of its links with the SPA fallback, which nginx serves as a 404 with
 * markup that looks fine in a browser. The row counts themselves are compared
 * against the published content image in the container job, which is the only
 * place that has the content to compare against.
 */
const STARSHIP_TYPES = [
  { segment: "starship-base-sizes", heading: "Starship hulls" },
  { segment: "starship-deployments", heading: "Deployments" },
  { segment: "starship-equipment", heading: "Ship equipment" },
  { segment: "starship-modifications", heading: "Modifications" },
  { segment: "starship-ventures", heading: "Ventures" },
  { segment: "starship-rules", heading: "Starship rules" },
];

test.describe("starship types", () => {
  for (const { segment, heading } of STARSHIP_TYPES) {
    test(`/${segment} is pre-rendered with its own markup`, async ({ request }) => {
      const response = await request.get(`/${segment}`);
      expect(response.ok(), `/${segment} must be a published route`).toBe(true);

      const html = await response.text();

      expect(
        html,
        `an empty shell here means /${segment} is reaching the SPA fallback ` +
          "rather than a page of its own",
      ).toMatch(new RegExp(`<h1[^>]*>${heading}</h1>`));

      expect(html).not.toContain("Not found — Star Wars 5e");
    });
  }

  test("the header offers every one of them, one menu deep", async ({ page }) => {
    await page.goto("/");

    // All six live under one group now. The strip used to carry every content
    // type at its top level, which is what made it unscannable.
    await page.locator('details[data-group="starships"] > summary').click();

    const menu = page.locator('details[data-group="starships"]');

    for (const { segment, heading } of STARSHIP_TYPES) {
      await expect(menu.getByRole("link", { name: heading })).toHaveAttribute(
        "href",
        `/${segment}`,
      );
    }
  });

  test("the header no longer overflows now that the types are grouped", async ({
    page,
  }) => {
    // This assertion used to be its own inverse: twenty-three destinations did
    // not fit any viewport, so the strip scrolled sideways and needed a fade at
    // its edge to say so. Grouping is what removed the overflow, and a strip
    // that starts scrolling again means a group has been dissolved back into
    // its types.
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");

      const overflows = await page
        .locator(".site-nav")
        .evaluate((nav) => nav.scrollWidth > nav.clientWidth + 1);

      expect(overflows, `the header scrolls sideways at ${width}px`).toBe(false);
    }
  });
});
