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
import AccountPasskeys from "./account-passkeys";
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
        // Mounted because one of the tests below is about this page staying
        // reachable from a session that is refused everywhere else — it is
        // where the credential that unlocks the rest gets enrolled.
        { path: "passkeys", Component: AccountPasskeys },
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

describe("the account's own heading", () => {
  /**
   * The heading is the one piece of this page that does not depend on who is
   * reading it, so it is the one piece that may be in the file.
   *
   * `/account` is prerendered to static HTML and served, byte for byte, to
   * everybody; that file is frozen in `loading`, because identity is only
   * resolved after hydration. A heading that waited for the session would
   * therefore be absent from the markup nginx serves — leaving a `<main>`
   * landmark with no heading structure in it for every reader before hydration
   * and every reader without JavaScript — and it would differ between the
   * prerendered markup and the first client render, which is a hydration
   * mismatch. So it is asserted in each state the page can be in.
   */
  it("is there before the session has resolved", () => {
    // Synchronous: this is the first render, the state the static file holds.
    mount(new AuthApiContract({ session: user() }));

    expect(
      screen.getByRole("heading", { level: 1, name: /your account/i }),
    ).toBeInTheDocument();
  });

  it("is still there once a signed-in reader has been recognised", async () => {
    mount(new AuthApiContract({ session: user({ displayName: "Jen Ordo" }) }));

    await screen.findByRole("button", { name: /sign out/i });

    expect(
      screen.getByRole("heading", { level: 1, name: /your account/i }),
    ).toBeInTheDocument();
  });

  it("is still there when the account service cannot be reached", async () => {
    mount(new AuthApiContract({ session: user(), offline: true }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/i),
    );

    expect(
      screen.getByRole("heading", { level: 1, name: /your account/i }),
    ).toBeInTheDocument();
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

    // Sign-out belongs to the resolved frame and to nothing else, so it is
    // what separates "recognised" from any of the guard's states. The name is
    // no longer the page's heading — that is "Your account", drawn before the
    // session resolves — and it appears in the header chip as well as here.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Jen Ordo").length).toBeGreaterThan(0);
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

  it("does not offer administration to a contributor", async () => {
    // The one place in this navigation where hiding a link is right rather than
    // a substitute for a guard: `/account/people` is a directory of other
    // people's email addresses and refuses a contributor outright, so a link to
    // it could only ever produce a refusal.
    mount(new AuthApiContract({ session: user({ roles: ["Contributor"] }) }));

    const nav = await accountNav();

    expect(within(nav).queryByRole("link", { name: /^people$/i })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /audit log/i })).toBeNull();
  });

  it("offers administration to an administrator", async () => {
    // The control. Without it, navigation that hid the links from everybody
    // would satisfy the assertion above.
    mount(new AuthApiContract({ session: user({ roles: ["Administrator"] }) }));

    const nav = await accountNav();

    expect(
      within(nav).getByRole("link", { name: /^people$/i }),
    ).toBeInTheDocument();
    expect(
      within(nav).getByRole("link", { name: /audit log/i }),
    ).toBeInTheDocument();
  });

  it("keeps the upload affordance off a community profile", async () => {
    mount(new AuthApiContract({ session: user({ roles: ["Community"] }) }));

    await screen.findByRole("heading", { name: /what this account can do/i });

    expect(screen.queryByRole("link", { name: /go to contributions/i })).toBeNull();
    expect(screen.getByText(/contributor access is granted by an admin/i)).toBeInTheDocument();
  });
});

describe("how this session was established", () => {
  /**
   * These three facts are new on `CurrentUser`, and none of them describes the
   * account — they describe the browser holding the cookie. That distinction
   * is the reason the page can say something useful at all: the same account
   * may be signed in with a passkey on a phone and with an emailed code on a
   * borrowed laptop, and only one of those two readers should be offered a
   * passkey.
   */
  it("names the passkey when that is what got the reader in", async () => {
    mount(new AuthApiContract({ session: user({ authenticationMethod: "passkey" }) }));

    expect(
      await screen.findByText(/you signed in on this device with a passkey/i),
    ).toBeInTheDocument();
  });

  it("names the emailed code when that is what got the reader in", async () => {
    mount(
      new AuthApiContract({
        session: user({ authenticationMethod: "email", strongAuthentication: false }),
      }),
    );

    expect(
      await screen.findByText(/signed in on this device with a code emailed to you/i),
    ).toBeInTheDocument();
  });

  it("says nothing at all about a session that predates the field", async () => {
    // `null` is an older cookie, still perfectly valid, established before the
    // service recorded this. Guessing the weaker answer would nag somebody who
    // signed in with a passkey last week.
    mount(new AuthApiContract({ session: user({ authenticationMethod: null }) }));

    await screen.findByRole("heading", { name: /how this account is protected/i });
    expect(screen.queryByText(/you signed in on this device/i)).toBeNull();
  });
});

describe("an elevated role with nothing to back it", () => {
  /** A contributor who has neither a passkey nor an authenticator app. */
  function strandedContributor() {
    return user({
      roles: ["Contributor"],
      passkeys: [],
      twoFactorEnabled: false,
      authenticationMethod: "email",
      strongAuthentication: false,
    });
  }

  it("warns that the role cannot be used, and links to both ways out", async () => {
    mount(new AuthApiContract({ session: strandedContributor() }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/cannot be used yet/i);
    // Both, because either one satisfies the requirement and a reader on a
    // machine that cannot enrol a passkey needs the other named.
    expect(
      within(alert).getByRole("link", { name: /add a passkey/i }),
    ).toHaveAttribute("href", "/account/passkeys");
    expect(
      within(alert).getByRole("link", { name: /authenticator app/i }),
    ).toHaveAttribute("href", "/account/security");
  });

  it("does not also make the calm suggestion, which would be the same nag twice", async () => {
    mount(new AuthApiContract({ session: strandedContributor() }));

    await screen.findByRole("alert");
    expect(screen.queryByText(/add a passkey while you are here/i)).toBeNull();
  });

  it("says nothing of the kind to a community account, which owes nothing", async () => {
    mount(
      new AuthApiContract({
        session: user({
          roles: ["Community"],
          passkeys: [],
          twoFactorEnabled: false,
          authenticationMethod: "email",
          strongAuthentication: false,
        }),
      }),
    );

    await screen.findByRole("heading", { name: /how this account is protected/i });
    expect(screen.queryByText(/cannot be used yet/i)).toBeNull();
  });

  it("stops warning once an authenticator app covers the requirement", async () => {
    mount(
      new AuthApiContract({
        session: user({
          roles: ["Contributor"],
          passkeys: [],
          twoFactorEnabled: true,
        }),
      }),
    );

    await screen.findByRole("heading", { name: /how this account is protected/i });
    expect(screen.queryByText(/cannot be used yet/i)).toBeNull();
  });
});

describe("offering a passkey after an emailed-code sign-in", () => {
  it("makes the offer once, in the calm voice, with somewhere to go", async () => {
    mount(
      new AuthApiContract({
        session: user({
          passkeys: [],
          authenticationMethod: "email",
          strongAuthentication: false,
        }),
      }),
    );

    // Waited for by the heading rather than by the live region, because the
    // account frame's own "checking your account" spinner is a `status` too
    // and resolves first.
    await screen.findByRole("heading", { name: /how this account is protected/i });
    const offer = screen.getByRole("status");
    expect(offer).toHaveTextContent(/add a passkey while you are here/i);
    expect(
      within(offer).getByRole("link", { name: /add a passkey/i }),
    ).toHaveAttribute("href", "/account/passkeys");
    // An offer, not an alarm. `role="status"` waits for a gap in the screen
    // reader's speech; `role="alert"` interrupts, and interrupting somebody to
    // suggest an optional improvement is the definition of a nag.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not make it to somebody who already has a passkey", async () => {
    // They signed in with a code on this machine and have a passkey on
    // another. There is nothing to offer, and offering anyway is how a page
    // starts being ignored.
    mount(
      new AuthApiContract({
        session: user({
          authenticationMethod: "email",
          strongAuthentication: false,
        }),
      }),
    );

    await screen.findByRole("heading", { name: /how this account is protected/i });
    expect(screen.queryByText(/add a passkey while you are here/i)).toBeNull();
  });

  it("does not make it to somebody who signed in with a passkey", async () => {
    mount(new AuthApiContract({ session: user({ passkeys: [] }) }));

    await screen.findByRole("heading", { name: /how this account is protected/i });
    expect(screen.queryByText(/add a passkey while you are here/i)).toBeNull();
  });
});

describe("a session that only proved an inbox", () => {
  /**
   * The client-side mirror of a rule the API enforces on its own: a
   * contributor or administrator request from a session established with an
   * emailed code is refused with a 403 whose `code` is
   * `strong-authentication-required`.
   *
   * Drawn here for the same reason the role refusal is drawn rather than
   * redirected — so the reader meets an explanation instead of a page that
   * silently does nothing — and worded differently from the role refusal
   * because it means something different. "Does not have access" is the end of
   * the conversation. This is two clicks from being fixed.
   */
  function contributorOnAnEmailedCode() {
    return user({
      roles: ["Contributor"],
      authenticationMethod: "email",
      strongAuthentication: false,
    });
  }

  it("is refused the contributor area, and told what would fix it", async () => {
    mount(
      new AuthApiContract({ session: contributorOnAnEmailedCode() }),
      "/account/contributions",
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/needs a passkey or an authenticator app/i);
    expect(
      within(alert).getByRole("link", { name: /add a passkey/i }),
    ).toHaveAttribute("href", "/account/passkeys");
    expect(
      within(alert).getByRole("link", { name: /authenticator app/i }),
    ).toHaveAttribute("href", "/account/security");
  });

  it("is not told its account lacks access, which would be untrue", async () => {
    // It holds the role. Reporting a dead end at somebody who is a minute from
    // the answer is the specific failure this wording exists to avoid.
    mount(
      new AuthApiContract({ session: contributorOnAnEmailedCode() }),
      "/account/contributions",
    );

    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent(/does not have access/i);
    expect(screen.queryByRole("heading", { name: /^contributions$/i })).toBeNull();
  });

  it("still reaches the passkeys page, which is the way out of it", async () => {
    // The catch-22 this must never become: locking the account area behind the
    // very credential the account area is where you enrol.
    mount(
      new AuthApiContract({ session: contributorOnAnEmailedCode() }),
      "/account/passkeys",
    );

    expect(
      await screen.findByRole("heading", { name: /your passkeys/i }),
    ).toBeInTheDocument();
  });

  it("lets a contributor with a passkey straight through, as before", async () => {
    mount(
      new AuthApiContract({
        session: user({ roles: ["Contributor"], authenticationMethod: "passkey" }),
      }),
      "/account/contributions",
    );

    expect(
      await screen.findByRole("heading", { name: /^contributions$/i }),
    ).toBeInTheDocument();
  });
});
