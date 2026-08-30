/**
 * The account API, served into a real browser.
 *
 * Exactly the same contract object the unit tests drive
 * (`tests/auth-api-contract.ts`), wrapped as a Playwright route handler rather
 * than as a `fetch` implementation. Sharing it is the point: the two suites
 * cannot drift into testing different servers, and when the real service
 * arrives both are pointed at it by deleting one adapter each.
 *
 * The CSRF cookie is planted through the browser's own cookie jar rather than
 * faked, so the client really has to read it back out of `document.cookie` and
 * echo it — the contract rejects any state-changing request that does not.
 */

import type { BrowserContext, Page } from "@playwright/test";

import {
  AuthApiContract,
  CSRF_COOKIE,
  CSRF_TOKEN,
  type ContractOptions,
} from "../tests/auth-api-contract";

export { AuthApiContract } from "../tests/auth-api-contract";
export { user, passkey, VALID_TOTP_CODE } from "../tests/auth-api-contract";

export const ORIGIN = "http://localhost:4173";

/**
 * Intercepts `/api/auth/*` and answers from the contract.
 *
 * Anything else is left alone, so the prerendered pages, the assets and the
 * fonts are all served by the real preview server.
 */
export async function serveAccountApi(
  page: Page,
  context: BrowserContext,
  options: ContractOptions = {},
): Promise<AuthApiContract> {
  const contract = new AuthApiContract(options);

  await context.addCookies([
    { name: CSRF_COOKIE, value: CSRF_TOKEN, url: ORIGIN },
  ]);

  await page.route("**/api/auth/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice("/api/auth".length);
    const raw = request.postData();

    let reply;
    try {
      reply = contract.handle(
        request.method(),
        path,
        raw ? (JSON.parse(raw) as unknown) : undefined,
        new Headers(await request.allHeaders()),
      );
    } catch {
      // The contract throws to simulate the service being unreachable.
      await route.abort("failed");
      return;
    }

    if (reply.status === 204) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    await route.fulfill({
      status: reply.status,
      contentType: "application/json",
      body: JSON.stringify(reply.body),
    });
  });

  return contract;
}

/**
 * Attaches Chrome's virtual authenticator through the DevTools protocol.
 *
 * This is a real WebAuthn implementation, not a stub of `navigator.credentials`:
 * the ceremony runs, the credential is signed, and the challenge really does
 * come back inside `clientDataJSON` — which is what the contract checks. A test
 * built on a stubbed `navigator` could not tell a working client from one that
 * fabricated an assertion.
 */
export async function attachVirtualAuthenticator(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("WebAuthn.enable");
  await session.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}
