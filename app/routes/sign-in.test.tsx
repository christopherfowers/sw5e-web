/**
 * Signing in with a passkey.
 *
 * The happy-path test is the least interesting one here. What this file is
 * really for is the four ways the ceremony fails in the wild — dismissed
 * prompt, unsupported browser, no platform authenticator, service down — and
 * the two-legged MFA path, none of which a manual pass over the page would
 * ever exercise.
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, user, VALID_TOTP_CODE } from "../../tests/auth-api-contract";
import { marker, renderWithSession, serveApiContract } from "../../tests/harness";
import { installAuthenticator, removeWebAuthn } from "../../tests/webauthn-stub";
import SignIn from "./sign-in";

const ACCOUNT_MARKER = "account page reached";

let restore: (() => void) | null = null;

function mount(contract: AuthApiContract, at = "/sign-in") {
  serveApiContract(contract);
  return renderWithSession(
    [
      { path: "/sign-in", Component: SignIn },
      { path: "/account", Component: marker(ACCOUNT_MARKER) },
      { path: "/account/passkeys", Component: marker("passkeys page reached") },
    ],
    [at],
  );
}

function passkeyButton() {
  return screen.getByRole("button", { name: /continue with a passkey/i });
}

afterEach(() => {
  restore?.();
  restore = null;
  vi.unstubAllGlobals();
});

describe("the happy path", () => {
  it("signs in and lands on the account page", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    const contract = new AuthApiContract({ session: null });
    mount(contract);

    await userEvent.click(passkeyButton());

    await waitFor(() =>
      expect(screen.getByText(ACCOUNT_MARKER)).toBeInTheDocument(),
    );
    // Both legs of the ceremony really ran; a UI that navigated without them
    // would otherwise pass.
    expect(authenticator.get).toHaveBeenCalledTimes(1);
    expect(
      contract.calls.map((call) => call.path),
    ).toEqual(
      expect.arrayContaining(["/passkey/login/begin", "/passkey/login/complete"]),
    );
  });

  it("returns the reader to the page they were sent from", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }), "/sign-in?next=%2Faccount%2Fpasskeys");

    await userEvent.click(passkeyButton());

    await waitFor(() =>
      expect(screen.getByText("passkeys page reached")).toBeInTheDocument(),
    );
  });

  it("ignores a destination pointing at another origin", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }), "/sign-in?next=%2F%2Fevil.example");

    await userEvent.click(passkeyButton());

    await waitFor(() =>
      expect(screen.getByText(ACCOUNT_MARKER)).toBeInTheDocument(),
    );
  });
});

describe("when the ceremony does not complete", () => {
  it("surfaces a dismissed or timed-out prompt as a real error", async () => {
    // The case a passkey UI most often gets wrong: the browser reports this as
    // an empty NotAllowedError, and a page that ignores it simply appears to
    // do nothing when someone presses Escape.
    const authenticator = installAuthenticator({
      failWith: new DOMException("", "NotAllowedError"),
    });
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }));

    await userEvent.click(passkeyButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/sign-in was not completed/i);
    expect(alert).toHaveTextContent(/dismissed, timed out/i);
  });

  it("leaves the button usable so the reader can try again", async () => {
    const authenticator = installAuthenticator({
      failWith: new DOMException("", "NotAllowedError"),
    });
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }));

    await userEvent.click(passkeyButton());
    await screen.findByRole("alert");

    expect(passkeyButton()).toBeEnabled();
  });

  it("does not claim success, and does not navigate", async () => {
    const authenticator = installAuthenticator({
      failWith: new DOMException("", "NotAllowedError"),
    });
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }));

    await userEvent.click(passkeyButton());
    await screen.findByRole("alert");

    expect(screen.queryByText(ACCOUNT_MARKER)).toBeNull();
  });

  it("blames the service, not the passkey, when the API is unreachable", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null, offline: true }));

    await userEvent.click(passkeyButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be reached/i);
    expect(alert).not.toHaveTextContent(/not accepted/i);
  });
});

describe("when the browser cannot do passkeys at all", () => {
  it("says so and disables the button rather than opening a prompt that fails", async () => {
    restore = removeWebAuthn();
    mount(new AuthApiContract({ session: null }));

    await waitFor(() =>
      expect(
        screen.getByText(/this browser does not support passkeys/i),
      ).toBeInTheDocument(),
    );
    expect(passkeyButton()).toBeDisabled();
  });

  it("still tells the reader what they can do instead", async () => {
    restore = removeWebAuthn();
    mount(new AuthApiContract({ session: null }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/open this page on a device that has one/i);
  });
});

describe("when the device has no built-in authenticator", () => {
  it("warns without disabling: a security key or a phone can still answer", async () => {
    const authenticator = installAuthenticator({ platformAuthenticator: false });
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }));

    await waitFor(() =>
      expect(
        screen.getByText(/this device has no built-in authenticator/i),
      ).toBeInTheDocument(),
    );
    expect(passkeyButton()).toBeEnabled();
  });

  it("says nothing at all when the device does have one", async () => {
    const authenticator = installAuthenticator({ platformAuthenticator: true });
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }));

    await waitFor(() => expect(passkeyButton()).toBeEnabled());
    expect(
      screen.queryByText(/no built-in authenticator/i),
      "the warning must not be shown to the overwhelming majority for whom it is untrue",
    ).toBeNull();
  });
});

describe("two-factor authentication", () => {
  /**
   * The literal the server sends is `mfaRequired` — camelCase, no hyphen — and
   * the branch carries `user: null` and nothing else. A client comparing
   * against `mfa-required` falls through to the authenticated branch and reads
   * a user that is not there, so these tests are as much about the spelling as
   * about the flow.
   */
  it("asks for a code instead of signing in, and does not navigate first", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null, mfaRequired: true }));

    await userEvent.click(passkeyButton());

    expect(await screen.findByLabelText(/six-digit code/i)).toBeInTheDocument();
    expect(screen.queryByText(ACCOUNT_MARKER)).toBeNull();
  });

  it("completes sign-in once a valid code is given", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    const contract = new AuthApiContract({ session: null, mfaRequired: true });
    mount(contract);

    await userEvent.click(passkeyButton());
    await userEvent.type(await screen.findByLabelText(/six-digit code/i), VALID_TOTP_CODE);
    await userEvent.click(screen.getByRole("button", { name: /verify and sign in/i }));

    await waitFor(() =>
      expect(screen.getByText(ACCOUNT_MARKER)).toBeInTheDocument(),
    );
  });

  it("rejects a wrong code, clears the field, and stays on the step", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null, mfaRequired: true }));

    await userEvent.click(passkeyButton());
    const field = await screen.findByLabelText(/six-digit code/i);
    await userEvent.type(field, "000000");
    await userEvent.click(screen.getByRole("button", { name: /verify and sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/not correct/i);
    expect(field).toHaveValue("");
    expect(screen.queryByText(ACCOUNT_MARKER)).toBeNull();
  });

  it("does not send a code that is the wrong length", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    const contract = new AuthApiContract({ session: null, mfaRequired: true });
    mount(contract);

    await userEvent.click(passkeyButton());
    await userEvent.type(await screen.findByLabelText(/six-digit code/i), "123");
    await userEvent.click(screen.getByRole("button", { name: /verify and sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/six-digit code/i);
    expect(
      contract.calls.some((call) => call.path === "/mfa/totp/verify"),
    ).toBe(false);
  });

  it("moves focus onto the new step so a screen reader is not left behind", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null, mfaRequired: true }));

    await userEvent.click(passkeyButton());

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /enter your authentication code/i }),
      ).toHaveFocus(),
    );
  });
});

describe("an already signed-in reader", () => {
  it("is taken straight to their account rather than shown a sign-in form", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: user() }));

    await waitFor(() =>
      expect(screen.getByText(ACCOUNT_MARKER)).toBeInTheDocument(),
    );
  });
});

describe("no email is asked for, and none is sent", () => {
  /**
   * The API ignores the request body on `passkey/login/begin`, never accepts
   * an address, and always answers with an empty `allowCredentials` — so an
   * email field here is a control that cannot change the outcome, and asking
   * for one on a sign-in page implies the answer depends on it.
   *
   * It is also what keeps this page from being an account-existence oracle:
   * with no input, there is nothing whose answer could differ between a
   * registered address and an unregistered one.
   */
  it("offers no address field anywhere on the page", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }));

    await waitFor(() => expect(passkeyButton()).toBeEnabled());
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    expect(screen.queryByText(/my passkey is not being offered/i)).toBeNull();
  });

  it("starts the ceremony with no request body at all", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    const contract = new AuthApiContract({ session: null });
    mount(contract);

    await userEvent.click(passkeyButton());

    await waitFor(() =>
      expect(screen.getByText(ACCOUNT_MARKER)).toBeInTheDocument(),
    );
    const begin = contract.calls.find((call) => call.path === "/passkey/login/begin");
    expect(begin?.body).toBeUndefined();
  });
});
