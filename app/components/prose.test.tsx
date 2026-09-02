/**
 * Prose headings as addresses.
 *
 * The community's own request was for "more links to sections for
 * navigation", and the state before this was that a rules chapter carried
 * forty-four headings and not one of them could be linked to — the only
 * address anybody could send was the whole chapter with "scroll down" after
 * it.
 *
 * What is asserted here is the part that makes a link worth sending: the id is
 * derived from the heading, it is unique within the page, and the anchor that
 * exposes it says which section it leads to rather than repeating "link to
 * this section" forty-four times into a screen reader.
 */

import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { uniqueSlugger } from "~/content/slug";
import { Prose } from "./prose";

/**
 * Names this markdown's headings the way `nameItemHeadings` would, then draws
 * it. A slugger is passed in when a test needs two blocks to share a namespace,
 * which is what an item page does across its sections and entries.
 */
function renderProse(markdown: string, slugger = uniqueSlugger()) {
  const headingIds = markdown
    .split(/\r?\n/)
    .map((line) => /^\s{0,3}#{1,6}\s+(.*)$/.exec(line.trim())?.[1]?.trim())
    .filter((heading): heading is string => Boolean(heading))
    .map(slugger);

  const Stub = createRoutesStub([
    { path: "/", Component: () => <Prose markdown={markdown} headingIds={headingIds} /> },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("a heading in the corpus", () => {
  it("carries an id taken from its own words", () => {
    renderProse("## Travel Pace\n\nText.");

    expect(screen.getByRole("heading", { name: /travel pace/i })).toHaveAttribute(
      "id",
      "travel-pace",
    );
  });

  it("is followed by a link to itself", () => {
    renderProse("## Travel Pace\n\nText.");

    const anchor = screen.getByRole("link", { name: "Link to Travel Pace" });

    expect(anchor).toHaveAttribute("href", "#travel-pace");
  });

  it("names the section in the link, not itself", () => {
    // Forty-four links all called "Link to this section" is a list a screen
    // reader user cannot choose from.
    renderProse("## Resting\n\nText.\n\n## Vision and Light\n\nMore.");

    expect(screen.getByRole("link", { name: "Link to Resting" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Link to Vision and Light" }),
    ).toBeInTheDocument();
  });

  it("takes its name from the words, not the markup around them", () => {
    // Emphasis and links inside a heading are formatting; the address is what
    // the heading says.
    renderProse("## The **Long** Rest\n\nText.");

    expect(screen.getByRole("heading", { level: 2 })).toHaveAttribute(
      "id",
      "the-long-rest",
    );
  });
});

describe("the anchor and the outline", () => {
  it("does not put its own name into the heading's", () => {
    /*
      The regression this exists for, and it is one that only shows up in a
      screen reader. A link nested inside a heading contributes its name to the
      heading's, so the first version of this made every heading announce as
      "Benefits Link to Benefits" — an anchor added to help people navigate the
      outline, making the outline worse to listen to.

      Asserted as an exact name rather than a substring, because a substring
      match passes on the broken version.
    */
    renderProse("## Benefits\n\nText.");

    const heading = screen.getByRole("heading", { level: 2 });

    expect(heading).toHaveAccessibleName("Benefits");
  });

  it("keeps the anchor reachable and named in its own right", () => {
    // The other half. Making the heading's name clean by hiding the anchor
    // from assistive technology would take it away from keyboard users too.
    renderProse("## Benefits\n\nText.");

    const anchor = screen.getByRole("link", { name: "Link to Benefits" });

    expect(anchor).not.toHaveAttribute("aria-hidden");
    expect(anchor).not.toHaveAttribute("tabindex", "-1");
  });
});

describe("two headings that would collide", () => {
  it("get separate addresses", () => {
    renderProse("## Variant\n\nOne.\n\n## Variant\n\nTwo.");

    const headings = screen.getAllByRole("heading", { name: /variant/i });

    expect(headings.map((heading) => heading.id)).toEqual(["variant", "variant-2"]);
  });

  it("collide across separate Prose blocks on one page, unless they share a slugger", () => {
    // The reason the slugger is a prop. An item page renders one Prose per
    // section and one per entry; a slugger made inside each would hand out
    // `resting` to all of them.
    const shared = uniqueSlugger();

    const first = renderProse("## Resting\n\nOne.", shared);
    const second = renderProse("## Resting\n\nTwo.", shared);

    expect(within(first.container).getByRole("heading").id).toBe("resting");
    expect(within(second.container).getByRole("heading").id).toBe("resting-2");
  });
});

describe("prose with no page to be addressed on", () => {
  it("has no ids and no anchors when no slugger is given", () => {
    // A draft preview and a revision diff are not published pages. An address
    // for a heading in one of them is a promise nothing keeps.
    const Stub = createRoutesStub([
      { path: "/", Component: () => <Prose markdown={"## Resting\n\nText."} /> },
    ]);
    render(<Stub initialEntries={["/"]} />);

    expect(screen.getByRole("heading", { name: "Resting" })).not.toHaveAttribute("id");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
