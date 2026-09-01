/**
 * The flagging client, tested at the network boundary.
 *
 * The same reasoning as `app/auth/api.test.ts`: everything asserted here is
 * invisible in the UI and expensive to get wrong. A filter sent as an empty
 * string rather than omitted is a 400 the reviewer meets instead of a queue; a
 * report whose body names the wrong field is a 400 the reader meets after
 * writing out what they wanted to say.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "~/api/http";
import { flagSummary, listFlags, listOwnFlags, raiseFlag, updateFlagStatus } from "./api";

interface Recorded {
  url: string;
  init: RequestInit;
}

function recordFetch(reply: () => Response) {
  const calls: Recorded[] = [];

  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(reply());
  });

  return calls;
}

function ok(body: unknown, status = 200) {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
}

function problem(status: number, body: unknown) {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/problem+json" },
    });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("filing a report", () => {
  it("posts the reason and the target, and nothing else", async () => {
    const calls = recordFetch(ok({ id: "flag-1" }, 201));

    await raiseFlag({
      reason: "image-artist-known",
      targetType: "asset-credit",
      targetKey: "species-wookiee",
      details: "Drawn by A. Ordo.",
    });

    expect(calls[0].url).toBe("/api/flags");
    expect(calls[0].init.method).toBe("POST");

    // No `targetKind`. The server derives it from the reason, and a client
    // that also sent it would be a client that could contradict itself.
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      reason: "image-artist-known",
      targetType: "asset-credit",
      targetKey: "species-wookiee",
      details: "Drawn by A. Ordo.",
    });
  });

  it("sends the session cookie and stays on this origin", async () => {
    const calls = recordFetch(ok({ id: "flag-1" }, 201));

    await raiseFlag({
      reason: "text-error",
      targetType: "species",
      targetKey: "wookiee",
    });

    // Relative, so `connect-src 'self'` can stay closed, and `same-origin`
    // rather than `include`, so credentials stop travelling the moment a path
    // here ever stops being relative.
    expect(calls[0].url.startsWith("/api/")).toBe(true);
    expect(calls[0].init.credentials).toBe("same-origin");
    expect(calls[0].init.redirect).toBe("error");
  });

  it("sends no CSRF token, because the service does not use one", async () => {
    const calls = recordFetch(ok({ id: "flag-1" }, 201));

    await raiseFlag({ reason: "text-error", targetType: "species", targetKey: "wookiee" });

    const headers = calls[0].init.headers as Record<string, string>;

    // The API checks provenance with `Origin` and `Sec-Fetch-Site`, both of
    // which the browser writes and script cannot forge. A readable token here
    // would hand JavaScript a credential to look after and buy nothing.
    expect(Object.keys(headers).sort()).toEqual(["Accept", "Content-Type"]);
  });

  it("surfaces a duplicate as a conflict the caller can branch on", async () => {
    recordFetch(
      problem(409, {
        title: "You have already reported this",
        detail: "You have an open report of the same kind against this.",
        code: "duplicate-report",
      }),
    );

    const error = await raiseFlag({
      reason: "text-error",
      targetType: "species",
      targetKey: "wookiee",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("conflict");
    expect((error as ApiError).code).toBe("duplicate-report");
  });

  it("carries the server's field error through", async () => {
    recordFetch(
      problem(400, {
        title: "That report could not be filed",
        detail: "Tell us what the problem is.",
        fieldErrors: { details: "Tell us what the problem is." },
      }),
    );

    const error = (await raiseFlag({
      reason: "other",
      targetType: "species",
      targetKey: "wookiee",
    }).catch((caught: unknown) => caught)) as ApiError;

    // The form puts the message beside the control that produced it, which it
    // can only do if the field name survives the trip.
    expect(error.fieldErrors.details).toBe("Tell us what the problem is.");
  });

  it("reports a quota refusal as rate limiting, not as a bad request", async () => {
    recordFetch(
      problem(429, {
        title: "Too many reports",
        detail: "You have filed as many reports as one account may in a day.",
        code: "report-quota",
      }),
    );

    const error = (await raiseFlag({
      reason: "text-error",
      targetType: "species",
      targetKey: "wookiee",
    }).catch((caught: unknown) => caught)) as ApiError;

    expect(error.kind).toBe("rate-limited");
    expect(error.message).toContain("as one account may in a day");
  });
});

describe("the queue", () => {
  it("asks for the outstanding reports by sending no status at all", async () => {
    const calls = recordFetch(ok({ flags: [], page: 1, pageSize: 25, totalCount: 0, totalPages: 0 }));

    await listFlags();

    // The service decides what "outstanding" means. A client that named the
    // states here would silently stop agreeing with it the day a fifth one is
    // added.
    expect(calls[0].url).toBe("/api/flags");
  });

  it("omits an empty filter rather than sending it empty", async () => {
    const calls = recordFetch(ok({ flags: [], page: 1, pageSize: 25, totalCount: 0, totalPages: 0 }));

    await listFlags({ status: undefined, reason: "", targetType: "species" });

    // The service refuses a value it does not recognise rather than ignoring
    // it, which is the behaviour this client wants — and is exactly why an
    // empty string must never be sent as one.
    expect(calls[0].url).toBe("/api/flags?targetType=species");
  });

  it("passes the filters it was given, and only those", async () => {
    const calls = recordFetch(ok({ flags: [], page: 1, pageSize: 25, totalCount: 0, totalPages: 0 }));

    await listFlags({ status: "all", reason: "image-artist-known" });

    const query = new URL(calls[0].url, "https://sw5e.test").searchParams;

    expect(query.get("status")).toBe("all");
    expect(query.get("reason")).toBe("image-artist-known");
    expect([...query.keys()].sort()).toEqual(["reason", "status"]);
  });

  it("reads the summary from its own route", async () => {
    const calls = recordFetch(
      ok({ total: 0, outstanding: 0, byStatus: [], byReason: [], mostFlagged: [] }),
    );

    await flagSummary();

    expect(calls[0].url).toBe("/api/flags/summary");
  });

  it("reads a reporter's own list from a different route than the queue", async () => {
    const calls = recordFetch(ok({ flags: [], page: 1, pageSize: 25, totalCount: 0, totalPages: 0 }));

    await listOwnFlags();

    // A separate route rather than a query parameter on the queue, so the two
    // audiences are not one typo apart.
    expect(calls[0].url).toBe("/api/flags/mine");
  });
});

describe("moving a report", () => {
  it("puts the status, and sends a null note rather than omitting it", async () => {
    const calls = recordFetch(ok({ id: "flag-1", status: "accepted" }));

    await updateFlagStatus("flag-1", "accepted");

    expect(calls[0].url).toBe("/api/flags/flag-1/status");
    expect(calls[0].init.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      status: "accepted",
      note: null,
    });
  });

  it("percent-encodes the identifier into the path", async () => {
    const calls = recordFetch(ok({ id: "x", status: "open" }));

    // A server-issued GUID today. A value that reaches a URL should never
    // depend on that staying true.
    await updateFlagStatus("../../auth/logout", "open");

    expect(calls[0].url).toBe("/api/flags/..%2F..%2Fauth%2Flogout/status");
  });

  it("names a lost race as one rather than as a generic conflict", async () => {
    recordFetch(
      problem(409, {
        title: "That is not a move this report can make",
        detail: "This report is declined, and declined to resolved is not allowed.",
        code: "invalid-transition",
        status: "declined",
      }),
    );

    const error = (await updateFlagStatus("flag-1", "resolved").catch(
      (caught: unknown) => caught,
    )) as ApiError;

    expect(error.code).toBe("invalid-transition");
  });
});
