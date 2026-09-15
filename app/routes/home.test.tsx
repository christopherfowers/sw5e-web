import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import Home, { meta } from "./home";
import { TYPE_ORDER } from "~/content/type-meta";
import type { Route } from "./+types/home";

const loaderData = {
  total: 1820,
  curated: false,
  sourceTotals: { PHB: 900, EC: 700, WH: 120, SnV: 271 },
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
  /*
    The sheets as the loader hands them over. Three rather than four, and one
    of them not rebuilt — the page has to draw a row where only some files
    carry the disclosure, which is the state the corpus will be in the first
    time somebody adds a sheet that needed no cleaning.
  */
  resources: [
    {
      key: "character-sheet",
      name: "Character sheet",
      blurb: "The official sheet, to print and fill in by hand.",
      file: "character-sheet.pdf",
      pages: 4,
      fillable: false,
      sanitized: true,
      accent: "indigo" as const,
    },
    {
      key: "character-sheet-fillable",
      name: "Character sheet, form fillable",
      blurb: "The same sheet as a PDF you can type into.",
      file: "character-sheet-fillable.pdf",
      pages: 4,
      fillable: true,
      sanitized: true,
      accent: "teal" as const,
    },
    {
      key: "deployment-sheet-fillable",
      name: "Deployment sheet, form fillable",
      blurb: null,
      file: "deployment-sheet-fillable.pdf",
      pages: 1,
      fillable: true,
      sanitized: false,
      accent: null,
    },
  ],
  /*
    The channels as the loader hands them over: already grouped, already
    labelled from the platform, and already filtered to the ones whose URL
    matches the host their platform uses. Two groups rather than three, because
    that is the state the corpus is really in — the old funding page belongs to
    somebody else and no Support channel exists.
  */
  groups: [
    {
      heading: "Development",
      blurb: "Discord is where the development happens.",
      channels: [
        { key: "discord", url: "https://discord.gg/zYcPYTu", label: "Discord" },
      ],
    },
    {
      heading: "Connect",
      blurb: "For sharing content, questions, and more.",
      channels: [
        { key: "reddit", url: "https://www.reddit.com/r/sw5e", label: "Reddit" },
        {
          key: "facebook",
          url: "https://www.facebook.com/groups/starwars5e",
          label: "Facebook",
        },
      ],
    },
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

  /**
   * The page does not draw the navigation a second time.
   *
   * There were twenty-seven cards here, grouped into the same six subjects the
   * header already offers from every page of the site. The books cover most of
   * what they pointed at, and the header covers the rest — so the grid was the
   * front page's longest section and its least load-bearing.
   *
   * Asserted rather than merely deleted, and asserted by *absence*, because the
   * reflex cure for a front page that feels thin is to put a grid of links back
   * on it. Reachability is not weakened by this: `nav-groups.test.ts` holds
   * "every content type is reachable from the navigation", which is the claim
   * that actually matters and is now made in the one place that can make it.
   */
  it("does not reproduce the navigation", () => {
    renderHome();

    expect(screen.queryByRole("region", { name: /categories/i })).toBeNull();

    /*
      `/species` is deliberately absent from this list. The hero still offers
      "Browse species" as its second action, which is a chosen way in for a
      reader who already knows what they came for — not a card in a grid. The
      distinction is the whole point of the change, so the test has to respect
      it rather than assert the page holds no links at all.
    */
    for (const path of [
      "/customization-options",
      "/force-powers",
      "/armor",
      "/monsters",
      "/starship-weapons",
    ]) {
      expect(
        document.querySelector(`a[href="${path}"]`),
        `${path} belongs to the header now, not to a card on the front page`,
      ).toBeNull();
    }
  });

  /**
   * The sheets sit under the books, in the books' form factor.
   *
   * They were four links to a Google Drive nobody here controlled, at the
   * bottom of a menu. They are content now, and they come second because they
   * are what a reader reaches for once they know what the books are.
   */
  it("offers the sheets under the books", () => {
    renderHome();

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent ?? "");
    const at = (text: string) =>
      headings.findIndex((heading) => new RegExp(text, "i").test(heading));

    expect(at("rulebooks")).toBeGreaterThanOrEqual(0);
    expect(at("rulebooks")).toBeLessThan(at("sheets and downloads"));
  });

  /**
   * A download is a plain anchor with `download`, not a router Link.
   *
   * Two things ride on this and neither is cosmetic. The file is not a route,
   * so a Link would hand `/resources/x.pdf` to the client router and produce a
   * "page not found" rather than a file. And `download` asks the browser to
   * save rather than open its PDF viewer, which is the same decision the
   * hosting design makes for every file this site serves.
   */
  it("links a sheet as a download rather than as a page", () => {
    renderHome();

    const link = screen.getByRole("link", { name: "Character sheet" });

    expect(link).toHaveAttribute("href", "/resources/character-sheet.pdf");
    expect(link).toHaveAttribute("download");
    expect(
      link.getAttribute("data-discover"),
      "a router Link would resolve this against the route table and 404",
    ).toBeNull();
  });

  it("says how many pages a sheet has, and which ones can be typed into", () => {
    renderHome();

    const sheets = within(
      screen.getByRole("region", { name: /sheets and downloads/i }),
    );

    expect(sheets.getByText(/^4 pages$/)).toBeInTheDocument();
    expect(sheets.getByText(/1 page · fillable/)).toBeInTheDocument();
  });

  /**
   * And says the files were rebuilt, once, where a reader decides.
   *
   * A file that has been altered — however safely, and these were altered to
   * remove an action that printed the document the moment it opened — must not
   * be presented as the author's untouched work. Said under the row rather than
   * on each tile, because four near-identical notices are noise.
   */
  it("discloses that the files are rebuilt rather than originals", () => {
    renderHome();

    const sheets = within(
      screen.getByRole("region", { name: /sheets and downloads/i }),
    );

    expect(sheets.getByText(/rebuilt from the originals/i)).toBeInTheDocument();
  });

  /**
   * A corpus with no sheets draws no section, rather than a heading with
   * nothing under it — the same degradation the shelf makes for a build with
   * no books, and what lets a sheet be added before the section is designed
   * around it.
   */
  it("draws no sheets section when the corpus carries none", () => {
    renderHome({ ...loaderData, resources: [] });

    expect(
      screen.queryByRole("region", { name: /sheets and downloads/i }),
    ).toBeNull();
  });

  /**
   * Getting in touch, as the site this replaces had it.
   *
   * Every link leaves the site, so every one carries `noopener noreferrer` —
   * `noreferrer` as well, because where a reader came from is not this
   * project's to hand to somebody else's analytics.
   */
  it("offers the community's channels, grouped", () => {
    renderHome();

    const touch = within(
      screen.getByRole("region", { name: /getting in touch/i }),
    );

    const discord = touch.getByRole("link", { name: "Discord" });
    expect(discord).toHaveAttribute("href", "https://discord.gg/zYcPYTu");
    expect(discord).toHaveAttribute("rel", "noopener noreferrer");

    expect(touch.getByRole("link", { name: "Reddit" })).toBeInTheDocument();
    expect(touch.getByRole("link", { name: "Facebook" })).toBeInTheDocument();
  });

  /**
   * And no Support column.
   *
   * The Patreon the old site carried belongs to the previous maintainer and is
   * shared with another project. It is deliberately not carried over, and the
   * absence needs no toggle: a group nothing is filed under does not render.
   * Asserted because the reflex when a three-column layout shows two is to add
   * the third one back.
   */
  it("draws no support column, having no support channel", () => {
    renderHome();

    const touch = within(
      screen.getByRole("region", { name: /getting in touch/i }),
    );

    expect(touch.queryByText(/^support$/i)).toBeNull();
    expect(touch.queryByRole("link", { name: /patreon/i })).toBeNull();
  });

  it("draws no contact section at all when the corpus names no channels", () => {
    renderHome({ ...loaderData, groups: [] });

    expect(
      screen.queryByRole("region", { name: /getting in touch/i }),
    ).toBeNull();
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
   * The books, and then nothing that competes with them.
   *
   * The site this replaces opened with its rulebooks and the owner asked for
   * that back, on the reasoning that somebody arriving wants to see what this
   * is made of before being told where to start. The category grid used to
   * follow them and has gone; what remains below the shelf is one sentence
   * about the optional rules, which belong to no single book and so have
   * nowhere else to be said.
   */
  it("leads with the books, and puts nothing after them but the variants", () => {
    renderHome();

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent ?? "");

    expect(headings.some((heading) => /rulebooks/i.test(heading))).toBe(true);
    expect(
      headings.filter((heading) => /categories/i.test(heading)),
      "the grid the header already draws does not belong here too",
    ).toHaveLength(0);
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

});
