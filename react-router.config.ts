import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Config } from "@react-router/dev/config";

import { SUBCATEGORY_VIEWS } from "./app/content/subcategory-views";

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

  // Reports. Prerendered like the rest of the area, and — like the rest of it
  // — as a signed-out skeleton: the page has no loader, so nothing about a
  // moderation queue or anybody's reports is written into the static file.
  //
  // Adding this raised the prerendered route count by one. The container job in
  // .github/workflows/ci.yml adds a fixed number of content-free pages to the
  // document count, and that number went from 43 to 44 with this line.
  "/account/flags",

  // Administration. Three more content-free skeletons, for the same reason as
  // every other address here: leaving them to the SPA fallback would make them
  // answer 404 to a crawler, a monitor and a shared link while rendering
  // correctly in a browser.
  //
  // What is written to disk for each is the signed-out skeleton and nothing
  // else. None has a loader — see `app/routes/account-people.tsx` — so no
  // account directory and no audit trail can reach a static file. That is
  // load-bearing here in a way it is not on `/account/passkeys`: this is the
  // only part of the site that ever sees other people's email addresses.
  //
  // `/account/people/manage` is one address rather than one per account, and it
  // has to be. There is no bounded list of accounts to enumerate at build time,
  // and an account directory is the last thing a build machine should be
  // walking, so `/account/people/<id>` could not be prerendered at all — it
  // would render correctly in a browser while answering 404 to everything that
  // reads a status line. The account travels in the query string instead, which
  // does not change which file nginx serves. Only ever an opaque GUID: the
  // directory's search term is somebody's email address and never reaches a URL.
  //
  // Adding these raised the prerendered route count by two, then by one more
  // when managing an account became its own page. The container job in
  // .github/workflows/ci.yml adds a fixed number of content-free pages to the
  // document count, and that number went from 45 to 47 with the first two and
  // from 50 to 51 with the third.
  "/account/people",
  "/account/people/manage",
  "/account/audit",
] as const;

/**
 * The authoring workspace, prerendered as signed-out skeletons like the account
 * area and for exactly the same reasons: these addresses have to exist as files
 * or nginx answers 404 for them, and none of the three has a loader, so what
 * gets written to disk is a heading and nothing else.
 *
 * Three routes rather than one per document. The document being edited travels
 * in the query string — `/authoring/edit?type=class&key=guardian` — which is
 * what makes it possible to open the editor on something that does not exist
 * yet, and what keeps this list from growing with the corpus. A query string
 * does not change which file is served.
 *
 * Adding these raised the prerendered route count by three. The container job
 * in .github/workflows/ci.yml adds a fixed number of content-free pages to the
 * document count, and that number went from 47 to 50 with this block.
 */
const AUTHORING_PATHS = [
  "/authoring",
  "/authoring/edit",
  "/authoring/history",
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
    // `/about` is prerendered like the rest. It is the page a reader who
    // followed a dead sw5e.com link is most likely to reach through a search
    // engine rather than through this site's own navigation, so it is the last
    // page that can afford to need JavaScript before it says anything.
    // `/credits` prerenders for the same reason: attribution that only exists
    // once JavaScript has run is attribution a crawler never sees.
    const paths = [
      "/",
      "/about",
      "/search",
      "/sources",
      "/credits",
      ...ACCOUNT_PATHS,
      ...AUTHORING_PATHS,

      // The subcategory views — `/weapons`, `/armor`, `/other-equipment`,
      // `/force-powers`, `/tech-powers`, `/starship-weapons`. Read from the
      // registry rather than listed, so this list cannot fall out of step with
      // `app/routes.ts`, which declares its routes from the same array.
      //
      // These are the reason the views are paths at all. A filtered list is
      // only a real address on this site if it has a file: `?category=weapon`
      // would be answered by the unfiltered `/equipment/index.html`, so
      // everything that does not run the script — a crawler, a monitor, a
      // shared link opened with JavaScript off — would be handed all 505 rows
      // by an address claiming 215. Six more files buys six addresses that are
      // true before any script runs.
      //
      // Adding these raised the prerendered route count by six. The container
      // job in .github/workflows/ci.yml adds a fixed number of pages that do
      // not come from content to the document count, and that number went from
      // 51 to 57 with this block.
      ...SUBCATEGORY_VIEWS.map((view) => `/${view.slug}`),
    ];

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
