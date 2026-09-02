/**
 * The addresses that name a slice of a content type rather than a type.
 *
 * The navigation the site wants offers Weapons, Armor, Other equipment, Force
 * powers, Tech powers, Starship weapons, Variant rules, Expanded rules and the
 * three kinds of class improvement. Not one of them is a content type.
 * "Weapon" is a value of `category` on 215 of the 505 equipment documents;
 * "Force" is a value of `powerType` on 233 of the 465 powers; a variant rule is
 * 40 of the 75 rule documents; "Multiclass" is a value of `improvementType` on
 * 10 of the 30 class improvements. A reader could not
 * address any of them at all — `app/routes/type-index.tsx`
 * reads no search parameters, so the list a reader assembled with the Category
 * dropdown had no URL to share, and a menu entry had nothing to point at.
 *
 * These are path segments and not query strings, and that is forced rather than
 * preferred. There is no runtime server here: every published address is
 * prerendered to a file at build time, and anything without a file of its own
 * falls through to nginx's SPA fallback, which is wired to `error_page 404`.
 * `/equipment?category=weapon` would be answered with the unfiltered
 * `/equipment/index.html`, so a crawler, a monitor and a reader with
 * JavaScript switched off would each be handed all 505 rows by an address
 * claiming to hold 215 — and the filtering would only ever happen in a browser
 * that ran the script. A path segment gets its own file. See
 * `react-router.config.ts`, which prerenders one per entry below.
 *
 * A registry rather than one route module per view, because eleven
 * near-identical modules is eleven places for one page to drift. Every view here is the same
 * table with fewer rows in it: the columns, the sorting and the facet dropdowns all come
 * from the source type's entry in `./list-config.tsx`, and the row links go to
 * the same canonical `/equipment/<slug>` addresses they always did. The only
 * things that differ are the address, the words at the top, and which rows
 * qualify — which is exactly what an entry below declares. A twelfth view is
 * one more entry: `app/routes.ts` declares a route per entry and
 * `react-router.config.ts` prerenders a path per entry, so neither of them is
 * a step anybody has to remember.
 *
 * What is deliberately NOT here is a second home for a document. A weapon's
 * page stays at `/equipment/<slug>`; there is no `/weapons/<slug>`. One
 * document with two addresses is two pages competing in search results, and
 * every link into the corpus — the search index, the pager, the source pages —
 * would have to pick one of them and be wrong on the other.
 */

import { TYPE_META } from "./type-meta";
import type { AnySummary, ContentTypeId } from "./types";

/**
 * The archive's enum values reach a summary already expanded into prose:
 * `weapon` is stored as "Weapon" and `WeaponOrArmorAccessory` as "Weapon or
 * armor accessory", because that is the string the Category column and the
 * facet dropdown put on screen. See `humanize` in `scripts/lib/normalize.mjs`.
 *
 * So matching happens on the printed value, lower-cased, and on the whole
 * string. Whole-string rather than a prefix or a substring test: "Weapon or
 * armor accessory" is 23 ammo pouches and holsters that are emphatically not
 * weapons, and a `startsWith` here would file every one of them under
 * `/weapons` and take them out of `/other-equipment` at the same time.
 */
function equals(value: string | null, expected: string): boolean {
  return value != null && value.toLowerCase() === expected;
}

/**
 * The field reads the views need, each guarded by an `in` check.
 *
 * `AnySummary` is the union of all twenty-seven row shapes and most of them
 * have none of these fields — a species has no category — so the guard is what
 * makes a predicate total over the union rather than a cast that would quietly
 * return `undefined` if a view were ever pointed at the wrong type.
 */
function categoryIs(row: AnySummary, category: string): boolean {
  return "category" in row && equals(row.category, category);
}

function powerTypeIs(row: AnySummary, powerType: string): boolean {
  return "powerType" in row && equals(row.powerType, powerType);
}

/**
 * Whether a rule document is a chapter of a book or an optional rule.
 *
 * The same `in` guard as the two above, and for the same reason: only
 * `RuleSummary` carries the field, so reading it off `AnySummary` unguarded
 * would compile into `undefined` on the other twenty-six row shapes.
 */
function ruleTypeIs(row: AnySummary, ruleType: string): boolean {
  return "ruleType" in row && equals(row.ruleType, ruleType);
}

/**
 * Which of the three things a class improvement is.
 *
 * The archive keeps them in three dumps — ClassImprovement,
 * MulticlassImprovement, SplashclassImprovement — of identical shape, and
 * `scripts/lib/normalize.mjs` reads all three into one type, stamping each
 * record with the dump it came from because nothing in the record says. So
 * `improvementType` is the only thing separating three unrelated questions:
 * what a class gives you as you advance in it, what it gives you when you
 * multiclass into it, and what a single splashed level is worth.
 *
 * Whole-string equality through `equals`, and the value is the printed one —
 * `humanize` turns `splashclass` into "Splashclass" before it reaches a
 * summary, because the column shows prose. Matching the raw enum would pass
 * a hand-written test and select nothing in production.
 *
 * The whole-string part earns its keep differently here than it does for
 * weapons. "Multiclass" and "Splashclass" both *end* in the word this type is
 * named after, so a substring test on "class" would take all thirty rows onto
 * every one of the three pages and leave nothing anywhere to notice.
 */
function improvementTypeIs(row: AnySummary, improvementType: string): boolean {
  return (
    "improvementType" in row && equals(row.improvementType, improvementType)
  );
}

/** The book a row came from. Unguarded, because every summary carries `source`. */
function sourceIs(row: AnySummary, code: string): boolean {
  return equals(row.source, code);
}

/**
 * The equipment categories that have a view of their own.
 *
 * Written once because `/other-equipment` is defined by exclusion — it is
 * whatever its siblings did not claim — and a hand-kept list of negations
 * would be two lists to keep in step with a silent failure mode. Give
 * ammunition its own view without adding it here and all 50 rows appear on
 * both indexes; neither page looks broken, and nothing goes red.
 */
const CLAIMED_EQUIPMENT_CATEGORIES = ["weapon", "armor"] as const;

/**
 * The crumb above the three class-improvement views.
 *
 * Written here rather than resolved from `./nav-groups.ts`, which is the module
 * that owns the hub: nav-groups imports this file to turn a slug into a menu
 * entry, so reading it back would be a cycle. One path and one label, and
 * `nav-groups.test.ts` asserts that the address is one the build writes a file
 * for, which is the part that could rot.
 */
const CUSTOMIZATION_OPTIONS_CRUMB = {
  label: "Customization options",
  to: "/customization-options",
} as const;

export interface SubcategoryView {
  /**
   * The path segment, which is also the registry key. A top-level segment —
   * `/weapons`, not `/equipment/weapons` — because the reader is being sent
   * here from a menu, and because a nested path would collide with the
   * `:type/:slug` route that owns every address under `/equipment`.
   */
  slug: string;
  /** The heading, the table's caption, and the last crumb. */
  label: string;
  /**
   * The noun to put after a numeral, which is not always the heading. The
   * count line reads "26 pieces of armor" because "26 armor" is not English,
   * for the same reason `TypeMeta.counted` exists.
   */
  counted: string;
  /** One line saying what a reader will find, as a type's blurb does. */
  blurb: string;
  /**
   * The type the rows are drawn from, and the type their links point into. It
   * also decides the accent and the icon, so a weapons page reads as an
   * equipment page rather than as a colour of its own — it is not a new
   * subject, it is a shelf in an existing one.
   */
  type: ContentTypeId;
  /** Whether one row of `type` belongs on this view. */
  includes: (row: AnySummary) => boolean;
  /**
   * The crumb above this page, when the type's own index is the wrong answer.
   *
   * A shelf normally sits under the type it is a shelf of: `/weapons` crumbs up
   * to `/equipment`, which is where a reader goes when the shelf was the wrong
   * one. That only works while `/<type>` is still an index over the whole type,
   * and for the class improvements it is not — `/class-improvements` is one of
   * the three cuts rather than the thing above them, so the default would make
   * `/multiclass-improvements` crumb up to a sibling that does not contain a
   * single one of its rows, and `/class-improvements` crumb up to itself.
   *
   * Optional, because seven of the eleven views want the default and writing it
   * out eleven times is seven chances to write it differently.
   */
  parent?: { label: string; to: string };
}

/**
 * Grouped by the type the rows come from: the three equipment shelves, the two
 * halves of the power list, the starship one, the two cuts of the rule text,
 * then the three kinds of class improvement.
 */
export const SUBCATEGORY_VIEWS: readonly SubcategoryView[] = [
  {
    slug: "weapons",
    label: "Weapons",
    counted: "weapons",
    blurb:
      "Blasters, vibroblades and lightsabers, with what they cost, what they weigh and what they do.",
    type: "equipment",
    includes: (row) => categoryIs(row, "weapon"),
  },
  {
    slug: "armor",
    label: "Armor",
    counted: "pieces of armor",
    blurb: "Light, medium and heavy armor, with cost, weight and armor class.",
    type: "equipment",
    includes: (row) => categoryIs(row, "armor"),
  },
  {
    slug: "other-equipment",
    label: "Other equipment",
    counted: "items",
    blurb:
      "Ammunition, explosives, kits, utilities and everything else a character carries.",
    type: "equipment",
    /*
      The one predicate here that is a negation, and the one worth being
      careful about: it has to keep meaning "the rest" after somebody adds a
      view. Reading the sibling list rather than repeating it is what makes
      that true by construction.
    */
    includes: (row) =>
      !CLAIMED_EQUIPMENT_CATEGORIES.some((category) =>
        categoryIs(row, category),
      ),
  },
  {
    slug: "force-powers",
    label: "Force powers",
    counted: "force powers",
    blurb: "Force powers by level, casting time, range and alignment.",
    type: "powers",
    includes: (row) => powerTypeIs(row, "force"),
  },
  {
    slug: "tech-powers",
    label: "Tech powers",
    counted: "tech powers",
    blurb: "Tech powers by level, casting time and range.",
    type: "powers",
    includes: (row) => powerTypeIs(row, "tech"),
  },
  {
    slug: "starship-weapons",
    label: "Starship weapons",
    counted: "starship weapons",
    blurb: "Ship-mounted weapons by mounting, damage and cost.",
    type: "starship-equipment",
    includes: (row) => categoryIs(row, "weapon"),
  },

  /*
    The two cuts of the rule text, which are the two axes a rule document has.

    `ruleType` separates a chapter of a book from an optional rule a table
    switches on; `source` says which book it came from. Variant rules are cut on
    ruleType alone, and that is deliberate rather than lazy: all forty of them
    are Expanded Content today, but a variant rule printed in a future book is
    still a variant rule — the handbook's own Appendix B recommends a list of
    them — and adding `source` to this predicate would silently drop it.

    Expanded rules are cut on both, and have to be. Expanded Content's ten
    chapters are the only chapters in the corpus with no book of their own in
    the header: the Player's Handbook, Wretched Hives and Starships of the
    Galaxy each get an entry, and EC's chapters extend chapters those books
    already have rather than teaching something new. Without this view they are
    reachable only through `/sources/ec`, which is a page about a book.

    Neither of these covers the rule type on its own and they are not meant to —
    fifty of the seventy-five rows between them. `/rules` is still the index
    that holds all of them, and `nav-groups.test.ts` is what notices if it ever
    stops being offered.
  */
  {
    slug: "variant-rules",
    label: "Variant rules",
    counted: "variant rules",
    blurb:
      "The optional rules a table can turn on, from ability score changes to called shots and combination weapons.",
    type: "rules",
    includes: (row) => ruleTypeIs(row, "variant"),
  },
  {
    slug: "expanded-rules",
    label: "Expanded rules",
    counted: "chapters",
    blurb:
      "Expanded Content's own chapters: the community's additions to species, archetypes, equipment, powers and the rest.",
    type: "rules",
    includes: (row) => sourceIs(row, "ec") && ruleTypeIs(row, "chapter"),
  },

  /*
    The three kinds of class improvement, which are three subjects filed as one
    type because the archive's three dumps have identical fields.

    These are not shelves in the sense the equipment views are. `/weapons` is a
    slice of a list a reader might sensibly read whole; `/class-improvements`
    was thirty rows answering three different questions, and a reader who
    arrived from the multiclassing rules was handed twenty rows about something
    they had not asked about. The site this one replaces published the three
    separately — classImprovements, multiclassImprovements and
    splashclassImprovements, each its own page under Customization Options —
    and that split is the reader's expectation as much as the owner's.

    Which is why `/class-improvements` is the first of the three rather than
    the index above them. That address is a static segment here and therefore
    outranks the `:type` route, so the thirty-row type index no longer has a
    published address at all — deliberately, and this is the decision worth
    stating: the alternative was to leave the index where it was and put the
    class-only cut somewhere else, which would have left two addresses both
    saying "class improvements" and disagreeing about which ten or thirty rows
    that means. One of them would have been wrong on every link, every crumb
    and every search result. Nothing is lost by dropping the union — the three
    views partition it exactly, `nav-groups.test.ts` proves that against the
    dataset, and no reader ever wanted the merged list. `react-router.config.ts`
    stops prerendering the type index for this one type for the same reason.

    Their crumb goes up to the customization options hub rather than to a type
    index that is no longer there. See `parent` above.
  */
  {
    slug: "class-improvements",
    label: "Class improvements",
    counted: "class improvements",
    blurb:
      "What each class grants a character who keeps advancing in it, and the level it takes to qualify.",
    type: "class-improvements",
    includes: (row) => improvementTypeIs(row, "class"),
    parent: CUSTOMIZATION_OPTIONS_CRUMB,
  },
  {
    slug: "multiclass-improvements",
    label: "Multiclass improvements",
    counted: "multiclass improvements",
    blurb:
      "What a character gains by taking levels in a second class, and what each class asks of them first.",
    type: "class-improvements",
    includes: (row) => improvementTypeIs(row, "multiclass"),
    parent: CUSTOMIZATION_OPTIONS_CRUMB,
  },
  {
    slug: "splashclass-improvements",
    label: "Splashclass improvements",
    counted: "splashclass improvements",
    blurb:
      "What a single splashed level in a class is worth, for a character dipping into it rather than taking it up.",
    type: "class-improvements",
    includes: (row) => improvementTypeIs(row, "splashclass"),
    parent: CUSTOMIZATION_OPTIONS_CRUMB,
  },
];

const BY_SLUG = new Map(SUBCATEGORY_VIEWS.map((view) => [view.slug, view]));

/** The view at a path segment, or `undefined` if the segment names no view. */
export function getSubcategoryView(slug: string): SubcategoryView | undefined {
  return BY_SLUG.get(slug);
}

/**
 * The same lookup for callers that have already been past the loader's 404 and
 * cannot proceed without a view. It throws rather than returning `undefined`
 * so that a route declared without a matching entry fails at the first render
 * with the slug in the message, instead of rendering a page with no heading.
 */
export function requireSubcategoryView(slug: string): SubcategoryView {
  const view = BY_SLUG.get(slug);
  if (!view) {
    throw new Error(`No subcategory view is registered for "${slug}"`);
  }
  return view;
}

/** The rows of `view.type` that belong on `view`, in the dataset's order. */
export function selectSubcategoryRows(
  view: SubcategoryView,
  rows: readonly AnySummary[],
): AnySummary[] {
  return rows.filter((row) => view.includes(row));
}

/**
 * The crumb above a view's page: what it declared, or the type it slices.
 *
 * The fallback lives here rather than in `app/routes/subcategory-index.tsx` so
 * that "which list is above this one" has one answer, and so that the two
 * callers that need it — the shelf page and a document's own page — cannot
 * drift into disagreeing about where a reader goes when the shelf was wrong.
 */
export function parentCrumbOf(view: SubcategoryView): {
  label: string;
  to: string;
} {
  return (
    view.parent ?? { label: TYPE_META[view.type].plural, to: `/${view.type}` }
  );
}

/**
 * The view that has taken a type's own path segment, if one has.
 *
 * Exactly one has today — `/class-improvements` is a cut of the class
 * improvements rather than an index over them — and the point of asking rather
 * than naming it is that everything downstream keeps working the day somebody
 * puts the union back, or does the same thing to another type.
 */
function viewClaiming(type: ContentTypeId): SubcategoryView | undefined {
  return SUBCATEGORY_VIEWS.find((view) => view.slug === type);
}

/**
 * The list a single document should send a reader back up to, when `/<type>`
 * is no longer that list.
 *
 * A document page crumbs up to its type's index, which is right for
 * twenty-six of the twenty-seven types and actively wrong for the
 * twenty-seventh: a multiclass improvement that crumbed to
 * `/class-improvements` would be offering a reader a list of ten rows that
 * does not include the one they are standing on. So when a view has claimed
 * the type's segment, the crumb follows the row instead, to whichever of the
 * views actually holds it.
 *
 * `undefined` for every other type, which is the caller's signal to keep the
 * ordinary type-index crumb rather than a second rule to remember.
 */
export function listHolding(
  type: ContentTypeId,
  row: AnySummary,
): SubcategoryView | undefined {
  if (!viewClaiming(type)) return undefined;
  return SUBCATEGORY_VIEWS.find(
    (view) => view.type === type && view.includes(row),
  );
}
