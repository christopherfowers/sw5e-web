/**
 * The type index is the page that broke.
 *
 * `/maneuvers` sat in the site's navigation for the whole of the project's
 * life and rendered "No maneuvers in this build of the reference yet", because
 * the canonical content set had no maneuvers to give it. It was a working page
 * showing nothing, which is the kind of failure no smoke test catches: the
 * route resolved, the heading rendered, the status was 200.
 *
 * So there are two assertions here and they pull in opposite directions. One
 * says a populated type must render its rows and must NOT show the empty
 * state — that is the regression guard for this domain, and it fails on an
 * import that produces no items. The other says the empty state itself still
 * works, because the site is still allowed to publish a type the content set
 * cannot feed and must say so rather than 404 on its own link.
 */

import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import TypeIndex from "./type-index";
import type { Route } from "./+types/type-index";
import type {
  AnySummary,
  ContentTypeId,
  FightingOptionSummary,
  LightsaberFormSummary,
  ManeuverSummary,
  WeaponTrainingSummary,
} from "~/content/types";

const maneuvers: ManeuverSummary[] = [
  {
    slug: "parry",
    name: "Parry",
    source: "PHB",
    tagline: "Physical maneuver",
    kind: "Physical",
    prerequisite: null,
    superiorityDice: 1,
    improves: null,
  },
  {
    slug: "administer-aid-greater",
    name: "Administer Aid (Greater)",
    source: "PHB",
    tagline: "Improves Administer Aid",
    kind: "Mental",
    prerequisite: "Administer Aid (Improved) maneuver",
    superiorityDice: 0,
    improves: "Administer Aid",
  },
  {
    slug: "tactical-assessment",
    name: "Tactical Assessment",
    source: "EC",
    tagline: "Mental maneuver",
    kind: "Mental",
    prerequisite: null,
    superiorityDice: 1,
    improves: null,
  },
];

const fightingStyles: FightingOptionSummary[] = [
  {
    slug: "duelist-style",
    name: "Duelist Style",
    source: "PHB",
    tagline: "No prerequisite",
    prerequisite: null,
    benefits: 2,
  },
  {
    slug: "formfighting-style",
    name: "Formfighting Style",
    source: "PHB",
    tagline: "Requires The ability to cast force powers",
    prerequisite: "The ability to cast force powers",
    benefits: 2,
  },
];

const lightsaberForms: LightsaberFormSummary[] = [
  {
    slug: "shii-cho-form",
    name: "Shii-Cho Form",
    source: "PHB",
    tagline: "Acts as you adopt it",
    prerequisite: null,
    onAdopt: true,
  },
  {
    slug: "juyo-form",
    name: "Juyo Form",
    source: "PHB",
    tagline: "Active while held",
    prerequisite: null,
    onAdopt: false,
  },
];

const weaponFocuses: WeaponTrainingSummary[] = [
  {
    slug: "blade-focus",
    name: "Blade Focus",
    source: "WH",
    tagline: "Blade weapons",
    weaponGroup: "Blade",
    benefits: 3,
  },
];

function renderIndex(type: ContentTypeId, rows: AnySummary[]) {
  const Stub = createRoutesStub([
    {
      path: `/${type}`,
      Component: () =>
        TypeIndex({
          loaderData: { type, rows },
        } as unknown as Route.ComponentProps),
    },
  ]);
  return render(<Stub initialEntries={[`/${type}`]} />);
}

/** The exact sentence the empty index publishes. */
const EMPTY_STATE = /in this build of the reference yet/i;

describe("Type index", () => {
  it("renders maneuvers rather than the empty state it used to show", () => {
    renderIndex("maneuvers", maneuvers);

    expect(
      screen.getByRole("heading", { level: 1, name: "Maneuvers" }),
    ).toBeInTheDocument();

    // The rows themselves, by name: a page that rendered the heading and no
    // rows is exactly the state this domain was in.
    expect(screen.getByRole("link", { name: "Parry" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Administer Aid (Greater)" }),
    ).toBeInTheDocument();

    expect(screen.queryByText(EMPTY_STATE)).toBeNull();
    // The eyebrow names the navigation group this type sits in; the count
    // lives in the list's own status line, which is the one that has to change
    // when a filter narrows it. Having both said "3" was the duplication this
    // replaced.
    expect(screen.getByText("Combat")).toBeInTheDocument();
    expect(screen.getByText("3 maneuvers")).toBeInTheDocument();
  });

  it("shows what a maneuver costs and what it upgrades", () => {
    renderIndex("maneuvers", maneuvers);

    const row = screen.getByRole("link", { name: "Parry" }).closest("tr");
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("Physical");

    const upgrade = screen
      .getByRole("link", { name: "Administer Aid (Greater)" })
      .closest("tr");

    // Zero dice and the maneuver it improves are the two facts that make a
    // tiered maneuver legible in a list of 119.
    expect(upgrade!.textContent).toContain("0");
    expect(upgrade!.textContent).toContain("Administer Aid");
  });

  it("renders every other combat-option type with its own columns", () => {
    const cases: [ContentTypeId, AnySummary[], string, string][] = [
      ["fighting-styles", fightingStyles, "Fighting Styles", "Duelist Style"],
      ["lightsaber-forms", lightsaberForms, "Lightsaber Forms", "Shii-Cho Form"],
      ["weapon-focuses", weaponFocuses, "Weapon Focuses", "Blade Focus"],
    ];

    for (const [type, rows, heading, firstRow] of cases) {
      const view = renderIndex(type, rows);

      expect(
        screen.getByRole("heading", { level: 1, name: heading }),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: firstRow })).toBeInTheDocument();
      expect(screen.queryByText(EMPTY_STATE)).toBeNull();

      view.unmount();
    }
  });

  it("marks which lightsaber forms act as they are adopted", () => {
    renderIndex("lightsaber-forms", lightsaberForms);

    const acts = screen.getByRole("link", { name: "Shii-Cho Form" }).closest("tr");
    const held = screen.getByRole("link", { name: "Juyo Form" }).closest("tr");

    expect(acts!.textContent).toContain("Acts");
    expect(held!.textContent).toContain("While held");
  });

  /**
   * The other half of the guard. Every type the site publishes has canonical
   * content behind it today, but the mechanism that copes with one that does
   * not is still load-bearing: `CANONICAL_DIRECTORIES` may carry a null again,
   * and a type index that 404s on a link its own header offers is worse than
   * one that explains itself.
   */
  it("still explains itself when a type genuinely has nothing in it", () => {
    renderIndex("maneuvers", []);

    expect(
      screen.getByRole("heading", { level: 1, name: "Maneuvers" }),
    ).toBeInTheDocument();
    expect(screen.getByText(EMPTY_STATE)).toBeInTheDocument();

    // The page still says where it sits, so an empty type is a page that
    // explains itself rather than a heading floating on its own.
    expect(screen.getByText("Combat")).toBeInTheDocument();
    expect(screen.getByText("0 maneuvers")).toBeInTheDocument();
  });
});
