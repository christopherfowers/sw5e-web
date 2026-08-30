/**
 * Enrolling an authenticator app.
 *
 * The tests that matter most here are about what is *not* only a QR code. A
 * picture of a shared key is useless to a screen reader, and useless to anyone
 * whose authenticator app is on the same device as the browser — which is most
 * people, most of the time.
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthApiContract,
  TOTP_SHARED_KEY,
  user,
  VALID_TOTP_CODE,
} from "../../tests/auth-api-contract";
import { renderWithSession, serveApiContract } from "../../tests/harness";
import Account from "./account";
import AccountSecurity from "./account-security";

function mount(contract: AuthApiContract) {
  serveApiContract(contract);
  return renderWithSession(
    [
      {
        path: "/account",
        Component: Account,
        children: [{ path: "security", Component: AccountSecurity }],
      },
      { path: "/sign-in", Component: () => <p>sign-in</p> },
    ],
    ["/account/security"],
  );
}

function startEnrolment() {
  return userEvent.click(
    screen.getByRole("button", { name: /set up an authenticator app/i }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("before enrolment", () => {
  it("offers to set two-factor authentication up", async () => {
    mount(new AuthApiContract({ session: user({ twoFactorEnabled: false }) }));

    expect(
      await screen.findByRole("button", { name: /set up an authenticator app/i }),
    ).toBeInTheDocument();
  });

  it("says so when it is already on, and does not offer to set it up again", async () => {
    mount(new AuthApiContract({ session: user({ twoFactorEnabled: true }) }));

    expect(
      await screen.findByText(/an authenticator app is protecting this account/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /set up an authenticator app/i }),
    ).toBeNull();
  });
});

describe("enrolment", () => {
  it("shows the shared key as readable text, not only as a QR code", async () => {
    // The accessibility requirement this feature most often fails: a QR code
    // cannot be read aloud, focused, or scanned by the phone it is displayed
    // on.
    mount(new AuthApiContract({ session: user() }));

    await screen.findByRole("button", { name: /set up an authenticator app/i });
    await startEnrolment();

    const sharedKey = await screen.findByText(/JBSW Y3DP EHPK 3PXP/);
    expect(sharedKey).toBeInTheDocument();
    // Grouped for transcription, but still the same shared key the server sent.
    expect(sharedKey.textContent?.replace(/\s/g, "")).toBe(TOTP_SHARED_KEY);
  });

  it("draws the QR code from the authenticator URI without leaving this origin", async () => {
    mount(new AuthApiContract({ session: user() }));

    await screen.findByRole("button", { name: /set up an authenticator app/i });
    await startEnrolment();

    await screen.findByText(/JBSW Y3DP EHPK 3PXP/);
    const svg = document.querySelector("svg.qr-code");
    expect(svg, "the code must be drawn inline, never fetched from a QR service").not.toBeNull();
    // A meaningful amount of code, rather than an empty grid.
    expect(svg?.querySelector("path")?.getAttribute("d")?.length ?? 0).toBeGreaterThan(500);
    // Hidden from assistive technology: the accessible path is the text above.
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector('img[src*="http"]')).toBeNull();
  });

  it("turns two-factor on and shows recovery codes once a valid code is given", async () => {
    const contract = new AuthApiContract({ session: user() });
    mount(contract);

    await screen.findByRole("button", { name: /set up an authenticator app/i });
    await startEnrolment();
    await userEvent.type(await screen.findByLabelText(/six-digit code/i), VALID_TOTP_CODE);
    await userEvent.click(
      screen.getByRole("button", { name: /turn on two-factor authentication/i }),
    );

    expect(
      await screen.findByRole("heading", { name: /two-factor authentication is on/i }),
    ).toBeInTheDocument();
    // Enrolling without a way back in is how people lose accounts. The API
    // returns these exactly once, from this endpoint and no other, so a screen
    // that dropped them would be losing the only copy that will ever exist.
    expect(screen.getByText("AAAA-1111")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").filter((item) =>
      /^[A-Z]{4}-\d{4}$/.test(item.textContent ?? ""),
    )).toHaveLength(10);
    expect(contract.session?.twoFactorEnabled).toBe(true);
  });

  it("rejects a wrong code and keeps the reader on the step", async () => {
    const contract = new AuthApiContract({ session: user() });
    mount(contract);

    await screen.findByRole("button", { name: /set up an authenticator app/i });
    await startEnrolment();
    await userEvent.type(await screen.findByLabelText(/six-digit code/i), "000000");
    await userEvent.click(
      screen.getByRole("button", { name: /turn on two-factor authentication/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/not correct/i);
    expect(screen.queryByText("AAAA-1111")).toBeNull();
    expect(contract.session?.twoFactorEnabled).toBe(false);
    expect(screen.getByLabelText(/six-digit code/i)).toBeInTheDocument();
  });

  it("does not call the server with a code of the wrong length", async () => {
    const contract = new AuthApiContract({ session: user() });
    mount(contract);

    await screen.findByRole("button", { name: /set up an authenticator app/i });
    await startEnrolment();
    await userEvent.type(await screen.findByLabelText(/six-digit code/i), "12");
    await userEvent.click(
      screen.getByRole("button", { name: /turn on two-factor authentication/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/six-digit code/i);
    expect(contract.calls.some((call) => call.path === "/mfa/totp/verify")).toBe(false);
  });

  it("can be abandoned, leaving the account as it was", async () => {
    const contract = new AuthApiContract({ session: user() });
    mount(contract);

    await screen.findByRole("button", { name: /set up an authenticator app/i });
    await startEnrolment();
    await screen.findByLabelText(/six-digit code/i);
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(
      await screen.findByRole("button", { name: /set up an authenticator app/i }),
    ).toBeInTheDocument();
    expect(contract.session?.twoFactorEnabled).toBe(false);
  });

  it("moves focus to the new step so a screen reader follows the change", async () => {
    mount(new AuthApiContract({ session: user() }));

    await screen.findByRole("button", { name: /set up an authenticator app/i });
    await startEnrolment();

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /set up your authenticator app/i }),
      ).toHaveFocus(),
    );
  });

  it("reports a failure to start rather than showing an empty panel", async () => {
    const contract = new AuthApiContract({ session: user() });
    mount(contract);

    await screen.findByRole("button", { name: /set up an authenticator app/i });
    contract.offline = true;
    await startEnrolment();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be started/i,
    );
    expect(screen.queryByLabelText(/six-digit code/i)).toBeNull();
  });
});
