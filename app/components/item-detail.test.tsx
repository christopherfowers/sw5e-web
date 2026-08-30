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
