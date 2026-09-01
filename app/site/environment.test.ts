/**
 * The decision that keeps a "test environment" banner off the live site.
 *
 * Almost every assertion in here is about a failure returning `false`, which
 * looks like a lot of ceremony around a `catch`. It is not. The whole design
 * rests on one asymmetry — silence means production — and that asymmetry is a
 * single character away from being inverted at any point in this file's life.
 * Each of the cases below is a real thing that happens to a deployment: the API
 * not mounted yet, the proxy answering with the SPA shell, a request that never
 * comes back, a body from a version of the service that does not have this
 * field. Every one of them has to draw nothing.
 *
 * The complementary assertion — that a service which says it is QA does produce
 * a banner — is here too, because a fail-closed function that always returns
 * false is trivially "safe" and completely useless, and that is the failure a
 * suite of absence assertions would not catch on its own.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { isTestEnvironment } from "./environment";

function respondWith(
  body: unknown,
  { status = 200, contentType = "application/json" } = {},
) {
  // The parameters are named and unused because the assertion about *how* the
  // request is made — a relative path, no credentials — reads them off
  // `mock.calls`, and vi.fn only types that tuple from the implementation's own
  // signature.
  const fetchMock = vi.fn(
    async (path: string, init: RequestInit): Promise<Response> => {
      void path;
      void init;

      return new Response(
        typeof body === "string" ? body : JSON.stringify(body),
        { status, headers: { "content-type": contentType } },
      );
    },
  );

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isTestEnvironment", () => {
  it("reports a test environment when the service says it is not production", async () => {
    respondWith({ name: "QA", isProduction: false });

    await expect(isTestEnvironment()).resolves.toBe(true);
  });

  it("reports nothing when the service says it is production", async () => {
    respondWith({ name: "Production", isProduction: true });

    await expect(isTestEnvironment()).resolves.toBe(false);
  });

  /**
   * The one that decides whether this feature is safe to ship.
   *
   * A deployment with no API reachable at all — during a partial deploy, behind
   * a proxy that has not been given the route, or simply offline — must look
   * exactly like production. Invert the `catch` in `environment.ts` and this is
   * what fails.
   */
  it("reports nothing when the service cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await expect(isTestEnvironment()).resolves.toBe(false);
  });

  it("reports nothing when the request never answers", async () => {
    // Never settles. The abort signal composed inside `isTestEnvironment` is
    // what has to end this, and if the timeout is ever removed this test hangs
    // rather than failing quietly — which is the correct way for a missing
    // deadline to show up.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );

    await expect(isTestEnvironment()).resolves.toBe(false);
  }, 10_000);

  it("reports nothing for a 404, which is what an unmounted API answers", async () => {
    respondWith({ isProduction: false }, { status: 404 });

    await expect(isTestEnvironment()).resolves.toBe(false);
  });

  it("reports nothing for a 500", async () => {
    respondWith({ isProduction: false }, { status: 500 });

    await expect(isTestEnvironment()).resolves.toBe(false);
  });

  /**
   * A partial deploy in its purest form: nginx owns `/api/site/environment`
   * because the service is not mounted behind the proxy yet, so it answers 200
   * with this app's own HTML shell. A 200 is not enough on its own.
   */
  it("reports nothing when the static host answers with the app shell", async () => {
    respondWith("<!DOCTYPE html><html><body>Star Wars 5e</body></html>", {
      contentType: "text/html",
    });

    await expect(isTestEnvironment()).resolves.toBe(false);
  });

  it("reports nothing for a body that is not JSON at all", async () => {
    respondWith("not json", { contentType: "application/json" });

    await expect(isTestEnvironment()).resolves.toBe(false);
  });

  /**
   * The field missing, rather than present and true. A truthiness check would
   * read this as "not production" and put the banner on the live site the first
   * time the service's response shape changed under us.
   */
  it("reports nothing when the answer does not carry isProduction", async () => {
    respondWith({ name: "Production" });

    await expect(isTestEnvironment()).resolves.toBe(false);
  });

  it("reports nothing when isProduction is a string rather than a boolean", async () => {
    respondWith({ name: "QA", isProduction: "false" });

    await expect(isTestEnvironment()).resolves.toBe(false);
  });

  it("reports nothing for a null body", async () => {
    respondWith(null);

    await expect(isTestEnvironment()).resolves.toBe(false);
  });

  /**
   * The transport rules, asserted because each of them protects something the
   * banner is not otherwise near: a relative path is what keeps
   * `connect-src 'self'` closed, and omitted credentials are what stop a public
   * endpoint from joining the authenticated surface.
   */
  it("asks its own origin, without credentials", async () => {
    const fetchMock = respondWith({ name: "QA", isProduction: false });

    await isTestEnvironment();

    const [path, init] = fetchMock.mock.calls[0];

    expect(path).toBe("/api/site/environment");
    expect(path.startsWith("/")).toBe(true);
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
  });

  it("stops asking when the caller goes away", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );

    const controller = new AbortController();
    const answer = isTestEnvironment(controller.signal);
    controller.abort();

    await expect(answer).resolves.toBe(false);
  });
});
