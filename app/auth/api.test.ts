/**
 * The API client, tested at the network boundary.
 *
 * Every assertion here is about something invisible in the UI and expensive to
 * get wrong: whether credentials travel, whether a 401 means "signed out" or
 * "broken", whether the server's own explanation reaches the reader, and
 * whether a static host's HTML error page can be mistaken for an API response.
 *
 * The error-decoding tests carry more weight than they look like they should.
 * This API answers its failures as RFC 9457 problem documents — content type
 * `application/problem+json`, message in `detail` — and answers two of its most
 * common refusals with no body at all. A client written for
 * `application/json` and `message` misreads every one of them, and misreads
 * them as "the service is unreachable", which is the one failure a reader is
 * told to wait out rather than act on.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  assignRoles,
  beginPasskeyLogin,
  completePasskeyRegistration,
  getCurrentUser,
  logout,
  register,
  removePasskey,
  requestSignInCode,
  STRONG_AUTHENTICATION_REQUIRED,
  verifyEmail,
  verifySignInCode,
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

/** A refusal with no content type and no body, which is how this API sends several. */
function bodiless(status: number) {
  return new Response(null, { status });
}

function recordFetch(reply: () => Response) {
  const calls: RecordedRequest[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(reply());
  });
  return calls;
}

/** Every header the client actually put on the wire, flattened for assertions. */
function headerNames(call: RecordedRequest | undefined): string[] {
  return [...new Headers(call?.init.headers).keys()];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request wiring", () => {
  it("sends same-origin credentials so the session cookie travels", async () => {
    const calls = recordFetch(() => bodiless(401));

    await getCurrentUser();

    expect(calls[0]?.init.credentials).toBe("same-origin");
  });

  it("addresses the API relatively, so connect-src can stay at 'self'", async () => {
    const calls = recordFetch(() => bodiless(401));

    await getCurrentUser();

    expect(calls[0]?.url).toBe("/api/auth/me");
    expect(calls[0]?.url.startsWith("http")).toBe(false);
    expect(calls[0]?.url.startsWith("//")).toBe(false);
  });

  it("refuses to follow a redirect off this origin", async () => {
    const calls = recordFetch(() => bodiless(401));

    await getCurrentUser();

    expect(calls[0]?.init.redirect).toBe("error");
  });

  it("percent-encodes a credential id into the path", async () => {
    const calls = recordFetch(() => respond({ status: "removed" }));

    await removePasskey("a/b?c");

    expect(calls[0]?.url).toBe("/api/auth/passkey/a%2Fb%3Fc");
  });
});

describe("cross-site protection", () => {
  /**
   * The API does not use double-submit. It checks `Origin` and
   * `Sec-Fetch-Site`, both of which the browser writes and neither of which
   * script can forge — so the correct client behaviour is to send nothing
   * extra. These tests pin that absence, because a token header is the thing
   * somebody reaches for when a 403 appears, and adding one here would be
   * inventing a credential for JavaScript to look after in exchange for
   * nothing.
   */
  it("sends no CSRF token on a state-changing request", async () => {
    const calls = recordFetch(() => respond({ status: "pending", message: "" }, { status: 202 }));

    await register({ email: "a@example.com", displayName: "A" });

    expect(new Headers(calls[0]?.init.headers).get("x-csrf-token")).toBeNull();
    expect(headerNames(calls[0]).join(" ")).not.toMatch(/csrf/i);
  });

  it("sends no CSRF token on a read either", async () => {
    const calls = recordFetch(() => bodiless(401));

    await getCurrentUser();

    expect(headerNames(calls[0]).join(" ")).not.toMatch(/csrf/i);
  });

  it("does not read a CSRF cookie that happens to be present", async () => {
    // A stray cookie from an older deployment must not change what is sent.
    document.cookie = "sw5e_csrf=left-over; path=/";
    const calls = recordFetch(() => respond({ status: "pending", message: "" }, { status: 202 }));

    await register({ email: "a@example.com", displayName: "A" });

    expect(headerNames(calls[0]).join(" ")).not.toMatch(/csrf/i);
    document.cookie = "sw5e_csrf=; path=/; max-age=0";
  });

  it("sends only the two headers it means to", async () => {
    const calls = recordFetch(() => respond({ status: "removed" }));

    await removePasskey("credential-one");

    // DELETE carries no body, so there is no content type to declare either.
    expect(headerNames(calls[0]).sort()).toEqual(["accept"]);
  });

  it("reports the server's bodiless 403 as forbidden, not as an outage", async () => {
    // What the cross-site filter actually answers: no body, no content type,
    // and no explanation of which header it disliked.
    recordFetch(() => bodiless(403));

    const error = await register({ email: "a@b.co", displayName: "A" }).catch(
      (thrown: unknown) => thrown,
    );

    expect((error as ApiError).kind).toBe("forbidden");
    expect((error as ApiError).status).toBe(403);
  });
});

describe("getCurrentUser", () => {
  it("reads the account straight off the body, with no envelope", async () => {
    recordFetch(() =>
      respond({
        id: "user-1",
        email: "reader@example.com",
        displayName: "Jen Ordo",
        roles: ["Community"],
        twoFactorEnabled: false,
        passkeys: [],
      }),
    );

    await expect(getCurrentUser()).resolves.toMatchObject({
      displayName: "Jen Ordo",
      twoFactorEnabled: false,
    });
  });

  it("returns null for a bodiless 401, which is what the cookie scheme sends", async () => {
    // The regression that mattered most. The anonymous challenge is written by
    // the authentication handler before any endpoint runs, so it carries no
    // problem document and no content type at all. A client that decided what
    // the failure was from the body treated every signed-out visitor as an
    // outage: no redirect to sign-in, and no way in from the header.
    recordFetch(() => bodiless(401));

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("returns null for a 401 that does carry a problem document", async () => {
    recordFetch(() =>
      respond(
        { title: "Unauthorized", status: 401, detail: "You are not signed in." },
        { status: 401, contentType: "application/problem+json" },
      ),
    );

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

  it("still treats an HTML 404 as the service being absent", async () => {
    // The partial-deploy case: nginx answering for a path the API should own.
    // A 404 is not an authentication answer, so the body still gets a say.
    recordFetch(() =>
      new Response("<!doctype html><title>Not found</title>", {
        status: 404,
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(getCurrentUser()).rejects.toMatchObject({ kind: "unavailable" });
  });
});

describe("error decoding", () => {
  it("surfaces `detail` from a problem+json document", async () => {
    // Both halves of this were wrong before: the content type does not contain
    // the substring "application/json", and the message is in `detail`. Either
    // mistake alone replaces the server's reason with a generic one.
    recordFetch(() =>
      respond(
        {
          type: "https://tools.ietf.org/html/rfc9110#section-15.5.1",
          title: "Invalid request",
          status: 400,
          detail: "That is not a valid email address.",
          traceId: "00-abc",
        },
        { status: 400, contentType: "application/problem+json" },
      ),
    );

    const error = await register({ email: "x", displayName: "y" }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("That is not a valid email address.");
    expect((error as ApiError).kind).toBe("invalid");
  });

  it("carries a code and field errors through", async () => {
    recordFetch(() =>
      respond(
        {
          code: "invalid",
          detail: "That address is not usable.",
          fieldErrors: { email: "Use a work address." },
        },
        { status: 422, contentType: "application/problem+json" },
      ),
    );

    const error = await register({ email: "x", displayName: "y" }).catch(
      (thrown: unknown) => thrown,
    );

    expect((error as ApiError).message).toBe("That address is not usable.");
    expect((error as ApiError).code).toBe("invalid");
    expect((error as ApiError).fieldErrors.email).toBe("Use a work address.");
  });

  it("falls back to `title` when a problem document has no detail", async () => {
    recordFetch(() =>
      respond(
        { title: "That conflicts with something already on the account.", status: 409 },
        { status: 409, contentType: "application/problem+json" },
      ),
    );

    const error = await removePasskey("a").catch((thrown: unknown) => thrown);

    expect((error as ApiError).message).toMatch(/conflicts with something/i);
  });

  it("supplies its own wording when the server sends none", async () => {
    recordFetch(() => respond({}, { status: 429, contentType: "application/problem+json" }));

    const error = await register({ email: "a@b.co", displayName: "A" }).catch(
      (thrown: unknown) => thrown,
    );

    expect((error as ApiError).kind).toBe("rate-limited");
    expect((error as ApiError).message).toMatch(/too many attempts/i);
  });

  it("maps a 409 with a code to a conflict the caller can branch on", async () => {
    // How the passkeys page tells "you cannot remove your last credential"
    // apart from any other conflict.
    recordFetch(() =>
      respond(
        { code: "last-credential", detail: "That is the only way you can sign in." },
        { status: 409, contentType: "application/problem+json" },
      ),
    );

    const error = await removePasskey("a").catch((thrown: unknown) => thrown);

    expect((error as ApiError).kind).toBe("conflict");
    expect((error as ApiError).code).toBe("last-credential");
  });

  it("tells the two 403s apart, because one of them is fixable", async () => {
    /*
     * A plain forbidden is the end of the conversation: the account does not
     * hold the role. This one is not — the account holds it, and the session
     * behind the request was simply established with an emailed code, so
     * enrolling a passkey or an authenticator app clears it in a minute. The
     * client can only draw that distinction if the code survives the decode,
     * and only shows the useful sentence if the server's `detail` survives it
     * too rather than being replaced by the generic default.
     */
    recordFetch(() =>
      respond(
        {
          code: STRONG_AUTHENTICATION_REQUIRED,
          detail:
            "This action needs a passkey or an authenticator app. Sign in again with one, or add one to your account.",
        },
        { status: 403, contentType: "application/problem+json" },
      ),
    );

    const error = await assignRoles("user-2", ["Contributor"]).catch(
      (thrown: unknown) => thrown,
    );

    expect((error as ApiError).kind).toBe("forbidden");
    expect((error as ApiError).code).toBe("strong-authentication-required");
    expect((error as ApiError).message).toMatch(/passkey or an authenticator app/i);
    expect((error as ApiError).message).not.toMatch(/does not have access/i);
  });

  it("maps 403 to forbidden rather than to signed out", async () => {
    recordFetch(() =>
      respond({ detail: "Administrators only." }, {
        status: 403,
        contentType: "application/problem+json",
      }),
    );

    const error = await assignRoles("user-2", ["Contributor"]).catch(
      (thrown: unknown) => thrown,
    );

    expect((error as ApiError).kind).toBe("forbidden");
  });
});

describe("request bodies", () => {
  function bodyOf(call: RecordedRequest | undefined): unknown {
    return JSON.parse(String(call?.init.body ?? "null"));
  }

  it("sends both halves of the verification link", async () => {
    // The token is scoped to the address it was issued for; either alone is
    // refused.
    const calls = recordFetch(() =>
      respond({ status: "verified", enrollmentExpiresAt: "2026-08-30T19:52:11Z" }),
    );

    await verifyEmail("reader@example.com", "tok");

    expect(bodyOf(calls[0])).toEqual({
      email: "reader@example.com",
      token: "tok",
    });
  });

  it("sends no body at all when starting a passkey sign-in", async () => {
    // The API ignores anything here and never accepts an address, so sending
    // one would imply the answer could differ per caller. It cannot.
    const calls = recordFetch(() => respond({ challenge: "c" }));

    await beginPasskeyLogin();

    expect(calls[0]?.init.body).toBeUndefined();
  });

  it("names the passkey with `name`, and sends null when unnamed", async () => {
    const calls = recordFetch(() =>
      respond({ credentialId: "c", name: null, createdAt: "2026-01-01T00:00:00Z" }, {
        status: 201,
      }),
    );
    const credential = { id: "c" } as never;

    await completePasskeyRegistration(credential);

    expect(bodyOf(calls[0])).toEqual({ credential: { id: "c" }, name: null });
  });

  it("puts the full desired role set, because the call is declarative", async () => {
    const calls = recordFetch(() =>
      respond({ userId: "user-2", roles: ["Community", "Contributor"] }),
    );

    await assignRoles("user-2", ["Contributor"]);

    expect(calls[0]?.init.method).toBe("PUT");
    expect(calls[0]?.url).toBe("/api/auth/admin/users/user-2/roles");
    expect(bodyOf(calls[0])).toEqual({ roles: ["Contributor"] });
  });

  it("asks for a sign-in code with the address and nothing else", async () => {
    const calls = recordFetch(() =>
      respond(
        {
          status: "pending",
          message: "If that address has an account, a sign-in code is on its way.",
          resendAfterSeconds: 60,
          expiresInSeconds: 600,
        },
        { status: 202 },
      ),
    );

    await requestSignInCode("reader@example.com");

    expect(calls[0]?.url).toBe("/api/auth/email/code");
    expect(calls[0]?.init.method).toBe("POST");
    expect(bodyOf(calls[0])).toEqual({ email: "reader@example.com" });
  });

  it("sends both halves when redeeming a sign-in code", async () => {
    // The code is issued *for* an address and the server checks the pair, so a
    // client that sent only the digits would be refused every time — and would
    // be indistinguishable, from the reader's side, from one sending a wrong
    // code.
    const calls = recordFetch(() =>
      respond({ status: "mfaRequired", user: null }),
    );

    await verifySignInCode("reader@example.com", "654321");

    expect(calls[0]?.url).toBe("/api/auth/email/code/verify");
    expect(bodyOf(calls[0])).toEqual({
      email: "reader@example.com",
      code: "654321",
    });
  });

  it("percent-encodes a user id into the admin path", async () => {
    const calls = recordFetch(() => respond({ userId: "a/b", roles: [] }));

    await assignRoles("a/b", ["Administrator"]);

    expect(calls[0]?.url).toBe("/api/auth/admin/users/a%2Fb/roles");
  });
});

describe("logout", () => {
  it("accepts a 204 with no body", async () => {
    recordFetch(() => new Response(null, { status: 204 }));

    await expect(logout()).resolves.toBeUndefined();
  });
});
