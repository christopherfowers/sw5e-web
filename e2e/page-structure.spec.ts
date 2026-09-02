import { expect, test } from "@playwright/test";

/**
 * The invariants every page of this site owes a reader, checked on one page of
 * each kind.
 *
 * These are the faults that do not announce themselves. A page with two `h1`s
 * or a heading level skipped from two to four still looks correct; what it
 * does is destroy the outline a screen-reader user navigates by, and nothing
 * in a screenshot or a unit test shows it. The same goes for a duplicate `id`
 * — perfectly invisible, and it silently breaks every `aria-labelledby` and
 * `<label for>` pointing at the second one.
 *
 * They are checked here rather than in jsdom because several of them are only
 * true of the whole assembled document: the header, the rail, the page and the
 * footer each render fine on their own and can still collide once they are on
 * the same page.
 *
 * ## What this is not
 *
 * Not an accessibility audit. It is a small set of structural facts that can
 * be asserted mechanically and are always wrong when they fail — colour
 * contrast, focus order and whether the wording makes sense are not among
 * them, and a green run here says nothing about any of those.
 */

type Page = import("@playwright/test").Page;

/**
 * One page of each shape the site produces, rather than a sample of content.
 *
 * A second species page would exercise exactly the code the first one did; the
 * account and authoring shells are here because they are prerendered signed
 * out and are the ones most likely to be forgotten.
 */
const PAGES = [
  { path: "/", what: "the home page" },
  { path: "/species", what: "a content index" },
  { path: "/species/abyssin", what: "a content item with a picture" },
  { path: "/monsters/3p0-series", what: "a content item without one" },
  { path: "/rules", what: "the rules index" },
  { path: "/search?q=blaster", what: "search results" },
  { path: "/sources", what: "the source-book list" },
  { path: "/credits", what: "the attribution page" },
  { path: "/about", what: "the about page" },
  { path: "/sign-in", what: "the sign-in page" },
  { path: "/register", what: "the registration page" },
  { path: "/account", what: "the account shell, signed out" },
  { path: "/authoring", what: "the authoring shell, signed out" },
  { path: "/no-such-page", what: "a mistyped address" },
];

/** Everything the audit below can find, as sentences. */
async function structuralFaults(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const faults: string[] = [];
    const main = document.querySelector("main");
    if (!main) return ["there is no <main> landmark"];

    const headings = [...main.querySelectorAll("h1,h2,h3,h4,h5,h6")];
    const levels = headings.map((heading) => Number(heading.tagName[1]));

    // Exactly one, because the outline has one root. Two `h1`s is two
    // documents in a trench coat, and none leaves the landmark unlabelled.
    const firstLevel = levels.filter((level) => level === 1).length;
    if (firstLevel !== 1) faults.push(`main has ${firstLevel} h1 elements, not 1`);

    for (let index = 1; index < levels.length; index += 1) {
      if (levels[index]! - levels[index - 1]! > 1) {
        faults.push(
          `heading level jumps from h${levels[index - 1]} to h${levels[index]} ` +
            `at "${headings[index]!.textContent?.trim().slice(0, 40)}"`,
        );
      }
    }

    // An image with no `alt` attribute at all is announced by its filename. An
    // empty one is a deliberate "this is decorative" and is correct, so the
    // check is for the attribute's absence rather than for its emptiness.
    const unlabelled = document.querySelectorAll("img:not([alt])").length;
    if (unlabelled) faults.push(`${unlabelled} images have no alt attribute`);

    const namelessLinks = [...document.querySelectorAll("a")].filter(
      (link) =>
        !link.textContent?.trim() &&
        !link.getAttribute("aria-label") &&
        !link.querySelector('img[alt]:not([alt=""])'),
    );
    if (namelessLinks.length) {
      faults.push(
        `${namelessLinks.length} links have no accessible name ` +
          `(first href: ${namelessLinks[0]!.getAttribute("href")})`,
      );
    }

    const namelessButtons = [...document.querySelectorAll("button")].filter(
      (button) => !button.textContent?.trim() && !button.getAttribute("aria-label"),
    );
    if (namelessButtons.length) {
      faults.push(`${namelessButtons.length} buttons have no accessible name`);
    }

    const seen = new Map<string, number>();
    for (const element of document.querySelectorAll("[id]")) {
      seen.set(element.id, (seen.get(element.id) ?? 0) + 1);
    }
    const duplicated = [...seen].filter(([, count]) => count > 1).map(([id]) => id);
    if (duplicated.length) faults.push(`duplicate ids: ${duplicated.join(", ")}`);

    // A form control with no label is a control a screen reader announces as
    // "edit text, blank".
    const namelessFields = [...document.querySelectorAll("input, select, textarea")].filter(
      (field) => {
        if (field.getAttribute("type") === "hidden") return false;
        if (field.getAttribute("aria-label") || field.getAttribute("aria-labelledby")) {
          return false;
        }
        return !(field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`));
      },
    );
    if (namelessFields.length) {
      faults.push(`${namelessFields.length} form controls have no label`);
    }

    return faults;
  });
}

test.describe("every page", () => {
  for (const { path, what } of PAGES) {
    test(`${what} is structurally sound`, async ({ page }) => {
      await page.goto(path);

      /*
        Polled rather than read once, and for a reason worth keeping: an
        address with no prerendered file behind it is served the SPA fallback,
        whose `main` is empty until hydration paints the boundary into it. A
        single read caught that empty frame and reported a missing `h1` that
        appears a moment later.

        This still fails when a heading is genuinely absent — it just gives the
        page the same moment a reader would.
      */
      await expect
        .poll(() => structuralFaults(page), { message: `${what} (${path})` })
        .toEqual([]);
    });
  }

  for (const { path, what } of PAGES) {
    test(`${what} names itself in the tab`, async ({ page }) => {
      await page.goto(path);

      // The 404 case is why this exists. A route that throws does not have its
      // own meta called, so every mistyped address came back with an empty
      // title and the tab, the bookmark and the history entry all showed the
      // raw URL.
      const title = await page.title();

      expect(title.trim(), `${what} (${path}) must have a title`).not.toBe("");
      expect(title).toContain("Star Wars 5e");
    });
  }
});

test.describe("a heading in the rules text", () => {
  /**
   * Sections became addressable so that people can send each other a link to
   * one instead of naming a chapter and saying "scroll down". These are the
   * two ways that fails quietly.
   */
  const CHAPTER = "/rules/phb-adventuring";

  test("can be linked to, and the link lands clear of the header", async ({ page }) => {
    await page.goto(CHAPTER);

    const anchors = page.locator(".heading-anchor");
    expect(await anchors.count()).toBeGreaterThan(5);

    const href = await anchors.first().getAttribute("href");
    expect(href).toMatch(/^#[a-z0-9-]+$/);

    await page.goto(`${CHAPTER}${href}`);

    // The whole point of the link. A sticky header that covers the heading
    // somebody was sent to makes the address worse than useless: it looks like
    // it landed in the wrong place.
    const heading = page.locator(href!);
    const box = (await heading.boundingBox())!;
    const header = (await page.locator("header").first().boundingBox())!;

    expect(
      box.y,
      "the heading a fragment link lands on must not be under the sticky header",
    ).toBeGreaterThanOrEqual(header.y + header.height);
  });

  test("shows its anchor once a keyboard reaches it", async ({ page }) => {
    // The anchor is invisible until hovered, which is right for a page nobody
    // is trying to edit — and would be a trap if focus did not also reveal it,
    // because a keyboard user would be sitting on a link with opacity 0.
    await page.goto(CHAPTER);

    const anchor = page.locator(".heading-anchor").first();
    await anchor.focus();

    await expect(anchor).toBeFocused();

    // Polled, because the anchor fades in and a single read catches it
    // partway. What is asserted is where it settles, not how fast.
    await expect
      .poll(() =>
        anchor.evaluate((element) => Number(getComputedStyle(element).opacity)),
      )
      .toBe(1);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const { path, what } of PAGES) {
    test(`${what} does not scroll sideways`, async ({ page }) => {
      await page.goto(path);

      // A page wider than the screen is the single most common phone layout
      // fault and the easiest to introduce: one table, one long word or one
      // fixed width does it, and it is invisible on the desktop the change was
      // made on. Wide content is expected to scroll inside its own container.
      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth,
        window: window.innerWidth,
      }));

      expect(
        overflow.document,
        `${what} (${path}) is ${overflow.document - overflow.window}px wider than the screen`,
      ).toBeLessThanOrEqual(overflow.window);
    });
  }
});
