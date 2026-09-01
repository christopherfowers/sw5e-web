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
 * Its replacement, "Continuing sw5e.com", was wrong in a subtler way and did
 * more damage: it described the site as standing outside Star Wars 5e and
 * carrying its work forward. This site is Star Wars 5e. The tag now says what
 * the site is. It carried three different taglines and now carries none:
 * beside a logo reading SW5e and a name reading Star Wars 5e, a third
 * restatement said nothing the first two had not.
 *
 * These tests are here because that line is three words in a header and is
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
  it("says what the site is beside the wordmark", () => {
    mount();

    expect(
      screen.getByText(/^Star Wars 5e$/),
      "every page has to say which reference this is; most readers never see " +
        "the home page",
    ).toBeInTheDocument();
  });

  it("no longer describes the site as a community reference", () => {
    mount();

    expect(screen.queryByText(/community reference/i)).toBeNull();
  });

  /**
   * The assertion this file exists for now.
   *
   * "Continuing sw5e.com" put the site outside the project it is part of, on
   * every page, in the one line a reader who deep-linked into a single power
   * ever sees. A site that has changed where it is served from does not
   * introduce itself by its old address, and no verb of succession belongs in
   * the wordmark at all — "continuing", "successor" and "formerly" are three
   * ways of saying the same untrue thing.
   */
  it("does not describe itself as succeeding something else", () => {
    const { container } = mount();
    const text = container.textContent ?? "";

    expect(text).not.toMatch(/continuing/i);
    // Containment rather than a `/sw5e\.com/` regex. CodeQL reads an unanchored
    // hostname pattern as a host check arbitrary domains can slip past, and it
    // is right to in general; the subject here is the wordmark's own prose, so
    // a substring says what is meant without teaching anyone to dismiss that
    // rule. The rest of the suite already does it this way.
    expect(text).not.toContain("sw5e.com");
    expect(text).not.toMatch(/successor|formerly/i);
  });

  /**
   * The claim that stays forbidden, and for a reason unrelated to the one
   * above. Being Star Wars 5e is not being official: Star Wars belongs to
   * Lucasfilm and the conversion is fan content under the Fan Content Policy.
   * The header must never imply otherwise, whatever else it says.
   */
  it("never claims to be official", () => {
    const { container } = mount();

    expect(container.textContent ?? "").not.toMatch(/\bofficial\b/i);
  });
});
