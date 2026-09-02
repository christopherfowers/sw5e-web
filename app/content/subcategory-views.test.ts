/**
 * What each subcategory view selects, and — the half that is easy to get
 * wrong — what it leaves out.
 *
 * Most of the eight are ordinary equality on a field and would be hard to break
 * subtly. `/other-equipment` is not: it is defined by exclusion, so it is
 * correct only relative to its siblings, and every way of getting it wrong
 * produces a page that still renders a plausible list. Miss the negation and a
 * weapon appears on two indexes; over-negate and 23 ammo pouches vanish from
 * the site's navigation entirely, because "Weapon or armor accessory" is the
 * one category value that starts with the word this view has to exclude.
 *
 * The values matched are the printed ones — "Weapon", not `weapon`. The
 * archive's enums are expanded by `humanize` in `scripts/lib/normalize.mjs`
 * before they reach a summary, because a Category column has to show prose, so
 * the printed form is the only form these predicates ever see. The fixtures
 * below are written that way on purpose; matching the raw enum would pass a
 * test and select nothing in production.
 */

import { describe, expect, it } from "vitest";

import prerenderConfig from "../../react-router.config";
import {
  SUBCATEGORY_VIEWS,
  getSubcategoryView,
  requireSubcategoryView,
  selectSubcategoryRows,
} from "./subcategory-views";
import type {
  AnySummary,
  EquipmentSummary,
  PowerSummary,
  RuleSummary,
  StarshipEquipmentSummary,
} from "./types";

function equipment(
  name: string,
  category: string | null,
): EquipmentSummary {
  return {
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    source: "PHB",
    tagline: null,
    category,
    cost: 100,
    weight: 1,
    damage: null,
    armorClass: null,
    properties: null,
  };
}

function power(name: string, powerType: string | null): PowerSummary {
  return {
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    source: "PHB",
    tagline: null,
    level: 1,
    powerType,
    castingPeriod: "1 action",
    range: "Self",
    duration: "Instantaneous",
    concentration: false,
    forceAlignment: null,
  };
}

function shipPart(
  name: string,
  category: string | null,
): StarshipEquipmentSummary {
  return {
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    source: "SOTG",
    tagline: null,
    category,
    cost: 500,
    mounting: "Primary",
    damage: null,
    properties: null,
  };
}

/**
 * One row of each category the equipment corpus actually carries in quantity,
 * plus the two that exist to trip a sloppy predicate: an accessory whose
 * category begins with "Weapon", and an item with no category at all.
 */
const EQUIPMENT: EquipmentSummary[] = [
  equipment("Bo-rifle", "Weapon"),
  equipment("Combat suit", "Armor"),
  equipment("Power cell", "Ammunition"),
  equipment("Thermal detonator", "Explosive"),
  equipment("Medpac", "Medical"),
  equipment("Ammo pouch", "Weapon or armor accessory"),
  equipment("Unfiled oddity", null),
];

const POWERS: PowerSummary[] = [
  power("Force push", "Force"),
  power("Overload", "Tech"),
];

const SHIP_PARTS: StarshipEquipmentSummary[] = [
  shipPart("Laser cannon", "Weapon"),
  shipPart("Deflector shield", "Shield"),
  shipPart("Class 1 hyperdrive", "Hyperdrive"),
];

function rule(name: string, source: string, ruleType: string): RuleSummary {
  return {
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    source,
    tagline: null,
    ruleType,
    chapterNumber: ruleType === "Chapter" ? 1 : null,
    sectionCount: 3,
  };
}

/**
 * One row of each combination the rule corpus carries: chapters from three
 * books, and the variant rules that all happen to come from Expanded Content
 * today. The handbook variant is the row that matters — there is none in the
 * data yet, and the predicate is written for the day there is.
 */
const RULES: RuleSummary[] = [
  rule("Combat", "PHB", "Chapter"),
  rule("Entertainment and Downtime", "WH", "Chapter"),
  rule("Customization Options", "EC", "Chapter"),
  rule("Called Shots", "EC", "Variant"),
  rule("Hero Points", "PHB", "Variant"),
];

/** The names a view selects out of a set of rows, which is what a page shows. */
function selected(slug: string, rows: AnySummary[]): string[] {
  return selectSubcategoryRows(requireSubcategoryView(slug), rows).map(
    (row) => row.name,
  );
}

describe("the registry", () => {
  it("registers exactly the addresses the navigation needs", () => {
    expect(SUBCATEGORY_VIEWS.map((view) => view.slug)).toEqual([
      "weapons",
      "armor",
      "other-equipment",
      "force-powers",
      "tech-powers",
      "starship-weapons",
      "variant-rules",
      "expanded-rules",
    ]);
  });

  it("draws every view from a type the site actually publishes", () => {
    // A view pointed at a type that does not exist would take the whole
    // prerender down rather than degrade, since `getSummaries` reads a file
    // named after it.
    expect(SUBCATEGORY_VIEWS.map((view) => view.type)).toEqual([
      "equipment",
      "equipment",
      "equipment",
      "powers",
      "powers",
      "starship-equipment",
      "rules",
      "rules",
    ]);
  });

  it("looks a view up by its slug and admits when there is none", () => {
    expect(getSubcategoryView("weapons")?.label).toBe("Weapons");
    expect(getSubcategoryView("equipment")).toBeUndefined();
    expect(getSubcategoryView("")).toBeUndefined();
  });

  it("throws by name rather than rendering a page with no heading", () => {
    // What a route declared with no matching entry would hit. The slug is in
    // the message because that is the only thing that identifies which of
    // several identical-looking routes was wrong.
    expect(() => requireSubcategoryView("blasters")).toThrow(/blasters/);
  });
});

describe("the equipment views", () => {
  it("puts weapons on /weapons and nothing else", () => {
    expect(selected("weapons", EQUIPMENT)).toEqual(["Bo-rifle"]);
  });

  it("keeps accessories out of /weapons even though their category says weapon", () => {
    // "Weapon or armor accessory" is 23 rows of pouches, slings and holsters.
    // A prefix or substring match would file all of them as weapons.
    expect(selected("weapons", EQUIPMENT)).not.toContain("Ammo pouch");
  });

  it("puts armor on /armor and nothing else", () => {
    expect(selected("armor", EQUIPMENT)).toEqual(["Combat suit"]);
  });

  it("excludes from /other-equipment exactly what the sibling views claim", () => {
    const others = selected("other-equipment", EQUIPMENT);

    // The exclusions, named individually: this view is defined by them.
    expect(others).not.toContain("Bo-rifle");
    expect(others).not.toContain("Combat suit");

    // And the tail, which is the whole reason the view exists — 264 items
    // that belong to no shelf of their own and would otherwise be unreachable
    // from the Equipment menu.
    expect(others).toContain("Power cell");
    expect(others).toContain("Thermal detonator");
    expect(others).toContain("Medpac");
    expect(others).toContain("Ammo pouch");
  });

  it("files an item with no category under /other-equipment", () => {
    // `category` is nullable, and a row that has none is still an item a
    // reader has to be able to reach. Dropping it would make the three views
    // fail to add up to the type.
    expect(selected("other-equipment", EQUIPMENT)).toContain("Unfiled oddity");
  });

  it("covers every equipment row exactly once between the three views", () => {
    // The property that makes these three a partition of `/equipment` rather
    // than three overlapping searches. Nothing appears twice, nothing is
    // stranded, and the arithmetic on the type index still holds.
    const filed = [
      ...selected("weapons", EQUIPMENT),
      ...selected("armor", EQUIPMENT),
      ...selected("other-equipment", EQUIPMENT),
    ];

    expect(filed).toHaveLength(EQUIPMENT.length);
    expect(new Set(filed).size).toBe(EQUIPMENT.length);
  });
});

describe("the power views", () => {
  it("splits the power list by its type", () => {
    expect(selected("force-powers", POWERS)).toEqual(["Force push"]);
    expect(selected("tech-powers", POWERS)).toEqual(["Overload"]);
  });

  it("does not read a category field the powers do not have", () => {
    // The predicates are guarded by `in` checks, so a view pointed at the
    // wrong type selects nothing rather than throwing or, worse, matching on
    // `undefined === undefined`.
    expect(selected("weapons", POWERS)).toEqual([]);
  });
});

describe("the starship view", () => {
  it("selects ship weapons and leaves the other systems alone", () => {
    expect(selected("starship-weapons", SHIP_PARTS)).toEqual(["Laser cannon"]);
  });

  it("takes its rows from starship equipment, not from the character list", () => {
    // Both types spell the category "Weapon", so the only thing keeping a
    // bo-rifle off the starship page is which summaries file the view reads.
    expect(requireSubcategoryView("starship-weapons").type).toBe(
      "starship-equipment",
    );
    expect(requireSubcategoryView("weapons").type).toBe("equipment");
  });
});

/**
 * The two cuts of the rule text, which are the two axes a rule document has and
 * the only two views here that are not a single equality.
 *
 * `/variant-rules` is cut on `ruleType` alone, and the Player's Handbook
 * variant in the fixture above is the whole reason: every variant rule in the
 * corpus today is Expanded Content, so a predicate that also tested the source
 * would pass every test written against real data and silently drop the first
 * variant rule printed anywhere else.
 *
 * `/expanded-rules` is cut on both, and has to be. Dropping the `ruleType` half
 * would swallow the forty variant rules into a page about ten chapters;
 * dropping the source half would put every chapter of every book on it.
 */
describe("the rule views", () => {
  it("takes every variant rule, whichever book printed it", () => {
    expect(selected("variant-rules", RULES)).toEqual([
      "Called Shots",
      "Hero Points",
    ]);
  });

  it("takes Expanded Content's chapters and nothing else", () => {
    expect(selected("expanded-rules", RULES)).toEqual([
      "Customization Options",
    ]);
  });

  it("keeps the two apart rather than overlapping them", () => {
    // Expanded Content is the source of both the chapters and every variant
    // rule in the corpus, so these two views are one careless predicate away
    // from being the same page twice.
    const variants = selected("variant-rules", RULES);
    const expanded = selected("expanded-rules", RULES);

    expect(variants.filter((name) => expanded.includes(name))).toEqual([]);
  });

  it("leaves the other books' chapters to their own pages", () => {
    // The handbook, Wretched Hives and Starships of the Galaxy each have an
    // entry of their own in the Rules menu, pointing at the book rather than at
    // a slice of the rule type.
    const filed = [
      ...selected("variant-rules", RULES),
      ...selected("expanded-rules", RULES),
    ];

    expect(filed).not.toContain("Combat");
    expect(filed).not.toContain("Entertainment and Downtime");
  });

  it("does not read a rule field the equipment rows do not have", () => {
    expect(selected("variant-rules", EQUIPMENT)).toEqual([]);
    expect(selected("expanded-rules", EQUIPMENT)).toEqual([]);
  });
});

describe("an empty view", () => {
  it("selects nothing rather than failing when the dataset has no rows", () => {
    // Not hypothetical: the committed fixture in `app/data/fixture` holds no
    // starship equipment and no weapons at all, so half of these views render
    // empty on a contributor's machine and in CI.
    for (const view of SUBCATEGORY_VIEWS) {
      expect(selectSubcategoryRows(view, [])).toEqual([]);
    }
  });
});

/**
 * The half of this feature that nothing else can observe.
 *
 * A subcategory view that is declared as a route but left out of the prerender
 * list still works: `npm run dev` serves it, the e2e suite clicks through it,
 * every test above stays green. What happens instead is that no file is
 * written for it, so nginx answers it from the SPA fallback — which is wired
 * to `error_page 404`. The page renders perfectly in a browser and is broken
 * to a crawler, a monitor and a shared link, which is the exact failure the
 * whole design of these addresses exists to avoid.
 *
 * So this asserts against the build's own configuration rather than against
 * the app. See the same argument, at length, in
 * `app/auth/prerender-safety.test.ts`.
 */
describe("every view is prerendered rather than left to the SPA fallback", () => {
  it.each(SUBCATEGORY_VIEWS.map((view) => view.slug))(
    "/%s has a file of its own",
    async (slug) => {
      const paths = await prerenderConfig.prerender!();

      expect(paths).toContain(`/${slug}`);
    },
  );

  it("adds eight paths and no more, which is what CI counts", () => {
    // `.github/workflows/ci.yml` asserts the total number of prerendered
    // routes against the canonical content set by adding a fixed number of
    // content-free pages to it. That number went from 51 to 57 for the first
    // six and from 58 to 60 for the two rule views, and a ninth moves it
    // again.
    expect(SUBCATEGORY_VIEWS).toHaveLength(8);
  });
});
