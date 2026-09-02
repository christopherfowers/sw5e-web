/**
 * The architectural invariant that keeps identity out of static files.
 *
 * This site prerenders every published path to HTML at build time and serves
 * it from nginx with no runtime server anywhere. A `loader` on a route
 * therefore does not run per request — it runs once, on a build machine, and
 * its result is written into a file that every visitor is then served and that
 * every cache in between is free to keep.
 *
 * So a `loader` in the account area could only ever do one of two things: read
 * a session that does not exist at build time, so the feature silently does
 * nothing; or, if a build ever did have one, write one person's identity into
 * `/account/index.html`.
 *
 * Neither failure is visible. The pages still render, the flows still work in
 * a browser, and nothing in the test suite would go red — which is precisely
 * why this file exists. It is checking the shape of the source, because the
 * behaviour it protects cannot be observed from inside the app.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every route module in the account area. Listed by hand rather than globbed:
 * a glob would quietly stop covering a file that was renamed, and a list that
 * is wrong fails loudly at `readFileSync`.
 */
const AUTH_ROUTE_MODULES = [
  "register.tsx",
  "verify-email.tsx",
  "sign-in.tsx",
  "account.tsx",
  "account-profile.tsx",
  "account-passkeys.tsx",
  "account-security.tsx",
  "account-contributions.tsx",
  "account-flags.tsx",
  "account-people.tsx",

  // Managing one account. Its own route module since it became its own page,
  // and covered here for the sharpest version of the reason this file exists:
  // a loader on it would run at build time against a query string the build
  // machine invented, and anything it returned about an account would be
  // written into a static file every visitor is served.
  "account-people-manage.tsx",

  "account-audit.tsx",

  // The authoring workspace. Same rule, and if anything a sharper version of
  // it: a loader here would bake a build machine's view of the draft queue —
  // the name of every document somebody has unfinished work on, and of everyone
  // who has it — into a static file served to every visitor of a public site.
  "authoring.tsx",
  "authoring-worklist.tsx",
  "authoring-edit.tsx",
  "authoring-history.tsx",
];

function source(file: string): string {
  return readFileSync(path.resolve("app/routes", file), "utf8");
}

describe("no auth route may run code at build time", () => {
  it.each(AUTH_ROUTE_MODULES)("%s exports no loader", (file) => {
    const text = source(file);

    // `loader` and `clientLoader` are matched separately: `clientLoader` is
    // harmless — it runs in the browser — while `loader` runs during the
    // prerender. The pattern is anchored so `clientLoader` cannot satisfy it.
    expect(
      /(^|\W)export\s+(async\s+)?function\s+loader\b/.test(text),
      `${file} must not export a loader: it would run during the prerender and ` +
        "bake its result into a static file served to every visitor",
    ).toBe(false);
    expect(
      /(^|\W)export\s+const\s+loader\b/.test(text),
      `${file} must not export a loader`,
    ).toBe(false);
  });

  it.each(AUTH_ROUTE_MODULES)("%s exports no action", (file) => {
    // `ssr: false` makes actions unusable anyway — React Router refuses to
    // build with one — but a contributor reaching for a `<Form method="post">`
    // should meet this message rather than a build error about SSR.
    expect(
      /(^|\W)export\s+(async\s+)?function\s+action\b/.test(source(file)),
      `${file} must not export an action: there is no server to run one`,
    ).toBe(false);
  });
});

describe("the account routes are prerendered rather than left to the fallback", () => {
  const config = readFileSync(path.resolve("react-router.config.ts"), "utf8");

  it.each([
    "/register",
    "/verify-email",
    "/sign-in",
    "/account",
    "/account/passkeys",
    "/account/security",
    "/account/contributions",
    "/account/flags",
    "/account/people",
    "/account/people/manage",
    "/account/audit",
    "/authoring",
    "/authoring/edit",
    "/authoring/history",
  ])("%s is in the prerender list", (route) => {
    // A path missing from this list is served by nginx's SPA fallback, which
    // is wired to `error_page 404`. It would render correctly in a browser
    // while answering 404 to everything else — a shared link, a crawler, a
    // monitor.
    expect(config).toContain(`"${route}"`);
  });
});
