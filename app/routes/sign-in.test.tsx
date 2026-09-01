/**
 * Signing in: with a passkey, and with a code sent to an email address.
 *
 * The happy-path tests are the least interesting ones here. What this file is
 * really for is the ways each path fails in the wild — a dismissed prompt, an
 * unsupported browser, no platform authenticator, a service that is down, a
 * code that is wrong or spent, a caller who has asked for too many — plus the
 * two-legged MFA path, which is now reachable through either door and has to
 * come back out of the one it was entered by. None of that is exercised by a
 * manual pass over the page.
 *
 * One property runs underneath the emailed-code tests and is worth stating
 * once: the page must never reveal whether an address has an account. The API
 * guarantees it by answering identically; the tests below check that the UI
 * does not undo the guarantee by wording two identical answers differently.
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthApiContract,
  EMAIL_CODE_REQUEST_BUDGET,
  user,
  VALID_EMAIL_CODE,
  VALID_TOTP_CODE,
  VALID_VERIFICATION_EMAIL,
} from "../../tests/auth-api-contract";
import { marker, renderWithSession, serveApiContract } from "../../tests/harness";
import { installAuthenticator, removeWebAuthn } from "../../tests/webauthn-stub";
import SignIn from "./sign-in";

const ACCOUNT_MARKER = "account page reached";

/** An address the fixture has never heard of, and never will have. */
const UNKNOWN_EMAIL = "stranger@example.com";

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

function codeField() {
  return screen.getByLabelText(/six-digit code/i);
}

function resendButton() {
  return screen.getByRole("button", { name: /send a new code/i });
}

/**
 * Walks from the landing step to the code step for `address`.
 *
 * Every emailed-code test starts here, and going through the real controls
 * rather than reaching into state is deliberate: the route from the passkey
 * step to the address field is itself something that can break, and a helper
 * that skipped it would keep passing after the alternative stopped being
 * reachable.
 */
async function requestCodeFor(address: string) {
  await waitFor(() => expect(passkeyButton()).toBeEnabled());
  await userEvent.click(
    screen.getByRole("button", { name: /email me a sign-in code/i }),
  );
  await userEvent.type(await screen.findByLabelText(/email address/i), address);
  await userEvent.click(screen.getByRole("button", { name: /^email me a code$/i }));
  return screen.findByLabelText(/six-digit code/i);
}

/** The whole rendered card, which is what "identical" has to mean. */
function cardText(): string {
  return document.querySelector(".auth-card")?.textContent ?? "";
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


describe("no email is asked for by the passkey path, and none is sent", () => {
  /**
   * This block used to assert something stronger and simpler: that there was
   * no email field anywhere on the sign-in page at all. That is no longer
   * true, because the page now offers an emailed one-time code for the
   * machines a passkey cannot reach — so the property it was really guarding
   * has to be restated in the narrower form that survives, rather than deleted
   * along with the assertion.
   *
   * What was being protected was never the absence of a field for its own
   * sake. It was two facts.
   *
   * The passkey ceremony takes no address, because the API ignores the body on
   * `passkey/login/begin`, never accepts one, and always answers with an empty
   * `allowCredentials`. A field on that step would be a control that cannot
   * change the outcome, and asking for one implies the answer depends on it.
   * That is unchanged, and is asserted below on the passkey step and on the
   * request it makes.
   *
   * And the page must not be an account-existence oracle. That used to follow
   * from there being no input at all; it now has to be enforced where the
   * input is. So the third test drives the emailed-code path with a registered
   * address and with one the fixture has never heard of, and requires the
   * rendered result to be the same characters. The guarantee moved from the
   * shape of the form to the behaviour of the server, and the test moved with
   * it.
   */
  it("offers no address field on the passkey step", async () => {
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

  it("says exactly the same thing about an address it knows and one it does not", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;

    const known = new AuthApiContract({ session: null });
    const first = mount(known);
    await requestCodeFor(VALID_VERIFICATION_EMAIL);
    // Only the address the reader typed is allowed to differ. Everything the
    // page says about it has to be the same characters in the same order.
    const knownScreen = cardText().replaceAll(VALID_VERIFICATION_EMAIL, "«address»");
    first.unmount();

    const unknown = new AuthApiContract({ session: null });
    const second = mount(unknown);
    await requestCodeFor(UNKNOWN_EMAIL);
    const unknownScreen = cardText().replaceAll(UNKNOWN_EMAIL, "«address»");
    second.unmount();

    expect(unknownScreen).toBe(knownScreen);
    // And both really asked. Two identical screens for two requests that were
    // never made would prove nothing at all.
    expect(known.calls.filter((call) => call.path === "/email/code")).toHaveLength(1);
    expect(unknown.calls.filter((call) => call.path === "/email/code")).toHaveLength(1);
  });
});

describe("the emailed code is offered as the alternative, not as an equal", () => {
  it("puts the passkey button before the emailed-code button in the document", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }));

    await waitFor(() => expect(passkeyButton()).toBeEnabled());
    const alternative = screen.getByRole("button", {
      name: /email me a sign-in code/i,
    });

    // Reading order is the recommendation, for everyone who meets this page
    // through a screen reader or a keyboard rather than through the styling.
    expect(
      passkeyButton().compareDocumentPosition(alternative) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the passkey button as the only primary action", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }));

    await waitFor(() => expect(passkeyButton()).toBeEnabled());

    expect(passkeyButton()).toHaveClass("button-primary");
    expect(
      screen.getByRole("button", { name: /email me a sign-in code/i }),
    ).not.toHaveClass("button-primary");
  });

  it("still offers it when the browser cannot do passkeys at all", async () => {
    // The readers this path exists for most: the button beside it is disabled,
    // so an alternative that vanished along with WebAuthn support would leave
    // them looking at a page with nothing on it they can press.
    restore = removeWebAuthn();
    mount(new AuthApiContract({ session: null }));

    await waitFor(() => expect(passkeyButton()).toBeDisabled());
    expect(
      screen.getByRole("button", { name: /email me a sign-in code/i }),
    ).toBeEnabled();
  });
});

describe("signing in with an emailed code", () => {
  it("asks for an address, then a code, then signs in", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    const contract = new AuthApiContract({ session: null });
    mount(contract);

    await requestCodeFor(VALID_VERIFICATION_EMAIL);
    await userEvent.type(codeField(), VALID_EMAIL_CODE);
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() =>
      expect(screen.getByText(ACCOUNT_MARKER)).toBeInTheDocument(),
    );
    // The code really was posted with the address it was issued for. The
    // server pairs the two, so a client that sent only the digits would be
    // refused every time — and would look, from here, exactly like a client
    // that sent a wrong code.
    const verify = contract.calls.find((call) => call.path === "/email/code/verify");
    expect(verify?.body).toEqual({
      email: VALID_VERIFICATION_EMAIL,
      code: VALID_EMAIL_CODE,
    });
  });

  it("returns the reader to the page they were sent from", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(
      new AuthApiContract({ session: null }),
      "/sign-in?next=%2Faccount%2Fpasskeys",
    );

    await requestCodeFor(VALID_VERIFICATION_EMAIL);
    await userEvent.type(codeField(), VALID_EMAIL_CODE);
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() =>
      expect(screen.getByText("passkeys page reached")).toBeInTheDocument(),
    );
  });

  it("moves focus onto each new step so a screen reader is not left behind", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }));

    await waitFor(() => expect(passkeyButton()).toBeEnabled());
    await userEvent.click(
      screen.getByRole("button", { name: /email me a sign-in code/i }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /enter your email address/i }),
      ).toHaveFocus(),
    );

    await userEvent.type(
      screen.getByLabelText(/email address/i),
      VALID_VERIFICATION_EMAIL,
    );
    await userEvent.click(screen.getByRole("button", { name: /^email me a code$/i }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /enter the code we emailed you/i }),
      ).toHaveFocus(),
    );
  });

  it("does not steal focus on arrival, before the reader has moved anywhere", async () => {
    // A heading that grabs focus the moment a page loads is its own bug: it
    // throws away wherever the browser had put the caret, including an address
    // bar somebody was still typing in.
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }));

    await waitFor(() => expect(passkeyButton()).toBeEnabled());

    expect(
      screen.getByRole("heading", { name: /choose how to sign in/i }),
    ).not.toHaveFocus();
  });
});

describe("when the emailed code is not accepted", () => {
  it("rejects a wrong code, clears the field, and stays on the step", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }));

    const field = await requestCodeFor(VALID_VERIFICATION_EMAIL);
    await userEvent.type(field, "000000");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/not accepted/i);
    expect(field).toHaveValue("");
    expect(codeField()).toBeInTheDocument();
    expect(screen.queryByText(ACCOUNT_MARKER)).toBeNull();
  });

  it("says nothing about why, because the server does not either", async () => {
    // The single 401 covers a wrong code, an expired one, a spent one, one
    // issued for another address, and an address with no account at all. A UI
    // that separated any of those would be telling whoever is guessing which
    // of their guesses was close.
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }));

    const field = await requestCodeFor(UNKNOWN_EMAIL);
    await userEvent.type(field, VALID_EMAIL_CODE);
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/not accepted/i);
    expect(alert).not.toHaveTextContent(/expired/i);
    expect(alert).not.toHaveTextContent(/no account|not found|unknown/i);
  });

  it("does not send a code that is the wrong length", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    const contract = new AuthApiContract({ session: null });
    mount(contract);

    const field = await requestCodeFor(VALID_VERIFICATION_EMAIL);
    await userEvent.type(field, "123");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/six-digit code/i);
    expect(
      contract.calls.some((call) => call.path === "/email/code/verify"),
    ).toBe(false);
  });

  it("refuses a code that has already been redeemed once", async () => {
    /*
     * Single use is the property that makes a code safe to put in an inbox at
     * all, and it is invisible from the happy path — a client that never
     * redeemed one twice would pass either way. Driving it needs a flow that
     * survives the first redemption, which is what the second-factor branch
     * gives: the code is spent, the sign-in is not finished, and "start over"
     * comes back to the same field with the same digits still in the reader's
     * hand.
     */
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null, mfaRequired: true }));

    await requestCodeFor(VALID_VERIFICATION_EMAIL);
    await userEvent.type(codeField(), VALID_EMAIL_CODE);
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(
      await screen.findByRole("heading", { level: 1, name: /one more step/i }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /start over/i }));
    await userEvent.type(
      await screen.findByLabelText(/six-digit code/i),
      VALID_EMAIL_CODE,
    );
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/not accepted/i);
    expect(screen.queryByText(ACCOUNT_MARKER)).toBeNull();
  });

  it("blames the service, not the code, when the API is unreachable", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    const contract = new AuthApiContract({ session: null });
    mount(contract);

    const field = await requestCodeFor(VALID_VERIFICATION_EMAIL);
    contract.offline = true;
    await userEvent.type(field, VALID_EMAIL_CODE);
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be reached/i);
    expect(alert).not.toHaveTextContent(/not accepted/i);
  });
});

describe("asking for a code too often", () => {
  it("reports the refusal as rate limiting rather than as an outage", async () => {
    /*
     * The distinction is the whole test. Both failures leave the reader
     * looking at the same form having achieved nothing, and the advice for
     * each is the opposite of the advice for the other: wait, versus check
     * your connection and try again. A client that reported a 429 as "the
     * service could not be reached" would have people hammering an endpoint
     * that is refusing them precisely for hammering it.
     */
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    const contract = new AuthApiContract({ session: null });
    // The caller's own per-IP budget, already spent — as it would be by the
    // time anybody actually meets this. Spent against the same contract the
    // page is about to talk to, through the entry point a browser uses.
    const headers = new Headers({ origin: contract.origin });
    for (let spent = 0; spent < EMAIL_CODE_REQUEST_BUDGET; spent += 1) {
      contract.handle("POST", "/email/code", { email: UNKNOWN_EMAIL }, headers);
    }
    mount(contract);

    await waitFor(() => expect(passkeyButton()).toBeEnabled());
    await userEvent.click(
      screen.getByRole("button", { name: /email me a sign-in code/i }),
    );
    await userEvent.type(
      await screen.findByLabelText(/email address/i),
      VALID_VERIFICATION_EMAIL,
    );
    await userEvent.click(screen.getByRole("button", { name: /^email me a code$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/too many/i);
    expect(alert).not.toHaveTextContent(/could not be reached/i);
    // And the reader is left where they can act on it, rather than pushed
    // forward into a step that waits for a code nobody sent.
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/six-digit code/i)).toBeNull();
  });
});

describe("the resend control", () => {
  it("is disabled for as long as the server said, and says how long that is", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }));

    await requestCodeFor(VALID_VERIFICATION_EMAIL);

    expect(resendButton()).toBeDisabled();
    // A disabled control that does not say why, or for how long, reads as
    // broken rather than as busy.
    expect(resendButton()).toHaveTextContent(/60s/);
  });

  it("comes back once that cooldown has passed, and really does send again", async () => {
    /*
     * The cooldown is the server's number and not this page's, so the fixture
     * shortens it and the page is required to follow. That is the assertion
     * worth having: a client counting to sixty on its own would pass a test
     * that could only ever see sixty, and would be wrong the first time
     * somebody tuned the service.
     */
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    const contract = new AuthApiContract({ session: null, resendAfterSeconds: 1 });
    mount(contract);

    await requestCodeFor(VALID_VERIFICATION_EMAIL);
    expect(resendButton()).toBeDisabled();

    await waitFor(() => expect(resendButton()).toBeEnabled(), { timeout: 5000 });

    await userEvent.click(resendButton());

    await waitFor(() =>
      expect(
        contract.calls.filter((call) => call.path === "/email/code"),
      ).toHaveLength(2),
    );
    // And it says so. Nothing else on the screen changed, and focus did not
    // move, so without this the button would appear to have done nothing.
    expect(await screen.findByRole("status")).toHaveTextContent(
      /new code is on its way/i,
    );
  });
});

describe("finding the way back", () => {
  it("returns to the address step without spending another request", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    const contract = new AuthApiContract({ session: null });
    mount(contract);

    await requestCodeFor(VALID_VERIFICATION_EMAIL);
    await userEvent.click(
      screen.getByRole("button", { name: /use a different address/i }),
    );

    expect(await screen.findByLabelText(/email address/i)).toBeInTheDocument();
    expect(contract.calls.filter((call) => call.path === "/email/code")).toHaveLength(1);
  });

  it("returns to the passkey step from the code step", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }));

    await requestCodeFor(VALID_VERIFICATION_EMAIL);
    await userEvent.click(
      screen.getByRole("button", { name: /sign in with a passkey instead/i }),
    );

    await waitFor(() => expect(passkeyButton()).toBeInTheDocument());
    expect(screen.queryByLabelText(/six-digit code/i)).toBeNull();
  });

  it("returns to the passkey step from the address step", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null }));

    await waitFor(() => expect(passkeyButton()).toBeEnabled());
    await userEvent.click(
      screen.getByRole("button", { name: /email me a sign-in code/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /use a passkey instead/i }),
    );

    await waitFor(() => expect(passkeyButton()).toBeInTheDocument());
    expect(screen.queryByLabelText(/email address/i)).toBeNull();
  });

  it("keeps a mistyped address on the page instead of spending a request on it", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    const contract = new AuthApiContract({ session: null });
    mount(contract);

    await waitFor(() => expect(passkeyButton()).toBeEnabled());
    await userEvent.click(
      screen.getByRole("button", { name: /email me a sign-in code/i }),
    );
    await userEvent.type(
      await screen.findByLabelText(/email address/i),
      "not-an-address",
    );
    await userEvent.click(screen.getByRole("button", { name: /^email me a code$/i }));

    expect(
      await screen.findByText(/does not look like an email address/i),
    ).toBeInTheDocument();
    expect(contract.calls.some((call) => call.path === "/email/code")).toBe(false);
  });
});

describe("a second factor after an emailed code", () => {
  it("chains into the authenticator step and completes there", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    const contract = new AuthApiContract({ session: null, mfaRequired: true });
    mount(contract);

    await requestCodeFor(VALID_VERIFICATION_EMAIL);
    await userEvent.type(codeField(), VALID_EMAIL_CODE);
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    // The emailed code alone is not enough, and the page does not pretend it
    // was by navigating first.
    expect(
      await screen.findByRole("heading", { level: 1, name: /one more step/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(ACCOUNT_MARKER)).toBeNull();

    await userEvent.type(
      await screen.findByLabelText(/six-digit code/i),
      VALID_TOTP_CODE,
    );
    await userEvent.click(screen.getByRole("button", { name: /verify and sign in/i }));

    await waitFor(() =>
      expect(screen.getByText(ACCOUNT_MARKER)).toBeInTheDocument(),
    );
    // The second leg is the same endpoint the passkey path uses. One MFA step
    // reachable from both doors, rather than two that drift apart.
    expect(
      contract.calls.filter((call) => call.path === "/mfa/totp/verify"),
    ).toHaveLength(1);
  });

  it("starts over into the emailed-code path, not into the passkey path", async () => {
    // The old behaviour sent every "start over" back to the passkey step,
    // which is a dead end for exactly the readers who chose the other door
    // because they have no passkey to go back to.
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null, mfaRequired: true }));

    await requestCodeFor(VALID_VERIFICATION_EMAIL);
    await userEvent.type(codeField(), VALID_EMAIL_CODE);
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    await screen.findByRole("heading", { level: 1, name: /one more step/i });

    await userEvent.click(screen.getByRole("button", { name: /start over/i }));

    expect(
      await screen.findByRole("heading", { level: 1, name: /check your inbox/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /continue with a passkey/i }),
    ).toBeNull();
  });

  it("still starts over into the passkey path when that is where it began", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null, mfaRequired: true }));

    await userEvent.click(passkeyButton());
    await screen.findByRole("heading", { level: 1, name: /one more step/i });

    await userEvent.click(screen.getByRole("button", { name: /start over/i }));

    await waitFor(() => expect(passkeyButton()).toBeInTheDocument());
    expect(screen.queryByLabelText(/six-digit code/i)).toBeNull();
  });

  it("names the authenticator app rather than the passkey when a code is refused", async () => {
    // Reached from the emailed-code path, so "that passkey was not accepted"
    // would be describing a credential this reader has never used.
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: null, mfaRequired: true }));

    await requestCodeFor(VALID_VERIFICATION_EMAIL);
    await userEvent.type(codeField(), VALID_EMAIL_CODE);
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await userEvent.type(await screen.findByLabelText(/six-digit code/i), "000000");
    await userEvent.click(screen.getByRole("button", { name: /verify and sign in/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/not correct/i);
    expect(alert).not.toHaveTextContent(/passkey/i);
  });
});
