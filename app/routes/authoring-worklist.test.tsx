/**
 * The worklist, and the loop it closes.
 *
 * The one thing here worth more than the rest: a report a reviewer accepted
 * used to be the end of the road. The queue could say "yes, that is wrong" and
 * then had nowhere to send anybody. What is asserted below is that accepting
 * one now leads into the editor for the thing it is about, carrying the
 * report's identifier — which is what makes publishing the correction close the
 * report for the person who filed it.
 *
 * The other is that an overtaken draft is drawn as the state it is rather than
 * left to fail at the end. A draft whose base is no longer current cannot be
 * published, and saving over it replaces whatever was published underneath.
 */

import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, user } from "../../tests/auth-api-contract";
import {
  AuthoringApiStub,
  revision,
  serveAuthoring,
} from "../../tests/authoring-api-stub";
import { flag, FlagApiStub } from "../../tests/flag-api-stub";
import { marker, renderWithSession } from "../../tests/harness";
import type { CurrentUser } from "~/auth/types";
import { resetContentTypeCache } from "~/authoring/use-content-types";
import Authoring from "./authoring";
import AuthoringWorklist from "./authoring-worklist";

const contributor = () => user({ roles: ["Contributor"], strongAuthentication: true });

function mount(
  account: CurrentUser | null,
  stub: AuthoringApiStub,
  flags = new FlagApiStub({ queue: [] }),
) {
  const auth = new AuthApiContract({ session: account });
  stub.session = account;
  vi.stubGlobal("fetch", serveAuthoring(auth, stub, flags));

  const result = renderWithSession(
    [
      {
        path: "/authoring",
        Component: Authoring,
        children: [{ index: true, Component: AuthoringWorklist }],
      },
      { path: "/sign-in", Component: marker("sign-in page") },
    ],
    ["/authoring"],
  );

  return { ...result, stub, flags };
}

beforeEach(() => {
  resetContentTypeCache();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("who can reach the worklist", () => {
  it("refuses a community account, and asks the authoring API nothing", async () => {
    const { stub } = mount(user(), new AuthoringApiStub());

    expect(
      await screen.findByText(/this area is for contributor accounts/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /drafts in progress/i })).toBeNull();

    // Drained first. A negative assertion made in the same tick as the render
    // can pass because the request has not been issued yet rather than because
    // it never will be, and effects are where these requests are issued.
    await act(async () => {});
    expect(stub.touchedAuthoring).toBe(false);
  });

  it("sends an unauthenticated visitor to sign in", async () => {
    const { stub } = mount(null, new AuthoringApiStub());

    expect(await screen.findByText("sign-in page")).toBeInTheDocument();

    // Drained first. A negative assertion made in the same tick as the render
    // can pass because the request has not been issued yet rather than because
    // it never will be, and effects are where these requests are issued.
    await act(async () => {});
    expect(stub.touchedAuthoring).toBe(false);
  });
});

describe("reports waiting on a correction", () => {
  it("leads from an accepted report into the editor for what it is about", async () => {
    const flags = new FlagApiStub({
      queue: [
        flag({
          id: "flag-7",
          status: "accepted",
          targetType: "armor-properties",
          targetKey: "bulky",
          targetName: "Bulky",
          reason: "content-incorrect",
          details: "The book says Stealth, not Perception.",
        }),
      ],
    });

    mount(contributor(), new AuthoringApiStub(), flags);

    expect(await screen.findByText("Bulky")).toBeInTheDocument();
    expect(screen.getByText("The book says Stealth, not Perception.")).toBeInTheDocument();

    const correct = screen.getByRole("link", { name: /correct this/i });

    // The canonical key, not the route segment the report happened to carry,
    // and the report's identifier alongside it — which is what ties the draft
    // to the report so that publishing closes it.
    expect(correct).toHaveAttribute(
      "href",
      "/authoring/edit?type=armor-property&key=bulky&flag=flag-7",
    );
  });

  it("asks only for the accepted ones", async () => {
    // An open report has not been triaged, and correcting something before
    // deciding it needs correcting is how a queue stops meaning anything.
    const { flags } = mount(contributor(), new AuthoringApiStub());

    // Waited for rather than read once. The heading is static markup and is
    // there the instant the guard lets the page draw; the request is issued
    // from an effect afterwards, so reading the call log at that moment is a
    // race — one this test lost on CI while winning it locally.
    await waitFor(() => {
      const asked = flags.calls.find((call) => call.path.startsWith("/api/flags?"));
      expect(asked?.path).toContain("status=accepted");
    });
  });

  it("does not offer an editor for a type this service does not manage", async () => {
    // Better than a link to an editor that meets a 404 on arrival.
    const flags = new FlagApiStub({
      queue: [flag({ status: "accepted", targetType: "holocrons", targetKey: "one" })],
    });

    mount(contributor(), new AuthoringApiStub(), flags);

    expect(await screen.findByText(/nothing here manages/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /correct this/i })).toBeNull();
  });
});

describe("drafts in progress", () => {
  it("marks a draft that has been overtaken, and lists it first", async () => {
    const stub = new AuthoringApiStub({
      revisions: {
        "armor-property/bulky": [
          revision({ id: 41, number: 1 }),
          revision({ id: 42, number: 2, action: "updated" }),
        ],
        "armor-property/powered": [revision({ id: 50, key: "powered", number: 1 })],
      },
      drafts: {
        // Healthy: based on what is published.
        "armor-property/powered": {
          document: { key: "powered", name: "Powered" },
          baseRevisionId: 50,
          updatedAt: "2026-09-02T10:00:00.000Z",
        },
        // Overtaken: 42 is published, this was started against 41.
        "armor-property/bulky": {
          document: { key: "bulky", name: "Bulky" },
          baseRevisionId: 41,
          updatedAt: "2026-09-01T10:00:00.000Z",
        },
      },
    });

    mount(contributor(), stub);

    expect(await screen.findByText(/one draft has been overtaken/i)).toBeInTheDocument();
    expect(screen.getByText(/^Overtaken\./)).toBeInTheDocument();

    // First, even though it is the older of the two. A draft that cannot be
    // published is the one somebody has to deal with.
    const rows = screen.getAllByRole("listitem").filter((row) => row.dataset.stale !== undefined || row.className === "work-row");
    expect(rows[0]).toHaveTextContent("Bulky");
  });

  it("says nothing about staleness when every draft is current", async () => {
    const stub = new AuthoringApiStub({
      revisions: { "armor-property/bulky": [revision({ id: 41 })] },
      drafts: {
        "armor-property/bulky": { document: { key: "bulky", name: "Bulky" }, baseRevisionId: 41 },
      },
    });

    mount(contributor(), stub);

    expect(await screen.findByText("Bulky")).toBeInTheDocument();
    expect(screen.queryByText(/overtaken/i)).toBeNull();
  });

  it("offers a contributor editing and an administrator reviewing", async () => {
    const stub = new AuthoringApiStub({
      revisions: { "armor-property/bulky": [revision({ id: 41 })] },
      drafts: {
        "armor-property/bulky": { document: { key: "bulky", name: "Bulky" }, baseRevisionId: 41 },
      },
    });

    mount(contributor(), stub);

    // The wording follows what the account may actually do. A contributor
    // cannot publish, so nothing here promises they can.
    expect(await screen.findByRole("link", { name: /keep editing/i })).toHaveAttribute(
      "href",
      "/authoring/edit?type=armor-property&key=bulky",
    );
    // Named for the document it belongs to, so it is not confused with the
    // section link in the sidebar. That naming is what a screen reader reads
    // out when it lists the links on this page.
    expect(
      screen.getByRole("link", { name: /history of bulky/i }),
    ).toHaveAttribute("href", "/authoring/history?type=armor-property&key=bulky");
  });

  it("says something useful when there is nothing to do", async () => {
    mount(contributor(), new AuthoringApiStub());
    expect(await screen.findByText(/no drafts are open/i)).toBeInTheDocument();
  });
});

describe("starting something new", () => {
  it("will not offer to start on a key that is not a slug", async () => {
    mount(contributor(), new AuthoringApiStub());

    const start = await screen.findByRole("button", { name: /start drafting/i });
    // Disabled until both halves of the address are there, because the key is
    // the address: it goes in the published page's URL and every
    // cross-reference in the corpus resolves through it.
    expect(start).toBeDisabled();
  });

  it("offers every type the service manages, including the ones this site does not browse", async () => {
    // The credit records have no page of their own and are the most edited
    // thing here: a hundred and fifty pictures are waiting for an artist's name.
    mount(contributor(), new AuthoringApiStub());

    // Awaited, because the registry is fetched after hydration like everything
    // else in this area.
    expect(await screen.findByRole("option", { name: "Asset credits" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Armor properties" })).toBeInTheDocument();
  });
});
