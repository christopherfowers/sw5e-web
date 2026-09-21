/**
 * The front page reading its own words out of content.
 *
 * The hero paragraph and the three section headings used to be markup, so
 * changing a word of the site's own description meant a code edit and a deploy.
 * They are a `page` document now, and this is the pair of properties that has
 * to hold for that to be safe to ship:
 *
 *   an authored slot is used
 *   a missing slot renders the wording the page was built with
 *
 * The second is the one worth guarding. It is what lets the type be introduced
 * at all: a deployment holding no page documents, which is every deployment
 * until somebody saves one, has to look exactly as it did before. Without it
 * the release that added this would have blanked the front page until an
 * administrator filled in a form.
 *
 * `booksLede` is tested on its own because its fallback is not a fixed string.
 * Left alone the page counts the shelf, which is a sentence that cannot go
 * stale, and that is the default the corpus ships with.
 */

import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const copy = vi.hoisted(() => ({ current: {} as Record<string, string> }));

vi.mock("~/content/pages", () => ({
  pageCopy: () => copy.current,
}));

const { default: Home } = await import("./home");
type HomeProps = Parameters<typeof Home>[0];

const loaderData = {
  total: 1820,
  curated: false,
  sourceTotals: { PHB: 900, EC: 700 },
  chapters: [{ slug: "phb-introduction", name: "Introduction", group: "Start here" }],
  variantRules: 42,
  books: [
    { key: "phb", code: "PHB", name: "Player's Handbook", blurb: null, accent: null },
    { key: "ec", code: "EC", name: "Expanded Content", blurb: null, accent: null },
  ],
  resources: [
    {
      key: "character-sheet",
      name: "Character sheet",
      blurb: null,
      file: "character-sheet.pdf",
      pages: 4,
      fillable: false,
      sanitized: false,
      accent: null,
    },
  ],
  groups: [
    {
      heading: "Connect",
      blurb: null,
      channels: [
        {
          key: "discord",
          url: "https://discord.gg/example",
          platform: "discord" as const,
          label: "Discord",
        },
      ],
    },
  ],
};

function renderHome() {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => Home({ loaderData } as unknown as HomeProps),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

beforeEach(() => {
  copy.current = {};
});

describe("with nothing authored", () => {
  it("renders the wording the page was built with", () => {
    renderHome();

    expect(
      screen.getByRole("heading", { level: 2, name: "The rulebooks" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Sheets and downloads" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Getting in touch" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/A Star Wars roleplaying game/)).toBeInTheDocument();
  });

  it("counts the shelf itself when nobody has written that sentence", () => {
    renderHome();

    expect(
      screen.getByText("Everything in this reference comes from one of these 2 books."),
    ).toBeInTheDocument();
  });
});

describe("with words authored", () => {
  it("uses them instead", () => {
    copy.current = {
      heroLede: "A galaxy, in one place.",
      booksHeading: "The books",
      resourcesHeading: "Sheets",
      touchHeading: "Find us",
    };

    renderHome();

    expect(screen.getByText("A galaxy, in one place.")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "The books" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Sheets" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Find us" }),
    ).toBeInTheDocument();

    // And the built-in wording is gone rather than rendered alongside it.
    expect(screen.queryByText("The rulebooks")).not.toBeInTheDocument();
    expect(screen.queryByText(/A Star Wars roleplaying game/)).not.toBeInTheDocument();
  });

  it("lets somebody own the shelf sentence, count and all", () => {
    copy.current = { booksLede: "Four books, and a fifth on the way." };

    renderHome();

    expect(
      screen.getByText("Four books, and a fifth on the way."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/comes from one of these/)).not.toBeInTheDocument();
  });

  /**
   * A slot filled in for one section must not leak into another. Seven slots
   * read off one object is exactly the shape where a copy and paste puts the
   * same value in two places.
   */
  it("keeps each slot to its own section", () => {
    copy.current = { resourcesHeading: "Only this one" };

    renderHome();

    expect(
      screen.getByRole("heading", { level: 2, name: "Only this one" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "The rulebooks" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Getting in touch" }),
    ).toBeInTheDocument();
  });
});
