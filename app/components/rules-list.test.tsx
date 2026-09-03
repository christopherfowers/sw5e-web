import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { ContentList } from "./content-list";
import { getListConfig } from "~/content/list-config";
import type {
  AnySummary,
  ContentTypeId,
  EnhancedItemSummary,
  RuleSummary,
} from "~/content/types";

/**
 * The two indexes the corpus's two hardest types get: 1,918 enhanced items and
 * 75 passages of rules prose.
 *
 * They are tested together because they are the two answers to the same
 * question — what does a reader do with a list this shape — and the answers are
 * opposite. Enhanced items are a catalogue and get the full filter bar, because
 * nobody scrolls 1,918 rows. Rules are not a catalogue at all: there is nothing
 * to compare between "Chapter 9: Combat" and the "Flanking" variant, so they
 * get a table of contents grouped by book instead of five columns of dashes.
 */

function renderList(
  type: ContentTypeId,
  typeLabel: string,
  rows: AnySummary[],
) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <ContentList
          type={type}
          typeLabel={typeLabel}
          rows={rows}
          config={getListConfig(type)}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

/* ------------------------------------------------------------ enhanced items */

const items: EnhancedItemSummary[] = [
  {
    slug: "ab-75-bo-rifle",
    name: "AB-75 Bo-Rifle",
    source: "WH",
    tagline: "Prototype weapon",
    itemType: "Weapon",
    rarity: "Prototype",
    rarityRank: 2,
    subtype: "bo-rifle",
    requiresAttunement: false,
    prerequisite: null,
  },
  {
    slug: "absorbing-amplifier-mk-v",
    name: "Absorbing Amplifier Mk V",
    source: "WH",
    tagline: "Legendary item modification",
    itemType: "Item modification",
    rarity: "Legendary",
    rarityRank: 4,
    subtype: "wristpad",
    requiresAttunement: false,
    prerequisite: null,
  },
  {
    slug: "obscured-armoring",
    name: "Obscured Armoring",
    source: "WH",
    tagline: "Premium item modification",
    itemType: "Item modification",
    rarity: "Premium",
    rarityRank: 1,
    subtype: "armor",
    requiresAttunement: false,
    prerequisite: "Armor",
  },
  {
    slug: "aegis-armor",
    name: "Aegis Armor",
    source: "EC",
    tagline: "Standard armor",
    itemType: "Armor",
    rarity: "Standard",
    rarityRank: 0,
    subtype: "any",
    requiresAttunement: true,
    prerequisite: null,
  },
];

function rowNames(): string[] {
  return screen
    .getAllByRole("rowheader")
    .map((cell) => within(cell).getByRole("link").textContent?.trim() ?? "");
}

describe("the enhanced item index", () => {
  it("offers the facets that make 1,918 rows navigable", () => {
    renderList("enhanced-items", "Enhanced items", items);

    for (const label of ["Rarity", "Type", "Kind", "Attunement"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("offers rarity in the game's order, not the alphabet's", async () => {
    renderList("enhanced-items", "Enhanced items", items);

    const options = within(screen.getByLabelText("Rarity"))
      .getAllByRole("option")
      .map((option) => option.textContent);

    // Alphabetically this would read Legendary, Premium, Prototype, Standard.
    expect(options).toEqual([
      "All",
      "Standard",
      "Premium",
      "Prototype",
      "Legendary",
    ]);
  });

  it("sorts rarity by rank, so ascending means least rare first", async () => {
    const user = userEvent.setup();
    renderList("enhanced-items", "Enhanced items", items);

    await user.click(screen.getByRole("button", { name: /^Rarity/ }));

    // Standard, Premium, Prototype, Legendary — the ladder. Sorted as the text
    // in the badge this would read Legendary, Premium, Prototype, Standard,
    // which is an order nothing in the game recognises.
    expect(rowNames()).toEqual([
      "Aegis Armor",
      "Obscured Armoring",
      "AB-75 Bo-Rifle",
      "Absorbing Amplifier Mk V",
    ]);
  });

  it("narrows to the items that cost an attunement slot", async () => {
    const user = userEvent.setup();
    renderList("enhanced-items", "Enhanced items", items);

    await user.selectOptions(screen.getByLabelText("Attunement"), "Required");

    expect(rowNames()).toEqual(["Aegis Armor"]);
  });

  it("narrows to the modifications that go into one piece of equipment", async () => {
    const user = userEvent.setup();
    renderList("enhanced-items", "Enhanced items", items);

    await user.selectOptions(screen.getByLabelText("Kind"), "wristpad");

    expect(rowNames()).toEqual(["Absorbing Amplifier Mk V"]);
  });
});

/* --------------------------------------------------------------------- rules */

const rules: RuleSummary[] = [
  {
    slug: "phb-combat",
    name: "Combat",
    source: "PHB",
    tagline: "Star Wars 5e Player's Handbook · Chapter 9",
    readingGroup: "Playing the game",
    order: 11,
    ruleType: "Chapter",
    chapterNumber: 9,
    sectionCount: 9,
  },
  {
    slug: "phb-species",
    name: "Species",
    source: "PHB",
    tagline: "Star Wars 5e Player's Handbook · Chapter 2",
    readingGroup: "Creating a character",
    order: 4,
    ruleType: "Chapter",
    chapterNumber: 2,
    sectionCount: 2,
  },
  {
    slug: "phb-changelog",
    name: "Changelog",
    source: "PHB",
    tagline: "Star Wars 5e Player's Handbook",
    readingGroup: "Reference",
    order: 15,
    ruleType: "Chapter",
    // The archive files a changelog at 99 so it sorts last, and a preface at a
    // negative number so it sorts first. Neither is a printable position.
    chapterNumber: 99,
    sectionCount: 1,
  },
  {
    slug: "wh-equipment",
    name: "Equipment",
    source: "WH",
    tagline: "Wretched Hives · Chapter 5",
    readingGroup: null,
    order: null,
    ruleType: "Chapter",
    chapterNumber: 5,
    sectionCount: 7,
  },
  {
    slug: "flanking",
    name: "Flanking",
    source: "EC",
    tagline: "Optional variant rule",
    readingGroup: null,
    order: null,
    ruleType: "Variant",
    chapterNumber: null,
    sectionCount: 1,
  },
  {
    slug: "ec-species",
    name: "Species",
    source: "EC",
    tagline: "Expanded Content",
    readingGroup: null,
    order: null,
    ruleType: "Chapter",
    chapterNumber: 0,
    sectionCount: 448,
  },
];

function bookHeadings(): string[] {
  return screen
    .getAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent?.replace(/\d+ entr(y|ies)$/, "").trim() ?? "");
}

function entryNames(): string[] {
  return screen.getAllByRole("link").map((link) => link.textContent?.trim() ?? "");
}

describe("the rules index", () => {
  it("is a table of contents rather than a table", () => {
    renderList("rules", "Rules", rules);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(bookHeadings()).toEqual([
      "Player's Handbook",
      "Expanded Content",
      "Wretched Hives",
    ]);
  });

  it("orders each book by the position it prints its chapters in", () => {
    renderList("rules", "Rules", rules);

    // Species is chapter 2 and Combat chapter 9, so the printed order is not
    // the alphabetical one. The changelog is filed at 99 and sorts last.
    const handbook = screen.getByRole("region", { name: "Player's Handbook" });
    expect(
      within(handbook)
        .getAllByRole("link")
        .map((link) => link.textContent?.trim()),
    ).toEqual(["Species", "Combat", "Changelog"]);
  });

  it("puts a book's optional variants after its chapters", () => {
    renderList("rules", "Rules", rules);

    const expanded = screen.getByRole("region", { name: "Expanded Content" });
    expect(
      within(expanded)
        .getAllByRole("link")
        .map((link) => link.textContent?.trim()),
    ).toEqual(["Species", "Flanking"]);
  });

  it("distinguishes two chapters that share a title", () => {
    renderList("rules", "Rules", rules);

    // "Species" is a chapter in both the Player's Handbook and Expanded
    // Content, and they are different chapters with different URLs.
    const links = screen
      .getAllByRole("link", { name: "Species" })
      .map((link) => link.getAttribute("href"));

    expect(links).toEqual(["/rules/phb-species", "/rules/ec-species"]);
  });

  it("says how long a passage is, which is all a reader can judge before opening it", () => {
    renderList("rules", "Rules", rules);

    // The heading it is read under, not the number it was printed at. A
    // reader deciding whether to open this is choosing between parts of a
    // path, and "Chapter 9" only means something to somebody holding the book.
    expect(screen.getByText(/Playing the game · 9 sections/)).toBeInTheDocument();
    expect(screen.getByText(/Variant rule · 1 section$/)).toBeInTheDocument();
  });

  it("drops a book's heading entirely when a filter empties it", async () => {
    const user = userEvent.setup();
    renderList("rules", "Rules", rules);

    await user.selectOptions(screen.getByLabelText("Kind"), "Variant");

    expect(bookHeadings()).toEqual(["Expanded Content"]);
    expect(entryNames()).toEqual(["Flanking"]);
  });
});
