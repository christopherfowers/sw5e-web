/**
 * The API client, tested at the network boundary.
 *
 * Every assertion here is about something invisible in the UI and expensive to
 * get wrong: whether credentials travel, whether the CSRF token is echoed,
 * whether a 401 means "signed out" or "broken", and whether a static host's
 * HTML error page can be mistaken for an API response.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  getCurrentUser,
  logout,
  readCsrfToken,
  register,
  removePasskey,
} from "./api";

interface RecordedRequest {
  url: string;
  init: RequestInit;
}

function respond(
  body: unknown,
  { status = 200, contentType = "application/json" as string | null } = {},
) {
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers,
  });
}

function recordFetch(reply: () => Response) {
  const calls: RecordedRequest[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(reply());
  });
  return calls;
}

function setCsrfCookie(value: string) {
  document.cookie = `sw5e_csrf=${value}; path=/`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfCookie("");
});

describe("request wiring", () => {
  it("sends same-origin credentials so the session cookie travels", async () => {
    const calls = recordFetch(() => respond({ user: null }, { status: 401 }));

    await getCurrentUser();

    expect(calls[0]?.init.credentials).toBe("same-origin");
  });

  it("addresses the API relatively, so connect-src can stay at 'self'", async () => {
    const calls = recordFetch(() => respond({ user: null }, { status: 401 }));

    await getCurrentUser();

    expect(calls[0]?.url).toBe("/api/auth/me");
    expect(calls[0]?.url.startsWith("http")).toBe(false);
  });

  it("echoes the CSRF cookie back as a header on a state-changing request", async () => {
    setCsrfCookie("token-abc");
    const calls = recordFetch(() => respond({ status: "verification-sent" }));

    await register({ email: "a@example.com", displayName: "A" });

    expect(new Headers(calls[0]?.init.headers).get("x-csrf-token")).toBe("token-abc");
  });

  it("does not send a CSRF header on a read, which changes nothing", async () => {
    setCsrfCookie("token-abc");
    const calls = recordFetch(() => respond({ user: null }, { status: 401 }));

    await getCurrentUser();

    expect(new Headers(calls[0]?.init.headers).get("x-csrf-token")).toBeNull();
  });

  it("refuses to follow a redirect off this origin", async () => {
    const calls = recordFetch(() => respond({ user: null }, { status: 401 }));

    await getCurrentUser();

    expect(calls[0]?.init.redirect).toBe("error");
  });

  it("percent-encodes a credential id into the path", async () => {
    setCsrfCookie("token-abc");
    const calls = recordFetch(() => respond({ status: "removed" }));

    await removePasskey("a/b?c");

    expect(calls[0]?.url).toBe("/api/auth/passkey/a%2Fb%3Fc");
  });
});

describe("readCsrfToken", () => {
  it("finds the token among other cookies", () => {
    document.cookie = "other=1; path=/";
    setCsrfCookie("token-xyz");

    expect(readCsrfToken()).toBe("token-xyz");
  });

  it("is null when the server has not set one", () => {
    setCsrfCookie("");

    expect(readCsrfToken()).toBeNull();
  });
});

describe("getCurrentUser", () => {
  it("returns null for a 401, which is the API's way of saying signed out", async () => {
    recordFetch(() => respond({ code: "unauthenticated" }, { status: 401 }));

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("throws rather than returning null when the service is unreachable", async () => {
    // The distinction the whole session state machine rests on: an outage must
    // not be indistinguishable from a sign-out, or a network blip logs
    // everybody out.
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("failed")));

    await expect(getCurrentUser()).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("treats an HTML response as the service being absent, not as a session", async () => {
    // What a static host answers with when the API is not mounted: a 200 whose
    // body is the SPA shell. Parsed as JSON it would throw somewhere useless.
    recordFetch(() =>
      new Response("<!doctype html><title>404</title>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(getCurrentUser()).rejects.toMatchObject({ kind: "unavailable" });
  });
});

describe("error decoding", () => {
  it("carries the server's message and field errors through", async () => {
    setCsrfCookie("token-abc");
    recordFetch(() =>
      respond(
        {
          code: "invalid",
          message: "That address is not usable.",
          fieldErrors: { email: "Use a work address." },
        },
        { status: 422 },
      ),
    );

    const error = await register({ email: "x", displayName: "y" }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("That address is not usable.");
    expect((error as ApiError).fieldErrors.email).toBe("Use a work address.");
    expect((error as ApiError).kind).toBe("invalid");
  });

  it("supplies its own wording when the server sends none", async () => {
    setCsrfCookie("token-abc");
    recordFetch(() => respond({}, { status: 429 }));

    const error = await register({ email: "a@b.co", displayName: "A" }).catch(
      (thrown: unknown) => thrown,
    );

    expect((error as ApiError).kind).toBe("rate-limited");
    expect((error as ApiError).message).toMatch(/too many attempts/i);
  });

  it("maps 403 to forbidden rather than to signed out", async () => {
    setCsrfCookie("token-abc");
    recordFetch(() => respond({ code: "csrf" }, { status: 403 }));

    const error = await register({ email: "a@b.co", displayName: "A" }).catch(
      (thrown: unknown) => thrown,
    );

    expect((error as ApiError).kind).toBe("forbidden");
  });
});

describe("logout", () => {
  it("accepts a 204 with no body", async () => {
    setCsrfCookie("token-abc");
    recordFetch(() => new Response(null, { status: 204 }));

    await expect(logout()).resolves.toBeUndefined();
  });
});
