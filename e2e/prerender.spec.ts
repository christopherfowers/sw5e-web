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

  /**
   * The test-environment banner, checked in the bytes rather than in the DOM.
   *
   * The banner is drawn only after hydration, from what the API says about the
   * deployment, and the e2e suite runs against a `vite preview` with no API
   * behind it — so what is being asserted here is the half that must hold on
   * every deployment including the live one: the served HTML carries the empty
   * live region and none of the banner's words.
   *
   * A banner in these bytes would be in all ~2,200 prerendered files. Production
   * would paint "TEST ENVIRONMENT" on first byte and take it away again once
   * JavaScript ran, which is worse than not having a banner at all.
   */
  test("the served document carries an empty live region and no banner", async ({
    request,
  }) => {
    const html = await (await request.get("/")).text();

    expect(
      html,
      "the live region has to be in the prerendered markup, or inserting the " +
        "banner into it later announces nothing",
    ).toMatch(/<div class="environment-banner" role="status"><\/div>/);

    expect(html).not.toMatch(/test environment/i);
    expect(html).not.toMatch(/not the live site/i);
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
 * build. A statement about what this site is that only appears after hydration
 * is one a crawler never indexes and a reader on a slow connection sees late.
 *
 * The claims themselves changed. The site described itself as continuing
 * sw5e.com and as not speaking for it, and both were false: this is Star Wars
 * 5e. What is asserted here now is that the served bytes say what the site is
 * and that the disclaimer of a relationship that exists is gone from them.
 */
test.describe("the site's self-description", () => {
  test("the home page says what the site is, before any JavaScript runs", async ({
    request,
  }) => {
    const response = await request.get("/");
    const html = await response.text();

    expect(html).toContain("the whole conversion and every book");
    expect(
      html,
      "the hero described the site as succeeding something it is part of",
    ).not.toContain("picks up where sw5e.com left off");
  });

  test("no page disclaims the relationship the site actually has", async ({
    request,
  }) => {
    // Checked on a content page as well as the home page, because the sentence
    // this replaces lived in the footer and the footer is on all of them. It
    // read "This site continues that work and does not speak for sw5e.com or
    // the people who ran it", and it was served with every one of the roughly
    // 2,200 prerendered files.
    for (const path of ["/", "/about", "/species"]) {
      const html = await (await request.get(path)).text();

      expect(html, `${path} still disclaims sw5e.com`).not.toContain(
        "does not speak for",
      );
      expect(html, `${path} still calls the site a continuation`).not.toContain(
        "continues that work",
      );
    }
  });

  test("every page still carries both true disclaimers", async ({ request }) => {
    // The two that protect the project, and the ones the rewrite above must
    // never take with it. Being Star Wars 5e is not being licensed by the
    // people who own Star Wars.
    const html = await (await request.get("/species")).text();

    expect(html).toContain("belong to Lucasfilm");
    expect(html).toContain(
      "not affiliated with, endorsed by, or sponsored by Lucasfilm or Wizards of the Coast",
    );
    expect(html).toContain("Fan Content Policy");
    expect(html).toContain("source code is MIT licensed");
  });

  test("the description a search result shows has dropped the indefinite article", async ({
    request,
  }) => {
    const response = await request.get("/");
    const html = await response.text();

    // This was scoped to the meta description while the footer still carried
    // the old "A community reference for the Star Wars 5e tabletop roleplaying
    // game" sentence — that block was being rewritten separately and its
    // wording was under review, so a document-wide assertion would have failed
    // on in-flight work. The footer has since been replaced with the Fan
    // Content Policy attribution, so the assertion is now what it was always
    // meant to be: the phrase appears nowhere in the served page.
    const description =
      /<meta[^>]+name="description"[^>]+content="([^"]*)"/.exec(html)?.[1] ?? "";

    expect(
      description,
      "the description must exist and be the prerendered one, not a shell " +
        "placeholder",
    ).not.toBe("");
    expect(description).toContain("Star Wars 5e, the whole reference");
    expect(
      html,
      "the site positioned itself as one fan project among several for as " +
        "long as this phrase appeared anywhere on the page — the description " +
        "was only the most visible place it did",
    ).not.toMatch(/a community reference/i);
  });

  test("every page says what the site is in its header", async ({ request }) => {
    // A content page rather than the home page: this is what somebody arriving
    // from a search result is served, and it is where the claim has to hold.
    const response = await request.get("/species");
    const html = await response.text();

    expect(response.ok()).toBe(true);
    expect(html).toContain("The current reference");
    expect(
      html,
      "the wordmark introduced the site by its old address on every page",
    ).not.toContain("Continuing sw5e.com");
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
