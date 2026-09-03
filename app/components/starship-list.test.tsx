import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { ContentList } from "./content-list";
import { getListConfig } from "~/content/list-config";
import type { StarshipRuleSummary } from "~/content/types";

/**
 * The thirteen chapters of Starships of the Galaxy.
 *
 * Its own file rather than a fourth section of `rules-list.test.tsx`, because
 * the thing being checked is that the two lists agree — and a test that shares
 * a fixture with the list it is comparing against cannot show that. They read
 * different config entries off the same two fields, and the way this breaks is
 * that somebody changes one entry and not the other.
 */

function renderList(rows: StarshipRuleSummary[]) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <ContentList
          type="starship-rules"
          typeLabel="Starship rules"
          rows={rows}
          config={getListConfig("starship-rules")}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

/**
 * Shuffled, and the two orders disagree.
 *
 * Combat is printed as chapter 9 but read tenth; the introduction is printed
 * as 0 but read first. A fixture where the printed and authored numbers agreed
 * would pass whichever field the list actually sorted by, which is the entire
 * question this file exists to answer.
 */
const chapters: StarshipRuleSummary[] = [
  {
    slug: "combat",
    name: "Combat",
    source: "SotG",
    tagline: null,
    chapterNumber: 9,
    readingGroup: "Flying it",
    order: 10,
  },
  {
    slug: "introduction",
    name: "Introduction",
    source: "SotG",
    tagline: null,
    chapterNumber: 0,
    readingGroup: "Start here",
    order: 1,
  },
  {
    slug: "starships",
    name: "Starships",
    source: "SotG",
    tagline: null,
    chapterNumber: 1,
    readingGroup: "Building a starship",
    order: 3,
  },
  /*
    The chapter that makes the two orders disagree rather than merely differ in
    their numbering. The book prints "building one step by step" near the back
    as chapter 13; it is read second, straight after the introduction, because
    that is what somebody new to starships needs next. Without a row that
    crosses another, every printed number happened to sort the same way as its
    authored position and the comparison below passed while proving nothing.
  */
  {
    slug: "step-by-step-starships",
    name: "Step-by-Step Starships",
    source: "SotG",
    tagline: null,
    chapterNumber: 13,
    readingGroup: "Start here",
    order: 2,
  },
  // Placed nowhere. Every chapter of this book is placed today, so this is a
  // shape the corpus does not currently contain — which is why the list has to
  // be asked about it here rather than left to be discovered.
  {
    slug: "errata",
    name: "Errata",
    source: "SotG",
    tagline: null,
    chapterNumber: 14,
    readingGroup: null,
    order: null,
  },
];

function linkNames(): (string | undefined)[] {
  return screen.getAllByRole("link").map((link) => link.textContent?.trim());
}

describe("the starship chapter index", () => {
  it("is in the authored order, not the order the book printed", () => {
    renderList(chapters);

    expect(linkNames()).toEqual([
      "Introduction",
      "Step-by-Step Starships",
      "Starships",
      "Combat",
      // Unplaced, so last rather than at position zero.
      "Errata",
    ]);
  });

  /**
   * Stated separately so the difference is visible rather than implied. If the
   * two ever produced the same answer the test above would be pinning a
   * coincidence and would keep passing after the authored order stopped being
   * read.
   */
  it("differs from what the printed numbers would give", () => {
    renderList(chapters);

    const byPrintedNumber = [...chapters]
      .sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0))
      .map((chapter) => chapter.name);

    expect(linkNames()).not.toEqual(byPrintedNumber);
  });

  /**
   * What a reader is told about a chapter before opening it.
   *
   * "Chapter 9" was the old answer and it is the one fact about the passage a
   * reader on a website cannot act on: there is no book in their hands to turn
   * to page 9 of.
   */
  it("labels a chapter with the heading it is read under, not a page number", () => {
    renderList(chapters);

    // Present in both the compact line and the position column, which is the
    // intent rather than a duplicate to assert away.
    expect(screen.getAllByText("Flying it").length).toBeGreaterThan(0);

    expect(screen.queryByText("Chapter 9")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Chapter \d+$/)).not.toBeInTheDocument();
  });
});
