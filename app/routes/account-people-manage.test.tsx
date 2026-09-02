/**
 * Managing one account, on the page that now does it.
 *
 * These assertions moved here with the code they cover. What changed on the way
 * is the address they start from — `/account/people/manage?user=…` rather than a
 * panel opened underneath the directory — and what they can therefore check:
 * that the page says whose account this is before it offers to delete it, and
 * that finishing with it puts the reader back on the list rather than nowhere.
 *
 * The assertions that matter, and what would break each of them:
 *
 *   a community account cannot reach it       the page trusting the directory
 *                                             above it to have guarded the
 *                                             route, which one re-parenting
 *                                             would undo
 *   the page names the account it is          the reader arriving from a list
 *   about to act on                           of twenty rows with no way to
 *                                             tell which of them they opened
 *   a suspension is described honestly        copy that promises something the
 *                                             service does not do
 *   the last administrator cannot act on      the self-guards being dropped,
 *   themselves                                leaving buttons that only 400
 *   deleting returns to the directory         a reader left on the page of an
 *                                             account that no longer exists
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
import { removeWebAuthn } from "../../tests/webauthn-stub";
import Account from "./account";
import AccountPeople from "./account-people";
import AccountPeopleManage from "./account-people-manage";

const ADMINISTRATOR = user({ roles: ["Community", "Administrator"] });

/** Shaped like `app/routes.ts`: the management page is a child of the list. */
function routes() {
  return [
    {
      path: "/account",
      Component: Account,
      children: [
        {
          path: "people",
          Component: AccountPeople,
          children: [{ path: "manage", Component: AccountPeopleManage }],
        },
      ],
    },
    { path: "/sign-in", Component: () => <p>sign-in page</p> },
    { path: "/", Component: () => <p>home</p> },
  ];
}

function mount(admin: AdminApiStub, session = ADMINISTRATOR, userId = "u") {
  const auth = new AuthApiContract({ session });
  vi.stubGlobal("fetch", serveAdministration(auth, admin));
  return {
    admin,
    ...renderWithSession(routes(), [`/account/people/manage?user=${userId}`]),
  };
}

/** One account, managed, with the page settled. */
async function open(admin: AdminApiStub, session = ADMINISTRATOR, userId = "u") {
  const mounted = mount(admin, session, userId);
  await screen.findByRole("heading", { name: /^delete$/i });
  return mounted;
}

afterEach(() => {
  vi.unstubAllGlobals();
  removeWebAuthn();
});

/* ------------------------------------------------------------- who may look */

describe("who may manage an account", () => {
  it("refuses a community account, and shows nobody's address", async () => {
    // The page guards itself rather than inheriting the directory's guard. That
    // is redundant while it is a child route and is the point: a module whose
    // protection is a fact about where it sits in a tree is one edit to
    // `app/routes.ts` away from having none, and this one draws somebody else's
    // email address.
    const admin = new AdminApiStub({
      users: [adminUser({ id: "u", email: "zeb@example.test" })],
    });

    mount(admin, user({ roles: ["Community"] }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /this area is for administrator accounts/i,
      ),
    );

    expect(admin.calls).toHaveLength(0);
    expect(document.body.textContent).not.toContain("zeb@example.test");
  });

  it("refuses a contributor", async () => {
    const admin = new AdminApiStub({
      users: [adminUser({ id: "u", email: "zeb@example.test" })],
    });

    mount(admin, user({ roles: ["Community", "Contributor"] }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /this area is for administrator accounts/i,
      ),
    );

    expect(admin.calls).toHaveLength(0);
  });
});

/* ----------------------------------------------------------- who this is about */

describe("who is being managed", () => {
  it("names them, at the top, before anything that acts on them", async () => {
    // The whole reason this stopped being a panel. An administrator who pressed
    // Manage on the eleventh row and could not tell which account they had
    // opened was the complaint; a heading carrying the account's own name is
    // the answer, and it has to be the account's rather than the reader's.
    const admin = new AdminApiStub({
      users: [
        adminUser({
          id: "u",
          displayName: "Zeb Orrelios",
          email: "zeb@example.test",
          roles: ["Community", "Contributor"],
          emailConfirmed: false,
          createdAt: "2026-08-01T09:00:00.000Z",
        }),
      ],
    });

    await open(admin);

    const heading = screen.getByRole("heading", { name: "Zeb Orrelios" });
    expect(heading).toBeInTheDocument();

    const page = heading.closest("section");
    expect(page).not.toBeNull();

    // The address, the roles they hold and where they currently stand — the
    // four things an administrator needs before deciding anything, on the same
    // screen as the controls that decide it.
    expect(within(page!).getByText("zeb@example.test")).toBeInTheDocument();
    // The badge, not the checkbox in the role editor further down — the point
    // is that the standing is legible before the reader reaches a control.
    expect(
      within(page!).getByText("Contributor", { selector: "[data-role]" }),
    ).toBeInTheDocument();
    expect(within(page!).getByText(/address never verified/i)).toBeInTheDocument();
    expect(within(page!).getByText(/joined/i)).toBeInTheDocument();
  });

  it("renders a display name as text and never as markup", async () => {
    // Chosen by its owner, and drawn as the page's heading. Of everything on
    // this page it is the value most obviously under a stranger's control.
    const hostile = '<img src=x onerror="alert(1)">';

    const admin = new AdminApiStub({
      users: [adminUser({ id: "u", displayName: hostile, email: "zeb@example.test" })],
    });

    await open(admin);

    expect(screen.getByRole("heading", { name: hostile })).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("offers the way back to the directory before anything else", async () => {
    const admin = new AdminApiStub({
      users: [adminUser({ id: "u", email: "zeb@example.test" })],
    });

    await open(admin);

    // Bare. The directory is still mounted behind this page and is holding the
    // administrator's search; a query string here would be either redundant or
    // — if it carried the term — the one thing that may not reach a URL.
    expect(screen.getByRole("link", { name: /back to the directory/i })).toHaveAttribute(
      "href",
      "/account/people",
    );
  });

  it("says what is missing when the address names no account", async () => {
    const admin = new AdminApiStub({ users: [adminUser({ id: "u" })] });
    const auth = new AuthApiContract({ session: ADMINISTRATOR });
    vi.stubGlobal("fetch", serveAdministration(auth, admin));
    renderWithSession(routes(), ["/account/people/manage"]);

    expect(
      await screen.findByText(/this address needs to name an account/i),
    ).toBeInTheDocument();

    // And nothing was fetched on the strength of a missing identifier.
    expect(admin.lastCall("GET", "/api/auth/admin/users/u")).toBeUndefined();
  });

  it("reports an account that is not there, and still offers the way out", async () => {
    const admin = new AdminApiStub({ users: [] });

    mount(admin, ADMINISTRATOR, "gone");

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent(/no account with that identifier exists/i);
    expect(
      screen.getByRole("link", { name: /back to the directory/i }),
    ).toBeInTheDocument();
  });
});

/* --------------------------------------------------------------- suspending */

describe("suspending an account", () => {
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

  it("takes two deliberate presses, and lands back on the directory", async () => {
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

    // And the reader is not left sitting on the page of an account that no
    // longer exists, watching its next fetch answer 404.
    expect(
      await screen.findByRole("searchbox", { name: /search by address or name/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^people$/i })).toBeInTheDocument();
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

    await open(admin, ADMINISTRATOR, ADMINISTRATOR.id);

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

    await open(admin, ADMINISTRATOR, "someone-else");

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

    mount(admin);

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

    mount(admin);

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

    mount(admin);

    const history = await screen.findByRole("region", {
      name: /administrative history/i,
    });

    // `findBy`, not `getBy`. The section itself is in the markup from the first
    // render — it draws its own heading and a pending state — so waiting for
    // the region only waits for the page, and the entries arrive a round trip
    // later. A `getBy` here passes on a fast machine and fails on a slow one.
    expect(await within(history).findByText(/roles changed/i)).toBeInTheDocument();
    expect(within(history).getByText(/Jen Ordo/)).toBeInTheDocument();

    // Filtered by the server, on the identifier of the account being looked at.
    const call = admin.lastCall("GET", "/api/auth/admin/audit");
    expect(new URLSearchParams(call?.path.split("?")[1]).get("subjectId")).toBe("u");
  });
});
