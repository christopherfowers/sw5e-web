import { expect, test } from "@playwright/test";
import { hydrated } from "./hydration";

/**
 * The header's grouped navigation, in a real browser.
 *
 * jsdom does not implement `<summary>` activation or the accessibility mapping
 * that makes a disclosure announce itself, so the unit tests in
 * `app/components/site-nav.test.tsx` can only assert the state machine. What
 * has to be checked here is what a person actually does with it: reach it by
 * Tab, open it with Enter, hear that it opened, and get out with Escape.
 *
 * The last group of tests runs with JavaScript switched off. That is not a
 * nicety on this site — every page is static HTML and the whole point is that
 * it is readable without a bundle. A menu that only opens once React has
 * hydrated would put most of the site's destinations behind JavaScript.
 */

type Page = import("@playwright/test").Page;

/** A group's menu, and the control that opens it. */
function menu(page: Page, group: string) {
  return page.locator(`details[data-group="${group}"]`);
}

function trigger(page: Page, group: string) {
  return menu(page, group).locator("> summary");
}

const GROUPS = [
  "Characters",
  "Combat",
  "Gear",
  "Starships",
  "Bestiary",
  "Reference",
];

test.describe("grouped navigation", () => {
  test("the header offers groups rather than one item per content type", async ({
    page,
  }) => {
    await page.goto("/powers");

    const items = page.locator(".site-nav > ul > li");

    // Twenty-two content types plus Sources used to be twenty-three items in
    // one strip that scrolled sideways at every width.
    await expect(items).toHaveCount(GROUPS.length);
    await expect(items).toHaveText(GROUPS.map((label) => new RegExp(label)));
  });

  test("a menu opens from the keyboard and announces that it is open", async ({
    page,
  }) => {
    await page.goto("/powers");

    const combat = trigger(page, "combat");

    // The disclosure reports itself closed before it is touched, which is the
    // state a screen reader reads out. It is set after hydration rather than
    // served, so this also proves hydration reached the header.
    await expect(combat).toHaveAttribute("aria-expanded", "false");

    await combat.focus();
    await page.keyboard.press("Enter");

    await expect(combat).toHaveAttribute("aria-expanded", "true");
    await expect(
      menu(page, "combat").getByRole("link", { name: "Maneuvers" }),
    ).toBeVisible();
  });

  test("Escape closes the menu and hands focus back", async ({ page }) => {
    await page.goto("/powers");

    const combat = trigger(page, "combat");
    await combat.focus();
    await page.keyboard.press("Enter");
    await expect(combat).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Escape");

    await expect(combat).toHaveAttribute("aria-expanded", "false");
    await expect(
      combat,
      "closing a menu must not leave focus on something that is now hidden",
    ).toBeFocused();
  });

  test("a group's menu leads to the types in it", async ({ page }) => {
    await page.goto("/powers");

    await trigger(page, "starships").click();
    await page.getByRole("link", { name: "Deployments" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Deployments",
    );
  });

  test("a menu opened with the pointer is still open a moment later", async ({
    page,
  }) => {
    // Written against the clock rather than against the click, because the bug
    // it guards is a race and not a refusal. `toggle` on a `<details>` is
    // dispatched asynchronously, so a handler that mirrors the element's state
    // back into React can fire after the open has already been recorded, read
    // the two as disagreeing, and put the menu straight back. Every assertion
    // that checks immediately after the click passes against that; the panel is
    // open at the instant it is asked and shut by the next frame.
    //
    // So this waits, and then asks. `toHaveAttribute` would retry until it
    // succeeded and hide exactly the failure being looked for, which is why the
    // state is read once, after settling, rather than polled.
    await page.goto("/powers");

    const characters = trigger(page, "characters");
    await characters.click();

    await page.waitForTimeout(250);

    expect(await menu(page, "characters").evaluate((el: HTMLDetailsElement) => el.open)).toBe(true);
    expect(await characters.getAttribute("aria-expanded")).toBe("true");
    await expect(
      menu(page, "characters").getByRole("link", { name: "Species" }),
    ).toBeVisible();
  });

  test("only one menu is open at a time", async ({ page }) => {
    await page.goto("/powers");

    // One-at-a-time is React's doing: without it the browser's own disclosure
    // opens both, quite correctly. So this has to wait, unlike the tests above
    // it that are about the menus working before React arrives at all.
    await hydrated(page);

    const combat = trigger(page, "combat");
    const characters = trigger(page, "characters");

    await combat.click();
    await characters.click();

    await expect(characters).toHaveAttribute("aria-expanded", "true");
    await expect(combat).toHaveAttribute("aria-expanded", "false");
  });

  test("an open menu never pushes the page sideways", async ({ page }) => {
    // A panel anchored to its own trigger runs off the right edge of a narrow
    // screen — Starships sits two thirds of the way across a phone — and a
    // horizontal scrollbar on a page nobody scrolled sideways reads as a broken
    // layout. This is the failure the flat strip had, arriving by another door.
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/powers");

      for (const group of ["characters", "combat", "starships"]) {
        const overflows = await menu(page, group).evaluate((details) => {
          (details as HTMLDetailsElement).open = true;
          const wide =
            document.documentElement.scrollWidth > window.innerWidth + 1;
          (details as HTMLDetailsElement).open = false;
          return wide;
        });

        expect(
          overflows,
          `the ${group} menu overflows the viewport at ${width}px`,
        ).toBe(false);
      }
    }
  });

  test("the rail keeps a reader's siblings on screen", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/maneuvers");

    const rail = page.getByRole("navigation", { name: "Combat sections" });
    await expect(rail).toBeVisible();

    // The point of the rail: moving between siblings costs no trip through a
    // menu.
    await rail.getByRole("link", { name: /Lightsaber Forms/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Lightsaber Forms",
    );
    await expect(
      page.getByRole("navigation", { name: "Combat sections" }),
    ).toBeVisible();
  });

  test("the rail stays out of the way on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/maneuvers");

    await expect(
      page.getByRole("navigation", { name: "Combat sections" }),
    ).toBeHidden();
    await expect(trigger(page, "combat")).toBeVisible();
  });

  test.describe("with JavaScript disabled", () => {
    test.use({ javaScriptEnabled: false });

    test("every group's destinations are in the served HTML", async ({
      request,
    }) => {
      const html = await (await request.get("/powers")).text();

      for (const path of [
        "/species",
        "/classes",
        "/class-improvements",
        "/features",
        "/maneuvers",
        "/lightsaber-forms",
        "/equipment",
        "/monsters",
        "/starship-ventures",
        "/sources",
      ]) {
        expect(
          html,
          `${path} is not reachable from a page served without JavaScript`,
        ).toContain(`href="${path}"`);
      }
    });

    test("a menu still opens", async ({ page }) => {
      await page.goto("/powers");

      // Native `<details>` disclosure, with nothing hydrated behind it. The
      // explicit aria-expanded is deliberately absent here: without JavaScript
      // React is not the thing changing the state, so an attribute frozen at
      // "false" would contradict the element it sits on.
      const combat = trigger(page, "combat");
      await expect(combat).not.toHaveAttribute("aria-expanded", /.*/);

      await combat.click();

      await expect(
        menu(page, "combat").getByRole("link", { name: "Maneuvers" }),
      ).toBeVisible();
    });
  });
});
