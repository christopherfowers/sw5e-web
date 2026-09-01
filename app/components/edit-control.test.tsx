/**
 * The "Edit this page" line on a content page.
 *
 * Two properties, and the second one is the load-bearing one:
 *
 *   a contributor is offered it, with the document already named
 *   nobody else sees it, and neither does the prerendered file
 *
 * The second matters because every content page on this site is a static file
 * written at build time and served byte for byte to everybody. If this drew
 * anything in the session's `loading` state, that markup would be baked into
 * ~7,900 pages and shipped to every anonymous reader, and the first client
 * render would differ from it.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, afterEach, vi } from "vitest";

import { AuthApiContract, user } from "../../tests/auth-api-contract";
import { renderWithSession, serveApiContract } from "../../tests/harness";
import { EditControl } from "./edit-control";

function mount(session: Parameters<typeof user>[0] | null) {
  serveApiContract(
    new AuthApiContract({ session: session === null ? null : user(session) }),
  );

  return renderWithSession([
    {
      path: "/",
      Component: () => <EditControl type="species" slug="wookiee" />,
    },
    { path: "/authoring/edit", Component: () => <p>editor</p> },
  ]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a contributor", () => {
  it("is offered the editor for the document they are reading", async () => {
    mount({ roles: ["Contributor"] });

    const edit = await screen.findByRole("link", { name: /edit this page/i });

    // The type and key travel in the query string, escaped, because there is
    // no runtime server and the editor has to be able to address a document
    // that does not exist yet. A hand-built string is how a key containing an
    // ampersand silently opens the wrong document.
    expect(edit).toHaveAttribute("href", "/authoring/edit?type=species&key=wookiee");
  });

  it("is offered the document's history alongside it", async () => {
    mount({ roles: ["Administrator"] });

    expect(
      await screen.findByRole("link", { name: /history/i }),
    ).toHaveAttribute("href", "/authoring/history?type=species&key=wookiee");
  });
});

describe("everybody else", () => {
  it("is shown nothing at all when signed out", async () => {
    mount(null);

    // Waited on rather than asserted synchronously: the interesting failure is
    // a control that appears *after* the session resolves to anonymous, which
    // an immediate assertion would sail straight past.
    await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
  });

  it("is shown nothing when signed in without the role", async () => {
    mount({ roles: ["Community"] });

    await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
  });
});

describe("the file the build writes", () => {
  it("contains none of it", () => {
    // Rendered with no session provider resolution at all — the first frame,
    // which is the state the prerendered HTML is frozen in. Anything drawn
    // here would ship to every anonymous reader of every content page and
    // would not match the first client render.
    const { container } = render(<EditControl type="species" slug="wookiee" />);

    expect(container).toBeEmptyDOMElement();
  });
});
