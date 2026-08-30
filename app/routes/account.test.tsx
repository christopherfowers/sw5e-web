/**
 * Route protection and role awareness.
 *
 * The three assertions that matter, and what would break each of them:
 *
 *   a signed-out reader is actually redirected     collapsing `loading` into
 *                                                  `anonymous`, or forgetting
 *                                                  the navigate entirely
 *   a signed-in reader is *not* redirected mid-    redirecting on `loading`,
 *   load                                           which bounces everybody on
 *                                                  every hard navigation
 *   a community account cannot reach contributor   an inline role check that
 *   surfaces                                       drifts, or a guard that
 *                                                  only hides the link
 */

import { screen, waitFor, within } from "@testing-library/react";
import { useSearchParams } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, user } from "../../tests/auth-api-contract";
import { marker, renderWithSession, serveApiContract } from "../../tests/harness";
import Account from "./account";
import AccountContributions from "./account-contributions";
import AccountProfile from "./account-profile";

const SIGN_IN_MARKER = "sign-in page reached";

/** Reports where the guard asked to be sent back to, so it can be asserted. */
function SignInProbe() {
  const [params] = useSearchParams();
  return (
    <p>
      {SIGN_IN_MARKER} · next={params.get("next") ?? "none"}
    </p>
  );
}

function accountRoutes() {
  return [
    {
      path: "/account",
      Component: Account,
      children: [
        { index: true, Component: AccountProfile },
        { path: "contributions", Component: AccountContributions },
      ],
    },
    { path: "/sign-in", Component: SignInProbe },
    { path: "/", Component: marker("home") },
  ];
}

function mount(contract: AuthApiContract, at = "/account") {
  serveApiContract(contract);
  return renderWithSession(accountRoutes(), [at]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a signed-out reader", () => {
  it("is redirected to the sign-in page", async () => {
    mount(new AuthApiContract({ session: null }));

    await waitFor(() =>
      expect(screen.getByText(new RegExp(SIGN_IN_MARKER))).toBeInTheDocument(),
    );
  });

  it("is redirected carrying the page they wanted, so they land back on it", async () => {
    mount(new AuthApiContract({ session: null }), "/account/contributions");

    await waitFor(() =>
      expect(
        screen.getByText(/next=\/account\/contributions/),
      ).toBeInTheDocument(),
    );
  });

  it("is left with no account content once the redirect has run", async () => {
    mount(new AuthApiContract({ session: null }));

    await waitFor(() =>
      expect(screen.getByText(new RegExp(SIGN_IN_MARKER))).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("navigation", { name: /account sections/i }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
  });
});

describe("while the session is still loading", () => {
  it("does not redirect, and does not paint account content either", () => {
    // Synchronous: this is the first render, before any answer. Redirecting
    // here would throw every signed-in reader to /sign-in on every hard
    // navigation, and painting content here would be a guess.
    mount(new AuthApiContract({ session: user() }));

    expect(screen.queryByText(new RegExp(SIGN_IN_MARKER))).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/checking your account/i);
  });
});

describe("a signed-in reader", () => {
  it("sees their account rather than a redirect", async () => {
    mount(new AuthApiContract({ session: user({ displayName: "Jen Ordo" }) }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: "Jen Ordo" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(new RegExp(SIGN_IN_MARKER))).toBeNull();
  });

  it("is told when the account service cannot be reached, and is not signed out", async () => {
    mount(new AuthApiContract({ session: user(), offline: true }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/i),
    );
    // An outage must not masquerade as a sign-out.
    expect(screen.queryByText(new RegExp(SIGN_IN_MARKER))).toBeNull();
  });
});

describe("role awareness", () => {
  /** The account nav, scoped so the profile page own links cannot satisfy it. */
  async function accountNav() {
    return screen.findByRole("navigation", { name: /account sections/i });
  }

  it("does not offer contributor navigation to a community account", async () => {
    mount(new AuthApiContract({ session: user({ roles: ["Community"] }) }));

    const nav = await accountNav();

    expect(
      within(nav).queryByRole("link", { name: /contributions/i }),
    ).toBeNull();
  });

  it("offers contributor navigation to a contributor", async () => {
    mount(new AuthApiContract({ session: user({ roles: ["Contributor"] }) }));

    const nav = await accountNav();

    expect(
      within(nav).getByRole("link", { name: /contributions/i }),
    ).toBeInTheDocument();
  });

  it("offers it to an administrator too, because Administrator includes Contributor", async () => {
    mount(new AuthApiContract({ session: user({ roles: ["Administrator"] }) }));

    const nav = await accountNav();

    expect(
      within(nav).getByRole("link", { name: /contributions/i }),
    ).toBeInTheDocument();
  });

  it("refuses the contributor page to a community account that navigates to it directly", async () => {
    // Hiding the link is not protection: this asserts the page itself refuses,
    // which is what someone typing the URL actually meets.
    mount(
      new AuthApiContract({ session: user({ roles: ["Community"] }) }),
      "/account/contributions",
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /this area is for contributor accounts/i,
      ),
    );
    expect(screen.queryByRole("heading", { name: /^contributions$/i })).toBeNull();
  });

  it("shows the contributor page to a contributor", async () => {
    mount(
      new AuthApiContract({ session: user({ roles: ["Contributor"] }) }),
      "/account/contributions",
    );

    expect(
      await screen.findByRole("heading", { name: /^contributions$/i }),
    ).toBeInTheDocument();
  });

  it("keeps the upload affordance off a community profile", async () => {
    mount(new AuthApiContract({ session: user({ roles: ["Community"] }) }));

    await screen.findByRole("heading", { name: /what this account can do/i });

    expect(screen.queryByRole("link", { name: /go to contributions/i })).toBeNull();
    expect(screen.getByText(/contributor access is granted by an admin/i)).toBeInTheDocument();
  });
});
