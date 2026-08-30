/**
 * A stand-in for the account API, written to the contract rather than to the
 * client.
 *
 * The service itself is built in the sibling repository and did not exist when
 * this UI was written, so the tests mock it at the network boundary — the
 * `fetch` call — and nowhere else. That matters: a mock placed one layer
 * higher, over `app/auth/api.ts`, would make every test pass without the
 * request headers, the credentials mode, the CSRF echo or the error decoding
 * ever being exercised, which is most of what that module is for.
 *
 * Because it sits at the boundary, this file is replaceable by the real
 * service without touching a single test. That is also why it is strict rather
 * than permissive: it enforces the parts of the contract the server will
 * enforce, so a client that forgets them fails here rather than in production.
 *
 *   - a state-changing request without a matching `X-CSRF-Token` is rejected
 *   - `GET /me` answers 401, not an empty 200, when there is no session
 *   - a passkey ceremony refuses a challenge it did not issue
 *
 * One `handle()` serves both test runners: Vitest wraps it as a `fetch`
 * implementation, Playwright wraps it as a `page.route` handler, and the two
 * therefore cannot drift apart.
 */

import type {
  CurrentUser,
  PasskeyCredential,
  Role,
} from "../app/auth/types";

export const CSRF_COOKIE = "sw5e_csrf";
export const CSRF_HEADER = "x-csrf-token";

/** The token the fixtures below expect to be echoed back. */
export const CSRF_TOKEN = "test-csrf-token";

/** The only verification token this fixture treats as valid. */
export const VALID_VERIFICATION_TOKEN = "valid-verification-token";

/** The only TOTP code this fixture accepts. */
export const VALID_TOTP_CODE = "123456";

export const TOTP_SECRET = "JBSWY3DPEHPK3PXP";
export const TOTP_URI =
  "otpauth://totp/Star%20Wars%205e:reader@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Star%20Wars%205e&algorithm=SHA1&digits=6&period=30";

export function passkey(overrides: Partial<PasskeyCredential> = {}): PasskeyCredential {
  return {
    id: "credential-one",
    label: "Work laptop",
    createdAt: "2026-02-01T10:00:00.000Z",
    lastUsedAt: "2026-08-01T09:30:00.000Z",
    ...overrides,
  };
}

export function user(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: "user-1",
    email: "reader@example.com",
    displayName: "Jen Ordo",
    roles: ["community"] as Role[],
    mfa: { totp: false },
    passkeys: [passkey()],
    ...overrides,
  };
}

interface Reply {
  status: number;
  body?: unknown;
}

const UNAUTHENTICATED: Reply = {
  status: 401,
  body: { code: "unauthenticated", message: "You are not signed in." },
};

export interface ContractOptions {
  /** The session the API starts with. `null` is a signed-out browser. */
  session?: CurrentUser | null;
  /** Whether a successful passkey login still demands a second factor. */
  mfaRequired?: boolean;
  /** Force every request to fail as if the service were down. */
  offline?: boolean;
}

/**
 * The fixture's whole surface. `state` is readable by tests so they can assert
 * on what the server ended up holding, rather than only on what the UI drew —
 * a UI that says "removed" without ever calling the endpoint is exactly the
 * kind of pass a test has to refuse.
 */
export class AuthApiContract {
  session: CurrentUser | null;
  mfaRequired: boolean;
  offline: boolean;

  /** Every request that reached the API, in order. */
  readonly calls: { method: string; path: string; body: unknown }[] = [];

  /** Challenges this fixture has issued and not yet seen answered. */
  private outstandingChallenges = new Set<string>();
  private nextCredential = 2;
  private awaitingTotpEnrolment = false;

  constructor(options: ContractOptions = {}) {
    this.session = options.session ?? null;
    this.mfaRequired = options.mfaRequired ?? false;
    this.offline = options.offline ?? false;
  }

  /** A base64url challenge, distinct per ceremony so replay is detectable. */
  private issueChallenge(): string {
    const challenge = `challenge-${this.outstandingChallenges.size}-${Date.now()}`;
    const encoded = base64Url(challenge);
    this.outstandingChallenges.add(encoded);
    return encoded;
  }

  handle(method: string, path: string, body: unknown, headers: Headers): Reply {
    this.calls.push({ method, path, body });

    if (this.offline) throw new TypeError("network failure");

    // The double-submit check the real service has to make. Enforced here so a
    // client that stops sending the header fails a test rather than shipping.
    if (method !== "GET" && headers.get(CSRF_HEADER) !== CSRF_TOKEN) {
      return {
        status: 403,
        body: { code: "csrf", message: "Missing or stale security token." },
      };
    }

    switch (`${method} ${path}`) {
      case "GET /me":
        return this.session
          ? { status: 200, body: { user: this.session } }
          : UNAUTHENTICATED;

      case "POST /logout":
        this.session = null;
        return { status: 204 };

      case "POST /register": {
        const payload = body as { email?: string; displayName?: string };
        if (!payload?.email || !payload?.displayName) {
          return {
            status: 422,
            body: {
              code: "invalid",
              message: "Check the details and try again.",
              fieldErrors: { email: "An email address is required." },
            },
          };
        }
        // Deliberately identical whether or not the address is known: the API
        // must not be an account-existence oracle.
        return { status: 202, body: { status: "verification-sent" } };
      }

      case "POST /email/verify": {
        const payload = body as { token?: string };
        if (payload?.token !== VALID_VERIFICATION_TOKEN) {
          return {
            status: 400,
            body: {
              code: "invalid-token",
              message: "That link has expired or has already been used.",
            },
          };
        }
        this.session = user({ passkeys: [], displayName: "Jen Ordo" });
        return { status: 200, body: { status: "verified", user: this.session } };
      }

      case "POST /passkey/register/begin": {
        if (!this.session) return UNAUTHENTICATED;
        return {
          status: 200,
          body: {
            publicKey: {
              challenge: this.issueChallenge(),
              rp: { name: "Star Wars 5e" },
              user: {
                id: base64Url(this.session.id),
                name: this.session.email,
                displayName: this.session.displayName,
              },
              pubKeyCredParams: [
                { type: "public-key", alg: -7 },
                { type: "public-key", alg: -257 },
              ],
              timeout: 60_000,
              attestation: "none",
              excludeCredentials: this.session.passkeys.map((existing) => ({
                type: "public-key",
                id: base64Url(existing.id),
              })),
              authenticatorSelection: {
                residentKey: "preferred",
                userVerification: "preferred",
              },
            },
          },
        };
      }

      case "POST /passkey/register/complete": {
        if (!this.session) return UNAUTHENTICATED;
        const payload = body as {
          credential?: { response?: { clientDataJSON?: string } };
          label?: string;
        };
        const challenge = challengeFromClientData(
          payload?.credential?.response?.clientDataJSON,
        );
        if (!challenge || !this.outstandingChallenges.delete(challenge)) {
          return {
            status: 400,
            body: { code: "bad-challenge", message: "That attempt has expired." },
          };
        }
        const created = passkey({
          id: `credential-${this.nextCredential++}`,
          label: payload.label?.trim() || "Unnamed device",
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
        });
        this.session = {
          ...this.session,
          passkeys: [...this.session.passkeys, created],
        };
        return { status: 200, body: { credential: created } };
      }

      case "POST /passkey/login/begin":
        return {
          status: 200,
          body: {
            publicKey: {
              challenge: this.issueChallenge(),
              timeout: 60_000,
              userVerification: "preferred",
            },
          },
        };

      case "POST /passkey/login/complete": {
        const payload = body as {
          credential?: { response?: { clientDataJSON?: string } };
        };
        const challenge = challengeFromClientData(
          payload?.credential?.response?.clientDataJSON,
        );
        if (!challenge || !this.outstandingChallenges.delete(challenge)) {
          return {
            status: 400,
            body: { code: "bad-challenge", message: "That attempt has expired." },
          };
        }
        if (this.mfaRequired) {
          return { status: 200, body: { status: "mfa-required", methods: ["totp"] } };
        }
        this.session = this.session ?? user();
        return { status: 200, body: { status: "authenticated", user: this.session } };
      }

      case "POST /mfa/totp/enroll":
        if (!this.session) return UNAUTHENTICATED;
        this.awaitingTotpEnrolment = true;
        return {
          status: 200,
          body: { secret: TOTP_SECRET, otpauthUri: TOTP_URI },
        };

      case "POST /mfa/totp/verify": {
        const payload = body as { code?: string };
        if (payload?.code !== VALID_TOTP_CODE) {
          return {
            status: 400,
            body: {
              code: "bad-code",
              message: "That code was not correct. Codes expire after 30 seconds.",
            },
          };
        }
        if (this.awaitingTotpEnrolment && this.session) {
          this.awaitingTotpEnrolment = false;
          this.session = { ...this.session, mfa: { totp: true } };
          return {
            status: 200,
            body: {
              status: "enrolled",
              recoveryCodes: ["AAAA-1111", "BBBB-2222", "CCCC-3333"],
            },
          };
        }
        this.mfaRequired = false;
        this.session = this.session ?? user({ mfa: { totp: true } });
        return { status: 200, body: { status: "authenticated", user: this.session } };
      }

      default: {
        const removal = /^\/passkey\/(.+)$/.exec(path);
        if (method === "DELETE" && removal) {
          if (!this.session) return UNAUTHENTICATED;
          const id = decodeURIComponent(removal[1] ?? "");
          const remaining = this.session.passkeys.filter(
            (existing) => existing.id !== id,
          );
          if (remaining.length === this.session.passkeys.length) {
            return {
              status: 404,
              body: { code: "not-found", message: "No such passkey." },
            };
          }
          this.session = { ...this.session, passkeys: remaining };
          return { status: 200, body: { status: "removed" } };
        }
        return {
          status: 404,
          body: { code: "not-found", message: "No such endpoint." },
        };
      }
    }
  }
}

/* --------------------------------------------------------------- adapters */

/**
 * Wraps the contract as a `fetch` implementation, for Vitest.
 *
 * Anything that is not an account endpoint is refused rather than passed
 * through: a test that accidentally makes a real network call should fail
 * loudly, not hang.
 */
export function contractFetch(contract: AuthApiContract): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = new Headers(init?.headers);

    if (!url.startsWith("/api/auth")) {
      throw new Error(`unexpected request to ${url} in a test`);
    }

    const path = url.slice("/api/auth".length);
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

    const reply = contract.handle(init?.method ?? "GET", path, body, headers);

    if (reply.status === 204) {
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  };
}

/* ---------------------------------------------------------------- helpers */

function base64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
}

/**
 * Pulls the challenge back out of the assertion, the way a real verifier does.
 * Checking it is what makes the ceremony tests mean something: a client that
 * sent a made-up assertion would otherwise pass.
 */
function challengeFromClientData(clientDataJSON: string | undefined): string | null {
  if (!clientDataJSON) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(clientDataJSON)) as {
      challenge?: string;
    };
    return parsed.challenge ?? null;
  } catch {
    return null;
  }
}
