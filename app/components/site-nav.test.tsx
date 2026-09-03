/**
 * The header used to be one flat strip of twenty-three destinations, and the
 * count was the failure — nobody scans twenty-three items, and the strip
 * scrolled sideways at every width. So the first test here is a count, and it
 * is written so that it fails against the flat strip it replaced.
 *
 * The second is the menu the site's owner specified, asserted entry by entry
 * and in order. That is a blunt test and it is meant to be: the menus are an
 * editorial decision rather than a projection of the data, so the only thing
 * that can catch a well-meaning reshuffle is a written-down copy of what was
 * agreed. Whether every content type remains *reachable* through it is a
 * different question and is answered against the dataset in
 * `app/content/nav-groups.test.ts`.
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
import { CONTENT_TYPE_IDS } from "~/content/types";

/**
 * The most destinations the header may offer at its top level.
 *
 * Not a target the grouping was designed to hit — the groups came out of the
 * material — but a ceiling on what a reader has to scan before choosing. Eight
 * leaves room for the Tools area that is coming, and for the Resources menu
 * that is specified and cannot be built until somebody supplies its five
 * addresses, without this number moving.
 */
const MAX_TOP_LEVEL = 8;

function renderNav(path = "/maneuvers") {
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
      // The books first, because a reader who does not yet know the game needs
      // the rules before a list of things to choose from.
      "Rules",
      "Characters",
      // Named after the chapter rather than after a word for the category:
      // Equipment is chapter 5 of the Player's Handbook, and "Gear" is a word
      // the reader has never seen in print.
      "Equipment",
      "Starships",
      "NPC statblocks",
      // The sheets, which are the one set of links that leave this site.
      "Resources",
    ]);
  });

  it("renders a group with a single destination as a link, not a menu", () => {
    renderNav();

    // Creatures is the whole of the group: there is no vehicle or starship stat
    // block anywhere in the corpus. A disclosure whose only job is to reveal one
    // link is a keystroke spent on nothing.
    const statblocks = topLevelItems().find(
      (item) => item.textContent?.trim() === "NPC statblocks",
    );

    expect(statblocks?.tagName).toBe("A");
    expect(statblocks).toHaveAttribute("href", "/monsters");
  });

  it("marks the group the current page belongs to", () => {
    renderNav("/starship-modifications");

    const current = topLevelItems().find((item) =>
      item.classList.contains("is-current"),
    );

    expect(current?.textContent?.trim()).toBe("Starships");
  });

  /*
    Most of what the header now offers is not a content type, so resolving the
    current group by looking the first path segment up in `TYPE_NAV` would leave
    the reader unmarked on the majority of the pages the menus send them to.
  */
  it.each([
    ["/weapons", "Equipment"],
    ["/customization-options", "Characters"],
    ["/variant-rules", "Rules"],
    ["/equipment/vibrorapier", "Equipment"],
  ])("marks the group on %s", (path, group) => {
    renderNav(path);

    const current = topLevelItems().find((item) =>
      item.classList.contains("is-current"),
    );

    expect(current?.textContent?.trim()).toBe(group);
  });
});

/** The `<details>` for a group, by the word in the header. */
function menuFor(label: string): HTMLDetailsElement {
  const summary = screen.getByText(label, { selector: "summary" });
  return summary.closest("details")!;
}

function entriesIn(menu: HTMLElement, selector: string) {
  return [...menu.querySelectorAll<HTMLAnchorElement>(`${selector} a[href]`)].map(
    (anchor) => [anchor.getAttribute("href"), anchor.textContent?.trim()],
  );
}

/**
 * The menu the site's owner specified, written out.
 *
 * Order is asserted along with membership because the order is the argument:
 * Rules opens with the three books that teach something and only then offers
 * the two cuts of the rule text; Characters walks a reader down the character
 * sheet — what you are, what you become, where you came from, what you take on
 * top — rather than listing types alphabetically.
 */
describe("the menu behind each group", () => {
  it.each([
    [
      "Rules",
      [
        ["/sources/phb", "Player's Handbook"],
        ["/sources/wh", "Wretched Hives"],
        ["/sources/sotg", "Starships of the Galaxy"],
        ["/variant-rules", "Variant rules"],
        ["/expanded-rules", "Expanded rules"],
      ],
      [
        ["/rules", "All rules"],
        ["/reference-tables", "Reference tables"],
        ["/sources", "Source books"],
      ],
    ],
    [
      "Characters",
      [
        ["/species", "Species"],
        ["/classes", "Classes"],
        ["/archetypes", "Archetypes"],
        ["/backgrounds", "Backgrounds"],
        ["/feats", "Feats"],
        ["/customization-options", "Customization options"],
        ["/force-powers", "Force powers"],
        ["/tech-powers", "Tech powers"],
        ["/maneuvers", "Maneuvers"],
      ],
      /*
        The quiet half of Characters. The three class-improvement cuts are here
        rather than beside Feats because nobody browses an improvement — they
        arrive from the class table that grants one — and they are here at all
        rather than only on the customization hub because a reader standing on
        one of the three needs the other two without a trip through a third
        page.
      */
      [
        ["/features", "Features"],
        ["/class-improvements", "Class improvements"],
        ["/multiclass-improvements", "Multiclass improvements"],
        ["/splashclass-improvements", "Splashclass improvements"],
      ],
    ],
    [
      "Equipment",
      [
        ["/armor", "Armor"],
        ["/weapons", "Weapons"],
        ["/other-equipment", "Other equipment"],
        ["/enhanced-items", "Enhanced items"],
      ],
      [
        ["/weapon-properties", "Weapon properties"],
        ["/armor-properties", "Armor properties"],
      ],
    ],
    [
      "Starships",
      [
        ["/starship-deployments", "Character deployments"],
        ["/starship-ventures", "Character ventures"],
        ["/starship-modifications", "Starship modifications"],
        ["/starship-equipment", "Starship equipment"],
        ["/starship-weapons", "Starship weapons"],
      ],
      [
        // Not in the owner's table, and six documents that everything else in
        // this menu is fitted to. Quiet rather than absent.
        ["/starship-base-sizes", "Starship hulls"],
        ["/starship-rules", "Starship rules"],
      ],
    ],
  ])("%s leads where it was asked to", (label, primary, supporting) => {
    renderNav();
    const menu = menuFor(label as string);

    expect(entriesIn(menu, ".nav-group-types")).toEqual(primary);
    expect(entriesIn(menu, ".nav-group-supporting")).toEqual(supporting);
  });

  /*
    The two halves are marked up differently and read differently, and that has
    to survive: the quiet half is a separate list under its own subhead, not
    four more entries in the same run. Without the subhead a screen reader hears
    thirteen equally-weighted links in Characters.
  */
  it("separates what the menu is for from what it merely keeps reachable", async () => {
    const user = userEvent.setup();
    renderNav();

    const equipment = menuFor("Equipment");
    await user.click(within(equipment).getByText("Equipment"));

    const supporting = equipment.querySelector(".nav-group-supporting");
    expect(
      supporting,
      "a weapon property is read from the weapon that cites it and must not " +
        "take a primary slot",
    ).not.toBeNull();
    expect(supporting).toHaveAccessibleName("Also here");

    expect(
      within(supporting as HTMLElement).getByRole("link", {
        name: "Weapon properties",
      }),
    ).toHaveAttribute("href", "/weapon-properties");
  });
});

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

    const characters = menuFor("Characters");
    await user.click(within(characters).getByText("Characters"));
    expect(characters.open).toBe(true);

    await user.click(within(characters).getByText("Characters"));
    expect(characters.open).toBe(false);
  });

  it("shows only one menu at a time", async () => {
    const user = userEvent.setup();
    renderNav();

    const equipment = menuFor("Equipment");
    const characters = menuFor("Characters");

    await user.click(within(equipment).getByText("Equipment"));
    await user.click(within(characters).getByText("Characters"));

    expect(characters.open).toBe(true);
    expect(
      equipment.open,
      "two panels open at once overlap each other and both are unreadable",
    ).toBe(false);
  });

  it("closes on Escape and hands focus back to the control", async () => {
    const user = userEvent.setup();
    renderNav();

    const characters = menuFor("Characters");
    const summary = within(characters).getByText("Characters");

    await user.click(summary);
    expect(characters.open).toBe(true);

    summary.focus();
    await user.keyboard("{Escape}");

    expect(characters.open).toBe(false);
    expect(
      summary,
      "Escape must not leave focus inside a panel that has just been hidden",
    ).toHaveFocus();
  });

  it("closes on Escape from anywhere on the page", async () => {
    const user = userEvent.setup();
    renderNav();

    const characters = menuFor("Characters");
    await user.click(within(characters).getByText("Characters"));
    expect(characters.open).toBe(true);

    // A reader who opened the menu with a pointer can have focus anywhere.
    // Escape bound to the bar itself would only answer while focus happened to
    // be inside it, and the menu would sit over the page with no way out.
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("{Escape}");

    expect(characters.open).toBe(false);
  });
});

describe("the group rail", () => {
  function renderRail(path: string) {
    const Stub = createRoutesStub([
      { path: "*", Component: () => <GroupRail /> },
    ]);
    return render(<Stub initialEntries={[path]} />);
  }

  it("lists the siblings of the page being read", () => {
    renderRail("/maneuvers");

    const rail = screen.getByRole("navigation", { name: "Characters sections" });

    expect(within(rail).getByRole("link", { name: "Species" })).toHaveAttribute(
      "href",
      "/species",
    );
    // The customization options are one sibling now rather than seven, which is
    // the whole reason the hub exists.
    expect(
      within(rail).getByRole("link", { name: "Customization options" }),
    ).toHaveAttribute("href", "/customization-options");
  });

  /*
    A filtered view is not a content type, so a rail that resolved its group
    through `TYPE_NAV` alone would render nothing on the pages the header sends
    most readers to.
  */
  it("follows a filtered view as well as a type index", () => {
    renderRail("/weapons");

    const rail = screen.getByRole("navigation", { name: "Equipment sections" });

    expect(within(rail).getByRole("link", { name: "Armor" })).toHaveAttribute(
      "href",
      "/armor",
    );
  });

  it("follows an item page as well as an index", () => {
    renderRail("/powers/absorb-energy");

    expect(
      screen.getByRole("navigation", { name: "Characters sections" }),
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

  it("renders nothing for a group that leads to one place", () => {
    const { container } = renderRail("/monsters");

    expect(
      container.querySelector(".group-rail"),
      "there are no siblings to orient against in a group of one",
    ).toBeNull();
  });
});

/* -------------------------------------------------------- links off the site */

/**
 * The Resources menu is the only one whose destinations are not this site.
 *
 * Rendered as an anchor rather than a NavLink, and that is a correctness
 * matter rather than a preference: NavLink hands its address to the client
 * router, which would match a Google Drive URL against no route and draw the
 * not-found page over a working site. So the assertion is on the element and
 * its attributes, not on the label.
 */
describe("a menu that leads off the site", () => {
  it("uses a real anchor, opens away, and cannot leak the referrer", async () => {
    const user = userEvent.setup();
    renderNav();

    const resources = menuFor("Resources");
    await user.click(within(resources).getByText("Resources"));

    const sheet = within(resources).getByRole("link", {
      name: /character sheet: form fillable/i,
    });

    expect(sheet.tagName).toBe("A");
    expect(sheet).toHaveAttribute(
      "href",
      "https://drive.google.com/file/d/17mCKw43pbeATDFWraKAOmSgyI8vcUCtK/view?usp=sharing",
    );
    expect(sheet).toHaveAttribute("target", "_blank");

    // Both, not either: noopener denies the opened tab a handle on this one,
    // noreferrer keeps the address a reader was on out of Drive's logs.
    const rel = sheet.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");

    // And the host is inside the link's own text, so it is read out together
    // with the link rather than sitting in a title attribute a keyboard reader
    // never reaches. Asserted on the element already in hand: looking it up by
    // accessible name would be testing the name-normalisation rules as much as
    // the markup.
    expect(sheet.textContent).toContain("(Google Drive)");
    expect(sheet.querySelector(".nav-external-host")).not.toBeNull();
  });

});
