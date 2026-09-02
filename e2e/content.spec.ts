import { expect, test } from "@playwright/test";
import { hydrated } from "./hydration";

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

  /**
   * The regression this domain exists to close. `/maneuvers` was in the
   * header, resolved, returned 200, rendered its `<h1>` — and said "No
   * maneuvers in this build of the reference yet", because nothing fed it.
   * Asserting the heading would have passed throughout. Asserting a row is
   * what does not.
   */
  test("the maneuver index serves maneuvers, not an empty state", async ({
    request,
  }) => {
    const html = await (await request.get("/maneuvers")).text();

    expect(html).toMatch(/<h1[^>]*>Maneuvers<\/h1>/);
    expect(html).toContain("Administer Aid");
    expect(html).toContain('href="/maneuvers/administer-aid"');
    expect(
      html,
      "the maneuver index is back to publishing nothing",
    ).not.toContain("in this build of the reference yet");
  });

  test("every combat-option index serves its own rows", async ({ request }) => {
    // One slug per type, each present in the committed fixture and in the full
    // canonical set, so this reads the same either way.
    const indexes: [string, string][] = [
      ["/fighting-styles", "Area Style"],
      ["/fighting-masteries", "Area Mastery"],
      ["/lightsaber-forms", "Aqinos Form"],
      ["/weapon-focuses", "Blade Focus"],
      ["/weapon-supremacies", "Blade Supremacy"],
    ];

    for (const [path, name] of indexes) {
      const html = await (await request.get(path)).text();

      expect(html, `${path} published no rows`).toContain(name);
      expect(html).not.toContain("in this build of the reference yet");
    }
  });

  test("a lightsaber form separates what it does on adoption from what it grants", async ({
    request,
  }) => {
    const html = await (await request.get("/lightsaber-forms/aqinos-form")).text();

    expect(html).toMatch(/<h1[^>]*>Aqinos Form<\/h1>/);
    // The two headings are the form's structure. One paragraph of prose here
    // would mean the effects were flattened back together.
    expect(html).toContain("As you adopt this form");
    expect(html).toContain("The ability to cast tech powers");
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
    await hydrated(page);

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
    await hydrated(page);

    const rows = page.getByRole("row");
    const before = await rows.count();

    await page.getByLabel("Filter by name").fill("absorb");

    // Polled, not read once. Filtering is a React state change, so the count
    // an instant after the keystroke is whatever happened to be on screen —
    // which is the old one often enough to matter.
    await expect.poll(() => rows.count()).toBeLessThan(before);
    expect(await rows.count()).toBeGreaterThan(1);
  });
});

test.describe("searching", () => {
  /**
   * The results page carries two fields for one job — its own, and the one in
   * the header that is on every page of the site. They used to disagree: the
   * page's showed what you searched for and the header's showed a placeholder,
   * so refining from the header meant starting again from nothing.
   */
  test("both search fields hold the query the results are for", async ({ page }) => {
    await page.goto("/search?q=speeder");
    await hydrated(page);

    const fields = page.locator('input[name="q"]');

    await expect(fields).toHaveCount(2);
    await expect(fields.nth(0)).toHaveValue("speeder");
    await expect(fields.nth(1)).toHaveValue("speeder");
  });

  test("typing a new query is not yanked back to the old one", async ({ page }) => {
    // The reason this is seeded rather than bound to the address. The two are
    // the same field for one keystroke and then diverge: somebody typing has
    // not navigated yet, and a field that reverts on every render is a field
    // nobody can type in.
    await page.goto("/search?q=speeder");

    /*
      The wait is the point of the test working at all. The served HTML has an
      empty field — it is prerendered without a query string — and React fills
      it in from the address during hydration. Clearing it before that happens
      clears nothing, and the seeding then puts "speeder" in, which is exactly
      what CI saw.
    */
    await hydrated(page);

    const header = page.locator("header").locator('input[name="q"]');

    /*
      Cleared and then typed, rather than filled.

      `fill` selects the existing text and replaces it, and this field is
      controlled by React inside a tree that is re-rendering for its own
      reasons — the results arriving, the index loading. A re-render between
      the selection and the insertion collapses the selection, and the new text
      lands after the old one instead of over it: CI saw "speederblaster".

      That is an artefact of how `fill` works, not something a person typing
      can produce, so the test types.
    */
    await header.fill("");
    await expect(header).toHaveValue("");
    await header.pressSequentially("blaster");

    await expect(header).toHaveValue("blaster");
    await expect(page).toHaveURL(/q=speeder/);
  });

  test("a fresh search re-seeds the field", async ({ page }) => {
    await page.goto("/search?q=speeder");
    await hydrated(page);
    await page.goto("/search?q=blaster");
    await hydrated(page);

    await expect(page.locator("header").locator('input[name="q"]')).toHaveValue(
      "blaster",
    );
  });
});

test.describe("finding a rule", () => {
  /**
   * The journey this exists for, end to end.
   *
   * "Difficult terrain" is a heading in the Adventuring chapter, and searching
   * for it used to return nothing: the index took the chapter's outer sections
   * and not the forty-odd headings inside them. The site held the rule and
   * could not find it.
   */
  test("a rule inside a chapter is findable, and the result lands on it", async ({
    page,
  }) => {
    await page.goto("/search?q=difficult+terrain");
    await hydrated(page);

    const result = page.locator(".result-link").first();

    await expect(result).toBeVisible();
    await expect(result).toHaveAttribute("href", /#difficult-terrain$/);

    await result.click();

    // Landed on the section, not at the top of a chapter that runs to tens of
    // thousands of words, and clear of the sticky header.
    const heading = page.locator("#difficult-terrain");
    const box = (await heading.boundingBox())!;
    const header = (await page.locator("header").first().boundingBox())!;

    await expect(heading).toBeVisible();
    expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
  });

  test("the result says which section matched", async ({ page }) => {
    // A result that asserts a match without showing it makes a reader open the
    // page to find out whether it was worth opening.
    await page.goto("/search?q=difficult+terrain");
    await hydrated(page);

    await expect(page.locator(".result-evidence").first()).toContainText(
      /difficult/i,
    );
  });
});
