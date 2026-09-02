/**
 * The page the six subcategory addresses render, and the one thing about it
 * that is not obvious from looking at it: where its rows link to.
 *
 * A weapon is an equipment document. It has one page, at `/equipment/<slug>`,
 * and `/weapons` is a way of reaching that page rather than a second place for
 * it to live. Nothing on screen shows the difference — a row headed "Bo-rifle"
 * looks identical whether its href is `/equipment/bo-rifle` or
 * `/weapons/bo-rifle` — but the second one is a page that was never
 * prerendered, so it would answer 404 through nginx's SPA fallback while
 * rendering correctly for whoever clicked it in a browser. That is the
 * assertion this file exists for.
 *
 * The registry's predicates are tested directly in
 * `app/content/subcategory-views.test.ts`; what is checked here is that the
 * route actually goes through them, and that an empty view — which four of the
 * six are against the committed fixture — says so instead of crashing.
 */

import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { EquipmentSummary, PowerSummary } from "~/content/types";

const equipmentRows: EquipmentSummary[] = [
  {
    slug: "bo-rifle",
    name: "Bo-rifle",
    source: "PHB",
    tagline: null,
    category: "Weapon",
    cost: 3000,
    weight: 9,
    damage: "1d8 kinetic",
    armorClass: null,
    properties: null,
  },
  {
    slug: "combat-suit",
    name: "Combat suit",
    source: "PHB",
    tagline: null,
    category: "Armor",
    cost: 500,
    weight: 8,
    damage: null,
    armorClass: "12 + Dex modifier",
    properties: null,
  },
  {
    slug: "ammo-pouch",
    name: "Ammo pouch",
    source: "EC",
    tagline: null,
    category: "Weapon or armor accessory",
    cost: 15,
    weight: 0,
    damage: null,
    armorClass: null,
    properties: null,
  },
];

const powerRows: PowerSummary[] = [
  {
    slug: "force-push",
    name: "Force push",
    source: "PHB",
    tagline: null,
    level: 1,
    powerType: "Force",
    castingPeriod: "1 action",
    range: "30 feet",
    duration: "Instantaneous",
    concentration: false,
    forceAlignment: "Universal",
  },
  {
    slug: "overload",
    name: "Overload",
    source: "PHB",
    tagline: null,
    level: 1,
    powerType: "Tech",
    castingPeriod: "1 action",
    range: "Touch",
    duration: "Instantaneous",
    concentration: false,
    forceAlignment: null,
  },
];

/**
 * The dataset the route's loader reads, stubbed per test.
 *
 * Mocked rather than fed through props, because the filtering is the loader's
 * job: a test that handed the component pre-filtered rows would assert that
 * `ContentList` renders a list, which is already covered, and would go green
 * with the predicate deleted.
 */
vi.mock("~/content/dataset.server", () => ({
  getSummaries: vi.fn(),
}));

const { getSummaries } = await import("~/content/dataset.server");
const SubcategoryIndex = (await import("./subcategory-index")).default;
const { loader } = await import("./subcategory-index");

type Summaries = EquipmentSummary[] | PowerSummary[];

/** Runs the real loader for an address, then renders what it returned. */
async function renderView(path: string, rows: Summaries) {
  vi.mocked(getSummaries).mockReturnValue(rows as never);

  const loaderData = await loader({
    request: new Request(`https://sw5e.test${path}`),
    params: {},
    context: {} as never,
  } as never);

  const Stub = createRoutesStub([
    {
      path,
      Component: () =>
        SubcategoryIndex({ loaderData } as never),
    },
  ]);
  return render(<Stub initialEntries={[path]} />);
}

const EMPTY_STATE = /in this build of the reference yet/i;

describe("/weapons", () => {
  it("shows the weapons and none of the rest of the equipment", async () => {
    await renderView("/weapons", equipmentRows);

    expect(
      screen.getByRole("heading", { level: 1, name: "Weapons" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bo-rifle" })).toBeInTheDocument();

    // Both exclusions matter, and for different reasons: armor has a view of
    // its own, and the accessory is the row whose category begins with the
    // word this page is named after.
    expect(screen.queryByRole("link", { name: "Combat suit" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Ammo pouch" })).toBeNull();
  });

  it("links a row to the canonical item page, not into the subcategory", async () => {
    await renderView("/weapons", equipmentRows);

    // The whole point of the registry carrying a `type`. `/weapons/bo-rifle`
    // is not a prerendered file, so it would 404 to everything that reads a
    // status line — and a document with two addresses is two search results
    // competing with each other.
    expect(screen.getByRole("link", { name: "Bo-rifle" })).toHaveAttribute(
      "href",
      "/equipment/bo-rifle",
    );
  });

  it("counts in the noun the page is headed with", async () => {
    await renderView("/weapons", equipmentRows);

    // Equipment's `counted` is "items", which would read "1 items" here. See
    // the `countedNoun` prop on ContentList.
    expect(screen.getByText("1 weapons")).toBeInTheDocument();
  });

  it("offers the parent type as a way back to the other rows", async () => {
    await renderView("/weapons", equipmentRows);

    expect(screen.getByRole("link", { name: "Equipment" })).toHaveAttribute(
      "href",
      "/equipment",
    );
  });
});

describe("/other-equipment", () => {
  it("shows the tail and neither of the shelves that have their own page", async () => {
    await renderView("/other-equipment", equipmentRows);

    expect(
      screen.getByRole("heading", { level: 1, name: "Other equipment" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ammo pouch" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Bo-rifle" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Combat suit" })).toBeNull();
  });
});

describe("/force-powers", () => {
  it("splits the power list and still links into /powers", async () => {
    await renderView("/force-powers", powerRows);

    expect(
      screen.getByRole("heading", { level: 1, name: "Force powers" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Force push" })).toHaveAttribute(
      "href",
      "/powers/force-push",
    );
    expect(screen.queryByRole("link", { name: "Overload" })).toBeNull();
  });
});

describe("a view with nothing in it", () => {
  it("explains itself rather than crashing", async () => {
    // The committed fixture holds no starship equipment at all, so this is the
    // state `/starship-weapons` is in for every contributor without the
    // archive and in CI. It has to be a page that says so.
    await renderView("/starship-weapons", []);

    expect(
      screen.getByRole("heading", { level: 1, name: "Starship weapons" }),
    ).toBeInTheDocument();
    expect(screen.getByText(EMPTY_STATE)).toBeInTheDocument();
    expect(screen.getByText("0 starship weapons")).toBeInTheDocument();
  });
});

describe("an address that names no view", () => {
  it("answers 404 rather than rendering an unfiltered list", async () => {
    // Reachable only through the SPA fallback, but the alternative to throwing
    // is a page with no heading and every row of some type on it.
    vi.mocked(getSummaries).mockReturnValue(equipmentRows as never);

    await expect(
      loader({
        request: new Request("https://sw5e.test/blasters"),
        params: {},
        context: {} as never,
      } as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("resolves the view from the data request React Router makes on navigation", async () => {
    // A client-side navigation asks for `/weapons.data`, and that request runs
    // this same loader. Without the suffix being stripped the slug would be
    // "weapons.data", every subcategory page would 404 the moment a reader
    // reached it by clicking rather than by typing, and the prerendered
    // version would go on looking fine.
    vi.mocked(getSummaries).mockReturnValue(equipmentRows as never);

    const data = await loader({
      request: new Request("https://sw5e.test/weapons.data"),
      params: {},
      context: {} as never,
    } as never);

    expect(data.slug).toBe("weapons");
    expect(data.rows.map((row) => row.name)).toEqual(["Bo-rifle"]);
  });
});
