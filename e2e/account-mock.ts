/**
 * The account API, served into a real browser.
 *
 * Exactly the same contract object the unit tests drive
 * (`tests/auth-api-contract.ts`), wrapped as a Playwright route handler rather
 * than as a `fetch` implementation. Sharing it is the point: the two suites
 * cannot drift into testing different servers, and when the real service
 * arrives both are pointed at it by deleting one adapter each.
 *
 * Nothing has to be planted before a test runs. The API's cross-site
 * protection is an `Origin` allow-list, and Chrome writes `Origin` itself on
 * every state-changing fetch — so this suite exercises the real mechanism for
 * free, and the contract refuses anything that arrives without it. That is
 * worth more than the cookie this used to plant: a header the browser controls
 * cannot be faked into passing by a client that has stopped doing its job.
 */

import type { BrowserContext, Page } from "@playwright/test";

import {
  AuthApiContract,
  type ContractOptions,
} from "../tests/auth-api-contract";

export { AuthApiContract } from "../tests/auth-api-contract";
export {
  user,
  passkey,
  VALID_EMAIL_CODE,
  VALID_TOTP_CODE,
  VALID_VERIFICATION_EMAIL,
  VALID_VERIFICATION_TOKEN,
} from "../tests/auth-api-contract";

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
  // The preview server's address, not jsdom's: this is the origin the browser
  // will really stamp on every unsafe method, and the contract refuses
  // anything else.
  const contract = new AuthApiContract({ origin: ORIGIN, ...options });

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

    // A bodiless refusal is genuinely bodiless — no content type either, which
    // is the shape the client has to read from the status alone.
    if (reply.status === 204 || reply.body === undefined) {
      await route.fulfill({ status: reply.status, body: "" });
      return;
    }
    await route.fulfill({
      status: reply.status,
      contentType:
        reply.status >= 400 ? "application/problem+json" : "application/json",
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
