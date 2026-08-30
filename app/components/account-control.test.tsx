/**
 * The header's account control.
 *
 * This component appears on every page of the site, including the ~130
 * prerendered content pages, so its loading state is the one piece of
 * authenticated UI that is written into static HTML and served to every
 * visitor. The first test is the one that keeps it honest.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, contractFetch, user } from "../../tests/auth-api-contract";
import { AuthProvider } from "~/auth/session";
import { AccountControl } from "./account-control";

function mount(contract: AuthApiContract) {
  vi.stubGlobal("fetch", contractFetch(contract));
  const Stub = createRoutesStub([{ path: "/", Component: AccountControl }]);
  return render(
    <AuthProvider>
      <Stub initialEntries={["/"]} />
    </AuthProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("before the session is known", () => {
  it("does not claim the reader is signed out", () => {
    // The flash-of-wrong-state bug this exists to prevent: showing "Sign in"
    // to a signed-in reader on every page load, for the length of one round
    // trip, because "not loaded yet" and "signed out" were the same value.
    mount(new AuthApiContract({ session: user() }));

    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
  });

  it("does not claim the reader is signed in either", () => {
    mount(new AuthApiContract({ session: user({ displayName: "Jen Ordo" }) }));

    expect(screen.queryByText("Jen Ordo")).toBeNull();
  });

  it("reserves the space so the header does not jump when the answer arrives", () => {
    const { container } = mount(new AuthApiContract({ session: user() }));

    const placeholder = container.querySelector(".account-chip");
    expect(placeholder).not.toBeNull();
    expect(placeholder).toHaveClass("is-pending");
    // Nothing to announce yet, so nothing is announced: "loading" read aloud
    // in the header of every page is noise.
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
  });
});

describe("once the session is known", () => {
  it("offers a way in to a signed-out reader", async () => {
    mount(new AuthApiContract({ session: null }));

    const link = await screen.findByRole("link", { name: /sign in/i });
    expect(link).toHaveAttribute("href", "/sign-in");
  });

  it("names the account and links to it for a signed-in reader", async () => {
    mount(new AuthApiContract({ session: user({ displayName: "Jen Ordo" }) }));

    const link = await screen.findByRole("link", { name: /jen ordo/i });
    expect(link).toHaveAttribute("href", "/account");
    expect(screen.queryByRole("link", { name: /^sign in$/i })).toBeNull();
  });
});

describe("when the account service is unreachable", () => {
  it("keeps the way in rather than removing the control", async () => {
    // A reader who wants to sign in should reach a page that explains the
    // outage, not find that the control has silently vanished.
    mount(new AuthApiContract({ session: user(), offline: true }));

    await waitFor(() =>
      expect(screen.getByRole("link", { name: /sign in/i })).toBeInTheDocument(),
    );
  });
});
