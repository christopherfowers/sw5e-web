/**
 * The bell in the site header.
 *
 * The first test is the one that matters most, for the same reason it is in
 * `account-control.test.tsx`: this component is written into ~130 prerendered
 * files that nginx serves to everybody, and those files are frozen in the
 * signed-out state. A bell that drew anything there would appear for anonymous
 * readers and then change its mind.
 *
 * After that, the behaviours worth holding: the count is announced rather than
 * left as a bare number, and clearing moves the count before the request
 * finishes, because a button whose whole purpose is to empty the badge reads
 * as broken if the badge waits for a round trip.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, contractFetch, user } from "../../tests/auth-api-contract";
import { AuthProvider } from "~/auth/session";

import { NotificationBell } from "./bell";

interface Inbox {
  unread: number;
  items?: unknown[];
}

const marked: string[] = [];

/**
 * The auth contract, plus the notification routes it does not know about.
 *
 * Composed rather than added to the shared contract: that fixture describes
 * the account API and is asserted against by a dozen other files, and widening
 * it for one feature's convenience makes it a worse description of the thing
 * it exists to describe.
 */
function fetchWith(contract: AuthApiContract, inbox: Inbox): typeof fetch {
  const auth = contractFetch(contract);

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.startsWith("/api/notifications/count")) {
      return new Response(JSON.stringify({ unread: inbox.unread }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.startsWith("/api/notifications/read-all")) {
      marked.push("all");
      return new Response(JSON.stringify({ marked: inbox.unread }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.startsWith("/api/notifications/")) {
      return new Response(
        JSON.stringify({ items: inbox.items ?? [], nextCursor: null }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    return auth(input, init);
  };
}

function mount(contract: AuthApiContract, inbox: Inbox) {
  vi.stubGlobal("fetch", fetchWith(contract, inbox));
  const Stub = createRoutesStub([{ path: "/", Component: NotificationBell }]);
  return render(
    <AuthProvider>
      <Stub initialEntries={["/"]} />
    </AuthProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  marked.length = 0;
});

describe("what a signed-out reader gets", () => {
  it("draws nothing at all", async () => {
    mount(new AuthApiContract({ session: null }), { unread: 0 });

    // Not an empty bell, not a placeholder: nothing. Every prerendered file on
    // this site is frozen in this state and served to every visitor.
    await waitFor(() => {
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });
});

describe("the count", () => {
  it("is announced with a noun, not left as a bare number", async () => {
    mount(new AuthApiContract({ session: user() }), { unread: 3 });

    // A badge reading "3" is "3" to anybody not looking at it.
    const bell = await screen.findByRole("button", {
      name: "Notifications, 3 unread",
    });
    expect(bell).toBeInTheDocument();
  });

  it("says so when there is nothing", async () => {
    mount(new AuthApiContract({ session: user() }), { unread: 0 });

    expect(
      await screen.findByRole("button", { name: "Notifications, none unread" }),
    ).toBeInTheDocument();
  });

  it("caps what it draws without capping what it says", async () => {
    mount(new AuthApiContract({ session: user() }), { unread: 140 });

    const bell = await screen.findByRole("button", {
      name: "Notifications, 140 unread",
    });
    expect(bell).toHaveTextContent("99+");
  });
});

describe("clearing", () => {
  it("empties the count before the request finishes", async () => {
    mount(new AuthApiContract({ session: user() }), {
      unread: 2,
      items: [
        {
          id: 1,
          kind: "content.published",
          subjectType: "class",
          subjectKey: "sentinel",
          detail: { name: "Sentinel", actor: "Drake" },
          createdAt: new Date().toISOString(),
          read: false,
        },
      ],
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "Notifications, 2 unread" }),
    );

    await userEvent.click(await screen.findByRole("button", { name: "Mark all read" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Notifications, none unread" }),
      ).toBeInTheDocument();
    });

    expect(marked).toContain("all");
  });
});
