/**
 * The account directory, and what it refuses.
 *
 * The assertions that matter, and what would break each of them:
 *
 *   a community account cannot see the        the guard on the page being
 *   directory                                 dropped, or being replaced by
 *                                             hiding the navigation link
 *   an administrator who signed in with a     the page reporting a plain 403
 *   code is told what to do about it          and telling somebody two clicks
 *                                             from the answer to give up
 *   nobody's address is in the markup         the page rendering the list
 *   before the server answers                 optimistically, or a loader
 *   a suspension is described honestly        copy that promises something the
 *                                             service does not do
 *   the last administrator cannot act on      the self-guards being dropped,
 *   themselves                                leaving buttons that only 400
 *
 * Everything here mounts the real `AuthProvider` against the contract fixture,
 * so the session resolves the way it does in a browser — through a genuine
 * `GET /api/auth/me` — and the administrative stub reads that same session to
 * decide what to refuse. A test cannot hand itself an administrator.
 */

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, user } from "../../tests/auth-api-contract";
import {
  AdminApiStub,
  adminAction,
  adminUser,
  serveAdministration,
} from "../../tests/admin-api-stub";
import { renderWithSession } from "../../tests/harness";
import Account from "./account";
import AccountPeople from "./account-people";

const ADMINISTRATOR = user({ roles: ["Community", "Administrator"] });

function routes() {
  return [
    {
      path: "/account",
      Component: Account,
      children: [{ path: "people", Component: AccountPeople }],
    },
    { path: "/sign-in", Component: () => <p>sign-in page</p> },
    { path: "/", Component: () => <p>home</p> },
  ];
}

function mount(
  admin: AdminApiStub,
  session = ADMINISTRATOR,
  at = "/account/people",
) {
  const auth = new AuthApiContract({ session });
  vi.stubGlobal("fetch", serveAdministration(auth, admin));
  return { admin, ...renderWithSession(routes(), [at]) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------- who may look */

describe("who may see the directory", () => {
  it("refuses a community account, and shows nobody's address", async () => {
    const admin = new AdminApiStub({
      users: [adminUser({ email: "zeb@example.test" })],
    });

    mount(admin, user({ roles: ["Community"] }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /this area is for administrator accounts/i,
      ),
    );

    // The refusal has to have prevented the request, not merely hidden its
    // result. A page that fetched the directory and then declined to draw it
    // would have put every address in this test's memory.
    expect(admin.calls).toHaveLength(0);
    expect(document.body.textContent).not.toContain("zeb@example.test");
  });

  it("refuses a contributor", async () => {
    const admin = new AdminApiStub({ users: [adminUser()] });

    mount(admin, user({ roles: ["Community", "Contributor"] }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /this area is for administrator accounts/i,
      ),
    );

    expect(admin.calls).toHaveLength(0);
  });

  it("tells an administrator who signed in with a code how to fix it", async () => {
    // The account holds the role. This is not "you may not" — it is "not from
    // this sign-in", and the two must not be worded alike: one is the end of
    // the conversation and the other is about a minute of work.
    const admin = new AdminApiStub({ users: [adminUser()] });

    mount(
      admin,
      user({
        roles: ["Community", "Administrator"],
        authenticationMethod: "email",
        strongAuthentication: false,
      }),
    );

    const banner = await screen.findByRole("alert");

    expect(banner).toHaveTextContent(/passkey or an authenticator app/i);
    expect(banner).not.toHaveTextContent(/does not have access/i);
    expect(admin.calls).toHaveLength(0);
  });

  it("shows the directory to an administrator who signed in with a passkey", async () => {
    // The control. Without it, a page that refused everybody would satisfy all
    // three refusals above.
    const admin = new AdminApiStub({
      users: [adminUser({ displayName: "Zeb Orrelios", email: "zeb@example.test" })],
    });

    mount(admin);

    expect(await screen.findByText("zeb@example.test")).toBeInTheDocument();
    expect(screen.getByText("Zeb Orrelios")).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------- searching */

describe("finding somebody", () => {
  it("sends the term to the server and shows what came back", async () => {
    const admin = new AdminApiStub({
      users: [
        adminUser({ id: "a", email: "zeb@example.test", displayName: "Zeb" }),
        adminUser({ id: "b", email: "hera@example.test", displayName: "Hera" }),
      ],
    });

    mount(admin);

    await screen.findByText("zeb@example.test");

    await userEvent.type(
      screen.getByRole("searchbox", { name: /search by address or name/i }),
      "hera",
    );
    await userEvent.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() =>
      expect(screen.queryByText("zeb@example.test")).not.toBeInTheDocument(),
    );

    expect(screen.getByText("hera@example.test")).toBeInTheDocument();

    // Filtered by the server rather than in the browser. A page that fetched
    // everything once and filtered locally would be a page that had already
    // downloaded the whole directory.
    const call = admin.lastCall("GET", "/api/auth/admin/users");
    expect(new URLSearchParams(call?.path.split("?")[1]).get("q")).toBe("hera");
  });

  it("keeps the search term out of the address bar", async () => {
    // An email address typed into a search box must not end up in browser
    // history, in a bookmark, or in whatever the reader pastes into a chat
    // window when asking a colleague to look.
    const admin = new AdminApiStub({ users: [adminUser({ email: "zeb@example.test" })] });

    mount(admin);

    await screen.findByText("zeb@example.test");

    await userEvent.type(
      screen.getByRole("searchbox", { name: /search by address or name/i }),
      "zeb@example.test",
    );
    await userEvent.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() =>
      expect(
        new URLSearchParams(admin.lastCall("GET", "/api/auth/admin/users")?.path.split("?")[1]).get(
          "q",
        ),
      ).toBe("zeb@example.test"),
    );

    expect(window.location.search).not.toContain("zeb");
  });
});

/* --------------------------------------------------------------- suspending */

describe("suspending an account", () => {
  async function open(admin: AdminApiStub) {
    mount(admin);
    await screen.findByText("zeb@example.test");
    await userEvent.click(screen.getByRole("button", { name: /manage/i }));
    return screen.findByRole("heading", { name: /suspension/i });
  }

  it("will not suspend without a reason", async () => {
    const admin = new AdminApiStub({
      users: [adminUser({ id: "u", email: "zeb@example.test" })],
    });

    await open(admin);

    // Disabled rather than refused after the fact. The service requires the
    // reason, and a button that exists only to produce a 400 is a button that
    // reads as broken.
    expect(
      screen.getByRole("button", { name: /suspend this account/i }),
    ).toBeDisabled();

    expect(admin.lastCall("PUT", "/api/auth/admin/users/u/suspension")).toBeUndefined();
  });

  it("suspends with a reason, and says what that actually does", async () => {
    const admin = new AdminApiStub({
      users: [adminUser({ id: "u", email: "zeb@example.test" })],
    });

    await open(admin);

    await userEvent.type(
      screen.getByRole("textbox", { name: /^why$/i }),
      "Scraping the powers index.",
    );
    await userEvent.click(screen.getByRole("button", { name: /suspend this account/i }));

    await waitFor(() =>
      expect(admin.users[0].suspension?.reason).toBe("Scraping the powers index."),
    );

    // The two facts an administrator has to know before pressing it, and which
    // they would otherwise have to learn from the API documentation.
    expect(
      await screen.findByText(/cannot use a session it already had/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/passkeys are untouched/i)).toBeInTheDocument();
  });

  it("renders a suspension reason as text and never as markup", async () => {
    // Written by an administrator, and rendered to other administrators. An
    // administrator's session is the most valuable one on the platform, so
    // "written by somebody trusted" is not the same as "safe to interpolate".
    const hostile = '<img src=x onerror="alert(1)">';

    const admin = new AdminApiStub({
      users: [
        adminUser({
          id: "u",
          email: "zeb@example.test",
          suspension: { at: "2026-09-01T00:00:00.000Z", reason: hostile, byUserId: "a" },
        }),
      ],
    });

    await open(admin);

    expect(await screen.findByText(hostile)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("offers to lift a suspension that is standing", async () => {
    const admin = new AdminApiStub({
      users: [
        adminUser({
          id: "u",
          email: "zeb@example.test",
          suspension: { at: "2026-09-01T00:00:00.000Z", reason: "Because", byUserId: "a" },
        }),
      ],
    });

    await open(admin);

    await userEvent.click(screen.getByRole("button", { name: /lift the suspension/i }));

    await waitFor(() => expect(admin.users[0].suspension).toBeNull());

    // And it did not send a reason, which the service refuses on this branch.
    expect(admin.lastCall("PUT", "/api/auth/admin/users/u/suspension")?.body).toEqual({
      suspended: false,
      reason: null,
    });
  });
});

/* ----------------------------------------------------------------- deleting */

describe("deleting an account", () => {
  async function open(admin: AdminApiStub) {
    mount(admin);
    await screen.findByText("zeb@example.test");
    await userEvent.click(screen.getByRole("button", { name: /manage/i }));
    return screen.findByRole("heading", { name: /^delete$/i });
  }

  it("says that the account's revisions and reports survive it", async () => {
    // The sentence that most changes what somebody expects. An administrator
    // who believed deletion erased authorship would be reaching for it to do
    // something it does not do.
    const admin = new AdminApiStub({
      users: [adminUser({ id: "u", email: "zeb@example.test" })],
    });

    await open(admin);

    expect(screen.getByText(/coming from a removed account/i)).toBeInTheDocument();
  });

  it("takes two deliberate presses", async () => {
    const admin = new AdminApiStub({
      users: [adminUser({ id: "u", email: "zeb@example.test" })],
    });

    await open(admin);

    await userEvent.click(screen.getByRole("button", { name: /^delete this account$/i }));

    // Nothing has happened yet.
    expect(admin.lastCall("DELETE", "/api/auth/admin/users/u")).toBeUndefined();

    await userEvent.click(
      screen.getByRole("button", { name: /yes, delete this account/i }),
    );

    await waitFor(() => expect(admin.users).toHaveLength(0));
  });

  it("refuses while the account owns unpublished drafts, before anything is pressed", async () => {
    const admin = new AdminApiStub({
      users: [adminUser({ id: "u", email: "zeb@example.test" })],
      outstandingDrafts: 2,
    });

    await open(admin);

    expect(screen.getByText(/2 drafts are outstanding/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^delete this account$/i }),
    ).toBeDisabled();

    expect(admin.lastCall("DELETE", "/api/auth/admin/users/u")).toBeUndefined();
  });
});

/* ------------------------------------------------------- the last administrator */

describe("an administrator acting on their own account", () => {
  it("cannot suspend, delete or demote themselves", async () => {
    // The companion to the rule the service enforces. With self-demotion,
    // self-suspension and self-deletion all closed, the number of
    // administrators cannot reach zero — and a page that offered the buttons
    // anyway would be a page whose three most alarming controls only ever
    // produce a 400.
    const admin = new AdminApiStub({
      users: [
        adminUser({
          id: ADMINISTRATOR.id,
          email: ADMINISTRATOR.email,
          displayName: ADMINISTRATOR.displayName,
          roles: ["Community", "Administrator"],
        }),
      ],
    });

    mount(admin, ADMINISTRATOR, `/account/people?user=${ADMINISTRATOR.id}`);

    await screen.findByRole("heading", { name: /^delete$/i });

    expect(screen.getByRole("button", { name: /save roles/i })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /suspend this account/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /^delete this account$/i }),
    ).toBeDisabled();

    expect(
      screen.getByText(/you cannot delete your own account/i),
    ).toBeInTheDocument();
  });

  it("can act on somebody else, which is what makes the refusal above mean something", async () => {
    const admin = new AdminApiStub({
      users: [adminUser({ id: "someone-else", email: "zeb@example.test" })],
    });

    mount(admin, ADMINISTRATOR, "/account/people?user=someone-else");

    await screen.findByRole("heading", { name: /^delete$/i });

    expect(screen.getByRole("button", { name: /save roles/i })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /^delete this account$/i }),
    ).toBeEnabled();
  });
});

/* ------------------------------------------------------------------- roles */

describe("changing roles", () => {
  it("sends the complete set rather than the one that changed", async () => {
    // The API is declarative: anything absent is revoked. A client that sent
    // only the box it just ticked would silently strip every other role.
    const admin = new AdminApiStub({
      users: [
        adminUser({
          id: "u",
          email: "zeb@example.test",
          roles: ["Community", "Contributor"],
        }),
      ],
    });

    mount(admin, ADMINISTRATOR, "/account/people?user=u");

    await screen.findByRole("heading", { name: /^roles$/i });

    await userEvent.click(screen.getByRole("checkbox", { name: /^Administrator/ }));
    await userEvent.click(screen.getByRole("button", { name: /save roles/i }));

    await waitFor(() =>
      expect(admin.lastCall("PUT", "/api/auth/admin/users/u/roles")?.body).toEqual({
        roles: ["Contributor", "Administrator"],
      }),
    );
  });

  it("says when a granted role cannot be used yet", async () => {
    const admin = new AdminApiStub({
      users: [
        adminUser({ id: "u", email: "zeb@example.test", secondFactorEnrolled: false }),
      ],
    });

    mount(admin, ADMINISTRATOR, "/account/people?user=u");

    await screen.findByRole("heading", { name: /^roles$/i });

    // Anchored: the Administrator checkbox's own label says "Everything a
    // contributor can do", so an unanchored match finds two.
    await userEvent.click(screen.getByRole("checkbox", { name: /^Contributor/ }));
    await userEvent.click(screen.getByRole("button", { name: /save roles/i }));

    // Reported rather than swallowed. An administrator who grants Contributor
    // and hears nothing has every reason to believe the person can now upload,
    // while the person meets a 403 and reads it as the grant having failed.
    expect(
      await screen.findByText(/cannot use an elevated role until it enrols one/i),
    ).toBeInTheDocument();
  });
});

/* --------------------------------------------------------------- the history */

describe("what has been done to an account", () => {
  it("is shown on the account, filtered to it", async () => {
    const admin = new AdminApiStub({
      users: [adminUser({ id: "u", email: "zeb@example.test" })],
      actions: [
        adminAction({ subjectUserId: "u", actorDisplayName: "Jen Ordo" }),
        adminAction({ id: "other", subjectUserId: "somebody-else" }),
      ],
    });

    mount(admin, ADMINISTRATOR, "/account/people?user=u");

    const history = await screen.findByRole("region", {
      name: /administrative history/i,
    });

    // `findBy`, not `getBy`. The section itself is in the markup from the first
    // render — it draws its own heading and a pending state — so waiting for
    // the region only waits for the panel, and the entries arrive a round trip
    // later. A `getBy` here passes on a fast machine and fails on a slow one.
    expect(await within(history).findByText(/roles changed/i)).toBeInTheDocument();
    expect(within(history).getByText(/Jen Ordo/)).toBeInTheDocument();

    // Filtered by the server, on the identifier of the account being looked at.
    const call = admin.lastCall("GET", "/api/auth/admin/audit");
    expect(new URLSearchParams(call?.path.split("?")[1]).get("subjectId")).toBe("u");
  });
});
