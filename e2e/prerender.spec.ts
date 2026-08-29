import { expect, test } from "@playwright/test";

/**
 * Prerendering is the architectural justification for this frontend: content
 * pages are static HTML so search engines see fully rendered markup without
 * executing JavaScript.
 *
 * The existing smoke tests cannot protect it. They run with JavaScript
 * enabled, so hydration paints the heading whether or not the server sent any
 * markup — setting `prerender()` to `[]` leaves them green. These tests look
 * at what the server actually sends.
 */
test.describe("prerendered HTML", () => {
  test("the served document contains the rendered heading, not an empty root", async ({
    request,
  }) => {
    // A raw HTTP GET: no browser, no hydration, exactly what a crawler that
    // does not execute JavaScript receives.
    const response = await request.get("/");

    expect(response.ok()).toBe(true);

    const html = await response.text();

    expect(
      html,
      "the server must send prerendered markup; an empty SPA shell here means " +
        "prerendering has stopped running and content pages are invisible to " +
        "crawlers that do not execute JavaScript",
    ).toContain("Star Wars 5e");
    expect(html).toMatch(/<h1[^>]*>Star Wars 5e<\/h1>/);
  });

  test("the served document contains the descriptive title and meta description", async ({
    request,
  }) => {
    const response = await request.get("/");
    const html = await response.text();

    expect(html).toMatch(/<title>[^<]*Star Wars 5e[^<]*<\/title>/);
    expect(html).toMatch(/<meta[^>]+name="description"/);
  });

  test.describe("with JavaScript disabled", () => {
    test.use({ javaScriptEnabled: false });

    test("the home page still renders its heading", async ({ page }) => {
      await page.goto("/");

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Star Wars 5e",
      );
    });

    test("the home page still carries its title", async ({ page }) => {
      await page.goto("/");

      await expect(page).toHaveTitle(/Star Wars 5e/);
    });
  });
});
