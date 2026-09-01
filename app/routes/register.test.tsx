import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, contractFetch, user } from "../../tests/auth-api-contract";
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

/**
 * The bug this suite was written for.
 *
 * Registering on QA answered 202 and produced, verbatim:
 *
 *   Check your inbox — A verification link is on its way to
 *   chris.w.fowers@gmail.com. Open it to finish setting up your account.
 *
 * followed by an offer to check the spam folder. Nothing had been sent. The
 * relay had refused the message, the API knew, and `/health/ready` was
 * reporting `account-email: degraded` at that moment. The site told a reader to
 * wait for something it already knew would never arrive.
 *
 * The 202 cannot change — it is identical for a registered address and an
 * unknown one, and that is what stops this endpoint being used to discover who
 * has an account here. So what changes is the sentence, on the strength of one
 * global fact the service publishes separately.
 *
 * Both halves are asserted. A healthy relay must leave every word alone, or the
 * fix is a regression dressed as a fix; a refusing one must stop the promise,
 * or the fix does nothing.
 */
describe("when mail is not getting out", () => {
  it("leaves every word alone while the relay is healthy", async () => {
    const contract = new AuthApiContract({
      session: null,
      accountEmailDelivering: true,
    });
    mount(contract);

    await fillIn("reader@example.com", "Jen Ordo");
    await submit();

    expect(
      await screen.findByRole("heading", { level: 1, name: /check your inbox/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /a verification link is on its way to reader@example\.com/i,
    );
    expect(screen.getByText(/check the spam folder/i)).toBeInTheDocument();
  });

  it("stops saying a link is on its way when the service reports an outage", async () => {
    const contract = new AuthApiContract({
      session: null,
      accountEmailDelivering: false,
    });
    mount(contract);

    await fillIn("reader@example.com", "Jen Ordo");
    await submit();

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /email is not being delivered right now/i,
      }),
    ).toBeInTheDocument();

    // The exact claim that was false. Asserted as an absence from the whole
    // panel rather than from one element, because the sentence moving is not
    // the same as the sentence going.
    expect(screen.queryByText(/on its way/i)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      /no verification link was sent/i,
    );
  });

  /**
   * The other half of the original harm, and the more insulting one: a reader
   * told to go and search a folder for a message that was never handed to a
   * relay spends their time proving nothing, and concludes the fault is theirs.
   *
   * The folder is still named, and deliberately — going to look is the first
   * instinct, so the sentence that heads it off has to be the one that mentions
   * it. What must not survive is the *instruction*, which the healthy panel
   * still gives and this one must not.
   */
  it("does not send anyone to their spam folder for a message that was never sent", async () => {
    mount(new AuthApiContract({ session: null, accountEmailDelivering: false }));

    await fillIn("reader@example.com", "Jen Ordo");
    await submit();

    await screen.findByRole("heading", { level: 1, name: /not being delivered/i });

    expect(screen.queryByText(/check the spam folder/i)).toBeNull();
    expect(screen.getByText(/spam folder will not help/i)).toBeInTheDocument();
  });

  /**
   * Whose fault it is, said out loud.
   *
   * A reader can do nothing about a relay, so the only useful thing to give
   * them is an accurate account of what happened: it is the site, it is
   * everyone, and it is not the address they typed. Without this the honest
   * panel is merely a blank refusal, which people read as rejection.
   */
  it("says plainly that this is the site's problem and not the reader's", async () => {
    mount(new AuthApiContract({ session: null, accountEmailDelivering: false }));

    await fillIn("reader@example.com", "Jen Ordo");
    await submit();

    const banner = await screen.findByRole("status");

    expect(banner).toHaveTextContent(/for\s+everyone/i);
    expect(banner).toHaveTextContent(/not a problem with your address/i);
  });

  /**
   * The security property, at the level a reader meets it.
   *
   * The panel is drawn from a global fact, so it must not contain the address
   * that was typed — not in the heading, not in the banner, not in the note. A
   * panel that said "we could not send to reader@example.com" would be a
   * different answer for a registered address than for an unknown one the
   * moment anything downstream varied, and it is the shape of sentence that
   * invites exactly that change.
   */
  it("names no address, because the fact it is drawn from has none", async () => {
    mount(new AuthApiContract({ session: null, accountEmailDelivering: false }));

    await fillIn("reader@example.com", "Jen Ordo");
    await submit();

    await screen.findByRole("heading", { level: 1, name: /not being delivered/i });

    expect(document.body.textContent).not.toContain("reader@example.com");
  });

  /**
   * The 202 is unchanged and so is the request. A client that had started
   * asking a different question — or asking about the address — would show up
   * here as a changed body or an extra parameter.
   */
  it("registers exactly as before and asks the delivery question without an address", async () => {
    const contract = new AuthApiContract({
      session: null,
      accountEmailDelivering: false,
    });
    mount(contract);

    await fillIn("reader@example.com", "Jen Ordo");
    await submit();

    await screen.findByRole("heading", { level: 1, name: /not being delivered/i });

    const registration = contract.calls.find((entry) => entry.path === "/register");
    expect(registration?.body).toEqual({
      email: "reader@example.com",
      displayName: "Jen Ordo",
    });

    const delivery = contract.calls.find((entry) => entry.path === "/site/environment");
    expect(delivery).toBeDefined();
    expect(delivery?.method).toBe("GET");
    expect(delivery?.body).toBeUndefined();
  });

  /**
   * Degrade to what it did before.
   *
   * `offline: true` on the contract makes every account call fail, but the
   * delivery read is answered normally, so this is not that case. This one is
   * the delivery read itself failing while registration succeeds — a proxy that
   * has not been given the site route, an API a release behind, a request that
   * timed out. The reader must see exactly the panel they saw before any of
   * this was written, because nobody has reported an outage.
   */
  it("says what it always said when the delivery state cannot be read", async () => {
    const contract = new AuthApiContract({ session: null });
    const fetchWithNoSiteRoute = contractFetch(contract);

    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("/api/site/")) return Promise.reject(new TypeError("Failed to fetch"));
      return fetchWithNoSiteRoute(input, init);
    });

    renderWithSession(
      [
        { path: "/register", Component: Register },
        { path: "/account", Component: marker("account page") },
      ],
      ["/register"],
    );

    await fillIn("reader@example.com", "Jen Ordo");
    await submit();

    expect(
      await screen.findByRole("heading", { level: 1, name: /check your inbox/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/on its way/i);
  });
});
