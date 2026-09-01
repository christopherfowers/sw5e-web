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

/**
 * The site's claim about itself, checked in what the server actually sends.
 *
 * The unit tests assert the copy; these assert that the copy survives the
 * build. A continuity statement that only appears after hydration is one a
 * crawler never indexes and a reader on a slow connection sees late — and the
 * whole point of stating it is that somebody searching for the site they lost
 * finds this one.
 */
test.describe("the site's self-description", () => {
  test("the home page names the site it continues, before any JavaScript runs", async ({
    request,
  }) => {
    const response = await request.get("/");
    const html = await response.text();

    expect(html).toContain("sw5e.com");
    expect(
      html,
      "the site positioned itself as one fan project among several for as " +
        "long as this phrase was in its lede",
    ).not.toMatch(/a community reference/i);
  });

  test("every page carries the lineage in its header", async ({ request }) => {
    // A content page rather than the home page: this is what somebody arriving
    // from a search result is served, and it is where the claim has to hold.
    const response = await request.get("/species");
    const html = await response.text();

    expect(response.ok()).toBe(true);
    expect(html).toContain("Continuing sw5e.com");
  });

  test("the about page is prerendered rather than answered by the SPA fallback", async ({
    request,
  }) => {
    const response = await request.get("/about");

    expect(
      response.status(),
      "a 404 here means /about fell through to nginx's SPA fallback — it " +
        "renders in a browser and is broken to everything else, including " +
        "the search results this page exists to be found in",
    ).toBe(200);

    const html = await response.text();
    expect(html).toMatch(/<h1[^>]*>What this site is<\/h1>/);
    expect(html).toContain("Fan Content Policy");
  });
});
