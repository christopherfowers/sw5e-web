/**
 * The session state machine — the piece that makes accounts possible on a
 * prerendered site with no runtime server.
 *
 * The first test is the most important one in this file. It asserts that the
 * very first render, the one the build machine performs and writes into a
 * static HTML file served to every visitor, knows nothing about anybody.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, contractFetch, CSRF_TOKEN, user } from "../../tests/auth-api-contract";
import { AuthProvider, useSession } from "./session";

function Probe() {
  const session = useSession();
  return (
    <div>
      <p data-testid="status">{session.status}</p>
      <p data-testid="role">{session.role}</p>
      <p data-testid="name">{session.user?.displayName ?? "—"}</p>
      <p data-testid="error">{session.error ?? "—"}</p>
      <button type="button" onClick={() => void session.signOut()}>
        Sign out
      </button>
      <button type="button" onClick={() => void session.refresh()}>
        Refresh
      </button>
    </div>
  );
}

function mount(contract: AuthApiContract) {
  vi.stubGlobal("fetch", contractFetch(contract));
  document.cookie = `sw5e_csrf=${CSRF_TOKEN}; path=/`;
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuthProvider", () => {
  it("renders as loading before any answer, whoever is signed in", () => {
    // Synchronous assertion, deliberately: this is the state the prerender
    // freezes into a file every visitor is served. If it could ever be
    // "authenticated" on a first render, one person's identity would be baked
    // into static HTML.
    const contract = new AuthApiContract({ session: user() });

    mount(contract);

    expect(screen.getByTestId("status")).toHaveTextContent("loading");
    expect(screen.getByTestId("name")).toHaveTextContent("—");
  });

  it("resolves to the signed-in account once the server answers", async () => {
    const contract = new AuthApiContract({
      session: user({ displayName: "Jen Ordo", roles: ["contributor"] }),
    });

    mount(contract);

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );
    expect(screen.getByTestId("name")).toHaveTextContent("Jen Ordo");
    expect(screen.getByTestId("role")).toHaveTextContent("contributor");
  });

  it("resolves to anonymous on a 401", async () => {
    mount(new AuthApiContract({ session: null }));

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("anonymous"),
    );
    expect(screen.getByTestId("role")).toHaveTextContent("community");
  });

  it("distinguishes an unreachable service from a signed-out reader", async () => {
    // If these collapsed into one state, a dropped connection would look
    // exactly like a sign-out and every guarded page would bounce the reader
    // to /sign-in mid-session.
    mount(new AuthApiContract({ session: user(), offline: true }));

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("unavailable"),
    );
    expect(screen.getByTestId("status")).not.toHaveTextContent("anonymous");
    expect(screen.getByTestId("error")).toHaveTextContent(/could not be reached/i);
  });

  it("asks the server exactly once per mount", async () => {
    const contract = new AuthApiContract({ session: user() });

    mount(contract);

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );
    expect(contract.calls.filter((call) => call.path === "/me")).toHaveLength(1);
  });

  it("re-reads the account when something asks it to", async () => {
    const contract = new AuthApiContract({ session: user({ displayName: "Before" }) });
    mount(contract);

    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Before"));

    contract.session = user({ displayName: "After" });
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("After"));
  });

  it("calls the logout endpoint and drops the local session", async () => {
    const contract = new AuthApiContract({ session: user() });
    mount(contract);

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("anonymous"),
    );
    // Not merely a local state change: the cookie is the server's to clear.
    expect(
      contract.calls.some((call) => call.path === "/logout" && call.method === "POST"),
    ).toBe(true);
  });

  it("still signs the reader out locally when the logout request fails", async () => {
    const contract = new AuthApiContract({ session: user() });
    mount(contract);

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );

    contract.offline = true;
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    });

    // Showing someone as signed in after they asked to leave is the failure
    // that matters here; a stale cookie is caught by the next request.
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("anonymous"),
    );
  });
});
