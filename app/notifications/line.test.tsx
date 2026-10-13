/**
 * The sentence a notification becomes, and where following it goes.
 *
 * Two things are worth holding still here. A kind this build has never heard
 * of must still draw something, because the service's set can run ahead of a
 * browser holding an older bundle and the alternative is a blank row that
 * counts towards the unread total and can never be cleared. And a content
 * change must go to that document's history, where the diff already answers
 * the question the line raises.
 */

import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import type { Notification } from "./api";
import { NotificationLine } from "./line";

function mount(notification: Notification) {
  const router = createMemoryRouter(
    [{ path: "/", Component: () => <NotificationLine notification={notification} /> }],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
}

function published(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 1,
    kind: "content.published",
    subjectType: "class",
    subjectKey: "sentinel",
    detail: { name: "Sentinel", revision: "8", actor: "Drake" },
    createdAt: new Date().toISOString(),
    read: false,
    ...overrides,
  };
}

describe("what the line says", () => {
  it("names who did it, what they did, and to what", () => {
    mount(published());

    expect(screen.getByText("Drake")).toBeInTheDocument();
    expect(screen.getByText("Sentinel")).toBeInTheDocument();
    expect(screen.getByText(/as revision 8/)).toBeInTheDocument();
  });

  it("still reads when the detail is missing its wording", () => {
    // Detail is written at the time and could be anything on an old row.
    mount(published({ detail: {} }));

    expect(screen.getByText("sentinel")).toBeInTheDocument();
    expect(screen.getByText("somebody")).toBeInTheDocument();
  });

  it("draws a kind this build does not know about", () => {
    mount(published({ kind: "something.new" as Notification["kind"] }));

    // Not blank. A row nobody can read is a row nobody can clear, and it would
    // sit in the unread count forever.
    expect(screen.getByText(/Something happened to Sentinel/)).toBeInTheDocument();
  });

  it("renders authored names as text, never as markup", () => {
    mount(published({ detail: { name: "<em>Sentinel</em>", actor: "Drake" } }));

    // Display names are authored, so they are drawn and not interpreted.
    expect(screen.getByText("<em>Sentinel</em>")).toBeInTheDocument();
    expect(document.querySelector("em")).toBeNull();
  });
});

describe("where it goes", () => {
  it("sends a content change to that document's history", () => {
    mount(published());

    // The diff already exists there and answers the question the line raises.
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/authoring/history?type=class&key=sentinel",
    );
  });

  it("sends an account notification to the account page", () => {
    mount(
      published({
        kind: "account.role_granted",
        subjectType: null,
        subjectKey: null,
        detail: { role: "Administrator" },
      }),
    );

    expect(screen.getByRole("link")).toHaveAttribute("href", "/account");
  });

  it("is not a link when there is nowhere to send anybody", () => {
    mount(published({ kind: "something.new" as Notification["kind"], subjectType: null, subjectKey: null }));

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
