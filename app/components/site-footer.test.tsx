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
   * The header carries the lineage and the footer carries the attribution, and
   * the two have to read as one voice. The footer borrows the wordmark's verb
   * — "Continuing sw5e.com" / "continues that work" — and repeats, on every
   * page, the limit the about page sets out at length.
   */
  it("continues sw5e.com without claiming to speak for it", () => {
    const footer = renderFooter().container;

    expect(footer).toHaveTextContent(/continues that work/i);
    expect(footer).toHaveTextContent(
      /does not speak for sw5e\.com or the people who ran it/i,
    );
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
