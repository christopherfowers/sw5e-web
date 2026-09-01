/**
 * Revision history, the diff it shows, and putting a version back.
 *
 * The diff is the part worth testing here. The service deliberately does not
 * compute one — `GET .../revisions/{id}` answers with a whole document and
 * leaves the comparison to whoever is presenting it — so what a reviewer sees
 * is entirely this client's work, and "shows the field that changed rather than
 * two walls of text" is a behaviour with a test rather than an intention.
 */

import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, user } from "../../tests/auth-api-contract";
import {
  AuthoringApiStub,
  revision,
  serveAuthoring,
} from "../../tests/authoring-api-stub";
import { marker, renderWithSession } from "../../tests/harness";
import type { CurrentUser } from "~/auth/types";
import { resetContentTypeCache } from "~/authoring/use-content-types";
import Authoring from "./authoring";
import AuthoringHistory from "./authoring-history";

const contributor = () => user({ roles: ["Contributor"], strongAuthentication: true });
const administrator = () =>
  user({ roles: ["Administrator"], strongAuthentication: true });

const BULKY = {
  key: "bulky",
  name: "Bulky",
  contentSet: "core",
  // Long enough to be diffed word by word rather than shown whole, which is
  // what the rules text in this corpus actually looks like.
  description:
    "While wearing this armor, the wearer has disadvantage on Dexterity " +
    "(Stealth) checks made to move quietly past a hostile creature.",
};

function mount(account: CurrentUser | null, stub: AuthoringApiStub) {
  const auth = new AuthApiContract({ session: account });
  stub.session = account;
  vi.stubGlobal("fetch", serveAuthoring(auth, stub));

  const result = renderWithSession(
    [
      {
        path: "/authoring",
        Component: Authoring,
        children: [{ path: "history", Component: AuthoringHistory }],
      },
      { path: "/sign-in", Component: marker("sign-in page") },
    ],
    ["/authoring/history?type=armor-property&key=bulky"],
  );

  return { ...result, stub };
}

/** Two revisions, the second correcting one word of the first. */
function corrected() {
  return new AuthoringApiStub({
    revisions: {
      "armor-property/bulky": [
        revision({ id: 41, number: 1, action: "imported", document: BULKY }),
        revision({
          id: 42,
          number: 2,
          action: "updated",
          reason: "Checked against page 118.",
          document: {
            ...BULKY,
            description:
              "While wearing this armor, the wearer has disadvantage on Dexterity " +
              "(Acrobatics) checks made to move quietly past a hostile creature.",
          },
        }),
      ],
    },
  });
}

beforeEach(() => {
  resetContentTypeCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("who can read a history", () => {
  it("refuses a community account, and asks the authoring API nothing", async () => {
    const { stub } = mount(user(), corrected());

    expect(
      await screen.findByText(/this area is for contributor accounts/i),
    ).toBeInTheDocument();

    // Drained first. A negative assertion made in the same tick as the render
    // can pass because the request has not been issued yet rather than because
    // it never will be, and effects are where these requests are issued.
    await act(async () => {});
    expect(stub.touchedAuthoring).toBe(false);
  });

  it("sends an unauthenticated visitor to sign in", async () => {
    const { stub } = mount(null, corrected());

    expect(await screen.findByText("sign-in page")).toBeInTheDocument();

    await act(async () => {});
    expect(stub.touchedAuthoring).toBe(false);
  });
});

describe("the list", () => {
  it("shows every change, newest first, with what it was and why", async () => {
    mount(contributor(), corrected());

    expect(await screen.findByText("Revision 2")).toBeInTheDocument();
    expect(screen.getByText("Revision 1")).toBeInTheDocument();
    expect(screen.getByText("Imported from the archive")).toBeInTheDocument();
    // Free text from whoever published, rendered as a text node.
    expect(screen.getByText("Checked against page 118.")).toBeInTheDocument();
  });

  it("says when there is nothing published at this address", async () => {
    mount(contributor(), new AuthoringApiStub());
    expect(
      await screen.findByText(/nothing has been published at this address/i),
    ).toBeInTheDocument();
  });
});

describe("the diff", () => {
  it("opens on the newest change against what came before it", async () => {
    mount(contributor(), corrected());

    // One field, named, rather than two documents printed one after the other.
    expect(await screen.findByText(/one field differs/i)).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("/description")).toBeInTheDocument();
  });

  it("marks the words that changed inside a paragraph", async () => {
    mount(contributor(), corrected());

    await screen.findByText(/one field differs/i);

    // `<del>` and `<ins>` rather than colour alone: they are what a screen
    // reader announces as a deletion and an insertion.
    const removed = document.querySelector("del");
    const added = document.querySelector("ins");

    expect(removed?.textContent).toContain("(Stealth)");
    expect(added?.textContent).toContain("(Acrobatics)");
    // And the sentence they sit in is still there, so the change has context.
    expect(
      screen.getByText(/made to move quietly past a hostile creature/i),
    ).toBeInTheDocument();
  });

  it("compares against nothing for the first revision, which is what an import is", async () => {
    const user = userEvent.setup();
    mount(contributor(), corrected());

    await screen.findByText(/one field differs/i);
    await user.selectOptions(screen.getByLabelText("Compare from"), "");
    await user.selectOptions(screen.getByLabelText("Compare to"), "41");

    // Everything the document holds arrived at once.
    expect(await screen.findByText(/4 fields differ/i)).toBeInTheDocument();
  });

  it("says so plainly when two revisions hold the same content", async () => {
    const stub = new AuthoringApiStub({
      revisions: {
        "armor-property/bulky": [
          revision({ id: 41, number: 1, document: BULKY }),
          revision({ id: 42, number: 2, action: "reverted", revertedFromId: 41, document: BULKY }),
        ],
      },
    });

    mount(contributor(), stub);

    // A blank panel would read as a page that failed to load.
    expect(await screen.findByText(/hold the same content/i)).toBeInTheDocument();
  });
});

describe("putting a version back", () => {
  it("is not offered to a contributor", async () => {
    // Reverting needs Administrator on the service. A control that answered 403
    // would be a promise this interface cannot keep.
    mount(contributor(), corrected());

    await screen.findByText("Revision 1");
    expect(screen.queryByRole("button", { name: /put revision 1 back/i })).toBeNull();
  });

  it("is not offered for the revision that is already current", async () => {
    // It would write a revision that changed nothing, and a control whose only
    // effect is a line in the history teaches whoever reads that history to
    // treat it as noise.
    mount(administrator(), corrected());

    await screen.findByText("Revision 2");
    expect(screen.queryByRole("button", { name: /put revision 2 back/i })).toBeNull();
    expect(screen.getByRole("button", { name: /put revision 1 back/i })).toBeInTheDocument();
  });

  it("adds a revision rather than removing one", async () => {
    const { stub } = mount(administrator(), corrected());

    await screen.findByText("Revision 1");
    await userEvent.click(screen.getByRole("button", { name: /put revision 1 back/i }));

    const panel = screen.getByText(/this writes a new revision/i).closest("div")!;
    await userEvent.type(
      within(panel).getByLabelText("Why"),
      "The correction was wrong.",
    );
    await userEvent.click(
      within(panel).getByRole("button", { name: /^put revision 1 back$/i }),
    );

    // The history is append-only: three revisions where there were two, and the
    // mistake being undone is still readable.
    expect(await screen.findByText("Revision 3")).toBeInTheDocument();
    expect(screen.getByText("Revision 2")).toBeInTheDocument();

    const call = stub.lastCall("POST", "/api/authoring/content/armor-property/bulky/revert");
    expect(call?.body).toMatchObject({
      revisionId: 41,
      reason: "The correction was wrong.",
    });
  });

  it("says what is actually wrong when the old body no longer matches the schema", async () => {
    // Reverting re-validates against the schema as it stands now. Reporting
    // that as "revert failed" would send somebody looking for a fault in the
    // revert; the answer is that the document as it stood then is not a
    // document this content type accepts any more.
    const stub = corrected();
    stub.session = administrator();
    const auth = new AuthApiContract({ session: administrator() });
    vi.stubGlobal(
      "fetch",
      serveAuthoring(
        auth,
        Object.assign(stub, {
          handle: (method: string, path: string, body: unknown) => {
            if (path.endsWith("/revert")) {
              return {
                status: 400,
                body: {
                  title: "That change could not be saved",
                  status: 400,
                  detail: "The document does not match the published schema.",
                  code: "schema-violation",
                  schemaErrors: [
                    ': required — Required properties ["sourceKey"] were not present',
                  ],
                },
              };
            }
            return AuthoringApiStub.prototype.handle.call(stub, method, path, body);
          },
        }),
      ),
    );

    renderWithSession(
      [
        {
          path: "/authoring",
          Component: Authoring,
          children: [{ path: "history", Component: AuthoringHistory }],
        },
      ],
      ["/authoring/history?type=armor-property&key=bulky"],
    );

    await screen.findByText("Revision 1");
    await userEvent.click(screen.getByRole("button", { name: /put revision 1 back/i }));
    await userEvent.click(
      screen.getByRole("button", { name: /^put revision 1 back$/i }),
    );

    expect(
      await screen.findByText(/does not match the schema this content type uses now/i),
    ).toBeInTheDocument();
  });
});
