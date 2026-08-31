import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { ContentList, WINDOW } from "./content-list";
import { getListConfig } from "~/content/list-config";
import type {
  AnySummary,
  MonsterSummary,
  SpeciesSummary,
} from "~/content/types";

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

/**
 * Species are the one type shown as a gallery rather than a table, because a
 * portrait identifies a species faster than its name does. Two of these rows
 * have art in the archive and one does not, which is the case that has to
 * degrade without a broken icon or a collapsed tile.
 */
const speciesRows: SpeciesSummary[] = [
  {
    slug: "wookiee",
    name: "Wookiee",
    source: "PHB",
    tagline: "Medium · Kashyyyk",
    size: "Medium",
    homeworld: "Kashyyyk",
    language: "Shyriiwook",
    abilityIncreases: "Strength +2, Constitution +1",
  },
  {
    slug: "aleena",
    name: "Aleena",
    source: "PHB",
    tagline: "Small · Aleen",
    size: "Small",
    homeworld: "Aleen",
    language: "Aleena",
    abilityIncreases: "Dexterity +2",
  },
  {
    slug: "quermian",
    name: "Quermian",
    source: "EC",
    tagline: "Medium · Quermia",
    size: "Medium",
    homeworld: "Quermia",
    language: "Quermian",
    abilityIncreases: "Intelligence +2",
  },
];

function renderGallery(rows: AnySummary[] = speciesRows) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <ContentList
          type="species"
          typeLabel="Species"
          rows={rows}
          config={getListConfig("species")}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("a species index", () => {
  it("shows portraits rather than a table of names", () => {
    renderGallery();

    expect(screen.queryByRole("table")).toBeNull();
    expect(
      screen.getByRole("img", { name: /illustration of the wookiee species/i }),
      "a species tile must carry its portrait, described by what it shows",
    ).toBeInTheDocument();
  });

  it("gives every portrait explicit dimensions so nothing reflows around it", () => {
    renderGallery();

    for (const image of screen.getAllByRole("img")) {
      expect(image).toHaveAttribute("width");
      expect(image).toHaveAttribute("height");
    }
  });

  it("offers more than one width for a portrait, so a phone can take the small one", () => {
    renderGallery();

    const portrait = screen.getByRole("img", {
      name: /illustration of the aleena species/i,
    });
    expect(portrait.getAttribute("srcset")).toMatch(/\d+w,.+\d+w/);
    expect(portrait).toHaveAttribute("sizes");
  });

  it("loads everything below the first row lazily", () => {
    // 141 species is far more art than a first paint should pay for.
    const many = Array.from({ length: 20 }, (_, index) => ({
      ...speciesRows[0],
      slug: index === 0 ? "wookiee" : `aleena`,
      name: `Species ${String(index).padStart(2, "0")}`,
    }));
    renderGallery(many);

    const images = screen.getAllByRole("img");
    expect(images.at(-1)).toHaveAttribute("loading", "lazy");
  });

  it("draws a species with no portrait instead of leaving a broken image", () => {
    renderGallery();

    // Nothing points at a file that does not exist...
    for (const image of screen.getAllByRole("img")) {
      expect(image.getAttribute("src")).not.toContain("quermian");
    }
    // ...and the tile is still a tile: its name is there and reachable.
    expect(screen.getByRole("link", { name: "Quermian" })).toHaveAttribute(
      "href",
      "/species/quermian",
    );
  });

  it("can be sorted without column headers to click", async () => {
    const user = userEvent.setup();
    renderGallery();

    const names = () =>
      screen.getAllByRole("link").map((link) => link.textContent?.trim());

    expect(names()).toEqual(["Aleena", "Quermian", "Wookiee"]);

    await user.click(screen.getByRole("button", { name: /A–Z/ }));

    expect(names()).toEqual(["Wookiee", "Quermian", "Aleena"]);
  });
});

/**
 * The page that froze.
 *
 * `/features` published all 2,682 rows as 2.1 MB of HTML — 40,342 elements for
 * the browser to parse and lay out and for React to hydrate, in one block, on
 * the main thread. It was not slow to arrive; it arrived and then stopped
 * responding. Enhanced items, 1,918 rows, is the next type to land.
 *
 * The two numbers asserted below are the two halves of that: how much markup
 * the page is, and how many elements it is. Both are budgets rather than exact
 * figures, and both are far enough under what an unwindowed render produces
 * that no amount of ordinary drift reaches them — the unwindowed version of
 * this same list is roughly eight times the element budget.
 *
 * The third assertion is the one that keeps the other two honest. Publishing
 * the first hundred rows and nothing else would sail through a size budget
 * while quietly deleting the catalogue this site exists to be, so the complete
 * set of links is asserted to still be in the markup. `.github/workflows/ci.yml`
 * makes the same comparison against the real container.
 */
describe("a very long index", () => {
  const LONG = 2_682;

  const longRows: AnySummary[] = Array.from({ length: LONG }, (_, index) => ({
    slug: `feature-${index}`,
    name: `Feature ${String(index).padStart(4, "0")}`,
    source: index % 2 === 0 ? "PHB" : "EC",
    tagline: `Path of Ethereality · ${(index % 20) + 1}th level`,
    grantedBy: index % 3 === 0 ? "Class" : "Archetype",
    grantedByName: `Granting thing ${index % 40}`,
    level: (index % 20) + 1,
  })) as unknown as AnySummary[];

  function renderLong(rows = longRows) {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <ContentList
            type="features"
            typeLabel="Features"
            rows={rows}
            config={getListConfig("features")}
          />
        ),
      },
    ]);
    return render(<Stub initialEntries={["/"]} />);
  }

  /** The markup a browser would have to parse, in bytes. */
  function renderedBytes(container: HTMLElement): number {
    return new TextEncoder().encode(container.innerHTML).length;
  }

  it("draws one window of rows rather than the whole list", () => {
    renderLong();

    const body = screen.getByRole("table").querySelector("tbody")!;

    expect(
      body.querySelectorAll("tr").length,
      "every row of the list is being rendered again; this is the state that " +
        "froze /features",
    ).toBe(WINDOW);
  });

  it("stays inside a page-weight budget a full render blows through", () => {
    const { container } = renderLong();

    const bytes = renderedBytes(container);
    const elements = container.querySelectorAll("*").length;

    // Rendering all 2,682 rows produces 1,726,811 bytes and 40,342 elements.
    expect(
      bytes,
      `the list rendered ${bytes.toLocaleString("en-US")} bytes of markup for ` +
        `${LONG} entries`,
    ).toBeLessThan(400_000);
    expect(
      elements,
      `the list rendered ${elements.toLocaleString("en-US")} elements for ` +
        `${LONG} entries. Element count is what hydration costs, and what a ` +
        "reader feels as a frozen page.",
    ).toBeLessThan(8_000);
  });

  it("still publishes a link to every entry, not just the drawn ones", () => {
    const { container } = renderLong();

    const links = new Set(
      [...container.querySelectorAll<HTMLAnchorElement>("a[href^='/features/']")].map(
        (anchor) => anchor.getAttribute("href"),
      ),
    );

    expect(
      links.size,
      "windowing must not remove entries from the published catalogue: a " +
        "crawler, and a reader with no JavaScript, see only what is in the " +
        "markup",
    ).toBe(LONG);
  });

  it("escapes names on the way into the full index", () => {
    // The full index is built as a string rather than as elements, because
    // 2,682 hydrated anchors is most of the cost the window just removed. That
    // makes escaping this component's responsibility rather than React's.
    const { container } = renderLong([
      ...longRows.slice(0, LONG - 1),
      {
        ...longRows[0]!,
        slug: "quote-name",
        name: '<script>alert("x")</script> & Co',
      },
    ]);

    const index = container.querySelector(".full-index-list")!;
    expect(index.querySelector("script")).toBeNull();
    expect(
      within(index as HTMLElement).getByRole("link", {
        name: '<script>alert("x")</script> & Co',
      }),
    ).toHaveAttribute("href", "/features/quote-name");
  });

  it("says how much of the list it is showing", () => {
    renderLong();

    expect(screen.getByRole("status")).toHaveTextContent(
      `Showing ${WINDOW} of 2,682 features`,
    );
  });

  it("reveals the next window and lands the reader on the first new row", async () => {
    const user = userEvent.setup();
    renderLong();

    await user.click(screen.getByRole("button", { name: /Show 100 more/ }));

    const body = screen.getByRole("table").querySelector("tbody")!;
    expect(body.querySelectorAll("tr").length).toBe(WINDOW * 2);

    // A reader who has just asked for more rows is put at the first of them,
    // rather than left on a button at the bottom of a hundred rows they cannot
    // see. Scoped to the table: the same name is also in the full index below.
    expect(
      within(body).getByRole("link", { name: "Feature 0100" }),
      "the first newly revealed row must take focus",
    ).toHaveFocus();
  });

  it("shows everything when asked, and stops offering", async () => {
    const user = userEvent.setup();
    renderLong();

    await user.click(screen.getByRole("button", { name: /Show all 2,682/ }));

    expect(
      screen.getByRole("table").querySelectorAll("tbody tr").length,
    ).toBe(LONG);
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("puts the window back to the top when the question changes", async () => {
    const user = userEvent.setup();
    renderLong();

    await user.click(screen.getByRole("button", { name: /Show all 2,682/ }));
    await user.type(screen.getByLabelText("Filter by name"), "Feature 01");

    // Answering a new question must not carry the cost of the old one: 2,682
    // rows stay rendered otherwise, filtered or not.
    expect(
      screen.getByRole("table").querySelectorAll("tbody tr").length,
    ).toBeLessThanOrEqual(WINDOW);
  });

  it("leaves a list that fits in one window exactly as it was", () => {
    const { container } = renderLong(longRows.slice(0, WINDOW));

    expect(container.querySelectorAll("tbody tr").length).toBe(WINDOW);
    expect(
      container.querySelector(".full-index"),
      "a list the table already shows in full does not need a second copy of " +
        "itself underneath",
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
  });
});
