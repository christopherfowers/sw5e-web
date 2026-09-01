/**
 * The reports page, and the queue underneath it.
 *
 * Two things here carry more weight than the rest.
 *
 * **Escaping.** Report details, reviewer notes and display names are all
 * written by people and all rendered to contributors and administrators. A
 * stored cross-site scripting hole in a moderation queue hands an attacker the
 * most valuable session on the platform, so the tests below feed markup through
 * every one of those fields and assert that what lands in the document is a
 * text node — not that it "looks escaped", but that no element was created.
 *
 * **Who sees the queue.** The browser decides what to draw and the API decides
 * what to allow, and the second is the one that matters. What is asserted here
 * is the first: that a community account is not shown a queue it cannot load,
 * and that a contributor whose session only proved a mailbox is told why rather
 * than shown an empty one.
 */

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, user } from "../../tests/auth-api-contract";
import { flag, FlagApiStub, serveBoth } from "../../tests/flag-api-stub";
import { renderWithSession } from "../../tests/harness";
import type { CurrentUser } from "~/auth/types";
import Account from "./account";
import AccountFlags from "./account-flags";

function mount(account: CurrentUser, flags = new FlagApiStub()) {
  const auth = new AuthApiContract({ session: account });
  vi.stubGlobal("fetch", serveBoth(auth, flags));

  const result = renderWithSession(
    [
      {
        path: "/account",
        Component: Account,
        children: [{ path: "flags", Component: AccountFlags }],
      },
      { path: "/sign-in", Component: () => <p>sign-in</p> },
    ],
    ["/account/flags"],
  );

  return { ...result, flags };
}

const contributor = () =>
  user({ roles: ["Contributor"], strongAuthentication: true });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("your own reports", () => {
  it("lists what this account filed, and what became of it", async () => {
    mount(
      user(),
      new FlagApiStub({
        mine: [
          flag({
            id: "a",
            reason: "text-error",
            details: "Missing full stop.",
            status: "resolved",
            reviewedAt: "2026-09-02T09:00:00.000Z",
          }),
        ],
      }),
    );

    expect(await screen.findByText("Missing full stop.")).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();
  });

  it("never shows a reviewer's note to the reporter", async () => {
    // The service withholds it; this asserts the client does not go looking for
    // it somewhere else. A triage note is written between the people working
    // the queue, and a field that is sometimes private is one somebody
    // eventually writes the wrong thing into.
    mount(
      user(),
      new FlagApiStub({
        mine: [flag({ status: "declined", reviewerNote: null })],
      }),
    );

    await screen.findByText("Declined");
    expect(screen.queryByText(/reviewer note/i)).toBeNull();
  });

  it("says something useful when there is nothing yet", async () => {
    mount(user(), new FlagApiStub({ mine: [] }));

    expect(
      await screen.findByText(/you have not reported anything yet/i),
    ).toBeInTheDocument();
  });
});

describe("who gets the queue", () => {
  it("does not draw it for a community account", async () => {
    const { flags } = mount(user(), new FlagApiStub({ mine: [] }));

    await screen.findByRole("heading", { name: /your reports/i });

    expect(screen.queryByRole("heading", { name: /review queue/i })).toBeNull();

    // And it does not ask for it either. Drawing nothing while still fetching
    // would put a 403 in every community reader's console and a pointless
    // request on every load.
    expect(flags.calls.some((call) => call.path.startsWith("/api/flags?"))).toBe(false);
    expect(flags.calls.some((call) => call.path === "/api/flags")).toBe(false);
  });

  it("draws it for a contributor", async () => {
    mount(
      contributor(),
      new FlagApiStub({ mine: [], queue: [flag({ details: "A typo." })] }),
    );

    expect(
      await screen.findByRole("heading", { name: /review queue/i }),
    ).toBeInTheDocument();
    expect(await screen.findByText("A typo.")).toBeInTheDocument();
  });

  it("explains itself to a contributor who signed in with an emailed code", async () => {
    const { flags } = mount(
      user({
        roles: ["Contributor"],
        authenticationMethod: "email",
        strongAuthentication: false,
      }),
      new FlagApiStub({ mine: [] }),
    );

    // Not an empty queue, and not silence. The API refuses contributor work to
    // a session that only proved a mailbox, and enrolling a passkey clears it
    // in about a minute — so the copy has to say that rather than read as
    // "you do not have access".
    expect(
      await screen.findByText(/needs a passkey or an authenticator app/i),
    ).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /add a passkey/i })).toHaveAttribute(
      "href",
      "/account/passkeys",
    );

    expect(flags.calls.some((call) => call.path.startsWith("/api/flags?"))).toBe(false);
  });
});

describe("untrusted text", () => {
  const PAYLOAD = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

  it("renders report details as text and not as markup", async () => {
    const { container } = mount(
      contributor(),
      new FlagApiStub({ mine: [], queue: [flag({ details: PAYLOAD })] }),
    );

    // The exact string is in the document, so nothing was stripped and the
    // reviewer can read what was actually reported.
    expect(await screen.findByText(PAYLOAD)).toBeInTheDocument();

    // And no element was created from it. This is the assertion that matters:
    // a check for the absence of the literal text would pass on a page that had
    // executed it.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders a reviewer's note as text and not as markup", async () => {
    // A contributor's account can be compromised, and a note is rendered to
    // every other reviewer. It gets the same treatment as the public field.
    const { container } = mount(
      contributor(),
      new FlagApiStub({
        mine: [],
        queue: [
          flag({
            status: "declined",
            reviewerNote: PAYLOAD,
            reviewedAt: "2026-09-02T09:00:00.000Z",
            reviewedBy: { id: "user-2", displayName: "A reviewer" },
          }),
        ],
      }),
    );

    expect(await screen.findByText(PAYLOAD)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders a display name as text and not as markup", async () => {
    // Chosen by its owner, carried onto every report they file, and rendered
    // beside it. The service accepts angle brackets in a name — refusing them
    // would be arbitrary — so escaping is what has to hold.
    //
    // Asserted against the document's text rather than with `findByText`,
    // because the name sits inline in a sentence: "Filed 1 Sep 2026 by …". The
    // element check underneath is the one that matters either way.
    const { container } = mount(
      contributor(),
      new FlagApiStub({
        mine: [],
        queue: [flag({ reporter: { id: "user-9", displayName: PAYLOAD } })],
      }),
    );

    await screen.findByText("Wookiee");

    expect(container.textContent).toContain(PAYLOAD);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders a target name as text and not as markup", async () => {
    const { container } = mount(
      contributor(),
      new FlagApiStub({
        mine: [],
        queue: [flag({ targetName: PAYLOAD })],
      }),
    );

    expect(await screen.findByText(PAYLOAD)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("says who filed a report that outlived its account", async () => {
    mount(
      contributor(),
      new FlagApiStub({
        mine: [],
        queue: [flag({ reporter: { id: "gone", displayName: null } })],
      }),
    );

    // Not a blank space, and not the account identifier — which is neither
    // readable nor anybody's business.
    expect(await screen.findByText(/a removed account/i)).toBeInTheDocument();
  });

  /**
   * The rule that has to hold forever, checked against the source.
   *
   * Every assertion above is about what this build renders today. This one is
   * about what the next change is allowed to do: the moment somebody reaches
   * for `dangerouslySetInnerHTML` on this page, or routes a report through the
   * site's Markdown renderer to make links clickable, every test above still
   * passes and the hole is open.
   */
  it("has no route from untrusted text into markup", () => {
    // Assembled rather than written out, so that this file does not contain
    // the very string it is searching for. The search is a plain substring
    // match on purpose: it catches the prop appearing in a comment, which is
    // where it lands first when somebody is about to reach for it.
    const escapeHatch = "dangerously" + "SetInnerHTML";

    for (const file of [
      "app/routes/account-flags.tsx",
      "app/components/report-control.tsx",
    ]) {
      const source = readFileSync(path.resolve(file), "utf8");

      expect(source, `${file} must never render untrusted text as markup`)
        .not.toContain(escapeHatch);

      // The site's Markdown renderer is the other way in. It exists to turn
      // reviewed content into elements; a report is not reviewed content.
      expect(source).not.toMatch(/from "~\/content\/markdown"/);
      expect(source).not.toContain("<Prose");
    }
  });
});

describe("working the queue", () => {
  it("offers only the moves the lifecycle allows", async () => {
    mount(
      contributor(),
      new FlagApiStub({ mine: [], queue: [flag({ status: "declined" })] }),
    );

    const row = (await screen.findByText("Wookiee")).closest("li");
    expect(row).not.toBeNull();

    // Declined straight to resolved would claim work was done on something a
    // reviewer had just said needed none. The service refuses it; this is the
    // client not offering a button that answers 409.
    expect(within(row!).getByRole("button", { name: /reopen/i })).toBeInTheDocument();
    expect(within(row!).queryByRole("button", { name: /^resolved$/i })).toBeNull();
  });

  it("records a decision through the service rather than only in the page", async () => {
    const { flags } = mount(
      contributor(),
      new FlagApiStub({ mine: [], queue: [flag({ id: "flag-7", status: "open" })] }),
    );

    // Scoped to the row. "Accepted" is also one of the queue's own view
    // filters, and a click on the wrong one would pass this test by doing
    // nothing.
    const row = (await screen.findByText("Wookiee")).closest("li");
    await userEvent.click(
      within(row!).getByRole("button", { name: /^accepted$/i }),
    );

    await waitFor(() =>
      expect(flags.lastCall("PUT", "/api/flags/flag-7/status")).toBeDefined(),
    );

    expect(flags.lastCall("PUT", "/api/flags/flag-7/status")?.body).toMatchObject({
      status: "accepted",
    });
  });

  it("tells a reviewer when somebody else got there first", async () => {
    mount(
      contributor(),
      new FlagApiStub({
        mine: [],
        queue: [flag({ id: "flag-7", status: "open" })],
        replies: {
          "PUT /api/flags/flag-7/status": {
            status: 409,
            body: {
              title: "That is not a move this report can make",
              detail: "This report is declined.",
              code: "invalid-transition",
              status: "declined",
            },
          },
        },
      }),
    );

    const row = (await screen.findByText("Wookiee")).closest("li");
    await userEvent.click(
      within(row!).getByRole("button", { name: /^accepted$/i }),
    );

    // Two reviewers working one queue is the normal case, not an error state.
    // A page that showed nothing here would look broken.
    expect(await screen.findByText(/reload to see where it got to/i)).toBeInTheDocument();
  });

  it("filters by reason, which is what stops one pile burying another", async () => {
    const { flags } = mount(
      contributor(),
      new FlagApiStub({
        mine: [],
        queue: [flag()],
        summary: {
          total: 151,
          outstanding: 151,
          byStatus: [
            { key: "open", count: 151 },
            { key: "accepted", count: 0 },
            { key: "declined", count: 0 },
            { key: "resolved", count: 0 },
          ],
          byReason: [
            { key: "image-attribution-missing", count: 150 },
            { key: "text-error", count: 1 },
          ],
          mostFlagged: [],
        },
      }),
    );

    // The failure this defends against: a hundred and fifty attribution reports
    // and one typo, in date order, on a page nobody reaches the bottom of.
    const typos = await screen.findByRole("button", {
      name: /typo or a formatting mistake/i,
    });

    await userEvent.click(typos);

    await waitFor(() => {
      const asked = flags.calls.filter((call) =>
        call.path.startsWith("/api/flags?"),
      );
      expect(
        asked.some((call) => call.path.includes("reason=text-error")),
      ).toBe(true);
    });
  });
});
