/**
 * The header used to be one flat strip of twenty-three destinations. The count
 * is the failure — nobody scans twenty-three items, and the strip scrolled
 * sideways at every width — so the first test here is a count, and it is
 * written so that it fails against the flat strip it replaced.
 *
 * The rest is the part of a disclosure menu that is easy to ship broken: state
 * that is announced, one menu open at a time, Escape that does not strand
 * focus. Real keyboard operation in a real browser is covered by
 * `e2e/navigation.spec.ts`; jsdom does not implement `<summary>` activation, so
 * what is asserted here is the state machine rather than the key handling.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { GroupRail, GroupedNav } from "./site-nav";
import { NAVIGATION } from "~/content/nav-groups";
import { TYPE_META } from "~/content/type-meta";
import { CONTENT_TYPE_IDS } from "~/content/types";

/**
 * The most destinations the header may offer at its top level.
 *
 * Not a target the grouping was designed to hit — the groups came out of the
 * material — but a ceiling on what a reader has to scan before choosing. Eight
 * leaves room for the Tools area that is coming without this number moving.
 */
const MAX_TOP_LEVEL = 8;

function renderNav(path = "/powers") {
  const Stub = createRoutesStub([
    { path: "*", Component: () => <GroupedNav /> },
  ]);
  return render(<Stub initialEntries={[path]} />);
}

/**
 * Whatever the header's navigation offers before a reader opens anything.
 *
 * Deliberately selected as "the first list in the nav" rather than by the class
 * the grouped markup happens to use, so that the count assertion below is
 * measuring the header rather than measuring its own implementation. Pointed at
 * the flat strip this replaced, it returns twenty-three.
 */
function topLevelItems(): HTMLElement[] {
  const strip = screen
    .getByRole("navigation", { name: /^Content/ })
    .querySelector("ul");
  expect(strip, "the header navigation has no top-level list").not.toBeNull();

  return [...strip!.children].map((item) => {
    const control = item.querySelector<HTMLElement>(
      ":scope > a, :scope > details > summary",
    );
    expect(
      control,
      `a top-level navigation item renders no link and no menu: ${item.innerHTML}`,
    ).not.toBeNull();
    return control!;
  });
}

describe("the header's top level", () => {
  it("offers a handful of groups rather than one item per content type", () => {
    renderNav();

    const items = topLevelItems();

    expect(
      items.length,
      `the header offers ${items.length} top-level destinations for ` +
        `${CONTENT_TYPE_IDS.length} content types. That is the flat strip this ` +
        "grouping replaced.",
    ).toBeLessThanOrEqual(MAX_TOP_LEVEL);

    // Stated separately and deliberately: the ceiling above is only meaningful
    // while it is well under the number of types. If the corpus ever shrank to
    // eight types the first assertion would pass on a flat strip again.
    expect(items.length).toBeLessThan(CONTENT_TYPE_IDS.length);
  });

  it("names every group in the order they were agreed", () => {
    renderNav();

    expect(topLevelItems().map((item) => item.textContent?.trim())).toEqual([
      "Characters",
      "Combat",
      "Gear",
      "Starships",
      "Bestiary",
      "Reference",
    ]);
  });

  it("still leads to every content type, one menu deep", () => {
    renderNav();

    const links = [
      ...screen
        .getByRole("navigation", { name: "Content" })
        .querySelectorAll<HTMLAnchorElement>("a[href]"),
    ].map((anchor) => anchor.getAttribute("href"));

    for (const type of CONTENT_TYPE_IDS) {
      expect(
        links,
        `${TYPE_META[type].plural} is no longer reachable from the header`,
      ).toContain(`/${type}`);
    }
  });

  it("renders a group with a single destination as a link, not a menu", () => {
    renderNav();

    // Bestiary is one type today. A disclosure whose only job is to reveal one
    // link is a keystroke spent on nothing.
    const bestiary = topLevelItems().find(
      (item) => item.textContent?.trim() === "Bestiary",
    );

    expect(bestiary?.tagName).toBe("A");
    expect(bestiary).toHaveAttribute("href", "/monsters");
  });

  it("marks the group the current page belongs to", () => {
    renderNav("/starship-modifications");

    const current = topLevelItems().find((item) =>
      item.classList.contains("is-current"),
    );

    expect(current?.textContent?.trim()).toBe("Starships");
  });
});

/** The `<details>` for a group, by the word in the header. */
function menuFor(label: string): HTMLDetailsElement {
  const summary = screen.getByText(label, { selector: "summary" });
  return summary.closest("details")!;
}

describe("a group menu", () => {
  it("starts closed, so the prerendered page is the same for everyone", () => {
    renderNav();

    for (const group of NAVIGATION) {
      const summary = screen.queryByText(group.label, { selector: "summary" });
      if (summary) expect(summary.closest("details")!.open).toBe(false);
    }
  });

  it("opens and closes from the control that announces its state", async () => {
    const user = userEvent.setup();
    renderNav();

    const combat = menuFor("Combat");
    await user.click(within(combat).getByText("Combat"));
    expect(combat.open).toBe(true);

    await user.click(within(combat).getByText("Combat"));
    expect(combat.open).toBe(false);
  });

  it("shows only one menu at a time", async () => {
    const user = userEvent.setup();
    renderNav();

    const combat = menuFor("Combat");
    const characters = menuFor("Characters");

    await user.click(within(combat).getByText("Combat"));
    await user.click(within(characters).getByText("Characters"));

    expect(characters.open).toBe(true);
    expect(
      combat.open,
      "two panels open at once overlap each other and both are unreadable",
    ).toBe(false);
  });

  it("closes on Escape and hands focus back to the control", async () => {
    const user = userEvent.setup();
    renderNav();

    const combat = menuFor("Combat");
    const summary = within(combat).getByText("Combat");

    await user.click(summary);
    expect(combat.open).toBe(true);

    summary.focus();
    await user.keyboard("{Escape}");

    expect(combat.open).toBe(false);
    expect(
      summary,
      "Escape must not leave focus inside a panel that has just been hidden",
    ).toHaveFocus();
  });

  it("closes on Escape from anywhere on the page", async () => {
    const user = userEvent.setup();
    renderNav();

    const combat = menuFor("Combat");
    await user.click(within(combat).getByText("Combat"));
    expect(combat.open).toBe(true);

    // A reader who opened the menu with a pointer can have focus anywhere.
    // Escape bound to the bar itself would only answer while focus happened to
    // be inside it, and the menu would sit over the page with no way out.
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("{Escape}");

    expect(combat.open).toBe(false);
  });

  it("separates the types a reader browses from the ones they are sent to", async () => {
    const user = userEvent.setup();
    renderNav();

    const characters = menuFor("Characters");
    await user.click(within(characters).getByText("Characters"));

    const supporting = characters.querySelector(".nav-group-supporting");
    expect(
      supporting,
      "class improvements are reached from a class, never browsed, and must " +
        "not take a primary slot",
    ).not.toBeNull();
    expect(
      within(supporting as HTMLElement).getByRole("link", {
        name: TYPE_META["class-improvements"].plural,
      }),
    ).toHaveAttribute("href", "/class-improvements");

    // Still a primary destination in the same menu.
    expect(
      within(characters.querySelector(".nav-group-types")!).getByRole("link", {
        name: /Species/,
      }),
    ).toHaveAttribute("href", "/species");
  });
});

describe("the group rail", () => {
  function renderRail(path: string) {
    const Stub = createRoutesStub([
      { path: "*", Component: () => <GroupRail /> },
    ]);
    return render(<Stub initialEntries={[path]} />);
  }

  it("lists the siblings of the type being read", () => {
    renderRail("/maneuvers");

    const rail = screen.getByRole("navigation", { name: "Combat sections" });

    expect(
      within(rail).getByRole("link", { name: /Fighting Styles/ }),
    ).toHaveAttribute("href", "/fighting-styles");
    expect(
      within(rail).getByRole("link", { name: /Powers/ }),
    ).toHaveAttribute("href", "/powers");
  });

  it("follows an item page as well as an index", () => {
    renderRail("/powers/absorb-energy");

    expect(
      screen.getByRole("navigation", { name: "Combat sections" }),
    ).toBeInTheDocument();
  });

  it("renders nothing outside a content group", () => {
    const { container } = renderRail("/account/passkeys");

    expect(
      container.querySelector(".group-rail"),
      "a rail on the account area would be orientation for a group the " +
        "reader is not in",
    ).toBeNull();
  });
});
