import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { ItemDetail } from "./item-detail";
import type { ContentItem } from "~/content/types";

const feat: ContentItem = {
  type: "feats",
  slug: "ace-pilot",
  name: "Ace Pilot",
  source: "PHB",
  sourceName: "Player's Handbook",
  tagline: "No prerequisite",
  summary: {},
  stats: [{ label: "Ability increases", value: "Intelligence" }],
  sections: [
    {
      heading: null,
      body: "You are experienced in the air.\n\n### Benefits\nYou gain **piloting**.",
    },
  ],
  entries: [],
  tables: [],
};

const creature: ContentItem = {
  type: "monsters",
  slug: "aat",
  name: "AAT",
  source: "SnV",
  sourceName: "Scum and Villainy",
  tagline: "Large droid, unaligned",
  summary: {},
  stats: [
    { label: "Armor Class", value: "19 (armor plating)" },
    { label: "Languages", value: null, lost: true },
  ],
  abilityScores: [
    { ability: "Strength", score: 18, modifier: 4 },
    { ability: "Dexterity", score: 8, modifier: -1 },
  ],
  sections: [],
  entries: [
    { group: "Actions", name: "Laser Cannon", body: "Ranged Weapon Attack." },
  ],
  tables: [
    {
      caption: "Personality traits",
      columns: ["d2", "Trait"],
      rows: [["1", "Blunt"]],
    },
  ],
};

function renderItem(item: ContentItem) {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <ItemDetail item={item} /> },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("an item detail page", () => {
  it("uses the item name as the only level-one heading", () => {
    renderItem(feat);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Ace Pilot" }),
    ).toBeInTheDocument();
  });

  /**
   * The corpus writes its own headings starting at `###`. Rendering those as
   * `<h3>` under the page's `<h1>` would skip a level, which is a WCAG 2.1
   * failure, so prose headings are remapped to start at `<h2>`.
   */
  it("never skips a heading level between the title and the prose", () => {
    renderItem(feat);

    const levels = screen
      .getAllByRole("heading")
      .map((heading) => Number(heading.tagName.slice(1)))
      .filter((level) => level <= 3);

    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index] - levels[index - 1]).toBeLessThanOrEqual(1);
    }
    expect(
      screen.getByRole("heading", { level: 2, name: "Benefits" }),
    ).toBeInTheDocument();
  });

  it("renders a type with six fields and a type with a stat block from the same component", () => {
    const { unmount } = renderItem(feat);
    expect(screen.getByText("Ability increases")).toBeInTheDocument();
    unmount();

    renderItem(creature);
    expect(screen.getByText("Armor Class")).toBeInTheDocument();
    expect(screen.getByText("19 (armor plating)")).toBeInTheDocument();
  });

  it("marks a stat the archive lost instead of dropping the line", () => {
    renderItem(creature);

    expect(screen.getByText("Languages")).toBeInTheDocument();
    expect(screen.getByText(/not recorded/)).toBeInTheDocument();
  });

  it("shows ability scores with their modifiers", () => {
    renderItem(creature);

    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
    expect(screen.getByText("+4")).toBeInTheDocument();
  });

  it("groups named entries under a heading of their own", () => {
    renderItem(creature);

    expect(
      screen.getByRole("heading", { level: 2, name: "Actions" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Laser Cannon")).toBeInTheDocument();
  });

  it("gives roll tables a caption and row headers", () => {
    renderItem(creature);

    const table = screen.getByRole("table", { name: "Personality traits" });
    expect(table).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "1" })).toBeInTheDocument();
  });

  it("names the source book", () => {
    renderItem(feat);

    expect(screen.getByText("Player's Handbook")).toBeInTheDocument();
  });
});

/** A species that has art in the archive, and one of the eight that does not. */
function speciesItem(slug: string, name: string): ContentItem {
  return {
    type: "species",
    slug,
    name,
    source: "PHB",
    sourceName: "Player's Handbook",
    tagline: "Medium · Kashyyyk",
    summary: { size: "Medium" },
    stats: [{ label: "Size", value: "Medium" }],
    sections: [],
    entries: [],
    tables: [],
  };
}

describe("an item's picture", () => {
  it("shows a species portrait described by what it depicts", () => {
    renderItem(speciesItem("wookiee", "Wookiee"));

    const portrait = screen.getByRole("img");
    expect(portrait).toHaveAccessibleName("Illustration of the Wookiee species");
    expect(portrait).toHaveAttribute("width");
    expect(portrait).toHaveAttribute("height");
  });

  /**
   * 133 of 141 species have art. The other eight must not produce a broken
   * image, an empty frame, or a page that has lost its second column.
   */
  it("says so plainly when the archive has no portrait", () => {
    renderItem(speciesItem("quermian", "Quermian"));

    expect(screen.queryByRole("img")).toBeNull();
    expect(
      screen.getByText(/no illustration of the quermian exists in the archive/i),
    ).toBeInTheDocument();
  });

  it("draws a class illustration for an archetype", () => {
    renderItem({
      type: "archetypes",
      slug: "aqinos-form",
      name: "Aqinos Form",
      source: "EC",
      sourceName: "Expanded Content",
      tagline: "Guardian archetype",
      summary: { className: "Guardian" },
      stats: [{ label: "Class", value: "Guardian" }],
      sections: [],
      entries: [],
      tables: [],
    });

    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Illustration of a Guardian",
    );
  });

  it("renders no picture at all for a type that has none", () => {
    renderItem(feat);

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/exists in the archive/i)).toBeNull();
  });
});

/**
 * A stat whose value names another item the site publishes.
 *
 * This is how the enhanced items relate to the equipment they are the enhanced
 * form of: they are separate content types, and the relationship is a link on
 * the row rather than a merge of the two schemas. The link is only ever set
 * where the dataset builder resolved the name to exactly one document, so what
 * this covers is that a resolved reference reaches the reader and an
 * unresolved one leaves the value alone rather than rendering a dead link.
 */
describe("a stat that points at another item", () => {
  const withLink: ContentItem = {
    type: "enhanced-items",
    slug: "ab-75-bo-rifle",
    name: "AB-75 Bo-Rifle",
    source: "WH",
    sourceName: "Wretched Hives",
    tagline: "Prototype weapon",
    summary: {},
    stats: [
      { label: "Rarity", value: "Prototype" },
      { label: "Kind", value: "Bo-rifle", href: "/equipment/bo-rifle" },
    ],
    sections: [{ heading: null, body: "You have a +2 bonus to attack rolls." }],
    entries: [],
    tables: [],
  };

  it("links the value to the item it names", () => {
    renderItem(withLink);

    expect(screen.getByRole("link", { name: "Bo-rifle" })).toHaveAttribute(
      "href",
      "/equipment/bo-rifle",
    );
  });

  it("leaves an unresolved value as plain text rather than a dead link", () => {
    renderItem({
      ...withLink,
      stats: [{ label: "Kind", value: "Any blaster" }],
    });

    expect(screen.getByText("Any blaster")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Any blaster" }),
    ).not.toBeInTheDocument();
  });
});
