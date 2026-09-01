import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import Home, { meta } from "./home";
import { TYPE_ORDER } from "~/content/type-meta";
import type { Route } from "./+types/home";

const loaderData = {
  counts: { species: 141, monsters: 271, powers: 465 },
  total: 1820,
  curated: false,
  sourceTotals: { PHB: 900, EC: 700, WH: 120, SnV: 271 },
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
    expect(lede).not.toMatch(/sw5e\.com/i);
    expect(lede).toMatch(/the whole conversion and every book/i);
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

  it("links to every content type index", () => {
    renderHome();

    for (const path of [
      "/species",
      "/archetypes",
      "/backgrounds",
      "/feats",
      "/powers",
      "/maneuvers",
      "/fighting-styles",
      "/fighting-masteries",
      "/lightsaber-forms",
      "/weapon-focuses",
      "/weapon-supremacies",
      "/equipment",
      "/monsters",
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

    expect(description).toContain("Star Wars 5e, the whole reference");
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

    expect(description).toContain("Star Wars 5e, the whole reference");
    expect(description).not.toMatch(/undefined|NaN/);
  });
});
