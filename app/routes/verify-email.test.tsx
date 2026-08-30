/**
 * Following the link from the verification email.
 *
 * The first test is about the prerender, not about verification: this page is
 * built once, from the bare path `/verify-email` with no query string, and
 * that HTML is served to everyone who follows a link with a token in it. If
 * the first render branched on the token, the markup React hydrates onto would
 * disagree with the markup it was handed.
 */

import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthApiContract,
  VALID_VERIFICATION_TOKEN,
} from "../../tests/auth-api-contract";
import { marker, renderWithSession, serveApiContract } from "../../tests/harness";
import VerifyEmail from "./verify-email";

function mount(contract: AuthApiContract, at: string) {
  serveApiContract(contract);
  return renderWithSession(
    [
      { path: "/verify-email", Component: VerifyEmail },
      { path: "/account", Component: marker("account page") },
      { path: "/account/passkeys", Component: marker("passkeys page") },
      { path: "/register", Component: marker("register page") },
    ],
    [at],
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the first render", () => {
  it("does not depend on the token, so the prerendered markup is hydratable", () => {
    // Synchronous, and with a token present: whatever is in the URL, the first
    // paint is the same as the one the build produced.
    mount(
      new AuthApiContract({ session: null }),
      `/verify-email?token=${VALID_VERIFICATION_TOKEN}`,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/checking your link/i);
    expect(screen.queryByText(/verified/i)).toBeNull();
  });
});

describe("with a valid token", () => {
  it("verifies the address and offers the next step", async () => {
    const contract = new AuthApiContract({ session: null });
    mount(contract, `/verify-email?token=${VALID_VERIFICATION_TOKEN}`);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /your email address is verified/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /set up a passkey/i }),
    ).toBeInTheDocument();
    expect(
      contract.calls.some((call) => call.path === "/email/verify"),
    ).toBe(true);
  });

  it("adopts the session the server returned, without a second round trip", async () => {
    const contract = new AuthApiContract({ session: null });
    mount(contract, `/verify-email?token=${VALID_VERIFICATION_TOKEN}`);

    await screen.findByRole("heading", { name: /your email address is verified/i });

    // One `/me` on mount, and none after: verification hands back the account.
    expect(contract.calls.filter((call) => call.path === "/me")).toHaveLength(1);
  });

  it("sends the token exactly once", async () => {
    // Verification tokens are single-use. A second request would answer 400
    // and turn a successful verification into a failure the reader cannot
    // explain.
    const contract = new AuthApiContract({ session: null });
    mount(contract, `/verify-email?token=${VALID_VERIFICATION_TOKEN}`);

    await screen.findByRole("heading", { name: /your email address is verified/i });

    expect(
      contract.calls.filter((call) => call.path === "/email/verify"),
    ).toHaveLength(1);
  });
});

describe("with a token the server rejects", () => {
  it("says the link expired and offers a new one", async () => {
    mount(new AuthApiContract({ session: null }), "/verify-email?token=stale");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/expired or has already been used/i);
    expect(screen.getByRole("link", { name: /request a new one/i })).toBeInTheDocument();
  });
});

describe("with no token at all", () => {
  it("explains the truncated link rather than reporting a failure", async () => {
    // Email clients break long links across lines. This is common enough that
    // it deserves its own message rather than "verification failed".
    mount(new AuthApiContract({ session: null }), "/verify-email");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no verification code in this address/i);
  });

  it("never calls the endpoint with an empty token", async () => {
    const contract = new AuthApiContract({ session: null });
    mount(contract, "/verify-email");

    await screen.findByRole("alert");

    expect(contract.calls.some((call) => call.path === "/email/verify")).toBe(false);
  });
});

describe("focus", () => {
  it("is moved to the outcome, because the reader arrived from another app", async () => {
    mount(
      new AuthApiContract({ session: null }),
      `/verify-email?token=${VALID_VERIFICATION_TOKEN}`,
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /email verified/i })).toHaveFocus(),
    );
  });
});
