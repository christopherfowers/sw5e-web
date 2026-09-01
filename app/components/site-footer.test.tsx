import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { SiteFooter } from "./site-chrome";

/**
 * The footer makes three claims that are easy to blur into one another, and
 * the wording it replaced blurred all three: it said "game content and artwork
 * belong to their authors", which named nobody, and said nothing about who
 * made the conversion or about the site's own licence.
 *
 * These assertions are on the substance rather than on the exact sentences, so
 * the copy can be edited without a test rewrite — but a rewrite that drops one
 * of the three claims, or that starts implying the site owns Star Wars or that
 * MIT covers the game content, fails.
 */

function renderFooter() {
  const Stub = createRoutesStub([{ path: "/", Component: () => <SiteFooter /> }]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("the site footer", () => {
  it("names who made the conversion rather than crediting nobody", () => {
    renderFooter();

    expect(screen.getByRole("contentinfo")).toHaveTextContent(/Galiphile/);
    expect(screen.getByRole("contentinfo")).toHaveTextContent(
      /community of contributors/i,
    );
  });

  it("states the footing the conversion was made on", () => {
    renderFooter();

    expect(screen.getByRole("contentinfo")).toHaveTextContent(
      /Wizards of the Coast.s Fan Content Policy/i,
    );
  });

  it("says Star Wars belongs to Lucasfilm and that this site is unofficial", () => {
    const footer = renderFooter().container;

    expect(footer).toHaveTextContent(/belong to Lucasfilm/i);
    expect(footer).toHaveTextContent(/unofficial/i);
    expect(footer).toHaveTextContent(/not affiliated with, endorsed by/i);
  });

  /**
   * The distinction the old wording lost. The code is MIT; the game content
   * and artwork are not, and are not the site's to license.
   */
  it("separates the site's own licence from the game content's", () => {
    const footer = renderFooter().container;

    expect(footer).toHaveTextContent(/source code is MIT licensed/i);
    expect(footer).toHaveTextContent(
      /game content and the artwork are not the site.s to license/i,
    );
  });

  /**
   * The sentence this footer used to carry, and the reason it is now asserted
   * on its absence rather than on its wording.
   *
   * It read "This site continues that work and does not speak for sw5e.com or
   * the people who ran it", and it disclaimed a relationship that exists. This
   * site is Star Wars 5e. A disclaimer of that is not a modest hedge, it is a
   * false statement, and it appeared on every page of the site — which is
   * exactly why it is pinned here: the removed sentence is short, plausible and
   * of the kind a tidy-up would happily reinstate.
   *
   * Both halves are checked. "Continues that work" goes too, not only the
   * disclaimer: a footer that still described the site as continuing something
   * would keep the same false distance in a friendlier register.
   */
  it("no longer disclaims a relationship with sw5e.com that exists", () => {
    const footer = renderFooter().container;

    expect(footer).not.toHaveTextContent(/does not speak for/i);
    expect(footer).not.toHaveTextContent(/continues that work/i);
    expect(footer).not.toHaveTextContent(/the people who ran it/i);
  });

  /**
   * And what stands in its place. The footer has to say which project this is,
   * because it is one of only two things on every page that says anything about
   * the site at all — the wordmark tagline is the other.
   */
  it("says that this site is the reference, not a bystander to it", () => {
    const footer = renderFooter().container;

    expect(footer).toHaveTextContent(/this site is that reference/i);
  });

  it("links to the credits, so the claim about who made it is reachable", () => {
    renderFooter();

    expect(screen.getByRole("link", { name: "Credits" })).toHaveAttribute(
      "href",
      "/credits",
    );
  });

  /**
   * The sentence this replaced. Asserting on its absence is what stops it
   * being reinstated by a revert that looks tidy in a diff.
   */
  it("no longer claims artwork belongs to unnamed authors", () => {
    const footer = renderFooter().container;

    expect(footer).not.toHaveTextContent(
      /Game content and artwork belong to their authors/i,
    );
  });
});
