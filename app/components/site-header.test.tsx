/**
 * The header's tagline, which is the only self-description on every page.
 *
 * Most arrivals at this site do not come through the home page. They come from
 * a search result for one power, one species, one stat block — and the home
 * page's lede, however well written, is not on the page they land on. The
 * wordmark tag is. It read "Community reference", which said nothing a reader
 * did not already know and, with the indefinite framing on the home page,
 * positioned the site as one option among several rather than as the
 * continuation of the reference that went quiet.
 *
 * These tests are here because that line is four words in a header and is
 * exactly the kind of thing a tidy-up reverts.
 */

import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, contractFetch } from "../../tests/auth-api-contract";
import { AuthProvider } from "~/auth/session";
import { SiteHeader } from "./site-chrome";

function mount() {
  // The header carries the account control, which really calls the session
  // endpoint on mount. The contract fixture answers it so these tests are
  // about the tagline rather than about an unhandled fetch.
  vi.stubGlobal("fetch", contractFetch(new AuthApiContract({ session: null })));
  const Stub = createRoutesStub([{ path: "/", Component: SiteHeader }]);
  return render(
    <AuthProvider>
      <Stub initialEntries={["/"]} />
    </AuthProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the site header", () => {
  it("states the site's lineage beside the wordmark", () => {
    mount();

    expect(
      screen.getByText(/continuing sw5e\.com/i),
      "every page has to say which reference this is; most readers never see " +
        "the home page",
    ).toBeInTheDocument();
  });

  it("no longer describes the site as a community reference", () => {
    mount();

    expect(screen.queryByText(/community reference/i)).toBeNull();
  });

  it("does not claim to be that site, only to continue it", () => {
    const { container } = mount();

    // "Continuing sw5e.com" is a claim of stewardship. Anything that reads as
    // the site announcing itself *as* sw5e.com, or as official, is a claim
    // nobody granted and one with legal weight behind it.
    expect(container.textContent ?? "").not.toMatch(/\bofficial\b/i);
  });
});
