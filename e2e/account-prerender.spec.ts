import { existsSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

/**
 * What the static host actually serves for the account area.
 *
 * This is the file that guards the architecture rather than the feature. The
 * site prerenders every published path to HTML at build time and serves it
 * from nginx with no runtime server: one file per address, the same bytes for
 * every visitor, cached by everything in between. Two things follow, and
 * neither is observable from inside a running browser:
 *
 *   1. these addresses must exist as files, or nginx answers 404 for them
 *   2. those files must contain nobody's identity
 *
 * The tests below use raw HTTP requests, not a browser, because hydration
 * paints a correct-looking page either way.
 */

const ACCOUNT_PATHS = [
  "/register",
  "/verify-email",
  "/sign-in",
  "/account",
  "/account/passkeys",
  "/account/security",
  "/account/contributions",
];

test.describe("the account routes are real files, not the SPA fallback", () => {
  for (const path of ACCOUNT_PATHS) {
    test(`${path} answers 200 with its own markup`, async ({ request }) => {
      const response = await request.get(path);

      // The fallback is wired to nginx's `error_page 404`. A route missing
      // from the prerender list still renders correctly in a browser while
      // answering 404 to a shared link, a crawler or a monitor.
      expect(
        response.status(),
        `${path} must be prerendered; a 404 means it fell through to the SPA fallback`,
      ).toBe(200);
    });
  }

  test("each one carries its own title rather than a shared shell's", async ({
    request,
  }) => {
    const titles = await Promise.all(
      ["/sign-in", "/register", "/account"].map(async (path) => {
        const html = await (await request.get(path)).text();
        return /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
      }),
    );

    expect(titles[0]).toMatch(/^Sign in/);
    expect(titles[1]).toMatch(/^Create an account/);
    expect(titles[2]).toMatch(/^Your account/);
  });

  test("account pages ask not to be indexed", async ({ request }) => {
    for (const path of ["/sign-in", "/register", "/account"]) {
      const html = await (await request.get(path)).text();
      expect(html, `${path} must be noindex`).toMatch(
        /<meta[^>]+name="robots"[^>]+content="noindex"/,
      );
    }
  });
});

test.describe("no identity is baked into the static files", () => {
  test("the account page is the signed-out skeleton", async ({ request }) => {
    const html = await (await request.get("/account")).text();

    // What every visitor is served, and what a shared cache may hold.
    expect(html).toContain("Checking your account");
    expect(html).not.toContain("Sign out");
    expect(html).not.toContain("@example.com");
    expect(html).not.toMatch(/"roles"\s*:/);
    expect(html).not.toMatch(/"passkeys"\s*:/);
  });

  test("no account route ships a data payload beside it", () => {
    // React Router writes a `<route>.data` file next to every route that has a
    // `loader`, and that file is the serialized result of running it. For an
    // auth route it would be a build machine session, published as a static
    // asset. The absence of these files is the observable consequence of the
    // rule enforced in app/auth/prerender-safety.test.ts.
    //
    // Asserted against the build output rather than over HTTP because the two
    // hosts answer differently for a path that does not exist — nginx 404s,
    // `vite preview` falls back to the shell — and neither answer is the thing
    // under test.
    for (const file of ["account.data", "sign-in.data", "register.data"]) {
      expect(
        existsSync(path.resolve("build/client", file)),
        `build/client/${file} must not exist: a loader on an auth route runs at build time`,
      ).toBe(false);
    }

    // The control: routes that legitimately have a loader do produce one, so a
    // renamed output directory cannot make this test vacuously pass.
    expect(existsSync(path.resolve("build/client/species.data"))).toBe(true);
  });

  test("a content page carries the neutral header control, not a session", async ({
    request,
  }) => {
    const html = await (await request.get("/species/abyssin")).text();

    // The control appears on all ~130 prerendered content pages. It must
    // neither claim a reader is signed in nor claim they are signed out.
    expect(html).toContain("account-chip is-pending");
    expect(html).not.toContain("account-chip-signin");
    expect(html).not.toContain("account-chip-name");
    // And the page's own content is still prerendered.
    expect(html).toMatch(/<h1[^>]*>Abyssin<\/h1>/);
  });
});

test.describe("with JavaScript disabled", () => {
  test.use({ javaScriptEnabled: false });

  test("the account page is honest rather than blank or wrong", async ({ page }) => {
    await page.goto("/account");

    // Nothing can resolve without scripts, so the page stays in the one state
    // that is true for everybody. What it must never do is show a signed-out
    // page to somebody who is signed in, or the reverse.
    // Scoped to main: the header search carries a live region of its own.
    await expect(page.locator("main").getByRole("status")).toContainText(
      "Checking your account",
    );
    await expect(page.getByRole("button", { name: /sign out/i })).toHaveCount(0);
  });

  test("the sign-in page still renders its heading and explanation", async ({
    page,
  }) => {
    await page.goto("/sign-in");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
    await expect(
      page.getByText(/the whole reference is readable without an account/i),
    ).toBeVisible();
  });

  test("the registration form is present and complete", async ({ page }) => {
    await page.goto("/register");

    await expect(page.getByLabel(/email address/i)).toBeVisible();
    await expect(page.getByLabel(/display name/i)).toBeVisible();
  });
});

/**
 * Every account address names itself, before hydration and without scripts.
 *
 * These four files spend their first moments — and their entire life for a
 * reader whose scripts never run — in the `loading` state, because identity is
 * resolved after hydration and must never be written into a file that every
 * visitor shares. That state is allowed to say nothing about *who* the reader
 * is. It is not allowed to say nothing at all.
 *
 * Two things were missing, and both are only visible from outside a browser:
 *
 *   a `<main>` landmark with no heading anywhere inside it, so a screen reader
 *   moving by heading finds the page empty and a reader without JavaScript is
 *   told nothing about where they are
 *
 *   one `<title>` shared by all four, so a tab strip, a window list and a
 *   history entry have nothing to tell them apart
 */
const ACCOUNT_SECTIONS = [
  { path: "/account", title: "Your account — Star Wars 5e" },
  { path: "/account/passkeys", title: "Passkeys — Your account — Star Wars 5e" },
  {
    path: "/account/security",
    title: "Two-factor authentication — Your account — Star Wars 5e",
  },
  {
    path: "/account/contributions",
    title: "Contributions — Your account — Star Wars 5e",
  },
];

test.describe("every account route names itself in its own markup", () => {
  for (const section of ACCOUNT_SECTIONS) {
    test(`${section.path} prerenders a heading`, async ({ request }) => {
      const html = await (await request.get(section.path)).text();

      // Deliberately not asserting the wording: what matters is that the
      // landmark is not headingless. A heading that only appears once the
      // session resolves is not in the file nginx serves.
      expect(
        /<h1[^>]*>\s*\S[^<]*<\/h1>/.test(html),
        `${section.path} must prerender a level-one heading; without one the ` +
          "page presents a main landmark with no heading structure at all",
      ).toBe(true);
    });

    test(`${section.path} prerenders its own title`, async ({ request }) => {
      const html = await (await request.get(section.path)).text();

      expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(section.title);
    });
  }

  test("no two of them share a title", async ({ request }) => {
    const titles = await Promise.all(
      ACCOUNT_SECTIONS.map(async ({ path }) => {
        const html = await (await request.get(path)).text();
        return /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
      }),
    );

    expect(
      new Set(titles).size,
      `the account routes answer with ${new Set(titles).size} distinct titles ` +
        `for ${titles.length} addresses`,
    ).toBe(titles.length);
  });

  test("the headings survive with JavaScript turned off", async ({ browser }) => {
    // The same assertion through a browser that will never hydrate, which is
    // what a crawler and a reader on a failed script load actually get.
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    for (const { path } of ACCOUNT_SECTIONS) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }

    await context.close();
  });
});
