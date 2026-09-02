/**
 * The editor, tested on the four things it exists to get right.
 *
 * **Who may reach it.** The browser decides what to draw and the API decides
 * what to allow; only the second is a security boundary. What is asserted here
 * is the first, and it is asserted twice over: that the refusal is drawn, and
 * that the client did not ask the authoring API anything at all. A page that
 * drew a refusal while still firing four requests would put four 403s in a
 * community reader's console and would be one carelessly-lifted guard away from
 * showing them the answers.
 *
 * **That a schema refusal lands on the field that caused it.** The service
 * answers `schemaErrors` as an array of strings with a JSON Pointer at the
 * front of each. The pointers are what let an error be placed, and the test
 * below is written against the real string format rather than a convenient one.
 *
 * **That a stale publish loses nothing.** Somebody pastes four paragraphs out
 * of a Discord thread, somebody else publishes underneath them, and the publish
 * is refused. Every character has to survive that, in the control and in the
 * copy that would survive the tab closing.
 *
 * **That nothing is dropped.** A draft carries the whole document, so a field
 * the form does not draw is a field the next save deletes.
 */

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, user } from "../../tests/auth-api-contract";
import {
  ARMOR_PROPERTY_SCHEMA,
  AuthoringApiStub,
  revision,
  serveAuthoring,
  type StoredRevision,
} from "../../tests/authoring-api-stub";
import { marker, renderWithSession } from "../../tests/harness";
import { installAuthenticator, removeWebAuthn } from "../../tests/webauthn-stub";
import type { CurrentUser } from "~/auth/types";
import { recoveryKey } from "~/authoring/recovery";
import { resetContentTypeCache } from "~/authoring/use-content-types";
import Authoring from "./authoring";
import AuthoringEdit from "./authoring-edit";

const contributor = () => user({ roles: ["Contributor"], strongAuthentication: true });
const administrator = () =>
  user({ roles: ["Administrator"], strongAuthentication: true });

const BULKY = {
  key: "bulky",
  name: "Bulky",
  contentSet: "core",
  description: "The wearer has disadvantage on Dexterity (Stealth) checks.",
};

function mount(
  account: CurrentUser | null,
  stub: AuthoringApiStub,
  search = "?type=armor-property&key=bulky",
) {
  const auth = new AuthApiContract({ session: account });
  stub.session = account;
  vi.stubGlobal("fetch", serveAuthoring(auth, stub));

  const result = renderWithSession(
    [
      {
        path: "/authoring",
        Component: Authoring,
        children: [{ path: "edit", Component: AuthoringEdit }],
      },
      { path: "/sign-in", Component: marker("sign-in page") },
    ],
    [`/authoring/edit${search}`],
  );

  return { ...result, stub };
}

/** A stub holding one published armour property, with no draft open. */
function published(overrides: Partial<StoredRevision> = {}) {
  return new AuthoringApiStub({
    revisions: { "armor-property/bulky": [revision({ id: 41, number: 1, ...overrides })] },
  });
}

beforeEach(() => {
  resetContentTypeCache();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  removeWebAuthn();
});

/* --------------------------------------------------------------- who gets in */

describe("who can reach the editor", () => {
  it("refuses a community account, and asks the authoring API nothing", async () => {
    const { stub } = mount(user(), published());

    expect(
      await screen.findByText(/this area is for contributor accounts/i),
    ).toBeInTheDocument();

    // No form, and no draft anywhere on the screen.
    expect(screen.queryByRole("textbox")).toBeNull();

    // And nothing was asked for. Drawing a refusal while still fetching would
    // fill a reader's console with 403s and would mean the guard was the only
    // thing standing between them and the answers.
    //
    // Drained first: a negative assertion made in the same tick as the render
    // can pass because the request has not been issued yet rather than because
    // it never will be, and effects are where these requests are issued.
    await act(async () => {});
    expect(stub.touchedAuthoring).toBe(false);
  });

  it("sends an unauthenticated visitor to sign in, and asks the authoring API nothing", async () => {
    const { stub } = mount(null, published());

    expect(await screen.findByText("sign-in page")).toBeInTheDocument();

    await act(async () => {});
    expect(stub.touchedAuthoring).toBe(false);
  });

  it("explains itself to a contributor who signed in with an emailed code", async () => {
    installAuthenticator();
    // The account holds the role; the session does not clear the bar. The API
    // refuses this with a 403 whose code says so, and drawing an editor that
    // could not save anything would be worse than saying why.
    const { stub } = mount(
      user({
        roles: ["Contributor"],
        authenticationMethod: "email",
        strongAuthentication: false,
      }),
      published(),
    );

    expect(
      await screen.findByRole("button", { name: /confirm with a passkey/i }),
    ).toBeInTheDocument();

    // The editor stays unfetched behind the prompt. Drawing a form whose save
    // the API would refuse is worse than saying why, and loading the document
    // to populate it would be work done for a screen nobody reached.
    await act(async () => {});
    expect(stub.touchedAuthoring).toBe(false);
  });

  it("lets a contributor in, and does not offer them publishing", async () => {
    mount(contributor(), published());

    expect(await screen.findByLabelText("Name")).toHaveValue("Bulky");
    expect(screen.getByRole("button", { name: /save draft/i })).toBeEnabled();

    // Publishing needs Administrator on the service. A button that answered 403
    // would be a promise this interface cannot keep.
    expect(screen.queryByRole("button", { name: /publish/i })).toBeNull();
    expect(
      screen.getByText(/publishing is an administrator/i),
    ).toBeInTheDocument();
  });
});

/* ------------------------------------------------------- the generated form */

describe("the form drawn from the schema", () => {
  it("draws a control per property, labelled and described by the schema", async () => {
    mount(contributor(), published());

    const name = await screen.findByLabelText("Name");
    expect(name).toHaveValue("Bulky");
    expect(name).toHaveAccessibleDescription(/display name in title case/i);

    // An enum becomes a menu of its values, written for a reader rather than as
    // wire strings.
    const set = screen.getByLabelText("Content set");
    expect(set).toHaveValue("core");
    expect(within(set as HTMLSelectElement).getByText("Expanded content")).toBeInTheDocument();

    // The schema says this field is Markdown, so it gets room to be prose.
    expect(screen.getByLabelText("Description").tagName).toBe("TEXTAREA");
  });

  it("draws a property the schema does not describe rather than dropping it", async () => {
    // The failure this prevents is silent and permanent: a draft carries the
    // whole document, so a field the form does not draw is a field the next
    // save deletes.
    const stub = new AuthoringApiStub({
      revisions: {
        "armor-property/bulky": [
          revision({ id: 41, document: { ...BULKY, legacyNote: "kept from the archive" } }),
        ],
      },
    });

    mount(contributor(), stub);

    expect(await screen.findByLabelText("Name")).toHaveValue("Bulky");
    expect(screen.getByText(/not described by the schema/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/legacy note/i)).toHaveValue('"kept from the archive"');
  });

  it("falls back to editing the document directly when no schema is published", async () => {
    // A service one version behind must not make this interface undeployable.
    const stub = new AuthoringApiStub({
      schemas: {},
      revisions: { "armor-property/bulky": [revision({ id: 41 })] },
    });

    mount(contributor(), stub);

    expect(
      await screen.findByText(/no schema is published for this content type/i),
    ).toBeInTheDocument();
    const raw = screen.getByLabelText("Document") as HTMLTextAreaElement;
    expect(raw.value).toContain('"name": "Bulky"');
  });
});

/* -------------------------------------------------------------- refusals */

describe("a write the schema refuses", () => {
  /** The validator's real output format, pointer and keyword and all. */
  const refuseMissingDescription = () => [
    ': required — Required properties ["description"] were not present',
  ];

  it("puts the message on the field that caused it, not in a generic failure", async () => {
    const stub = new AuthoringApiStub({
      revisions: { "armor-property/bulky": [revision({ id: 41 })] },
      validate: refuseMissingDescription,
    });

    mount(contributor(), stub);

    const description = await screen.findByLabelText("Description");
    await userEvent.clear(description);
    await userEvent.click(screen.getByRole("button", { name: /save draft/i }));

    // The control that caused it is marked, and carries the reason.
    await waitFor(() => expect(description).toHaveAttribute("aria-invalid", "true"));
    expect(description).toHaveAccessibleDescription(/has to be filled in/i);

    // And a summary at the top, announced, linking to the control. An error
    // twelve fields down has to be visible before anybody scrolls.
    const summary = screen.getByRole("alert");
    expect(summary).toHaveTextContent(/one field was refused/i);
    expect(within(summary).getByRole("link", { name: "/description" })).toHaveAttribute(
      "href",
      `#${description.id}`,
    );

    // The other fields are untouched by somebody else's error.
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
  });

  it("shows a refusal it cannot place, in the service's own words", async () => {
    // Not every line carries a pointer: a document that is not an object, a key
    // that disagrees with its address, a type with no schema. Dropping those
    // would leave a save that failed for no stated reason.
    const stub = new AuthoringApiStub({
      revisions: { "armor-property/bulky": [revision({ id: 41 })] },
      validate: () => ["the 'key' property must be present and equal to the item key."],
    });

    mount(contributor(), stub);

    await screen.findByLabelText("Name");
    await userEvent.click(screen.getByRole("button", { name: /save draft/i }));

    expect(
      await screen.findByText(/must be present and equal to the item key/i),
    ).toBeInTheDocument();
  });
});

/* ----------------------------------------------------------- staleness */

describe("a publish refused because somebody else got there first", () => {
  it("keeps every character the author typed", async () => {
    const passage =
      "While wearing this armor you have disadvantage on Dexterity (Stealth) " +
      "checks.\n\nIf you are proficient with it, you may ignore this while " +
      "standing still, which is the ruling the table has used for years and " +
      "which the book supports on page 118.";

    const stub = new AuthoringApiStub({
      revisions: { "armor-property/bulky": [revision({ id: 41, number: 1 })] },
      drafts: { "armor-property/bulky": { document: BULKY, baseRevisionId: 41 } },
    });

    mount(administrator(), stub);

    const description = await screen.findByLabelText("Description");
    await userEvent.clear(description);
    await userEvent.type(description, passage);

    await userEvent.click(screen.getByRole("button", { name: /save draft/i }));
    await screen.findByText(/draft saved/i);

    // Somebody else publishes, in the seconds between the save and the publish.
    stub.appendRevision(
      "armor-property",
      "bulky",
      { ...BULKY, name: "Bulky (revised)" },
      "updated",
    );

    await userEvent.click(
      screen.getByRole("button", { name: /publish the saved draft/i }),
    );

    // The conflict is reported as the event it is.
    expect(
      await screen.findByRole("heading", { name: /this document has moved on/i }),
    ).toBeInTheDocument();

    // And this is the assertion the whole feature turns on: not one character
    // of what was typed has gone.
    expect(screen.getByLabelText("Description")).toHaveValue(passage);

    // Including in the copy that would survive this tab being closed.
    await waitFor(() => {
      const held = localStorage.getItem(recoveryKey("armor-property", "bulky"));
      expect(held).toContain("which the book supports on page 118");
    });
  });

  it("shows what was published underneath, so it can be folded in", async () => {
    // A conflict somebody can only be blocked by is a conflict they cannot
    // resolve: the service offers no merge and no re-base, so the other
    // person's change has to be readable right next to the editor.
    const stub = new AuthoringApiStub({
      revisions: {
        "armor-property/bulky": [
          revision({ id: 41, number: 1 }),
          revision({
            id: 42,
            number: 2,
            action: "updated",
            document: { ...BULKY, name: "Bulky (revised)" },
          }),
        ],
      },
      // Started against 41, while 42 is what is published.
      drafts: { "armor-property/bulky": { document: BULKY, baseRevisionId: 41 } },
    });

    mount(administrator(), stub);

    expect(
      await screen.findByRole("heading", { name: /this document has moved on/i }),
    ).toBeInTheDocument();

    // The other person's edit, named and shown.
    expect(await screen.findByText("Bulky (revised)")).toBeInTheDocument();
    expect(screen.getByText(/^\/name$/)).toBeInTheDocument();
  });

  it("offers the override as a separate, explicit act", async () => {
    const stub = new AuthoringApiStub({
      revisions: {
        "armor-property/bulky": [
          revision({ id: 41, number: 1 }),
          revision({ id: 42, number: 2, action: "updated" }),
        ],
      },
      drafts: { "armor-property/bulky": { document: BULKY, baseRevisionId: 41 } },
    });

    mount(administrator(), stub);

    await screen.findByRole("heading", { name: /this document has moved on/i });

    await userEvent.click(
      screen.getByRole("button", { name: /publish what is on screen over it/i }),
    );

    // Overriding re-saves — which is what recaptures the base revision — and
    // then publishes. Both, in that order, and only because it was asked for.
    await waitFor(() =>
      expect(stub.lastCall("PUT", "/api/authoring/drafts/armor-property/bulky")).toBeDefined(),
    );
    expect(await screen.findByText(/published as revision 3/i)).toBeInTheDocument();
  });

  it("does not let a publish happen while there are unsaved edits", async () => {
    // Publishing publishes what the service holds. Offering it with unsaved
    // edits would publish something other than what is on the screen — and,
    // worse, a save-then-publish would recapture the base revision and erase
    // the staleness check entirely.
    const stub = new AuthoringApiStub({
      revisions: { "armor-property/bulky": [revision({ id: 41 })] },
      drafts: { "armor-property/bulky": { document: BULKY, baseRevisionId: 41 } },
    });

    mount(administrator(), stub);

    const publish = await screen.findByRole("button", {
      name: /publish the saved draft/i,
    });
    expect(publish).toBeEnabled();

    await userEvent.type(screen.getByLabelText("Name"), "!");
    expect(publish).toBeDisabled();
    expect(screen.getByText(/changes that are not saved/i)).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------- recovery */

describe("work left behind by an earlier visit", () => {
  it("is offered rather than applied", async () => {
    localStorage.setItem(
      recoveryKey("armor-property", "bulky"),
      JSON.stringify({
        document: { ...BULKY, description: "Half a paragraph nobody saved." },
        savedAt: "2026-09-01T08:00:00.000Z",
      }),
    );

    mount(contributor(), published());

    expect(
      await screen.findByText(/unsaved work from an earlier visit/i),
    ).toBeInTheDocument();

    // Not applied. This browser cannot know whether the reader wants what they
    // were typing or what somebody has since saved, and choosing for them is
    // how the wrong one wins silently.
    expect(screen.getByLabelText("Description")).toHaveValue(BULKY.description);

    await userEvent.click(screen.getByRole("button", { name: /put it back/i }));
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Half a paragraph nobody saved.",
    );
  });

  it("is not offered when it matches what the service already holds", async () => {
    localStorage.setItem(
      recoveryKey("armor-property", "bulky"),
      JSON.stringify({ document: BULKY, savedAt: "2026-09-01T08:00:00.000Z" }),
    );

    mount(contributor(), published());

    await screen.findByLabelText("Name");
    expect(screen.queryByText(/unsaved work from an earlier visit/i)).toBeNull();
  });
});

/* ------------------------------------------------------- answering a report */

describe("an edit that answers a report", () => {
  it("carries the report through to the save, so publishing closes it", async () => {
    const stub = new AuthoringApiStub({
      revisions: { "armor-property/bulky": [revision({ id: 41 })] },
    });

    mount(contributor(), stub, "?type=armor-property&key=bulky&flag=flag-7");

    await screen.findByLabelText("Name");
    await userEvent.type(screen.getByLabelText("Name"), " armour");
    await userEvent.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => {
      const call = stub.lastCall("PUT", "/api/authoring/drafts/armor-property/bulky");
      expect(call?.body).toMatchObject({ resolvesFlagId: "flag-7" });
    });
  });
});

describe("an address with no key", () => {
  it("asks for one rather than firing requests that cannot match a route", async () => {
    // Reachable only by typing the address. The key is the document's address
    // on the service as well as on this site, so there is nothing to open
    // without one — and the three requests the load would otherwise make would
    // have an empty path segment and be refused by routing, which would be
    // reported as the document failing to open.
    const { stub } = mount(contributor(), published(), "?type=armor-property");

    expect(await screen.findByText(/a document needs a key/i)).toBeInTheDocument();

    await act(async () => {});
    expect(stub.touchedAuthoring).toBe(false);
  });
});

/* --------------------------------------------------- a read-only deployment */

describe("a deployment that cannot store content", () => {
  it("says so rather than reporting a fault", async () => {
    // A file-backed deployment is read-only by choice. Reporting its 503 as
    // "something went wrong" sends a contributor looking for a problem with
    // their own account.
    const stub = new AuthoringApiStub({
      replies: {
        "GET /api/authoring/drafts/armor-property/bulky": {
          status: 503,
          body: {
            title: "Content authoring is not enabled here",
            status: 503,
            detail: "This deployment stores content in files.",
            code: "authoring-unavailable",
          },
        },
      },
    });

    mount(contributor(), stub);

    expect(
      await screen.findByText(/content cannot be edited on this deployment/i),
    ).toBeInTheDocument();
  });
});

/** Kept so the schema fixture cannot drift from the type it claims to describe. */
it("uses a schema fixture whose root is an object with named properties", () => {
  expect(ARMOR_PROPERTY_SCHEMA.type).toBe("object");
  expect(Object.keys(ARMOR_PROPERTY_SCHEMA.properties)).toContain("description");
});

/* ------------------------------------------------- a document with no history */

/**
 * Opening a document that was imported rather than published.
 *
 * This is not an edge case; on the deployed site it is every document. A
 * revision is written when somebody publishes through the authoring API, and
 * the whole corpus arrived through the importer, which writes none — 7,877
 * documents and not one revision between them.
 *
 * The editor read the newest revision to find what to open, and when there was
 * not one it offered a blank form. So the edit button on every page in the
 * library led to an empty document, and the only thing an author could do with
 * it was retype what was already there. The report was exactly that: "found an
 * edit page button but it instead seems to only give me adding content. Cannot
 * change anything."
 */
describe("a document that was imported rather than published", () => {
  function imported() {
    return new AuthoringApiStub({
      // No revisions and no draft: what the importer leaves behind.
      published: {
        "armor-property/bulky": {
          key: "bulky",
          name: "Bulky",
          description: "The armor is unwieldy and slow to move in.",
        },
      },
    });
  }

  it("opens the published document rather than a blank form", async () => {
    mount(user({ roles: ["Contributor"] }), imported());

    // The document's own values, in the form. Before this, every one of these
    // fields was empty.
    await waitFor(() =>
      expect(screen.getByLabelText(/^name/i)).toHaveValue("Bulky"),
    );

    expect(screen.getByLabelText(/^key/i)).toHaveValue("bulky");
    expect(screen.getByLabelText(/^description/i)).toHaveValue(
      "The armor is unwieldy and slow to move in.",
    );
  });

  it("still offers a blank form for a document that is genuinely not there", async () => {
    // Nothing published at that address, no revisions, no draft. This is what
    // creating a document looks like, and it must keep working.
    mount(
      user({ roles: ["Contributor"] }),
      new AuthoringApiStub({}),
      "?type=armor-property&key=brand-new",
    );

    await waitFor(() =>
      expect(screen.getByLabelText(/^key/i)).toHaveValue("brand-new"),
    );

    expect(screen.getByLabelText(/^name/i)).toHaveValue("");
  });
});
