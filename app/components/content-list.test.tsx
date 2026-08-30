import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { ContentList } from "./content-list";
import { getListConfig } from "~/content/list-config";
import type { AnySummary, MonsterSummary } from "~/content/types";

const creatures: MonsterSummary[] = [
  {
    slug: "acklay",
    name: "Acklay",
    source: "SnV",
    tagline: "Huge beast",
    size: "Huge",
    kind: "beast",
    alignment: "unaligned",
    challengeRating: "8",
    challengeRatingValue: 8,
    armorClass: 15,
    hitPoints: 133,
  },
  {
    slug: "womp-rat",
    name: "Womp rat",
    source: "SnV",
    tagline: "Small beast",
    size: "Small",
    kind: "beast",
    alignment: "unaligned",
    challengeRating: "1/4",
    challengeRatingValue: 0.25,
    armorClass: 12,
    hitPoints: 7,
  },
  {
    slug: "protocol-droid",
    name: "Protocol droid",
    source: "SnV",
    tagline: "Medium droid",
    size: "Medium",
    kind: "droid",
    alignment: "unaligned",
    challengeRating: "2",
    challengeRatingValue: 2,
    armorClass: 11,
    hitPoints: 27,
  },
  {
    slug: "rancor",
    name: "Rancor",
    source: "SnV",
    tagline: "Huge beast",
    size: "Huge",
    kind: "beast",
    alignment: "unaligned",
    // Challenge 10 is the row that separates a numeric sort from a text one:
    // as text, "10" sorts before "2".
    challengeRating: "10",
    challengeRatingValue: 10,
    armorClass: 17,
    hitPoints: 143,
  },
];

function renderList(rows: AnySummary[] = creatures) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <ContentList
          type="monsters"
          typeLabel="Creatures"
          rows={rows}
          config={getListConfig("monsters")}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

function rowNames(): string[] {
  return screen
    .getAllByRole("rowheader")
    .map((cell) => within(cell).getByRole("link").textContent?.trim() ?? "");
}

describe("a content type index", () => {
  it("shows the columns that matter for this type", () => {
    renderList();

    expect(screen.getByRole("columnheader", { name: /CR/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /AC/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /HP/ })).toBeInTheDocument();
  });

  it("links every row to the item's page", () => {
    renderList();

    expect(screen.getByRole("link", { name: /acklay/i })).toHaveAttribute(
      "href",
      "/monsters/acklay",
    );
  });

  it("starts sorted by name", () => {
    renderList();

    expect(rowNames()).toEqual([
      "Acklay",
      "Protocol droid",
      "Rancor",
      "Womp rat",
    ]);
  });

  it("sorts a numeric column from high to low on first activation", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole("button", { name: /^CR/ }));

    expect(rowNames()).toEqual([
      "Rancor",
      "Acklay",
      "Protocol droid",
      "Womp rat",
    ]);
    expect(
      screen.getByRole("columnheader", { name: /^CR/ }),
    ).toHaveAttribute("aria-sort", "descending");
  });

  it("reverses the sort on a second activation", async () => {
    const user = userEvent.setup();
    renderList();

    const button = screen.getByRole("button", { name: /^CR/ });
    await user.click(button);
    await user.click(button);

    expect(rowNames()).toEqual([
      "Womp rat",
      "Protocol droid",
      "Acklay",
      "Rancor",
    ]);
    expect(
      screen.getByRole("columnheader", { name: /^CR/ }),
    ).toHaveAttribute("aria-sort", "ascending");
  });

  it("sorts fractional challenge ratings numerically, not as text", async () => {
    const user = userEvent.setup();
    renderList();

    const button = screen.getByRole("button", { name: /^CR/ });
    await user.click(button);
    await user.click(button);

    // As text the ratings sort "1/4", "10", "2", "8"; as numbers they sort
    // 1/4, 2, 8, 10, which is the order a reader expects.
    expect(rowNames()).toEqual([
      "Womp rat",
      "Protocol droid",
      "Acklay",
      "Rancor",
    ]);
  });

  it("filters by name as you type", async () => {
    const user = userEvent.setup();
    renderList();

    await user.type(screen.getByLabelText("Filter by name"), "womp");

    expect(rowNames()).toEqual(["Womp rat"]);
  });

  it("filters by a facet drawn from the data", async () => {
    const user = userEvent.setup();
    renderList();

    await user.selectOptions(screen.getByLabelText("Type"), "droid");

    expect(rowNames()).toEqual(["Protocol droid"]);
  });

  it("reports how many of the total are showing", async () => {
    const user = userEvent.setup();
    renderList();

    expect(screen.getByRole("status")).toHaveTextContent("4 creatures");

    await user.selectOptions(screen.getByLabelText("Type"), "droid");

    expect(screen.getByRole("status")).toHaveTextContent("1 of 4 creatures");
  });

  it("clears every filter at once", async () => {
    const user = userEvent.setup();
    renderList();

    await user.type(screen.getByLabelText("Filter by name"), "womp");
    await user.click(screen.getByRole("button", { name: /clear filters/i }));

    expect(rowNames()).toHaveLength(4);
  });

  it("says so when nothing matches instead of showing an empty table", async () => {
    const user = userEvent.setup();
    renderList();

    await user.type(screen.getByLabelText("Filter by name"), "zzzz");

    expect(screen.getByText(/nothing matches those filters/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("names the table for screen readers", () => {
    renderList();

    const table = screen.getByRole("table");
    expect(within(table).getByText(/sortable by column/i)).toBeInTheDocument();
  });
});
