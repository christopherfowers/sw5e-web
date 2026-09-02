/**
 * The account directory: what it refuses, and where it sends you.
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
 *   Manage goes somewhere                     managing an account sliding back
 *                                             into a panel below the fold,
 *                                             which is what it used to be
 *   the search survives the trip into an      the two pages being made
 *   account and back                          siblings, so the directory
 *                                             unmounts and the term — which
 *                                             may not be stored anywhere — is
 *                                             gone
 *
 * What one account can be *done to* lives in `account-people-manage.test.tsx`,
 * beside the page that does it.
 *
 * Everything here mounts the real `AuthProvider` against the contract fixture,
 * so the session resolves the way it does in a browser — through a genuine
 * `GET /api/auth/me` — and the administrative stub reads that same session to
 * decide what to refuse. A test cannot hand itself an administrator.
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, user } from "../../tests/auth-api-contract";
import {
  AdminApiStub,
  adminUser,
  serveAdministration,
} from "../../tests/admin-api-stub";
import { renderWithSession } from "../../tests/harness";
import { installAuthenticator, removeWebAuthn } from "../../tests/webauthn-stub";
import routeConfig from "~/routes";
import Account from "./account";
import AccountPeople from "./account-people";
import AccountPeopleManage from "./account-people-manage";

const ADMINISTRATOR = user({ roles: ["Community", "Administrator"] });

/**
 * Where the router thinks it is.
 *
 * `createRoutesStub` drives a memory router, so `window.location` never moves
 * and an assertion against it passes whatever the page does — including the
 * thing it is checking for. Two of the assertions below are about an email
 * address never reaching a URL, which is the last claim in this file that may
 * be made vacuously, so the address bar under test is this one.
 */
function LocationProbe() {
  const location = useLocation();
  return (
    <p data-testid="address-bar">{`${location.pathname}${location.search}`}</p>
  );
}

function Shell() {
  return (
    <>
      <LocationProbe />
      <Outlet />
    </>
  );
}

/** What the router currently has in the address bar. */
function address(): string {
  return screen.getByTestId("address-bar").textContent ?? "";
}

/**
 * The route table, shaped like the real one in `app/routes.ts`.
 *
 * The nesting is not a filing convenience here either: it is what keeps the
 * directory mounted while one account is being managed, and therefore what
 * keeps the administrator's search alive. That the shipped configuration has
 * the same shape is asserted separately, at the bottom of this file, because
 * `createRoutesStub` cannot read it.
 */
function routes() {
  return [
    {
      path: "/",
      Component: Shell,
      children: [
        { index: true, Component: () => <p>home</p> },
        { path: "sign-in", Component: () => <p>sign-in page</p> },
        {
          path: "account",
          Component: Account,
          children: [
            {
              path: "people",
              Component: AccountPeople,
              children: [{ path: "manage", Component: AccountPeopleManage }],
            },
          ],
        },
      ],
    },
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

/** How many times the directory itself has been asked for. */
function directoryFetches(admin: AdminApiStub): number {
  return admin.calls.filter(
    (call) =>
      call.method === "GET" && call.path.split("?")[0] === "/api/auth/admin/users",
  ).length;
}

afterEach(() => {
  vi.unstubAllGlobals();
  removeWebAuthn();
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

  it("asks an administrator who signed in with a code to prove their passkey", async () => {
    // The account holds the role. This is not "you may not" — it is "not from
    // this sign-in", and the two must not be worded alike: one is the end of
    // the conversation and the other is one prompt away. The account has a
    // passkey, so what it meets is the prompt rather than a description of it.
    installAuthenticator();
    const admin = new AdminApiStub({ users: [adminUser()] });

    mount(
      admin,
      user({
        roles: ["Community", "Administrator"],
        authenticationMethod: "email",
        strongAuthentication: false,
      }),
    );

    await screen.findByRole("button", { name: /confirm with a passkey/i });

    expect(document.body).not.toHaveTextContent(/does not have access/i);

    // And the directory was never asked for. Drawing the prompt while still
    // fetching would put the names of every account on the platform one 403
    // away from a session that must not have them.
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

    expect(address()).not.toContain("zeb");
  });
});

/* --------------------------------------------------------- opening somebody */

describe("opening an account", () => {
  it("offers a link to that account's own page, named after the account", async () => {
    const admin = new AdminApiStub({
      users: [
        adminUser({ id: "u-1", displayName: "Zeb Orrelios", email: "zeb@example.test" }),
        adminUser({ id: "u-2", displayName: "Hera Syndulla", email: "hera@example.test" }),
      ],
    });

    mount(admin);

    await screen.findByText("zeb@example.test");

    // A link, so it behaves like one: it says where it goes, it opens in a tab
    // on a middle click, and it does not need JavaScript to have run to be
    // understood. The identifier is opaque; nothing else about the account is
    // in it.
    expect(screen.getByRole("link", { name: "Manage Zeb Orrelios" })).toHaveAttribute(
      "href",
      "/account/people/manage?user=u-1",
    );
    expect(screen.getByRole("link", { name: "Manage Hera Syndulla" })).toHaveAttribute(
      "href",
      "/account/people/manage?user=u-2",
    );

    // And there is no disclosure control left. Twenty rows each carrying a
    // button called "Manage" that expands something below the fold is what this
    // page stopped doing, and a regression to it would put one back.
    expect(screen.queryByRole("button", { name: /manage/i })).not.toBeInTheDocument();
  });

  it("replaces the directory rather than appending to it", async () => {
    // The complaint this work exists for: pressing Manage on a list long enough
    // to scroll left the reader looking at an unchanged list, because what they
    // asked for had been drawn underneath it. Arriving somewhere has to look
    // like arriving somewhere.
    const admin = new AdminApiStub({
      users: [adminUser({ id: "u", displayName: "Zeb Orrelios", email: "zeb@example.test" })],
    });

    mount(admin);

    await screen.findByText("zeb@example.test");
    await userEvent.click(screen.getByRole("link", { name: "Manage Zeb Orrelios" }));

    expect(
      await screen.findByRole("heading", { name: "Zeb Orrelios" }),
    ).toBeInTheDocument();

    // The list, its search box and its paging are gone rather than scrolled off.
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^people$/i })).not.toBeInTheDocument();
  });

  it("sends a link to the address an account used to open at on to the new page", async () => {
    // `/account/people?user=…` was a link administrators sent each other, and
    // some of those are in inboxes. It carries the same opaque identifier the
    // new address does, so it is honoured rather than dropped on the floor.
    const admin = new AdminApiStub({
      users: [adminUser({ id: "u", displayName: "Zeb Orrelios", email: "zeb@example.test" })],
    });

    mount(admin, ADMINISTRATOR, "/account/people?user=u");

    expect(
      await screen.findByRole("heading", { name: "Zeb Orrelios" }),
    ).toBeInTheDocument();
    expect(address()).toBe("/account/people/manage?user=u");
  });
});

/* ------------------------------------------------------------ and back again */

describe("coming back to the directory", () => {
  it("brings the administrator's search and filters back with them", async () => {
    // The annoyance this must not trade the old one for. A search here is an
    // email address, so it cannot be put in the URL, in `history.state` or in
    // storage to be recovered — the only thing that can carry it across the
    // trip is the directory staying mounted, which is why the two pages are
    // nested rather than siblings.
    const admin = new AdminApiStub({
      users: [
        adminUser({
          id: "u",
          displayName: "Hera Syndulla",
          email: "hera@example.test",
          roles: ["Community", "Contributor"],
        }),
      ],
    });

    mount(admin);

    await screen.findByText("hera@example.test");

    await userEvent.type(
      screen.getByRole("searchbox", { name: /search by address or name/i }),
      "hera",
    );
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /^role$/i }),
      "Contributor",
    );
    await userEvent.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() =>
      expect(
        new URLSearchParams(
          admin.lastCall("GET", "/api/auth/admin/users")?.path.split("?")[1],
        ).get("q"),
      ).toBe("hera"),
    );

    const before = directoryFetches(admin);

    await userEvent.click(screen.getByRole("link", { name: "Manage Hera Syndulla" }));
    await screen.findByRole("heading", { name: "Hera Syndulla" });

    await userEvent.click(screen.getByRole("link", { name: /back to the directory/i }));

    // The box still holds what they typed, and so does the filter beside it.
    expect(
      await screen.findByRole("searchbox", { name: /search by address or name/i }),
    ).toHaveValue("hera");
    expect(screen.getByRole("combobox", { name: /^role$/i })).toHaveValue("Contributor");

    // And the refetch on arrival asked the server the same question, so the row
    // they come back to reflects whatever they just did to it rather than the
    // whole directory unfiltered.
    await waitFor(() => expect(directoryFetches(admin)).toBeGreaterThan(before));

    const query = new URLSearchParams(
      admin.lastCall("GET", "/api/auth/admin/users")?.path.split("?")[1],
    );
    expect(query.get("q")).toBe("hera");
    expect(query.get("role")).toBe("Contributor");
  });

  it("still keeps the search term out of the address bar on the way there and back", async () => {
    const admin = new AdminApiStub({
      users: [
        adminUser({ id: "u", displayName: "Zeb Orrelios", email: "zeb@example.test" }),
      ],
    });

    mount(admin);

    await screen.findByText("zeb@example.test");

    await userEvent.type(
      screen.getByRole("searchbox", { name: /search by address or name/i }),
      "zeb@example.test",
    );
    await userEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await screen.findByText(/matching that search/i);

    await userEvent.click(screen.getByRole("link", { name: "Manage Zeb Orrelios" }));
    await screen.findByRole("heading", { name: "Zeb Orrelios" });

    // The one thing in the URL is the identifier. Moving the panel to its own
    // address must not have moved the address into one along with it.
    expect(address()).toBe("/account/people/manage?user=u");
    expect(address()).not.toContain("zeb");
  });
});

/* ---------------------------------------------------- and in the real config */

describe("the shipped route configuration", () => {
  /** The route that renders one module, wherever it sits in the tree. */
  function find(
    routes: readonly unknown[],
    file: string,
  ): { path?: string; children?: readonly unknown[] } | undefined {
    for (const entry of routes) {
      const route = entry as { file?: string; path?: string; children?: unknown[] };
      if (route.file === file) return route;
      const nested = route.children && find(route.children, file);
      if (nested) return nested;
    }
    return undefined;
  }

  it("nests the management page inside the directory", () => {
    // `createRoutesStub` above builds its own table, so nothing in this file
    // would notice the shipped one being flattened — and flattening it is the
    // one change that silently undoes the search-survives-the-trip behaviour
    // two tests up. React Router keeps a parent route's component mounted while
    // a child renders; it keeps nothing at all for a sibling.
    const directory = find(routeConfig, "routes/account-people.tsx");

    expect(directory).toBeDefined();
    expect(find(directory?.children ?? [], "routes/account-people-manage.tsx")).toEqual(
      expect.objectContaining({ path: "manage" }),
    );
  });
});
