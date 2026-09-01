/**
 * The administrative log.
 *
 * Shorter than the directory's suite because the page does less: it reads, it
 * filters, it pages. What it must not do is the interesting part — it must not
 * open to anybody but an administrator, and it must not interpret anything a
 * person wrote as markup.
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, user } from "../../tests/auth-api-contract";
import {
  AdminApiStub,
  adminAction,
  serveAdministration,
} from "../../tests/admin-api-stub";
import { renderWithSession } from "../../tests/harness";
import Account from "./account";
import AccountAudit from "./account-audit";

const ADMINISTRATOR = user({ roles: ["Community", "Administrator"] });

function routes() {
  return [
    {
      path: "/account",
      Component: Account,
      children: [{ path: "audit", Component: AccountAudit }],
    },
    { path: "/sign-in", Component: () => <p>sign-in page</p> },
    { path: "/", Component: () => <p>home</p> },
  ];
}

function mount(admin: AdminApiStub, session = ADMINISTRATOR) {
  const auth = new AuthApiContract({ session });
  vi.stubGlobal("fetch", serveAdministration(auth, admin));
  return renderWithSession(routes(), ["/account/audit"]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("who may read the log", () => {
  it("refuses a community account without asking the server for it", async () => {
    const admin = new AdminApiStub({
      actions: [adminAction({ subjectDisplayName: "Zeb Orrelios" })],
    });

    mount(admin, user({ roles: ["Community"] }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /this area is for administrator accounts/i,
      ),
    );

    expect(admin.calls).toHaveLength(0);
    expect(document.body.textContent).not.toContain("Zeb Orrelios");
  });

  it("refuses a contributor", async () => {
    const admin = new AdminApiStub({ actions: [adminAction()] });

    mount(admin, user({ roles: ["Community", "Contributor"] }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /this area is for administrator accounts/i,
      ),
    );

    expect(admin.calls).toHaveLength(0);
  });

  it("shows it to an administrator", async () => {
    // The control for both refusals above.
    const admin = new AdminApiStub({
      actions: [adminAction({ subjectDisplayName: "Zeb Orrelios" })],
    });

    mount(admin);

    expect(await screen.findByText("Zeb Orrelios")).toBeInTheDocument();
  });
});

describe("what an entry says", () => {
  it("names who did what to whom, and when", async () => {
    mount(
      new AdminApiStub({
        actions: [
          adminAction({
            actorDisplayName: "Jen Ordo",
            subjectDisplayName: "Zeb Orrelios",
            rolesBefore: null,
            rolesAfter: ["Contributor"],
            createdAt: "2026-09-01T10:00:00.000Z",
          }),
        ],
      }),
    );

    expect(await screen.findByText("Zeb Orrelios")).toBeInTheDocument();
    expect(screen.getByText(/roles changed/i)).toBeInTheDocument();
    expect(screen.getByText(/by Jen Ordo/)).toBeInTheDocument();

    // What changed, not merely that something did. A log that said "roles were
    // changed" would be one nobody can audit.
    expect(screen.getByText(/Community → Contributor/)).toBeInTheDocument();

    // The machine-readable instant stays where a machine can find it.
    expect(screen.getByText(/by Jen Ordo/).querySelector("time")).toHaveAttribute(
      "dateTime",
      "2026-09-01T10:00:00.000Z",
    );
  });

  it("renders an administrator's note as text and never as markup", async () => {
    const hostile = '<img src=x onerror="alert(1)">';

    mount(
      new AdminApiStub({
        actions: [adminAction({ action: "account-suspended", reason: hostile })],
      }),
    );

    expect(await screen.findByText(hostile)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("still names the subject of a deletion, which is the entry that outlives it", async () => {
    // The reason the service copies display names onto the row instead of
    // resolving them the way the flag queue does. Resolving would render the
    // one entry most worth keeping as a bare identifier.
    mount(
      new AdminApiStub({
        actions: [
          adminAction({
            action: "account-deleted",
            subjectDisplayName: "Kel Dor Archivist",
            rolesAfter: null,
          }),
        ],
      }),
    );

    expect(await screen.findByText("Kel Dor Archivist")).toBeInTheDocument();
    expect(screen.getByText(/^deleted$/i)).toBeInTheDocument();
  });
});

describe("filtering", () => {
  it("asks the server for one kind of action rather than filtering in the browser", async () => {
    const admin = new AdminApiStub({
      actions: [
        adminAction({ id: "a", action: "roles-changed" }),
        adminAction({ id: "b", action: "account-deleted", subjectDisplayName: "Gone" }),
      ],
    });

    mount(admin);

    await screen.findByText(/roles changed/i);

    await userEvent.click(screen.getByRole("button", { name: /deletions/i }));

    await waitFor(() =>
      expect(
        new URLSearchParams(
          admin.lastCall("GET", "/api/auth/admin/audit")?.path.split("?")[1],
        ).get("action"),
      ).toBe("account-deleted"),
    );

    expect(screen.getByText("Gone")).toBeInTheDocument();
    expect(screen.queryByText(/roles changed/i)).not.toBeInTheDocument();
  });
});
