import { existsSync, globSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

/**
 * What the static host actually serves for the authoring workspace.
 *
 * The same architectural guard `e2e/account-prerender.spec.ts` puts on the
 * account area, and it matters more here. Two things follow from a site with no
 * runtime server, and neither is observable from inside a running browser:
 *
 *   1. these addresses must exist as files, or nginx answers 404 for them
 *   2. those files must contain nobody's identity and nobody's work
 *
 * The second is the sharp one. A `loader` on any of these would run once on a
 * build machine and write its result into a file served to every visitor of a
 * public site — and what it would write here is the draft queue: the name of
 * every document somebody has unfinished work on, and of everyone who has it.
 * The rule that prevents it is enforced in `app/auth/prerender-safety.test.ts`;
 * this checks the consequence, from outside, over raw HTTP.
 *
 * The requests below use `request` rather than a browser, because hydration
 * paints a correct-looking page either way.
 */

const AUTHORING_PATHS = ["/authoring", "/authoring/edit", "/authoring/history"];

test.describe("the authoring routes are real files, not the SPA fallback", () => {
  for (const address of AUTHORING_PATHS) {
    test(`${address} answers 200 with its own markup`, async ({ request }) => {
      const response = await request.get(address);

      // The fallback is wired to nginx's `error_page 404`. A route missing from
      // the prerender list still renders correctly in a browser while answering
      // 404 to a shared link, a crawler or a monitor.
      expect(
        response.status(),
        `${address} must be prerendered; a 404 means it fell through to the SPA fallback`,
      ).toBe(200);
    });
  }

  test("the editor answers the same file whatever it is asked to open", async ({
    request,
  }) => {
    // The whole reason the subject of an edit travels in the query string. A
    // path segment would need a prerendered file per document — and none at all
    // for a document that does not exist yet, which is precisely what the
    // editor has to be able to open.
    const response = await request.get(
      "/authoring/edit?type=class&key=a-class-nobody-has-written-yet",
    );

    expect(response.status()).toBe(200);
    expect(await response.text()).toMatch(/<h1[^>]*>Authoring<\/h1>/);
  });
});

test.describe("no identity and no work is baked into the static files", () => {
  test("the workspace is the signed-out skeleton", async ({ request }) => {
    const html = await (await request.get("/authoring")).text();

    // What every visitor is served, and what a shared cache may hold.
    expect(html).toContain("Checking your account");
    expect(html).not.toContain("Save draft");
    expect(html).not.toMatch(/"drafts"\s*:/);
    expect(html).not.toMatch(/"baseRevisionIsCurrent"\s*:/);
    expect(html).not.toContain("@example.com");
  });

  test("no authoring route ships a data payload beside it", () => {
    // React Router writes a `<route>.data` file next to every route that has a
    // `loader`, and that file is the serialized result of running it. For an
    // authoring route it would be a build machine's view of the draft queue,
    // published as a static asset.
    //
    // Searched for rather than named, deliberately. Asserting that
    // `authoring/edit.data` is absent would also pass if React Router named
    // that file something else entirely — which is a test that cannot fail for
    // the reason it claims to. Anything ending in `.data` anywhere under the
    // authoring output is a payload that should not be there.
    const client = path.resolve("build/client");
    const payloads = [
      ...globSync("authoring*.data", { cwd: client }),
      ...globSync("authoring/**/*.data", { cwd: client }),
    ];

    expect(
      payloads,
      "a loader on an authoring route runs at build time and writes its result " +
        "into a static asset served to every visitor",
    ).toEqual([]);

    // The control: routes that legitimately have a loader do produce one, so a
    // renamed output directory cannot make this test vacuously pass.
    expect(existsSync(path.resolve(client, "species.data"))).toBe(true);
  });
});

test.describe("every authoring route names itself in its own markup", () => {
  const SECTIONS = [
    { path: "/authoring", title: "Worklist — Authoring — Star Wars 5e" },
    { path: "/authoring/edit", title: "Editor — Authoring — Star Wars 5e" },
    { path: "/authoring/history", title: "History — Authoring — Star Wars 5e" },
  ];

  for (const section of SECTIONS) {
    test(`${section.path} prerenders a heading`, async ({ request }) => {
      const html = await (await request.get(section.path)).text();

      // Not asserting the wording: what matters is that the landmark is not
      // headingless. A heading that only appears once the session resolves is
      // not in the file nginx serves.
      expect(
        /<h1[^>]*>\s*\S[^<]*<\/h1>/.test(html),
        `${section.path} must prerender a level-one heading`,
      ).toBe(true);
    });

    test(`${section.path} prerenders its own title`, async ({ request }) => {
      const html = await (await request.get(section.path)).text();
      expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(section.title);
    });

    test(`${section.path} asks not to be indexed`, async ({ request }) => {
      const html = await (await request.get(section.path)).text();

      // Nothing here is for a search engine, and every address indexed is
      // another one handed to traffic looking for a write endpoint.
      expect(html).toMatch(/<meta[^>]+name="robots"[^>]+content="noindex"/);
    });
  }

  test("no two of them share a title", async ({ request }) => {
    const titles = await Promise.all(
      SECTIONS.map(async ({ path: address }) => {
        const html = await (await request.get(address)).text();
        return /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
      }),
    );

    expect(new Set(titles).size).toBe(titles.length);
  });
});

test.describe("with JavaScript disabled", () => {
  test.use({ javaScriptEnabled: false });

  test("the workspace is honest rather than blank or wrong", async ({ page }) => {
    await page.goto("/authoring");

    // Nothing can resolve without scripts, so the page stays in the one state
    // that is true for everybody. What it must never do is show the tools to
    // somebody who may not use them, or claim a signed-in reader is signed out.
    await expect(page.locator("main").getByRole("status")).toContainText(
      "Checking your account",
    );
    await expect(page.getByRole("button", { name: /save draft/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Authoring");
  });
});
