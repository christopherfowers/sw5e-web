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

  test("the header offers every one of them", async ({ page }) => {
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "Content types" });

    for (const { segment, heading } of STARSHIP_TYPES) {
      await expect(nav.getByRole("link", { name: heading })).toHaveAttribute(
        "href",
        `/${segment}`,
      );
    }
  });

  test("the navigation strip stays reachable now that it overflows", async ({
    page,
  }) => {
    // Fourteen destinations no longer fit any viewport, so the strip scrolls
    // and the fade at its right edge is the only thing that says so. It used
    // to be dropped above 64rem, back when eight destinations fitted there.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    const overflow = await page
      .locator(".site-nav")
      .evaluate((nav) => ({
        scrolls: nav.scrollWidth > nav.clientWidth,
        faded: getComputedStyle(nav).maskImage !== "none",
      }));

    expect(overflow.scrolls).toBe(true);
    expect(
      overflow.faded,
      "a strip that scrolls with no fade gives a reader no sign there is more of it",
    ).toBe(true);

    // And the last link is still reachable and still clear of the fade once
    // the strip is scrolled to its end.
    const last = page
      .getByRole("navigation", { name: "Content types" })
      .getByRole("link", { name: "Starship rules" });

    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
  });
});
