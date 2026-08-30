/**
 * The account client, run against the account API. The real one.
 *
 * Every other test in this repository answers the question "does this client
 * behave the way we think it should". This one answers the question that
 * actually went wrong: "is what we think the server says what the server
 * says".
 *
 * Both repositories were fully green while disagreeing about the envelope on
 * `/me`, the spelling of the MFA literal, the name of the passkey label field,
 * the capitalisation of every role, the path in the verification email, and the
 * content type of an error. Nothing failed, because this side was tested
 * against `tests/auth-api-contract.ts` — our own idea of the server — and the
 * server was tested against its own idea of us. Two mocks agreeing with the
 * code that wrote them is not evidence of anything.
 *
 * So this suite starts the published API image, points the real client module
 * at it, and asserts against the bytes that come back. It runs in CI as its own
 * job (`npm run test:contract`) and is skipped when `SW5E_CONTRACT_API` is not
 * set, so the ordinary unit suite stays fast and offline.
 *
 * The last block is the one that matters most: it replays the same requests
 * through `AuthApiContract` and compares the mock's answers to the server's. A
 * fixture that drifts from the service it stands in for is worse than no
 * fixture, because it makes a green suite mean the opposite of what it looks
 * like it means.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ApiError,
  beginPasskeyLogin,
  getCurrentUser,
  register,
  removePasskey,
  verifyEmail,
} from "../../app/auth/api";
import { AuthApiContract } from "../auth-api-contract";

const API = process.env.SW5E_CONTRACT_API;
const ORIGIN = process.env.SW5E_CONTRACT_ORIGIN ?? "http://localhost:4173";

/**
 * The client builds relative URLs on purpose — the site's CSP names no host,
 * and a test that let it build absolute ones would be testing a client we do
 * not ship. So the only thing stubbed here is the resolution of that relative
 * path against the API's origin, plus the `Origin` header a browser sets for
 * itself and script cannot forge.
 *
 * Everything downstream of the response — status handling, content-type
 * sniffing, problem-document decoding, the 401-means-anonymous rule — is the
 * shipped code running over real bytes.
 */
/**
 * The untouched platform `fetch`, captured once at module load.
 *
 * Deliberately not read inside {@link useRealApi}: calling that twice — which
 * the foreign-origin tests do — would otherwise wrap the previous wrapper, and
 * the inner one would overwrite the `Origin` the outer one had just set. The
 * cross-site tests then silently pass a well-formed same-origin request and
 * assert nothing at all.
 */
const platformFetch = globalThis.fetch;

function useRealApi(origin = ORIGIN): void {
  const realFetch = platformFetch;

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : String(input);
    const headers = new Headers(init?.headers);
    headers.set("Origin", origin);

    return realFetch(new URL(path, API), { ...init, headers, redirect: "manual" });
  }) as typeof fetch;
}

/** The  a browser would write for the page under test. */
const browserHeaders = (origin = ORIGIN) => new Headers({ Origin: origin });

const address = () => `contract-${Date.now()}-${Math.random().toString(36).slice(2)}@sw5e.test`;

describe.skipIf(!API)("the account client against the real API", () => {
  let restore: typeof globalThis.fetch;

  beforeAll(() => {
    restore = globalThis.fetch;
    useRealApi();
  });

  afterAll(() => {
    globalThis.fetch = restore;
  });

  describe("reading the session", () => {
    /**
     * The regression that mattered most. The API answers an anonymous caller
     * with a problem document, whose content type is `application/problem+json`
     * — which does not contain the substring `application/json`. A client
     * checking for that substring classifies the 401 as "the service is not
     * there" and tells every signed-out reader the site is broken instead of
     * offering them a way in.
     */
    it("reports no session rather than an outage", async () => {
      await expect(getCurrentUser()).resolves.toBeNull();
    });
  });

  describe("registration", () => {
    it("is accepted and answers without confirming anything", async () => {
      const response = await register({ email: address(), displayName: "Contract Probe" });

      expect(response.status).toBe("pending");
      expect(response.message.length).toBeGreaterThan(0);
    });

    /**
     * Proves the problem document is decoded, not merely survived: the message
     * the reader sees is the server's own `detail`, not this client's fallback
     * wording.
     */
    it("surfaces the server's own reason for a rejection", async () => {
      const failure = await register({ email: "not-an-address", displayName: "Contract Probe" })
        .then(() => null, (error: unknown) => error);

      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).kind).toBe("invalid");
      expect((failure as ApiError).status).toBe(400);
      expect((failure as ApiError).message).not.toBe(
        "That request could not be completed. Check the details and try again.",
      );
      expect((failure as ApiError).message.length).toBeGreaterThan(0);
    });
  });

  describe("email verification", () => {
    /**
     * The token is nonsense, so this must fail — but it has to fail as a
     * rejected token rather than as a malformed request, which is what proves
     * the client is sending both fields the endpoint requires. Sending only the
     * token, which this client used to do, fails differently.
     */
    it("sends both the address and the token", async () => {
      const failure = await verifyEmail(address(), "not-a-real-token")
        .then(() => null, (error: unknown) => error);

      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).status).toBe(400);
    });
  });

  describe("passkey sign-in options", () => {
    it("arrive unwrapped, naming no credentials", async () => {
      const options = await beginPasskeyLogin();

      // No `publicKey` envelope. The client is what wraps these for
      // navigator.credentials.get(); the server sends the inner document.
      expect(options).not.toHaveProperty("publicKey");

      expect(typeof options.challenge).toBe("string");
      expect(options.rpId).toBeTruthy();

      // Empty for every caller alike, which is what makes the endpoint
      // impossible to use for account enumeration.
      expect(options.allowCredentials).toEqual([]);
    });
  });

  describe("passkey revocation", () => {
    /**
     * Before the endpoint existed this answered 404, which this client would
     * have reported as an ordinary invalid request. A 401 is the proof that the
     * route is mounted and merely refusing an anonymous caller.
     */
    it("exists and refuses an anonymous caller", async () => {
      const failure = await removePasskey("not-a-real-credential")
        .then(() => null, (error: unknown) => error);

      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).kind).toBe("unauthenticated");
      expect((failure as ApiError).status).toBe(401);
    });
  });

  describe("cross-site request protection", () => {
    /**
     * The whole of this client's CSRF story, and the reason there is no token
     * anywhere in `api.ts`. The API decides by provenance, and a foreign origin
     * is refused with a bodiless 403 — which the client has to render as
     * "forbidden" rather than as an outage, since there is no body to read.
     */
    it("refuses a request that did not come from this site", async () => {
      const restoreOrigin = globalThis.fetch;
      useRealApi("https://elsewhere.example");

      try {
        const failure = await beginPasskeyLogin().then(() => null, (error: unknown) => error);

        expect(failure).toBeInstanceOf(ApiError);
        expect((failure as ApiError).kind).toBe("forbidden");
        expect((failure as ApiError).status).toBe(403);
      } finally {
        globalThis.fetch = restoreOrigin;
      }
    });
  });

  /**
   * The fixture, held against the thing it stands in for.
   *
   * `tests/auth-api-contract.ts` is what every unit test and every Playwright
   * spec in this repository talks to. If it drifts from the service, the entire
   * suite goes on passing while the deployed site breaks — which is precisely
   * what happened. These assertions compare the mock's answer to the server's
   * for the requests both can serve without a session, so a drift shows up here
   * instead of in production.
   */
  describe("the test fixture still resembles the service", () => {
    async function real(method: string, path: string, body?: unknown) {
      const response = await fetch(`/api/auth${path}`, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      const text = await response.text();
      return {
        status: response.status,
        body: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : null,
      };
    }

    it("agrees about an anonymous /me", async () => {
      const actual = await real("GET", "/me");
      const mocked = new AuthApiContract({ origin: ORIGIN }).handle("GET", "/me", undefined, browserHeaders());

      expect(actual.status).toBe(401);
      expect(mocked.status).toBe(actual.status);
    });

    it("agrees about what registration answers", async () => {
      const actual = await real("POST", "/register", {
        email: address(),
        displayName: "Contract Probe",
      });

      const mocked = new AuthApiContract({ origin: ORIGIN }).handle(
        "POST",
        "/register",
        { email: address(), displayName: "Contract Probe" },
        browserHeaders(),
      );

      expect(mocked.status).toBe(actual.status);
      expect(Object.keys(mocked.body as object).sort()).toEqual(
        Object.keys(actual.body as object).sort(),
      );
      expect((mocked.body as { status: string }).status).toBe(
        (actual.body as { status: string }).status,
      );
    });

    it("agrees about the shape of sign-in options", async () => {
      const actual = await real("POST", "/passkey/login/begin", {});
      const mocked = new AuthApiContract({ origin: ORIGIN }).handle(
        "POST",
        "/passkey/login/begin",
        {},
        browserHeaders(),
      );

      expect(mocked.status).toBe(actual.status);

      // The keys the client reads, rather than every key the server happens to
      // send — the server is allowed to add fields, and a strict comparison
      // would turn every such addition into a failure here.
      for (const key of ["challenge", "rpId", "allowCredentials"]) {
        expect(actual.body).toHaveProperty(key);
        expect(mocked.body).toHaveProperty(key);
      }

      expect(actual.body).not.toHaveProperty("publicKey");
      expect(mocked.body).not.toHaveProperty("publicKey");
    });

    it("agrees that a foreign origin is refused", async () => {
      const restoreOrigin = globalThis.fetch;
      useRealApi("https://elsewhere.example");

      try {
        const actual = await real("POST", "/passkey/login/begin", {});
        const mocked = new AuthApiContract({ origin: ORIGIN }).handle(
          "POST",
          "/passkey/login/begin",
          {},
          browserHeaders("https://elsewhere.example"),
        );

        expect(actual.status).toBe(403);
        expect(mocked.status).toBe(actual.status);
      } finally {
        globalThis.fetch = restoreOrigin;
      }
    });
  });
});
