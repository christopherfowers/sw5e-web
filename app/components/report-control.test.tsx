/**
 * The control that lets a reader say something is wrong.
 *
 * What is worth asserting here is not that a form submits. It is that the
 * control is invisible until asked for, that an anonymous reader is offered a
 * way in rather than a broken form, that the menu of reasons matches what is
 * being reported, and that the request carries the document the reader was
 * actually looking at — because a report that names the wrong document is worse
 * than no report at all.
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, user } from "../../tests/auth-api-contract";
import { FlagApiStub, serveBoth } from "../../tests/flag-api-stub";
import { renderWithSession } from "../../tests/harness";
import { ReportControl, type ReportTarget } from "./report-control";

const PAGE: ReportTarget = {
  kind: "document",
  type: "species",
  key: "wookiee",
  name: "Wookiee",
};

const PICTURE: ReportTarget = {
  kind: "image",
  type: "asset-credit",
  key: "species-wookiee",
  name: "Wookiee",
};

function mount(
  target: ReportTarget,
  { signedIn = true, flags = new FlagApiStub() } = {},
) {
  const auth = new AuthApiContract({ session: signedIn ? user() : null });
  vi.stubGlobal("fetch", serveBoth(auth, flags));

  const result = renderWithSession(
    [
      { path: "/species/wookiee", Component: () => <ReportControl target={target} /> },
      { path: "/sign-in", Component: () => <p>sign-in page</p> },
    ],
    ["/species/wookiee"],
  );

  return { ...result, flags };
}

function open() {
  return userEvent.click(screen.getByRole("button", { name: /report a problem/i }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("staying out of the way", () => {
  it("shows nothing but a collapsed control until it is asked for", async () => {
    mount(PAGE);

    const trigger = await screen.findByRole("button", { name: /report a problem/i });

    // This is a reference people read at the table. A form sitting open under
    // every page would be a moderation tool with a reference attached.
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("names what it is attached to, so two on one page are told apart", async () => {
    // A species page carries this control twice — once for the page, once for
    // its portrait. A screen-reader user listing the buttons would otherwise
    // hear "Report a problem" twice with nothing between them.
    mount(PICTURE);

    expect(
      await screen.findByRole("button", {
        name: /report a problem with the picture of Wookiee/i,
      }),
    ).toBeInTheDocument();
  });
});

describe("a reader who is not signed in", () => {
  it("is offered a way in rather than a form that cannot work", async () => {
    mount(PAGE, { signedIn: false });

    await open();

    const link = await screen.findByRole("link", { name: /sign in/i });

    // And the link remembers where they were, so they come back to the page
    // they were reporting rather than to their account.
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining(encodeURIComponent("/species/wookiee")),
    );

    // No form at all: an anonymous reader must not be able to write out a
    // report and then be told it could not be sent.
    expect(screen.queryByRole("radio")).toBeNull();
  });
});

describe("choosing a reason", () => {
  it("offers only the reasons that make sense for a picture", async () => {
    mount(PICTURE);
    await open();

    expect(
      await screen.findByRole("radio", { name: /I know who made this picture/i }),
    ).toBeInTheDocument();

    // "This does not match the book" is not a statement anybody can make about
    // a portrait, and the service refuses it. Offering it would collect reports
    // that are refused after being written.
    expect(screen.queryByRole("radio", { name: /does not match the book/i })).toBeNull();
  });

  it("offers only the reasons that make sense for a page", async () => {
    mount(PAGE);
    await open();

    expect(
      await screen.findByRole("radio", { name: /typo or a formatting mistake/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /who made this picture/i })).toBeNull();
  });

  it("asks for nothing until a reason is chosen, and cannot be sent empty", async () => {
    mount(PAGE);
    await open();

    await screen.findByRole("radio", { name: /typo or a formatting mistake/i });

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: /send report/i })).toBeDisabled();
  });
});

describe("filing", () => {
  it("sends the reason and the document the reader was looking at", async () => {
    const { flags } = mount(PAGE);
    await open();

    await userEvent.click(
      await screen.findByRole("radio", { name: /typo or a formatting mistake/i }),
    );
    await userEvent.type(
      screen.getByRole("textbox"),
      "The second sentence is missing a full stop.",
    );
    await userEvent.click(screen.getByRole("button", { name: /send report/i }));

    await waitFor(() => expect(flags.lastCall("POST", "/api/flags")).toBeDefined());

    // The whole value of putting this on the page is that the report names the
    // page. A control that sent the reader's typed description of where they
    // were would collect "one of the species pages".
    expect(flags.lastCall("POST", "/api/flags")?.body).toEqual({
      reason: "text-error",
      targetType: "species",
      targetKey: "wookiee",
      details: "The second sentence is missing a full stop.",
    });
  });

  it("reports a picture through its attribution record", async () => {
    const { flags } = mount(PICTURE);
    await open();

    await userEvent.click(
      await screen.findByRole("radio", { name: /I know who made this picture/i }),
    );
    await userEvent.type(screen.getByRole("textbox"), "Drawn by A. Ordo in 2017.");
    await userEvent.click(screen.getByRole("button", { name: /send report/i }));

    await waitFor(() => expect(flags.lastCall("POST", "/api/flags")).toBeDefined());

    // `asset-credit` and `{group}-{key}` — the record a reviewer edits to write
    // the credit. Anything else would file a report against the document that
    // cannot resolve it.
    expect(flags.lastCall("POST", "/api/flags")?.body).toMatchObject({
      reason: "image-artist-known",
      targetType: "asset-credit",
      targetKey: "species-wookiee",
    });
  });

  it("sends null rather than an empty string when nothing was written", async () => {
    const { flags } = mount(PAGE);
    await open();

    await userEvent.click(
      await screen.findByRole("radio", { name: /typo or a formatting mistake/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /send report/i }));

    await waitFor(() => expect(flags.lastCall("POST", "/api/flags")).toBeDefined());

    expect(flags.lastCall("POST", "/api/flags")?.body).toMatchObject({ details: null });
  });

  it("says where the report went, rather than only that it went", async () => {
    mount(PAGE);
    await open();

    await userEvent.click(
      await screen.findByRole("radio", { name: /typo or a formatting mistake/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /send report/i }));

    // Reporting into a void is something people do once. The confirmation
    // points at the page where they can see what happened to it.
    const confirmation = await screen.findByRole("status");
    expect(confirmation).toHaveTextContent(/filed/i);
    expect(screen.getByRole("link", { name: /your reports/i })).toHaveAttribute(
      "href",
      "/account/flags",
    );
  });

  it("explains a duplicate instead of reporting it as a failure", async () => {
    const { flags } = mount(PAGE, {
      flags: new FlagApiStub({
        replies: {
          "POST /api/flags": {
            status: 409,
            body: {
              title: "You have already reported this",
              detail: "You have an open report of the same kind against this.",
              code: "duplicate-report",
            },
          },
        },
      }),
    });

    await open();
    await userEvent.click(
      await screen.findByRole("radio", { name: /typo or a formatting mistake/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /send report/i }));

    // A double-click must not read as "that did not work". Nothing was lost,
    // and the copy has to say so.
    expect(await screen.findByText(/already reported this/i)).toBeInTheDocument();
    expect(flags.calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("shows the server's own explanation when a report is refused", async () => {
    mount(PAGE, {
      flags: new FlagApiStub({
        replies: {
          "POST /api/flags": {
            status: 429,
            body: {
              title: "Too many reports",
              detail: "You have filed as many reports as one account may in a day.",
              code: "report-quota",
            },
          },
        },
      }),
    });

    await open();
    await userEvent.click(
      await screen.findByRole("radio", { name: /typo or a formatting mistake/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /send report/i }));

    // The service knows which of two limits was reached; paraphrasing would
    // lose that, and "something went wrong" is advice nobody can act on.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /as many reports as one account may in a day/i,
    );
  });
});
