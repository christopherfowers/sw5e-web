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
   * The site is the maintained continuation of sw5e.com, and for a long time
   * it said so nowhere. Worse, its own lede opened "A community reference" —
   * an indefinite article that filed it alongside every other fan project
   * instead of saying which one it is. Both halves of that are asserted here,
   * because fixing one without the other leaves the page still wrong: dropping
   * the article without naming the lineage says nothing, and naming the lineage
   * under "a community reference" contradicts itself in the same paragraph.
   */
  it("does not file itself as one community reference among several", () => {
    renderHome();

    expect(screen.queryByText(/a community reference/i)).toBeNull();
  });

  it("tells a reader off an old bookmark which site this continues", () => {
    renderHome();

    expect(
      screen.getByText(/picks up where sw5e\.com left off/i),
      "the home page has to name the site it continues, in words a reader " +
        "arriving from that site will recognise",
    ).toBeInTheDocument();
  });

  it("offers that reader somewhere to read what happened", () => {
    renderHome();

    expect(
      document.querySelector('a[href="/about"]'),
      "the continuity claim needs a page behind it; the hero has room for one " +
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

  it("names the site it continues, where a search result will show it", () => {
    expect(descriptionFrom(tagsFor())).toMatch(/sw5e\.com/i);
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

    expect(description).toMatch(/sw5e\.com/i);
    expect(description).not.toMatch(/undefined|NaN/);
  });
});
