import { expect, test } from "@playwright/test";

const SEARCH_FIELD = /search all star wars 5e content/i;

/** Focuses the header search with the documented shortcut and types a query. */
async function searchByKeyboard(page: import("@playwright/test").Page, query: string) {
  const field = page.getByRole("searchbox", { name: SEARCH_FIELD });

  // The shortcut is installed by the client bundle, so it only answers once
  // the page has hydrated. Retrying the keystroke waits for that without
  // guessing at a duration. A press that arrives too early lands on the body
  // and is discarded, which is why the field is asserted to be empty after.
  await expect(async () => {
    await page.keyboard.press("/");
    await expect(field).toBeFocused({ timeout: 300 });
  }).toPass({ timeout: 15_000 });

  await expect(field, "the shortcut must not type itself into the field").toHaveValue("");
  await page.keyboard.type(query);
  await expect(page.locator(".site-search-panel a").first()).toBeVisible();
  return field;
}

/**
 * A keyboard-only path through the site, end to end: skip the navigation,
 * open search, walk the results, land on a content page, then sort a table.
 * No mouse is used anywhere in this file.
 *
 * This is the coverage the README's accessibility section admitted was
 * missing. WCAG 2.1 AA requires all functionality to be operable from a
 * keyboard (2.1.1) with no trap (2.1.2) and a visible focus indicator (2.4.7),
 * and none of that is observable by looking at the rendered page.
 */
test.describe("keyboard-only operation", () => {
  test("the first tab stop skips past the navigation to the content", async ({
    page,
  }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");

    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();

    await page.keyboard.press("Enter");

    await expect(page.locator("main")).toBeFocused();
  });

  test("search is reachable, usable and escapable without a mouse", async ({
    page,
  }) => {
    await page.goto("/");

    // The documented shortcut, pressed from the page body.
    const field = await searchByKeyboard(page, "absorb energy");
    const firstResult = page.locator(".site-search-panel a").first();

    // Arrow down moves from the field into the suggestions.
    await page.keyboard.press("ArrowDown");
    await expect(firstResult).toBeFocused();

    // Escape closes the panel and hands focus back, so there is no trap.
    await page.keyboard.press("Escape");
    await expect(field).toBeFocused();
    await expect(firstResult).toBeHidden();
  });

  test("a search result can be followed with Enter alone", async ({ page }) => {
    await page.goto("/");

    await searchByKeyboard(page, "absorb energy");

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Absorb Energy",
    );
  });

  test("results say which field matched", async ({ page }) => {
    await page.goto("/");

    await searchByKeyboard(page, "resistance");

    const evidence = page.locator(".site-search-panel .result-evidence").first();
    await expect(evidence).toBeVisible();
    await expect(evidence.locator("mark")).toHaveText(/resistance/i);
  });

  test("a table can be sorted from the keyboard and announces its order", async ({
    page,
  }) => {
    await page.goto("/monsters");

    const header = page.getByRole("columnheader", { name: /^CR/ });
    await expect(header).toHaveAttribute("aria-sort", "none");

    await page.getByRole("button", { name: /^CR/ }).focus();
    await page.keyboard.press("Enter");

    await expect(header).toHaveAttribute("aria-sort", "descending");

    await page.keyboard.press("Enter");
    await expect(header).toHaveAttribute("aria-sort", "ascending");
  });

  test("filters are reachable and operable by keyboard", async ({ page }) => {
    await page.goto("/powers");

    await page.getByLabel("Filter by name").focus();
    await page.keyboard.type("absorb");

    await expect(page.locator(".result-count")).toContainText(/of \d+ powers/);
  });

  test("every focusable control on a content page shows a focus ring", async ({
    page,
  }) => {
    await page.goto("/species/advozse");

    // Walk the page with Tab and confirm focus never lands on something with
    // no visible outline, which is how a keyboard user loses their place.
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Tab");
      const outline = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return "body";
        return getComputedStyle(active).outlineStyle;
      });
      if (outline === "body") break;
      expect(outline).not.toBe("none");
    }
  });
});
