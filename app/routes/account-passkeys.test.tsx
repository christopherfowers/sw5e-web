/**
 * Credential management.
 *
 * The assertions deliberately go past what is on screen and into what reached
 * the API. A page that removes a row from a list without ever calling the
 * endpoint looks identical to one that works, right up until the reader
 * reloads and finds the passkey they revoked still there.
 */

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, passkey, user } from "../../tests/auth-api-contract";
import { renderWithSession, serveApiContract } from "../../tests/harness";
import { installAuthenticator, removeWebAuthn } from "../../tests/webauthn-stub";
import Account from "./account";
import AccountPasskeys from "./account-passkeys";

let restore: (() => void) | null = null;

function mount(contract: AuthApiContract) {
  serveApiContract(contract);
  return renderWithSession(
    [
      {
        path: "/account",
        Component: Account,
        children: [{ path: "passkeys", Component: AccountPasskeys }],
      },
      { path: "/sign-in", Component: () => <p>sign-in</p> },
    ],
    ["/account/passkeys"],
  );
}

afterEach(() => {
  restore?.();
  restore = null;
  vi.unstubAllGlobals();
});

describe("the list", () => {
  it("names each credential and when it was last used", async () => {
    mount(
      new AuthApiContract({
        session: user({
          passkeys: [
            passkey({ id: "a", label: "Work laptop" }),
            passkey({ id: "b", label: "iPhone", lastUsedAt: null }),
          ],
        }),
      }),
    );

    expect(await screen.findByText("Work laptop")).toBeInTheDocument();
    const iphone = screen.getByText("iPhone").closest("li");
    expect(within(iphone as HTMLElement).getByText(/never used/i)).toBeInTheDocument();
  });

  it("says so plainly when there are none, rather than showing an empty box", async () => {
    mount(new AuthApiContract({ session: user({ passkeys: [] }) }));

    expect(await screen.findByText(/no passkeys yet/i)).toBeInTheDocument();
  });
});

describe("adding a passkey", () => {
  it("runs the ceremony and shows the new credential", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    const contract = new AuthApiContract({ session: user({ passkeys: [] }) });
    mount(contract);

    await screen.findByText(/no passkeys yet/i);
    await userEvent.type(await screen.findByLabelText(/name this passkey/i), "Work laptop");
    await userEvent.click(screen.getByRole("button", { name: /add a passkey/i }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/can now sign you in/i),
    );
    expect(authenticator.create).toHaveBeenCalledTimes(1);
    // The label the reader typed has to reach the server, not just the screen.
    const complete = contract.calls.find(
      (call) => call.path === "/passkey/register/complete",
    );
    expect((complete?.body as { label?: string })?.label).toBe("Work laptop");
    expect(contract.session?.passkeys.map((entry) => entry.label)).toContain(
      "Work laptop",
    );
  });

  it("passes the account's existing credentials so the device can spot a duplicate", async () => {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: user({ passkeys: [passkey({ id: "a" })] }) }));

    await screen.findByText("Work laptop");
    await userEvent.click(screen.getByRole("button", { name: /add a passkey/i }));

    await waitFor(() => expect(authenticator.create).toHaveBeenCalled());
    const options = authenticator.create.mock.calls[0]?.[0] as CredentialCreationOptions;
    const publicKey = options.publicKey as PublicKeyCredentialCreationOptions;
    expect(publicKey.excludeCredentials).toHaveLength(1);
  });

  it("explains an InvalidStateError as an existing passkey, not as a failure", async () => {
    const authenticator = installAuthenticator({
      failWith: new DOMException("", "InvalidStateError"),
    });
    restore = authenticator.uninstall;
    mount(new AuthApiContract({ session: user() }));

    await screen.findByText("Work laptop");
    await userEvent.click(screen.getByRole("button", { name: /add a passkey/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/already has a passkey/i);
    expect(alert).toHaveTextContent(/nothing to do/i);
  });

  it("surfaces a dismissed prompt rather than silently doing nothing", async () => {
    const authenticator = installAuthenticator({
      failWith: new DOMException("", "NotAllowedError"),
    });
    restore = authenticator.uninstall;
    const contract = new AuthApiContract({ session: user({ passkeys: [] }) });
    mount(contract);

    await screen.findByText(/no passkeys yet/i);
    await userEvent.click(screen.getByRole("button", { name: /add a passkey/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /passkey setup was not completed/i,
    );
    expect(
      contract.calls.some((call) => call.path === "/passkey/register/complete"),
      "a ceremony that never produced a credential must not be reported as complete",
    ).toBe(false);
  });

  it("disables the control and says why when the browser has no WebAuthn", async () => {
    restore = removeWebAuthn();
    mount(new AuthApiContract({ session: user() }));

    await waitFor(() =>
      expect(
        screen.getByText(/this browser cannot create passkeys/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /add a passkey/i })).toBeDisabled();
  });
});

describe("removing a passkey", () => {
  /**
   * Removal has nothing to do with the WebAuthn API, but the page probes it on
   * mount and warns when it is missing. Installing a working authenticator
   * keeps that warning out of the way, so an assertion on `role="alert"` here
   * is unambiguously about the removal.
   */
  function mountWithAuthenticator(contract: AuthApiContract) {
    const authenticator = installAuthenticator();
    restore = authenticator.uninstall;
    return mount(contract);
  }

  it("asks before doing it", async () => {
    const contract = new AuthApiContract({ session: user() });
    mountWithAuthenticator(contract);

    await screen.findByText("Work laptop");
    await userEvent.click(screen.getByRole("button", { name: /remove the passkey/i }));

    expect(screen.getByRole("button", { name: /yes, remove it/i })).toBeInTheDocument();
    expect(
      contract.calls.some((call) => call.method === "DELETE"),
      "nothing may be revoked before the reader confirms",
    ).toBe(false);
  });

  it("revokes the credential on the server, not just in the list", async () => {
    const contract = new AuthApiContract({
      session: user({ passkeys: [passkey({ id: "a", label: "Work laptop" }), passkey({ id: "b", label: "iPhone" })] }),
    });
    mountWithAuthenticator(contract);

    await screen.findByText("iPhone");
    await userEvent.click(
      screen.getByRole("button", { name: /remove the passkey “iPhone”/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /yes, remove it/i }));

    await waitFor(() => expect(screen.queryByText("iPhone")).toBeNull());
    expect(
      contract.calls.some(
        (call) => call.method === "DELETE" && call.path === "/passkey/b",
      ),
    ).toBe(true);
    expect(contract.session?.passkeys.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("can be backed out of, leaving the credential alone", async () => {
    const contract = new AuthApiContract({ session: user() });
    mountWithAuthenticator(contract);

    await screen.findByText("Work laptop");
    await userEvent.click(screen.getByRole("button", { name: /remove the passkey/i }));
    await userEvent.click(screen.getByRole("button", { name: /keep it/i }));

    expect(screen.getByText("Work laptop")).toBeInTheDocument();
    expect(contract.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("warns before removing the last way in", async () => {
    mountWithAuthenticator(
      new AuthApiContract({ session: user({ passkeys: [passkey({ id: "a" })] }) }),
    );

    await screen.findByText("Work laptop");
    await userEvent.click(screen.getByRole("button", { name: /remove the passkey/i }));

    expect(screen.getByText(/this is your only passkey/i)).toBeInTheDocument();
  });

  it("reports a server refusal instead of pretending it worked", async () => {
    const contract = new AuthApiContract({ session: user() });
    mountWithAuthenticator(contract);

    await screen.findByText("Work laptop");
    await userEvent.click(screen.getByRole("button", { name: /remove the passkey/i }));

    contract.offline = true;
    await userEvent.click(screen.getByRole("button", { name: /yes, remove it/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be completed/i);
    expect(screen.getByText("Work laptop")).toBeInTheDocument();
  });
});
