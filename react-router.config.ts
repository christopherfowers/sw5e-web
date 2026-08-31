import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Config } from "@react-router/dev/config";

const CONTENT_TYPES = [
  "species",
  "classes",
  "class-improvements",
  "archetypes",
  "features",
  "backgrounds",
  "feats",
  "powers",
  "maneuvers",
  "fighting-styles",
  "fighting-masteries",
  "lightsaber-forms",
  "weapon-focuses",
  "weapon-supremacies",
  "equipment",
  "enhanced-items",
  "weapon-properties",
  "armor-properties",
  "monsters",
  "starship-base-sizes",
  "starship-deployments",
  "starship-equipment",
  "starship-modifications",
  "starship-ventures",
  "starship-rules",
  "rules",
  "reference-tables",
] as const;

/**
 * The account routes, prerendered like everything else.
 *
 * It would be tempting to leave these out and let the SPA fallback serve them,
 * since none of them has any content to prerender. That would be a bug: the
 * fallback is wired to nginx's `error_page 404`, so every one of these
 * addresses would answer with an HTTP 404 that happens to render correctly —
 * fine in a browser, wrong to anything reading the status line, and wrong in a
 * shared link.
 *
 * What gets written to disk for each is the signed-out skeleton: the account
 * area has no `loader` anywhere in it, so there is nothing identity-shaped for
 * the build to bake in. See `app/routes/account.tsx`.
 *
 * `.github/workflows/ci.yml` asserts the total number of prerendered routes
 * against the canonical content set, so this list is part of that arithmetic.
 */
const ACCOUNT_PATHS = [
  "/register",
  "/verify-email",
  "/sign-in",
  "/account",
  "/account/passkeys",
  "/account/security",
  "/account/contributions",
] as const;

/**
 * The dataset this build renders from. `app/data/generated` is the full
 * archive-derived library and is gitignored; `app/data/fixture` is the small
 * committed sample that lets a contributor without the archive build the site.
 * Whichever the app resolves at build time, the prerender list has to match,
 * so both read the same directories in the same order.
 */
function datasetDirectory(): string {
  const generated = path.resolve("app/data/generated");
  return existsSync(path.join(generated, "manifest.json"))
    ? generated
    : path.resolve("app/data/fixture");
}

function slugsFor(directory: string, type: string): string[] {
  const file = path.join(directory, `${type}.summaries.json`);
  if (!existsSync(file)) return [];
  const summaries = JSON.parse(readFileSync(file, "utf8")) as { slug: string }[];
  return summaries.map((summary) => summary.slug);
}

export default {
  // No runtime Node server. Content pages are prerendered to static HTML for
  // search-engine visibility and instant loads; everything else is served by
  // the SPA fallback.
  ssr: false,

  /**
   * Every content page is prerendered: the home page, the twenty-two type
   * indexes, the search page, and one page per item. That is what makes the library
   * visible to crawlers that do not run JavaScript, and it is also what keeps
   * the dataset out of the browser — each page ships only its own data,
   * serialized into its own static HTML.
   *
   * Prerendering is serial, and is left that way. It is now almost the whole
   * build — the canonical set went from 132 documents to 1,377 when the class
   * graph landed, and each one costs two requests against a preview server, an
   * HTML render and a data payload — so raising React Router's `concurrency`
   * off its default of 1 is the obvious lever. It was tried and put back: on
   * Windows the prerender client issues each request over its own socket with
   * `Connection: close`, and running four at once made the very first one fail
   * with a bare socket error. A build that finishes in six minutes beats one
   * that might finish in three.
   */
  async prerender() {
    const directory = datasetDirectory();
    const paths = ["/", "/search", "/sources", ...ACCOUNT_PATHS];

    // Kept in step with SOURCE_META in app/content/source-meta.ts. A source
    // page is a static page over the whole dataset, so it costs one route per
    // book rather than one per entry.
    for (const slug of ["phb", "ec", "wh", "snv", "sotg"]) {
      paths.push(`/sources/${slug}`);
    }

    for (const type of CONTENT_TYPES) {
      paths.push(`/${type}`);
      for (const slug of slugsFor(directory, type)) {
        paths.push(`/${type}/${slug}`);
      }
    }

    return paths;
  },
} satisfies Config;
