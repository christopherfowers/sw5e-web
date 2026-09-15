import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import Home, { meta } from "./home";
import { TYPE_ORDER } from "~/content/type-meta";
import type { Route } from "./+types/home";

const loaderData = {
  counts: { species: 141, monsters: 271, powers: 465 },
  /*
    Keyed by address rather than by type, as the loader hands it over. Most of
    what the category grid draws is not a content type any more — three of the
    cards are books, eight are slices of a type and one is the customization
    hub — so a count per type could not label them.
  */
  destinationCounts: {
    "/species": 141,
    "/monsters": 271,
    "/force-powers": 233,
    "/tech-powers": 232,
    "/customization-options": 219,
    "/sources/phb": 900,
  } as Record<string, number>,
  total: 1820,
  curated: false,
  sourceTotals: { PHB: 900, EC: 700, WH: 120, SnV: 271 },
  /*
    Chapters as the loader hands them over: already filtered to the handbook,
    already in the book's order, and including the front matter numbered below
    one so the rendering of an unnumbered chapter is exercised.
  */
  /*
    The path as the loader hands it over: already filtered to the handbook,
    already in the authored order, and carrying the heading each step is read
    under. Two groups rather than one, because collapsing runs into headings is
    the only logic the component does with this and a single group would not
    exercise it.
  */
  chapters: [
    { slug: "phb-introduction", name: "Introduction", group: "Start here" },
    { slug: "phb-whats-different", name: "What's Different?", group: "Start here" },
    { slug: "phb-species", name: "Species", group: "Creating a character" },
  ],
  variantRules: 42,
  /*
    The shelf as the loader hands it over. Four books rather than the corpus's
    five, and one of them undescribed — the site has to draw a book nobody has
    written a blurb for, because that is the state a newly added supplement is
    in and the whole point of the books being content.
  */
  books: [
    {
      key: "phb",
      code: "PHB",
      name: "Player's Handbook",
      blurb: "The core rulebook.",
      accent: "indigo" as const,
    },
    {
      key: "ec",
      code: "EC",
      name: "Expanded Content",
      blurb: "Community-maintained material.",
      accent: "green" as const,
    },
    {
      key: "wh",
      code: "WH",
      name: "Wretched Hives",
      blurb: "The galaxy's underworld.",
      accent: "amber" as const,
    },
    { key: "snv", code: "SnV", name: "Scum and Villainy", blurb: null, accent: null },
  ],
};

function renderHome(data: typeof loaderData = loaderData) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () =>
        Home({ loaderData: data } as unknown as Route.ComponentProps),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("Home route", () => {
  it("renders the site name as the primary heading", () => {
    renderHome();

    expect(
      screen.getByRole("heading", { level: 1, name: /star wars 5e/i }),
    ).toBeInTheDocument();
  });

  /**
   * The lede opened "A community reference", and the indefinite article filed
   * the site alongside every other fan project instead of saying which one it
   * is. That is still forbidden.
   */
  it("does not file itself as one community reference among several", () => {
    renderHome();

    expect(screen.queryByText(/a community reference/i)).toBeNull();
  });

  /**
   * The sentence that replaced it overshot the other way. "This site picks up
   * where sw5e.com left off" is a succession claim, and a succession claim puts
   * the speaker outside the thing it succeeds. This site is Star Wars 5e, so
   * the hero says what the site is and the lineage moved to `/about`, where it
   * has room to be stated as a change of address rather than a handover.
   */
  it("does not describe itself as picking up somebody else's work", () => {
    const { container } = renderHome();
    const lede = container.querySelector(".lede")?.textContent ?? "";

    expect(lede).not.toMatch(/picks up where/i);
    // Containment rather than a `/sw5e\.com/` regex, for the reason the meta
    // assertions below already give: CodeQL reads an unanchored hostname
    // pattern as a host check arbitrary domains can slip past, and it is right
    // to in general. The subject here is a sentence, so a substring is both the
    // honest assertion and the one that does not train anyone to wave the rule
    // through.
    expect(lede).not.toContain("sw5e.com");
    // What the lede has to keep saying, whatever the wording: the whole
    // conversion is here, and it can be searched. Asserted as two claims
    // rather than as one sentence, so rephrasing does not fail the test while
    // dropping either claim still does.
    expect(lede).toMatch(/every book/i);
    expect(lede).toMatch(/search/i);
  });

  /**
   * The redirect notice, which is a different thing from the lede and stays.
   * Somebody who followed a dead bookmark needs to be told, in the words they
   * are holding, that this is where it points now.
   */
  it("still answers the reader who arrived on a dead sw5e.com link", () => {
    renderHome();

    const note = screen.getByText(/arrived from an sw5e\.com link/i);

    expect(note).toBeInTheDocument();
    expect(
      document.querySelector('a[href="/about"]'),
      "the redirect notice needs a page behind it; the hero has room for one " +
        "sentence and the question deserves more",
    ).not.toBeNull();
  });

  it("shows the real count of entries for each content type", () => {
    renderHome();

    // Scoped to the categories. "Species" is now the name of a card *and* of a
    // step on the reading path, because the path steps stopped carrying chapter
    // numbers — an unscoped lookup finds both and cannot say which it meant.
    const categories = within(screen.getByRole("region", { name: /categories/i }));

    const speciesCard = categories.getByRole("link", { name: /^species/i });
    expect(within(speciesCard).getByText("141")).toBeInTheDocument();

    const creatureCard = categories.getByRole("link", { name: /^creatures/i });
    expect(within(creatureCard).getByText("271")).toBeInTheDocument();
  });

  /**
   * The grid is the header's menus, drawn as cards. It is not a list of content
   * types and has not been one since the header stopped being one: three of
   * these are books, four are slices of a type and one is a hub over seven.
   * Asserting the addresses rather than the types is the only way to notice the
   * front page drifting away from the navigation.
   */
  it("offers the same destinations the header does", () => {
    renderHome();

    for (const path of [
      "/sources/phb",
      "/variant-rules",
      "/species",
      "/customization-options",
      "/force-powers",
      "/armor",
      "/weapons",
      "/other-equipment",
      "/starship-weapons",
      "/monsters",
      // The quiet half, which is quiet rather than absent: these are the
      // destinations the owner's menu does not name and the corpus does have.
      "/features",
      "/starship-base-sizes",
      "/rules",
    ]) {
      expect(
        document.querySelector(`a[href="${path}"]`),
        `the home page must offer a way into ${path}`,
      ).not.toBeNull();
    }
  });

  it("says so when the site is rendering the committed sample dataset", () => {
    renderHome({ ...loaderData, curated: true });

    expect(screen.getByText(/sample dataset/i)).toBeInTheDocument();
  });

  it("stays quiet about the dataset when the full library is present", () => {
    renderHome();

    expect(screen.queryByText(/sample dataset/i)).toBeNull();
  });
});

/**
 * The meta tags, asserted directly rather than through the DOM.
 *
 * They are what a search result shows and what somebody sees when the page is
 * pasted into a chat window, which makes them the site's most-read sentence by
 * a wide margin — and the one nobody looks at while working. The description
 * used to name eight content types by hand and had been wrong for five
 * releases: classes, features, starships, enhanced items, the property
 * glossaries and the rules text all arrived after it was written.
 */
describe("Home route metadata", () => {
  function tagsFor(data: typeof loaderData = loaderData) {
    return meta({ loaderData: data } as unknown as Route.MetaArgs) as unknown as Array<
      Record<string, string>
    >;
  }

  function descriptionFrom(tags: Array<Record<string, string>>) {
    return tags.find((tag) => tag.name === "description")?.content ?? "";
  }

  it("stops describing the site with an indefinite article", () => {
    const tags = tagsFor();
    const title = tags.find((tag) => "title" in tag)?.title ?? "";

    expect(title).not.toMatch(/community reference/i);
    expect(descriptionFrom(tags)).not.toMatch(/a community reference/i);
  });

  it("says what the site is, where a search result will show it", () => {
    // This asserted that the description named sw5e.com, because it read "The
    // maintained continuation of sw5e.com" — a phrase that spent every search
    // result describing the site as standing outside the project it is. The
    // description now states the site rather than its predecessor; `/about`
    // carries the address a returning reader searches for, and carries it with
    // the paragraph that phrase could never hold.
    const description = descriptionFrom(tagsFor());

    expect(description).toMatch(/Star Wars 5e/);
    expect(description).toMatch(/every book/i);
    expect(description).not.toMatch(/continuation|picks up where|successor/i);
  });

  it("counts the corpus rather than listing the types it began with", () => {
    const description = descriptionFrom(tagsFor());

    // Derived from the loader, so it cannot fall behind the library the way a
    // hand-written list did. `loaderData` above stands in for the manifest.
    expect(description).toContain(
      `${loaderData.total.toLocaleString("en-US")} entries across ${TYPE_ORDER.length} categories`,
    );
  });

  it("names the parts of the corpus a reader would doubt were here", () => {
    const description = descriptionFrom(tagsFor());

    // Each of these landed after the old description was written and none of
    // them appeared in it, which is precisely why the site read as a partial
    // conversion rather than the whole of one.
    for (const subject of ["classes", "features", "starships", "enhanced items"]) {
      expect(description, `the description must mention ${subject}`).toMatch(
        new RegExp(subject, "i"),
      );
    }
  });

  it("still reads as a sentence when the loader has thrown", () => {
    const description = descriptionFrom(
      meta({} as unknown as Route.MetaArgs) as unknown as Array<
        Record<string, string>
      >,
    );

    expect(description).toMatch(/Star Wars 5e/);
    expect(description).not.toMatch(/undefined|NaN/);
  });
});

/**
 * The page's order, which is the whole reason it was rebuilt.
 *
 * The complaint was that a newcomer opens the site and meets twenty-seven
 * category cards — "all the various options in a blob" — with the books at the
 * bottom and nothing saying how to play. Reading order is therefore the
 * assertion, not an implementation detail: how to play, then the supplements,
 * then the lists.
 */
describe("the order the page puts things in", () => {
  /**
   * The books, then how to play, then the lists.
   *
   * The books moved above how to play deliberately: the site this replaces
   * opened with its rulebooks and the owner asked for that back, on the
   * reasoning that somebody arriving wants to see what this is made of before
   * being told where to start. The lists stay last — the page opened with
   * twenty-seven category cards once, which answers "what do you have" before
   * anybody has been told what the game is.
   */
  it("leads with the books, then the categories", () => {
    renderHome();

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent ?? "");

    const at = (text: string) =>
      headings.findIndex((heading) => new RegExp(text, "i").test(heading));

    expect(at("rulebooks")).toBeGreaterThanOrEqual(0);
    expect(at("rulebooks")).toBeLessThan(at("categories"));
  });

  /**
   * And it does not reproduce the handbook's chapters.
   *
   * There was a "How to play" section here listing all fifteen of them under
   * their headings. That was right while a book's own page was a grid of
   * content-type counts and there was nowhere else to read a table of
   * contents. The handbook's page is now its chapters, and the hero's first
   * button goes straight there — so this was the same thing said twice, at
   * length, above the books it described.
   *
   * Asserted rather than merely deleted, because the tempting fix to a thin
   * front page is to put the list back.
   */
  it("does not repeat the handbook's chapters", () => {
    renderHome();

    expect(screen.queryByRole("region", { name: /how to play/i })).toBeNull();
    expect(screen.queryByText("Creating a character")).toBeNull();
  });

  /**
   * Every book, including the one that teaches the game.
   *
   * The row this replaces was headed "Supplemental rules" and left the handbook
   * out, because the section under it was the handbook — which made the row a
   * list of leftovers rather than a shelf. Somebody looking for the Player's
   * Handbook should find it among the books.
   */
  it("puts every book on the shelf, the handbook first", () => {
    renderHome();

    const shelf = screen.getByRole("region", { name: /rulebooks/i });
    const titles = within(shelf)
      .getAllByRole("link")
      .map((link) => link.textContent?.trim());

    expect(titles).toEqual([
      "Player's Handbook",
      "Expanded Content",
      "Wretched Hives",
      "Scum and Villainy",
    ]);
  });

  /**
   * A book nobody has described still gets a card.
   *
   * Scum and Villainy carries no blurb in this fixture. It must still appear
   * with its name and its cover — an undescribed book is the state every new
   * supplement starts in, and dropping it would make the shelf silently
   * incomplete.
   */
  it("draws a book that has no blurb yet", () => {
    renderHome();

    const shelf = screen.getByRole("region", { name: /rulebooks/i });

    expect(
      within(shelf).getByRole("link", { name: "Scum and Villainy" }),
    ).toBeInTheDocument();
  });

  it("sends a newcomer to the handbook before anything else", () => {
    renderHome();

    const actions = screen.getByRole("link", {
      name: /start with the player.s handbook/i,
    });

    // The introduction, not "What's Different?", which is numbered lower and
    // would otherwise sort first. Somebody who has never played needs the
    // chapter that says what the game is.
    expect(actions).toHaveAttribute("href", "/rules/phb-introduction");
  });



  /**
   * The optional rules sit at the foot of the path, not among the books.
   *
   * They used to live under the book row, which read as though the variants
   * were another supplement. They are rules, so they belong with how to play —
   * and they come after the path rather than inside it, because a reader being
   * walked somewhere should arrive before being offered detours.
   */
  it("still offers the optional rules, which belong to no one book", () => {
    renderHome();

    const shelf = within(screen.getByRole("region", { name: /rulebooks/i }));

    // Present on the page, and deliberately not inside the shelf: they are
    // options spread across the corpus rather than a book somebody opens.
    expect(
      screen.getByRole("link", { name: /optional and variant rules/i }),
    ).toBeInTheDocument();
    expect(shelf.queryByText(/optional and variant/i)).toBeNull();
  });

  /**
   * Seven separate cards — feats, fighting styles, masteries, lightsaber forms
   * and the two weapon tiers — are seven answers to one question. The
   * Player's Handbook introduces them together under one chapter heading, so
   * the front page offers one card and the seven live behind it.
   */
  it("gathers the customization options behind a single card", () => {
    renderHome();

    const characters = screen.getByRole("region", { name: /^characters$/i });

    expect(
      within(characters).getByRole("link", { name: /^customization options/i }),
    ).toHaveAttribute("href", "/customization-options");

    for (const name of [/^fighting styles/i, /^lightsaber forms/i]) {
      expect(
        within(characters).queryByRole("link", { name }),
        "the seven options are one answer, not seven cards in a grid",
      ).toBeNull();
    }
  });

  /**
   * A destination that is not a type still has to be countable, or the card is
   * a bare label in a grid where every neighbour carries a number. Three of the
   * counts on this page are now sums or filtered tallies rather than manifest
   * lookups.
   */
  it("counts what is behind a destination that is not a content type", () => {
    renderHome();

    const hub = screen.getByRole("link", { name: /^customization options/i });

    expect(within(hub).getByText("219")).toBeInTheDocument();
  });

  /**
   * The loader omits an address it cannot honestly count — `/sources` is a page
   * about five books rather than a page of anything — and the card has to read
   * as a card with no number rather than as a card claiming zero. Exercised by
   * withholding a count the page would otherwise have, because the destination
   * that really has none is in the quiet half and never draws a card.
   */
  it("leaves the count off a destination it was given no number for", () => {
    const withoutSpecies = { ...loaderData.destinationCounts };
    delete withoutSpecies["/species"];
    renderHome({ ...loaderData, destinationCounts: withoutSpecies });

    const categories = within(screen.getByRole("region", { name: /categories/i }));
    const species = categories.getByRole("link", { name: /^species/i });

    expect(species.querySelector(".type-card-count")).toBeNull();
    expect(
      categories.getByRole("link", { name: /^creatures/i }).querySelector(
        ".type-card-count",
      ),
      "withholding one count must not blank the rest of the grid",
    ).not.toBeNull();
  });
});
