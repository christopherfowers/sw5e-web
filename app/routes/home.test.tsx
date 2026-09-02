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
  chapters: [
    { slug: "phb-whats-different", name: "What's Different?", chapterNumber: -1 },
    { slug: "phb-introduction", name: "Introduction", chapterNumber: 0 },
    { slug: "phb-species", name: "Species", chapterNumber: 2 },
  ],
  variantRules: 42,
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

    const speciesCard = screen.getByRole("link", { name: /^species/i });
    expect(within(speciesCard).getByText("141")).toBeInTheDocument();

    const creatureCard = screen.getByRole("link", { name: /^creatures/i });
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
  it("leads with how to play, then supplements, then categories", () => {
    renderHome();

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent ?? "");

    const at = (text: string) =>
      headings.findIndex((heading) => new RegExp(text, "i").test(heading));

    expect(at("how to play")).toBeGreaterThanOrEqual(0);
    expect(at("how to play")).toBeLessThan(at("supplemental rules"));
    expect(at("supplemental rules")).toBeLessThan(at("categories"));
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

  it("lists the handbook's chapters in the book's own order", () => {
    renderHome();

    const chapters = within(
      screen.getByRole("region", { name: /how to play/i }),
    )
      .getAllByRole("link")
      .map((link) => link.textContent ?? "");

    expect(chapters).toEqual([
      "What's Different?",
      "Introduction",
      "2Species",
    ]);
  });

  /**
   * The handbook is what "how to play" means; the other books are what you
   * reach for afterwards. Listing it among the supplements would put the thing
   * a newcomer needs into the row they are meant to skip.
   */
  it("keeps the handbook out of the supplemental books", () => {
    renderHome();

    const supplemental = within(
      screen.getByRole("region", { name: /supplemental rules/i }),
    );

    expect(supplemental.queryByText(/player.s handbook/i)).toBeNull();
    expect(supplemental.getByText(/wretched hives/i)).toBeInTheDocument();
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

    const species = screen.getByRole("link", { name: /^species/i });

    expect(species.querySelector(".type-card-count")).toBeNull();
    expect(
      screen.getByRole("link", { name: /^creatures/i }).querySelector(
        ".type-card-count",
      ),
      "withholding one count must not blank the rest of the grid",
    ).not.toBeNull();
  });
});
