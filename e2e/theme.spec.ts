/**
 * Choosing a theme, in a real browser.
 *
 * The unit tests hold the palette and the contrast suite holds its legibility.
 * What neither can reach is the part that only exists at runtime: an attribute
 * written to the document, a choice put in storage, and an inline script that
 * has to replay it before the first paint of the *next* page.
 *
 * The no-flash case is the one worth the effort. It is invisible when it works
 * and merely annoying when it fails, which is exactly the kind of fault that
 * ships and stays.
 */

import { expect, test } from "@playwright/test";

const CONTROL = ".theme-control";

/**
 * Presses one of the three options, the way a person does.
 *
 * The radio itself is clipped to a pixel and sits under its label, so clicking
 * the input directly is something only automation would try — and Playwright
 * refuses, reporting that the label intercepts the click. It is right to: the
 * label *is* the control, and forwarding to its input is what a label is for.
 * So the test presses the label, which is both what a reader does and the only
 * thing that proves the association works.
 */
async function choose(page: import("@playwright/test").Page, value: string) {
  await page.locator(`${CONTROL} label:has(input[value="${value}"])`).click();
}

test.describe("the theme control", () => {
  /*
    A dark desktop throughout, because that is the configuration where every
    interesting case lives. Choosing dark on a dark system proves nothing — the
    page already looked like that.
  */
  test.use({ colorScheme: "dark" });

  test("starts following the system, with nothing stored", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    await expect(
      page.locator(`${CONTROL} input[value="system"]`),
    ).toBeChecked();
  });

  /**
   * The case the whole `:not([data-theme="light"])` selector exists for.
   *
   * Without it the media query would still match on a dark desktop and nothing
   * in the light branch would override it, so "light" would do nothing at all.
   */
  test("can make the site lighter than the desktop it is on", async ({
    page,
  }) => {
    await page.goto("/");

    await choose(page, "light");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // The ground actually changed, not just the attribute. Reading the
    // computed value rather than the token, because a token that stopped being
    // applied would still have the right value.
    const background = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(background).not.toBe("rgb(8, 9, 10)");
  });

  /**
   * And it survives a full document load on another route.
   *
   * This is the inline script's job, and it is asserted on a second page
   * rather than a reload so that a fix which only worked for the page the
   * choice was made on would fail here.
   */
  test("is still in force on the next page, before any script of ours runs", async ({
    page,
  }) => {
    await page.goto("/");
    await choose(page, "light");

    await page.goto("/species");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator(`${CONTROL} input[value="light"]`)).toBeChecked();
  });

  test("can be handed back to the system", async ({ page }) => {
    await page.goto("/");
    await choose(page, "light");
    await choose(page, "system");

    await expect(page.locator("html")).not.toHaveAttribute("data-theme");

    // And the choice is forgotten, not merely overridden — otherwise "system"
    // would be a third stored value that the script would have to understand.
    const stored = await page.evaluate(() =>
      window.localStorage.getItem("sw5e-theme"),
    );
    expect(stored).toBeNull();
  });

  /**
   * The control is reachable and operable from the keyboard.
   *
   * It is a radio group, so the browser gives this for free — which is most of
   * why it is a radio group. The test is here because the inputs are visually
   * clipped, and the tempting way to hide them is `display: none`, which would
   * silently take them out of the tab order along with the appearance.
   */
  test("is operable from the keyboard", async ({ page }) => {
    await page.goto("/");

    await page.locator(`${CONTROL} input[value="system"]`).focus();
    await page.keyboard.press("ArrowRight");

    await expect(page.locator(`${CONTROL} input[value="light"]`)).toBeChecked();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});
