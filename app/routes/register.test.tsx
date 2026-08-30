import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, user } from "../../tests/auth-api-contract";
import { marker, renderWithSession, serveApiContract } from "../../tests/harness";
import Register from "./register";

function mount(contract: AuthApiContract) {
  serveApiContract(contract);
  return renderWithSession(
    [
      { path: "/register", Component: Register },
      { path: "/account", Component: marker("account page") },
    ],
    ["/register"],
  );
}

async function fillIn(email: string, displayName: string) {
  if (email) await userEvent.type(screen.getByLabelText(/email address/i), email);
  if (displayName) {
    await userEvent.type(screen.getByLabelText(/display name/i), displayName);
  }
}

function submit() {
  return userEvent.click(
    screen.getByRole("button", { name: /send verification link/i }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validation", () => {
  it("refuses an address that is obviously not one, before spending a request", async () => {
    const contract = new AuthApiContract({ session: null });
    mount(contract);

    await fillIn("not-an-address", "Jen Ordo");
    await submit();

    expect(screen.getByText(/does not look like an email address/i)).toBeInTheDocument();
    expect(contract.calls.some((call) => call.path === "/register")).toBe(false);
  });

  it("requires a display name", async () => {
    const contract = new AuthApiContract({ session: null });
    mount(contract);

    await fillIn("reader@example.com", "");
    await submit();

    expect(screen.getByText(/enter the name you want to be known by/i)).toBeInTheDocument();
    expect(contract.calls.some((call) => call.path === "/register")).toBe(false);
  });

  it("ties each message to its own field for assistive technology", async () => {
    mount(new AuthApiContract({ session: null }));

    await fillIn("nope", "Jen Ordo");
    await submit();

    const field = screen.getByLabelText(/email address/i);
    expect(field).toHaveAttribute("aria-invalid", "true");
    // The message has to be reachable from the field, not merely near it.
    const described = field.getAttribute("aria-describedby") ?? "";
    expect(described).not.toBe("");
    const texts = described
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "");
    expect(texts.join(" ")).toMatch(/does not look like an email address/i);
  });
});

describe("submitting", () => {
  it("sends the trimmed details and confirms without claiming an account exists", async () => {
    const contract = new AuthApiContract({ session: null });
    mount(contract);

    await fillIn("  reader@example.com  ", "  Jen Ordo  ");
    await submit();

    expect(await screen.findByRole("status")).toHaveTextContent(
      /verification link is on its way/i,
    );
    const call = contract.calls.find((entry) => entry.path === "/register");
    expect(call?.body).toEqual({
      email: "reader@example.com",
      displayName: "Jen Ordo",
    });
  });

  it("moves focus to the confirmation, which replaced the form", async () => {
    mount(new AuthApiContract({ session: null }));

    await fillIn("reader@example.com", "Jen Ordo");
    await submit();

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /verification email sent/i }),
      ).toHaveFocus(),
    );
  });

  it("reports a rate limit as a rate limit rather than as a bad address", async () => {
    const contract = new AuthApiContract({ session: null });
    mount(contract);
    contract.offline = true;

    await fillIn("reader@example.com", "Jen Ordo");
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be sent/i);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("leaves the form intact after a failure so nothing has to be retyped", async () => {
    const contract = new AuthApiContract({ session: null });
    mount(contract);
    contract.offline = true;

    await fillIn("reader@example.com", "Jen Ordo");
    await submit();

    await screen.findByRole("alert");
    expect(screen.getByLabelText(/email address/i)).toHaveValue("reader@example.com");
    expect(screen.getByRole("button", { name: /send verification link/i })).toBeEnabled();
  });
});

describe("an already signed-in reader", () => {
  it("is told they have an account rather than shown the form again", async () => {
    mount(new AuthApiContract({ session: user({ displayName: "Jen Ordo" }) }));

    expect(await screen.findByText(/signed in as jen ordo/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/display name/i)).toBeNull();
  });
});
