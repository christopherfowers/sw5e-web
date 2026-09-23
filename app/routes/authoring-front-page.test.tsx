/**
 * Arranging the front page.
 *
 * The screen's whole claim is that it is the front page rather than a form
 * about it, so these assert the things that claim rests on: the reader's
 * sections are what render, the arrangement is editable in place, and what
 * gets written is only what moved.
 *
 * The last one matters more than it looks. The front page is arranged out of
 * a dozen separate documents and the service has no way to write them
 * together, so every needless write is another document that can fail halfway
 * through somebody else's edit.
 */

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, user } from "../../tests/auth-api-contract";
import { AuthoringApiStub, serveAuthoring } from "../../tests/authoring-api-stub";
import { marker, renderWithSession } from "../../tests/harness";
import type { CurrentUser } from "~/auth/types";
import { resetContentTypeCache } from "~/authoring/use-content-types";
import Authoring from "./authoring";
import AuthoringFrontPage from "./authoring-front-page";

const contributor = () => user({ roles: ["Contributor"], strongAuthentication: true });

function mount(account: CurrentUser | null, stub: AuthoringApiStub) {
  const auth = new AuthApiContract({ session: account });
  stub.session = account;
  vi.stubGlobal("fetch", serveAuthoring(auth, stub));

  return renderWithSession(
    [
      {
        path: "/authoring",
        Component: Authoring,
        children: [{ path: "front-page", Component: AuthoringFrontPage }],
      },
      { path: "/sign-in", Component: marker("sign-in page") },
    ],
    ["/authoring/front-page"],
  );
}

/**
 * A stub holding the Player's Handbook as it is actually published, so that
 * writing a placement has something to merge into. Without it every write
 * looks like a create, and the assertion that untouched fields survive would
 * be passing on an empty document.
 */
function withHandbook() {
  return new AuthoringApiStub({
    published: {
      "source/phb": {
        key: "phb",
        title: "Star Wars 5e Player's Handbook",
        shelfName: "Player's Handbook",
        abbreviation: "PHB",
        order: 1,
        isCoreRulebook: true,
      },
    },
  });
}

/** Every draft the stub was asked to write, in the order it was asked. */
function written(stub: AuthoringApiStub) {
  return stub.calls.filter((call) => call.method === "PUT");
}

beforeEach(() => {
  resetContentTypeCache();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("who may open it", () => {
  it("sends an anonymous visitor to sign in", async () => {
    mount(null, new AuthoringApiStub({}));

    expect(await screen.findByText("sign-in page")).toBeInTheDocument();
  });
});

describe("the page, drawn as the page", () => {
  it("draws the reader's own sections rather than a list of fields", async () => {
    mount(contributor(), new AuthoringApiStub({}));

    // The headings a reader sees, in the editor, because they are the same
    // components. A form would have shown "Books heading" and "Books lede".
    expect(
      await screen.findByRole("heading", { name: "The rulebooks" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Sheets and downloads" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Getting in touch" }),
    ).toBeInTheDocument();
  });

  it("says that saving is not publishing, because the site is built ahead of time", async () => {
    mount(contributor(), new AuthoringApiStub({}));

    expect(
      await screen.findByText(/reaches readers once those are published/i),
    ).toBeInTheDocument();
  });

  it("offers nothing to save until something moves", async () => {
    mount(contributor(), new AuthoringApiStub({}));

    const save = await screen.findByRole("button", { name: "Nothing changed" });
    expect(save).toBeDisabled();
  });
});

describe("arranging it", () => {
  it("puts a move handle and a remove control on each book", async () => {
    mount(contributor(), new AuthoringApiStub({}));

    const shelf = await screen.findByRole("heading", { name: "The rulebooks" });
    const section = shelf.closest("section");
    expect(section).not.toBeNull();

    expect(
      within(section!).getAllByRole("button", { name: /^Move / }).length,
    ).toBeGreaterThan(0);
    expect(
      within(section!).getAllByRole("button", { name: /off the front page$/ })
        .length,
    ).toBeGreaterThan(0);
  });

  it("opens each book's own document, for the fields this screen does not own", async () => {
    mount(contributor(), withHandbook());

    // Where a book sits is this screen's; its name, blurb and cover are the
    // book's own document. Somebody looking at the shelf who spots a wrong
    // blurb should not have to go and find it in a worklist.
    const open = await screen.findByRole("link", { name: "Edit Player's Handbook" });
    expect(open).toHaveAttribute("href", "/authoring/edit?type=source&key=phb");
  });

  it("counts a removal as one change, and writes one document", async () => {
    const stub = withHandbook();
    mount(contributor(), stub);

    const remove = (
      await screen.findAllByRole("button", { name: /off the front page$/ })
    )[0]!;
    await userEvent.click(remove);

    const save = await screen.findByRole("button", { name: "Save 1 change" });
    expect(save).toBeEnabled();

    await userEvent.click(save);

    // One document written, not the dozen the page is assembled from.
    await waitFor(() => {
      expect(written(stub).length).toBe(1);
    });
  });

  it("writes the whole document, so the fields it does not own survive", async () => {
    const stub = withHandbook();
    mount(contributor(), stub);

    await userEvent.click(
      (await screen.findAllByRole("button", { name: /off the front page$/ }))[0]!,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Save 1 change" }));

    await waitFor(() => expect(written(stub).length).toBe(1));

    // `saveDraft` replaces the document rather than patching it, so a screen
    // that sent only the two fields it changes would silently delete a book's
    // name, blurb and licence note.
    const body = written(stub)[0]!.body as { document: Record<string, unknown> };
    expect(body.document.showOnHomePage).toBe(false);
    expect(body.document.title).toBe("Star Wars 5e Player's Handbook");
  });
});

describe("the words", () => {
  it("edits a lede in place and counts it as a change to the page", async () => {
    const stub = withHandbook();
    mount(contributor(), stub);

    const lede = await screen.findByLabelText("Opening paragraph");
    await userEvent.type(lede, "Hello");

    await userEvent.click(await screen.findByRole("button", { name: "Save 1 change" }));

    await waitFor(() => expect(written(stub).length).toBe(1));
    expect(written(stub)[0]!.path).toContain("/pages/home");
  });
});
