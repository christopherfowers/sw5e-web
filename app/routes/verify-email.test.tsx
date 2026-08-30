/**
 * Following the link from the verification email.
 *
 * Two things are being pinned here, and the second is the one that was wrong.
 *
 * The first test is about the prerender: this page is built once, from the
 * bare path `/verify-email` with no query string, and that HTML is served to
 * everyone who follows a link with a token in it. If the first render branched
 * on the URL, the markup React hydrates onto would disagree with the markup it
 * was handed.
 *
 * Everything after it is about what verification actually does. It does *not*
 * sign anybody in — it opens a ten-minute window in which the account may
 * enrol its first passkey, and nothing else at all. So the assertions insist
 * that no session is claimed, that both halves of the link are sent, and that
 * the passkey ceremony really runs on this page rather than behind a link to
 * an account area the reader cannot yet reach.
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthApiContract,
  VALID_VERIFICATION_EMAIL,
  VALID_VERIFICATION_TOKEN,
} from "../../tests/auth-api-contract";
import { marker, renderWithSession, serveApiContract } from "../../tests/harness";
import { installAuthenticator, removeWebAuthn } from "../../tests/webauthn-stub";
import VerifyEmail from "./verify-email";

const GOOD_LINK = `/verify-email?email=${encodeURIComponent(
  VALID_VERIFICATION_EMAIL,
)}&token=${VALID_VERIFICATION_TOKEN}`;

let restore: (() => void) | null = null;

function mount(contract: AuthApiContract, at: string) {
  serveApiContract(contract);
  return renderWithSession(
    [
      { path: "/verify-email", Component: VerifyEmail },
      { path: "/sign-in", Component: marker("sign-in page") },
      { path: "/account", Component: marker("account page") },
      { path: "/account/passkeys", Component: marker("passkeys page") },
      { path: "/register", Component: marker("register page") },
    ],
    [at],
  );
}

afterEach(() => {
  restore?.();
  restore = null;
  vi.unstubAllGlobals();
});

describe("the first render", () => {
  it("does not depend on the link, so the prerendered markup is hydratable", () => {
    // Synchronous, and with a complete link present: whatever is in the URL,
    // the first paint is the same as the one the build produced.
    mount(new AuthApiContract({ session: null }), GOOD_LINK);

    expect(screen.getByRole("status")).toHaveTextContent(/checking your link/i);
    expect(screen.queryByText(/verified/i)).toBeNull();
  });
});

describe("with a complete link", () => {
  it("sends both the address and the token", async () => {
    // The token is scoped to the address it was issued for, and the API
    // refuses a request carrying only one of them. Sending the token alone —
    // which this page used to do — fails every verification.
    const contract = new AuthApiContract({ session: null });
    mount(contract, GOOD_LINK);

    await screen.findByRole("heading", { name: /your email address is verified/i });

    const call = contract.calls.find((entry) => entry.path === "/email/verify");
    expect(call?.body).toEqual({
      email: VALID_VERIFICATION_EMAIL,
      token: VALID_VERIFICATION_TOKEN,
    });
  });

  it("sends the token exactly once", async () => {
    // Verification tokens are single-use. A second request would answer 400
    // and turn a successful verification into a failure the reader cannot
    // explain.
    const contract = new AuthApiContract({ session: null });
    mount(contract, GOOD_LINK);

    await screen.findByRole("heading", { name: /your email address is verified/i });

    expect(
      contract.calls.filter((call) => call.path === "/email/verify"),
    ).toHaveLength(1);
  });

  it("does not claim a session, because verification does not create one", async () => {
    const contract = new AuthApiContract({ session: null });
    mount(contract, GOOD_LINK);

    await screen.findByRole("heading", { name: /your email address is verified/i });

    // The server is still anonymous, and the page has not pretended otherwise
    // by seeding the session with a user it was never given.
    expect(contract.session).toBeNull();
    expect(screen.queryByText("account page")).toBeNull();
  });

  it("says how long the enrolment window has left", async () => {
    // A window that expires silently is one people walk away from mid-flow.
    // The fixture opens a ten-minute one, as the service does.
    mount(new AuthApiContract({ session: null }), GOOD_LINK);

    // Waited for by heading rather than by role: the "checking your link"
    // spinner is a live region too, and would satisfy a bare role query while
    // the request was still in flight.
    await screen.findByRole("heading", { name: /your email address is verified/i });

    expect(screen.getByRole("status")).toHaveTextContent(/next 10 minutes/i);
  });
});

describe("enrolling the first passkey", () => {
  it("runs the ceremony on this page, using the enrolment ticket", async () => {
    // Not behind a link to /account/passkeys: that area is guarded on having a
    // session, and this reader has none — they would be bounced to /sign-in to
    // sign in with the passkey they have not made yet. These two endpoints
    // accept the ticket in a session's place, and they are the only ones that
    // do.
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    const contract = new AuthApiContract({ session: null });
    mount(contract, GOOD_LINK);

    await screen.findByRole("heading", { name: /your email address is verified/i });
    await userEvent.type(screen.getByLabelText(/name this passkey/i), "Work laptop");
    await userEvent.click(screen.getByRole("button", { name: /set up a passkey/i }));

    expect(
      await screen.findByRole("heading", { name: /your passkey is ready/i }),
    ).toBeInTheDocument();
    expect(authenticator.create).toHaveBeenCalledTimes(1);
    expect(contract.calls.map((call) => call.path)).toEqual(
      expect.arrayContaining([
        "/passkey/register/begin",
        "/passkey/register/complete",
      ]),
    );
    const complete = contract.calls.find(
      (call) => call.path === "/passkey/register/complete",
    );
    expect((complete?.body as { name?: string })?.name).toBe("Work laptop");
  });

  it("sends the reader on to sign in, since enrolling does not sign them in", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }), GOOD_LINK);

    await screen.findByRole("heading", { name: /your email address is verified/i });
    await userEvent.click(screen.getByRole("button", { name: /set up a passkey/i }));

    await screen.findByRole("heading", { name: /your passkey is ready/i });
    await userEvent.click(
      screen.getByRole("button", { name: /sign in with your passkey/i }),
    );

    expect(await screen.findByText("sign-in page")).toBeInTheDocument();
  });

  it("keeps the reader on the page and says why when the prompt is dismissed", async () => {
    const authenticator = installAuthenticator({
      failWith: new DOMException("", "NotAllowedError"),
    });
    restore = authenticator.uninstall;
    const contract = new AuthApiContract({ session: null });
    mount(contract, GOOD_LINK);

    await screen.findByRole("heading", { name: /your email address is verified/i });
    await userEvent.click(screen.getByRole("button", { name: /set up a passkey/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /passkey setup was not completed/i,
    );
    // The window is still open, so the button has to still be there.
    expect(screen.getByRole("button", { name: /set up a passkey/i })).toBeEnabled();
    expect(
      contract.calls.some((call) => call.path === "/passkey/register/complete"),
      "a ceremony that produced no credential must not be reported as complete",
    ).toBe(false);
  });

  it("explains a browser with no WebAuthn rather than offering a button that cannot work", async () => {
    restore = removeWebAuthn();
    mount(new AuthApiContract({ session: null }), GOOD_LINK);

    await screen.findByRole("heading", { name: /your email address is verified/i });

    await waitFor(() =>
      expect(
        screen.getByText(/this browser cannot create passkeys/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /set up a passkey/i })).toBeDisabled();
  });
});

describe("with a token the server rejects", () => {
  it("says the link expired and offers a new one", async () => {
    mount(
      new AuthApiContract({ session: null }),
      `/verify-email?email=${encodeURIComponent(VALID_VERIFICATION_EMAIL)}&token=stale`,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/expired or has already been used/i);
    expect(screen.getByRole("link", { name: /request a new one/i })).toBeInTheDocument();
  });
});

describe("with half a link", () => {
  /**
   * A truncated link and a rejected token need different advice: one is fixed
   * by pasting the whole address, the other by requesting a new email. Mail
   * clients wrap long URLs, so the truncated case is common enough to earn its
   * own message — and reporting it as "expired" sends the reader off for a
   * replacement that arrives in exactly the same shape.
   */
  it("explains a missing address rather than reporting a rejected token", async () => {
    mount(
      new AuthApiContract({ session: null }),
      `/verify-email?token=${VALID_VERIFICATION_TOKEN}`,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/part of the verification link is missing/i);
    expect(alert).not.toHaveTextContent(/expired/i);
  });

  it("explains a missing token the same way", async () => {
    mount(
      new AuthApiContract({ session: null }),
      `/verify-email?email=${encodeURIComponent(VALID_VERIFICATION_EMAIL)}`,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /part of the verification link is missing/i,
    );
  });

  it("never calls the endpoint with half a link", async () => {
    const contract = new AuthApiContract({ session: null });
    mount(contract, "/verify-email");

    await screen.findByRole("alert");

    expect(contract.calls.some((call) => call.path === "/email/verify")).toBe(false);
  });
});

describe("focus", () => {
  it("is moved to the outcome, because the reader arrived from another app", async () => {
    mount(new AuthApiContract({ session: null }), GOOD_LINK);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /email verified/i })).toHaveFocus(),
    );
  });

  it("follows the change when the passkey is created", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }), GOOD_LINK);

    await screen.findByRole("heading", { name: /your email address is verified/i });
    await userEvent.click(screen.getByRole("button", { name: /set up a passkey/i }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /passkey created/i }),
      ).toHaveFocus(),
    );
  });
});
