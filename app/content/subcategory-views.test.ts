/**
 * What each subcategory view selects, and — the half that is easy to get
 * wrong — what it leaves out.
 *
 * Most of the eleven are ordinary equality on a field and would be hard to break
 * subtly. Two shapes are not, and they fail the same way — a page that still
 * renders a plausible list.
 *
 * `/other-equipment` is defined by exclusion, so it is correct only relative to
 * its siblings. Miss the negation and a weapon appears on two indexes;
 * over-negate and 23 ammo pouches vanish from the site's navigation entirely,
 * because "Weapon or armor accessory" is the one category value that starts
 * with the word this view has to exclude.
 *
 * The three class-improvement views are equalities on values that contain one
 * another: "Class", "Multiclass" and "Splashclass". Any test that is not
 * whole-string selects all thirty rows onto all three pages, so those views are
 * asserted on their counts and on what they exclude, not on a representative
 * row.
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
  listHolding,
  parentCrumbOf,
  requireSubcategoryView,
  selectSubcategoryRows,
} from "./subcategory-views";
import type {
  AnySummary,
  ClassImprovementSummary,
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
    // These views cut rules by book and kind, never by reading position, so
    // nothing here is on the path.
    readingGroup: null,
    order: null,
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

/**
 * The ten classes the corpus carries an improvement for, in each of the three
 * kinds — which is the real shape of the type: thirty documents, ten per kind,
 * one per class per kind.
 *
 * Built at full size rather than one row per kind because the counts are the
 * assertion. "Selects its ten and leaves the other twenty" is a claim a
 * three-row fixture cannot make, and the thing most likely to go wrong here is
 * a predicate that takes too much: "Multiclass" and "Splashclass" both end in
 * the word the type is named after, so a substring match on "class" selects all
 * thirty and every page still renders a plausible list.
 */
const IMPROVEMENT_CLASSES = [
  "Berserker",
  "Consular",
  "Engineer",
  "Fighter",
  "Guardian",
  "Monk",
  "Operative",
  "Scholar",
  "Scout",
  "Sentinel",
];

function improvement(
  className: string,
  improvementType: string | null,
): ClassImprovementSummary {
  const kind = (improvementType ?? "unfiled").toLowerCase();
  return {
    slug: `${className.toLowerCase()}-${kind}-improvement`,
    name: `${className} ${improvementType ?? "Unfiled"} Improvement`,
    source: "EC",
    tagline: null,
    className,
    improvementType,
    prerequisite: `At least 3 levels in ${className.toLowerCase()}`,
  };
}

const IMPROVEMENTS: ClassImprovementSummary[] = [
  // The printed values, as `humanize` leaves them. Matching the raw enum —
  // `multiclass` — would pass against a fixture written the same wrong way and
  // select nothing at all in production.
  ...IMPROVEMENT_CLASSES.map((name) => improvement(name, "Class")),
  ...IMPROVEMENT_CLASSES.map((name) => improvement(name, "Multiclass")),
  ...IMPROVEMENT_CLASSES.map((name) => improvement(name, "Splashclass")),
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
      "class-improvements",
      "multiclass-improvements",
      "splashclass-improvements",
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
      "class-improvements",
      "class-improvements",
      "class-improvements",
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

/**
 * The three cuts of the class improvements, which are three subjects the
 * archive files as one type.
 *
 * Each is a single equality, so what is worth testing is not that the equality
 * works but that it is an equality: the three values are "Class",
 * "Multiclass" and "Splashclass", two of which end in the first. A substring
 * or a suffix test selects thirty rows on all three pages and looks entirely
 * correct doing it, which is why every assertion below is about the twenty
 * rows a page must not have as much as the ten it must.
 */
describe("the class improvement views", () => {
  it("puts the ten class improvements on /class-improvements", () => {
    const rows = selected("class-improvements", IMPROVEMENTS);

    expect(rows).toHaveLength(10);
    expect(rows).toContain("Guardian Class Improvement");
  });

  it("puts the ten multiclass improvements on /multiclass-improvements", () => {
    const rows = selected("multiclass-improvements", IMPROVEMENTS);

    expect(rows).toHaveLength(10);
    expect(rows).toContain("Guardian Multiclass Improvement");
  });

  it("puts the ten splashclass improvements on /splashclass-improvements", () => {
    const rows = selected("splashclass-improvements", IMPROVEMENTS);

    expect(rows).toHaveLength(10);
    expect(rows).toContain("Guardian Splashclass Improvement");
  });

  it("keeps the other twenty off each of the three", () => {
    /*
      The assertion the whole split exists for. A reader who arrives from the
      multiclassing rules must not be handed twenty rows about advancing in a
      class and dipping a level into one, and vice versa. "Multiclass" and
      "Splashclass" both end in "class", so this is what a careless predicate
      breaks first and nothing else would report.
    */
    for (const [slug, kept] of [
      ["class-improvements", "Class"],
      ["multiclass-improvements", "Multiclass"],
      ["splashclass-improvements", "Splashclass"],
    ] as const) {
      const rows = selected(slug, IMPROVEMENTS);

      expect(
        rows.filter((name) => !name.endsWith(`${kept} Improvement`)),
        `/${slug} is showing rows of another kind`,
      ).toEqual([]);
    }
  });

  it("covers every improvement exactly once between the three", () => {
    /*
      The property that lets `/class-improvements` be one of the three rather
      than an index above them: the three add up to the type, so nothing is
      stranded by there no longer being a page with all thirty on it. It is
      also the property `nav-groups.test.ts` re-checks against the real
      dataset, because this fixture cannot know what the archive adds next.
    */
    const filed = [
      ...selected("class-improvements", IMPROVEMENTS),
      ...selected("multiclass-improvements", IMPROVEMENTS),
      ...selected("splashclass-improvements", IMPROVEMENTS),
    ];

    expect(filed).toHaveLength(IMPROVEMENTS.length);
    expect(new Set(filed).size).toBe(IMPROVEMENTS.length);
  });

  it("strands a row whose kind is one nobody has written a view for", () => {
    /*
      Not a wish — a demonstration that the coverage assertion above and the
      dataset one in `nav-groups.test.ts` can actually fail. A fourth kind of
      improvement, or a record the reader failed to stamp, lands on none of the
      three; that is the failure those checks exist to report, and it is worth
      knowing it is reachable.
    */
    const withUnfiled = [...IMPROVEMENTS, improvement("Sentinel", null)];

    const filed = [
      ...selected("class-improvements", withUnfiled),
      ...selected("multiclass-improvements", withUnfiled),
      ...selected("splashclass-improvements", withUnfiled),
    ];

    expect(filed).toHaveLength(IMPROVEMENTS.length);
    expect(filed).not.toContain("Sentinel Unfiled Improvement");
  });

  it("does not read an improvement field the equipment rows do not have", () => {
    expect(selected("class-improvements", EQUIPMENT)).toEqual([]);
    expect(selected("multiclass-improvements", POWERS)).toEqual([]);
  });
});

/**
 * Where a page sends a reader who has decided this was the wrong list.
 *
 * For eight of the eleven views that is the type's own index, and for the three
 * class-improvement ones it cannot be: the type's segment is one of the three.
 * Without an answer here `/multiclass-improvements` would crumb up to a page
 * holding ten rows, none of them its own, and `/class-improvements` would crumb
 * up to itself.
 */
describe("the crumb above a view", () => {
  it("is the type's index for a shelf inside a type", () => {
    expect(parentCrumbOf(requireSubcategoryView("weapons"))).toEqual({
      label: "Equipment",
      to: "/equipment",
    });
  });

  it("is the hub for the three that have no index above them", () => {
    for (const slug of [
      "class-improvements",
      "multiclass-improvements",
      "splashclass-improvements",
    ]) {
      expect(
        parentCrumbOf(requireSubcategoryView(slug)),
        `/${slug} must not crumb up to a sibling that holds none of its rows`,
      ).toEqual({ label: "Customization options", to: "/customization-options" });
    }
  });
});

/**
 * The same question asked from a document's own page.
 *
 * A weapon crumbs up to `/equipment`, which holds it. A multiclass improvement
 * crumbing up to `/class-improvements` would be offered a list of ten rows that
 * does not contain it — so for the one type whose segment a view has taken, the
 * crumb follows the row.
 */
describe("the list a document belongs to", () => {
  it("is left to the type index for every type that still has one", () => {
    expect(listHolding("equipment", EQUIPMENT[0]!)).toBeUndefined();
    expect(listHolding("powers", POWERS[0]!)).toBeUndefined();
  });

  it("sends each improvement to whichever of the three actually holds it", () => {
    expect(listHolding("class-improvements", IMPROVEMENTS[0]!)?.slug).toBe(
      "class-improvements",
    );
    expect(listHolding("class-improvements", IMPROVEMENTS[10]!)?.slug).toBe(
      "multiclass-improvements",
    );
    expect(listHolding("class-improvements", IMPROVEMENTS[20]!)?.slug).toBe(
      "splashclass-improvements",
    );
  });

  it("admits it has no list for a row none of the three claims", () => {
    // The caller falls back to the type crumb, which is the least wrong thing
    // available — better than throwing on a page that renders fine otherwise.
    expect(
      listHolding("class-improvements", improvement("Sentinel", null)),
    ).toBeUndefined();
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

  it("adds eleven paths and no more, which is what CI counts", () => {
    // `.github/workflows/ci.yml` asserts the total number of prerendered
    // routes against the canonical content set by adding a fixed number of
    // content-free pages to it. That number went from 51 to 57 for the first
    // six, from 58 to 60 for the two rule views and from 60 to 62 for the
    // three class-improvement ones — three views less the type index they
    // replace — and a twelfth moves it again.
    expect(SUBCATEGORY_VIEWS).toHaveLength(11);
  });

  /*
    The other half of that arithmetic, and the half nothing else would notice.
    `/class-improvements` is a view now, so the build must stop writing a type
    index at that address — not because a duplicate path would break anything
    visible, but because the same page would be rendered twice under one
    filename and the prerender listing would be claiming a page the site does
    not have. Every other type keeps its index.
  */
  it("stops prerendering a type index at an address a view has taken", async () => {
    const paths = await prerenderConfig.prerender!();
    const indexes = paths.filter((path) => path === "/class-improvements");

    expect(indexes).toHaveLength(1);
    expect(paths).toContain("/feats");
    expect(paths).toContain("/class-improvements/berserker-class-improvement");
  });
});
