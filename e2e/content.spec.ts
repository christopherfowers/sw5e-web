import { expect, test } from "@playwright/test";

/**
 * Content pages are the reason this site pre-renders. These tests look at what
 * the server actually sends for a content route, not at what hydration paints,
 * because a crawler that does not run JavaScript sees only the former.
 *
 * Every path used here exists in both datasets: the committed fixture that CI
 * builds from, and the full archive-derived set a maintainer builds locally.
 */
test.describe("pre-rendered content routes", () => {
  test("a type index arrives as rendered HTML", async ({ request }) => {
    const html = await (await request.get("/species")).text();

    expect(
      html,
      "an empty shell here means content indexes have stopped pre-rendering " +
        "and are invisible to crawlers that do not execute JavaScript",
    ).toMatch(/<h1[^>]*>Species<\/h1>/);
    expect(html).toContain("Abyssin");
  });

  test("an item page arrives as rendered HTML with its own title", async ({
    request,
  }) => {
    const response = await request.get("/powers/absorb-energy");
    expect(response.ok()).toBe(true);

    const html = await response.text();
    expect(html).toMatch(/<h1[^>]*>Absorb Energy<\/h1>/);
    expect(html).toMatch(/<title>Absorb Energy[^<]*<\/title>/);
    expect(html).toMatch(/<meta[^>]+name="description"/);
  });

  /**
   * A guard against a specific way pre-rendering can fail silently: a route
   * that exports `clientLoader.hydrate` makes the build render the hydration
   * fallback into the static HTML, so every content page ships with the
   * fallback's title and none of its content while still returning 200.
   */
  test("no content page ships the not-found title", async ({ request }) => {
    for (const path of ["/species", "/species/abyssin", "/powers/acid-dart"]) {
      const html = await (await request.get(path)).text();
      expect(html, `${path} must be pre-rendered with its own data`).not.toContain(
        "Not found — Star Wars 5e",
      );
    }
  });

  test("a page that was never published reads as an error, not a blank screen", async ({
    page,
  }) => {
    await page.goto("/monsters/not-a-real-creature");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /return to the home page/i }),
    ).toBeVisible();
  });

  test("item pages live at readable URLs, not opaque ids", async ({ request }) => {
    for (const path of [
      "/species/abyssin",
      "/powers/absorb-energy",
      "/monsters/3p0-series",
    ]) {
      expect((await request.get(path)).ok(), `${path} must exist`).toBe(true);
    }
  });

  test.describe("with JavaScript disabled", () => {
    test.use({ javaScriptEnabled: false });

    test("an item page still renders its content and navigation", async ({
      page,
    }) => {
      await page.goto("/species/advozse");

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Advozse");
      await expect(
        page.getByRole("navigation", { name: "Breadcrumb" }),
      ).toBeVisible();
      await expect(
        page.getByRole("navigation", { name: /species navigation/i }),
      ).toBeVisible();
    });

    test("a type index still renders its rows", async ({ page }) => {
      await page.goto("/monsters");

      await expect(page.getByRole("table")).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: /CR/ }),
      ).toBeVisible();
    });
  });
});

test.describe("browsing", () => {
  test("the home page leads into every content type", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: /^Creatures/ }).first().click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Creatures");
  });

  test("an index row leads to that item's page", async ({ page }) => {
    await page.goto("/species");

    await page.getByRole("link", { name: "Abyssin", exact: true }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Abyssin");
  });

  test("previous and next move within a content type", async ({ page }) => {
    await page.goto("/species/advozse");

    const next = page.getByRole("link", { name: /^Next/ });
    await expect(next).toBeVisible();
    await next.click();

    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
      "Advozse",
    );
    await expect(page.getByRole("link", { name: /^Previous/ })).toBeVisible();
  });

  test("breadcrumbs lead back to the type index", async ({ page }) => {
    await page.goto("/powers/absorb-energy");

    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Powers" })
      .click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Powers");
  });

  test("filtering an index narrows the rows it shows", async ({ page }) => {
    await page.goto("/powers");

    const before = await page.getByRole("row").count();
    await page.getByLabel("Filter by name").fill("absorb");
    const after = await page.getByRole("row").count();

    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(1);
  });
});
