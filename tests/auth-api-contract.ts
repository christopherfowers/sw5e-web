/**
 * A stand-in for the account API, written to the contract rather than to the
 * client.
 *
 * The tests mock the service at the network boundary — the `fetch` call — and
 * nowhere else. That matters: a mock placed one layer higher, over
 * `app/auth/api.ts`, would make every test pass without the request headers,
 * the credentials mode, the cross-site check or the error decoding ever being
 * exercised, which is most of what that module is for.
 *
 * ## Why this file is the one that has to be right
 *
 * An earlier version of this fixture modelled a contract nobody had checked: a
 * `{user}` envelope on `/me`, a `label` on registration, `mfa-required` with a
 * hyphen, a double-submit CSRF header. The client agreed with it exactly,
 * because both were written from the same guess — so both suites were green
 * while disagreeing with the running service on nearly every endpoint. A shared
 * fixture is only worth having if it is a model of the *server*; the moment it
 * becomes a model of the client, it stops being able to fail.
 *
 * So everything below is checked against `docs/account-api-contract.md`, and it
 * is strict rather than permissive — it enforces what the real service
 * enforces, so a client that forgets something fails here rather than in
 * production:
 *
 *   - an unsafe method whose `Origin` is not this page's gets a bodiless 403
 *   - `GET /me` answers 401, not an empty 200, when there is no session
 *   - verifying an address does *not* create a session; it opens an enrolment
 *     window, and only passkey registration is permitted inside it
 *   - a passkey ceremony refuses a challenge it did not issue
 *   - the last remaining credential cannot be removed
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

/**
 * The origin the fixture considers to be the page's own.
 *
 * Read from the environment rather than hard-coded, so that changing the jsdom
 * URL cannot silently turn every unit test into a cross-site request. There is
 * no `location` in the Playwright runner's Node process, hence the fallback and
 * hence `ContractOptions.origin` — the e2e adapter passes the preview server's
 * address explicitly.
 */
export const PAGE_ORIGIN =
  typeof globalThis.location === "undefined"
    ? "http://localhost:3000"
    : globalThis.location.origin;

/** The only verification token this fixture treats as valid. */
export const VALID_VERIFICATION_TOKEN = "valid-verification-token";

/** The address that token was issued for. Both halves have to match. */
export const VALID_VERIFICATION_EMAIL = "reader@example.com";

/** The only TOTP code this fixture accepts. */
export const VALID_TOTP_CODE = "123456";

export const TOTP_SHARED_KEY = "JBSWY3DPEHPK3PXP";
export const TOTP_AUTHENTICATOR_URI =
  "otpauth://totp/Star%20Wars%205e:reader@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Star%20Wars%205e&algorithm=SHA1&digits=6&period=30";

/** What the enrolment ticket from `email/verify` is good for, in milliseconds. */
const ENROLMENT_WINDOW_MS = 10 * 60 * 1000;

export function passkey(overrides: Partial<PasskeyCredential> = {}): PasskeyCredential {
  return {
    id: "credential-one",
    name: "Work laptop",
    createdAt: "2026-02-01T10:00:00.000Z",
    ...overrides,
  };
}

export function user(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: "user-1",
    email: VALID_VERIFICATION_EMAIL,
    displayName: "Jen Ordo",
    roles: ["Community"] as Role[],
    twoFactorEnabled: false,
    passkeys: [passkey()],
    ...overrides,
  };
}

interface Reply {
  status: number;
  body?: unknown;
}

/**
 * The API's failures are RFC 9457 problem documents, and the client has to
 * decode `detail` rather than `message`. Building them here rather than inline
 * keeps the fixture honest about that.
 */
function problem(status: number, detail: string, code?: string): Reply {
  return {
    status,
    body: {
      type: "https://tools.ietf.org/html/rfc9110#section-15.5.1",
      title: "Request failed",
      status,
      detail,
      ...(code ? { code } : {}),
    },
  };
}

/**
 * The anonymous 401 is deliberately bodiless. It is the cookie authentication
 * scheme's own challenge, written before any handler runs, so it carries no
 * problem document and no content type at all — which is precisely the shape
 * that used to be misread as "the service is unreachable".
 */
const UNAUTHENTICATED: Reply = { status: 401 };

/** So is the cross-site refusal: the service will not say what it disliked. */
const CROSS_SITE_REFUSED: Reply = { status: 403 };

export interface ContractOptions {
  /** The session the API starts with. `null` is a signed-out browser. */
  session?: CurrentUser | null;
  /** Whether a successful passkey login still demands a second factor. */
  mfaRequired?: boolean;
  /** Force every request to fail as if the service were down. */
  offline?: boolean;
  /** The page origin unsafe methods must arrive from. */
  origin?: string;
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
  readonly origin: string;

  /** Every request that reached the API, in order. */
  readonly calls: { method: string; path: string; body: unknown }[] = [];

  /** Challenges this fixture has issued and not yet seen answered. */
  private outstandingChallenges = new Set<string>();
  private nextCredential = 2;
  private awaitingTotpEnrolment = false;

  /**
   * The enrolment ticket `email/verify` writes, as an expiry instant.
   *
   * A separate field from `session` on purpose, because that separation is the
   * contract's whole point: this ticket authorises passkey registration and
   * *nothing else*, and `GET /me` still answers 401 while it is held. A fixture
   * that modelled verification as a sign-in — as the previous one did — cannot
   * catch a client that assumes it has an account when it does not.
   */
  private enrolmentTicketExpiresAt: number | null = null;

  constructor(options: ContractOptions = {}) {
    this.session = options.session ?? null;
    this.mfaRequired = options.mfaRequired ?? false;
    this.offline = options.offline ?? false;
    this.origin = options.origin ?? PAGE_ORIGIN;
  }

  /** Whether an unexpired enrolment ticket is being held. */
  private holdsEnrolmentTicket(): boolean {
    return (
      this.enrolmentTicketExpiresAt !== null &&
      this.enrolmentTicketExpiresAt > Date.now()
    );
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

    /*
     * The provenance check the real service makes, and the only cross-site
     * protection there is. An unsafe method has to arrive with this page's own
     * `Origin`; the browser writes it and script cannot forge it, so a request
     * from anywhere else is refused outright and told nothing about why.
     *
     * Enforced here so that a client which starts sending requests some other
     * way — or a test that fakes an origin it should not have — fails against
     * the fixture rather than in production.
     */
    if (method !== "GET" && headers.get("origin") !== this.origin) {
      return CROSS_SITE_REFUSED;
    }

    switch (`${method} ${path}`) {
      // No envelope: the account object is the entire body.
      case "GET /me":
        return this.session
          ? { status: 200, body: this.session }
          : UNAUTHENTICATED;

      case "POST /logout":
        this.session = null;
        this.enrolmentTicketExpiresAt = null;
        this.awaitingTotpEnrolment = false;
        return { status: 204 };

      case "POST /register": {
        const payload = body as { email?: string; displayName?: string };
        if (!payload?.email || !payload?.displayName) {
          return {
            status: 422,
            body: {
              type: "https://tools.ietf.org/html/rfc9110#section-15.5.1",
              title: "Invalid request",
              status: 422,
              detail: "Check the details and try again.",
              code: "invalid",
              fieldErrors: { email: "An email address is required." },
            },
          };
        }
        // Deliberately identical whether or not the address is known: the API
        // must not be an account-existence oracle.
        return {
          status: 202,
          body: {
            status: "pending",
            message:
              "If that address can be registered, a verification link is on its way.",
          },
        };
      }

      case "POST /email/verify": {
        const payload = body as { email?: string; token?: string };
        // Both halves are required, and the token is scoped to its address: a
        // link that lost either parameter cannot be completed.
        if (
          payload?.token !== VALID_VERIFICATION_TOKEN ||
          payload?.email !== VALID_VERIFICATION_EMAIL
        ) {
          return problem(
            400,
            "That link has expired or has already been used.",
            "invalid-token",
          );
        }
        // Verification opens the enrolment window and does not sign anybody
        // in. `GET /me` still answers 401 from here.
        this.enrolmentTicketExpiresAt = Date.now() + ENROLMENT_WINDOW_MS;
        return {
          status: 200,
          body: {
            status: "verified",
            enrollmentExpiresAt: new Date(this.enrolmentTicketExpiresAt).toISOString(),
          },
        };
      }

      case "POST /passkey/register/begin": {
        // Authorised by a session *or* by an enrolment ticket. The ticket is
        // the only way a brand-new account can reach this at all.
        const account = this.session;
        if (!account && !this.holdsEnrolmentTicket()) return UNAUTHENTICATED;
        const existing = account?.passkeys ?? [];
        return {
          status: 200,
          // Unwrapped: this document *is* the response body.
          body: {
            challenge: this.issueChallenge(),
            rp: { name: "Star Wars 5e" },
            user: {
              id: base64Url(account?.id ?? "pending-account"),
              name: account?.email ?? VALID_VERIFICATION_EMAIL,
              displayName: account?.displayName ?? "New account",
            },
            pubKeyCredParams: [
              { type: "public-key", alg: -7 },
              { type: "public-key", alg: -257 },
            ],
            timeout: 60_000,
            attestation: "none",
            excludeCredentials: existing.map((credential) => ({
              type: "public-key",
              id: base64Url(credential.id),
            })),
            authenticatorSelection: {
              residentKey: "preferred",
              userVerification: "preferred",
            },
          },
        };
      }

      case "POST /passkey/register/complete": {
        if (!this.session && !this.holdsEnrolmentTicket()) return UNAUTHENTICATED;
        const payload = body as {
          credential?: { response?: { clientDataJSON?: string } };
          name?: string | null;
        };
        const challenge = challengeFromClientData(
          payload?.credential?.response?.clientDataJSON,
        );
        if (!challenge || !this.outstandingChallenges.delete(challenge)) {
          return problem(400, "That attempt has expired.", "bad-challenge");
        }
        // The label field is `name`. Anything else is ignored, which is how a
        // client sending `label` ended up enrolling nameless credentials.
        const created = passkey({
          id: `credential-${this.nextCredential++}`,
          name: payload.name?.trim() || null,
          createdAt: new Date().toISOString(),
        });
        if (this.session) {
          this.session = {
            ...this.session,
            passkeys: [...this.session.passkeys, created],
          };
        }
        // Enrolment does not sign anybody in; the client follows this with an
        // ordinary passkey sign-in.
        return {
          status: 201,
          body: {
            credentialId: created.id,
            name: created.name,
            createdAt: created.createdAt,
          },
        };
      }

      // The request body is ignored entirely, and the answer is identical for
      // every caller — there is nothing here to probe an address with.
      case "POST /passkey/login/begin":
        return {
          status: 200,
          body: {
            challenge: this.issueChallenge(),
            timeout: 120_000,
            allowCredentials: [],
            userVerification: "required",
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
          return problem(400, "That attempt has expired.", "bad-challenge");
        }
        if (this.mfaRequired) {
          // No `methods`, no account detail: a half-authenticated caller is
          // still an unauthenticated one.
          return { status: 200, body: { status: "mfaRequired", user: null } };
        }
        this.session = this.session ?? user();
        this.enrolmentTicketExpiresAt = null;
        return { status: 200, body: { status: "authenticated", user: this.session } };
      }

      case "POST /mfa/totp/enroll":
        if (!this.session) return UNAUTHENTICATED;
        this.awaitingTotpEnrolment = true;
        return {
          status: 200,
          body: {
            sharedKey: TOTP_SHARED_KEY,
            authenticatorUri: TOTP_AUTHENTICATOR_URI,
          },
        };

      case "POST /mfa/totp/verify": {
        const payload = body as { code?: string };
        if (payload?.code !== VALID_TOTP_CODE) {
          // 400 on the enrolment branch, 401 on the sign-in branch.
          return this.awaitingTotpEnrolment && this.session
            ? problem(
                400,
                "That code was not correct. Codes expire after 30 seconds.",
                "bad-code",
              )
            : problem(
                401,
                "That code was not correct. Codes expire after 30 seconds.",
                "bad-code",
              );
        }
        // Which job this endpoint is doing is decided by server-held state and
        // never by anything in the body.
        if (this.awaitingTotpEnrolment && this.session) {
          this.awaitingTotpEnrolment = false;
          this.session = { ...this.session, twoFactorEnabled: true };
          return {
            status: 200,
            body: {
              status: "enabled",
              recoveryCodes: [
                "AAAA-1111",
                "BBBB-2222",
                "CCCC-3333",
                "DDDD-4444",
                "EEEE-5555",
                "FFFF-6666",
                "GGGG-7777",
                "HHHH-8888",
                "IIII-9999",
                "JJJJ-0000",
              ],
            },
          };
        }
        this.mfaRequired = false;
        this.session = this.session ?? user({ twoFactorEnabled: true });
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
            return problem(404, "No such passkey.", "not-found");
          }
          // Removing the only credential would strand the account, so the
          // server refuses rather than letting the reader do it.
          if (this.session.passkeys.length === 1) {
            return problem(
              409,
              "That is the only way you can sign in. Add another passkey before removing this one.",
              "last-credential",
            );
          }
          this.session = { ...this.session, passkeys: remaining };
          return { status: 200, body: { status: "removed" } };
        }

        const roles = /^\/admin\/users\/([^/]+)\/roles$/.exec(path);
        if (method === "PUT" && roles) {
          if (!this.session) return UNAUTHENTICATED;
          if (!this.session.roles.includes("Administrator")) {
            return problem(403, "Administrators only.", "forbidden");
          }
          const payload = body as { roles?: unknown };
          const requested = Array.isArray(payload?.roles)
            ? (payload.roles as string[])
            : [];
          // `Community` is the floor every account stands on, not something
          // that can be granted, so the API refuses to be asked for it.
          const assignable = ["Contributor", "Administrator"];
          if (requested.some((role) => !assignable.includes(role))) {
            return problem(400, "That is not a role that can be assigned.", "invalid-role");
          }
          return {
            status: 200,
            body: {
              userId: decodeURIComponent(roles[1] ?? ""),
              roles: ["Community", ...requested],
            },
          };
        }

        return problem(404, "No such endpoint.", "not-found");
      }
    }
  }
}

/* --------------------------------------------------------------- adapters */

export interface FetchAdapterOptions {
  /**
   * The `Origin` header to send on unsafe methods. Defaults to the contract's
   * own origin, which is what a browser would really put there — so ordinary
   * tests need nothing. A test proving the cross-site check works overrides it
   * with a foreign origin, or with `null` for a request that carries none.
   */
  origin?: string | null;
}

/**
 * Wraps the contract as a `fetch` implementation, for Vitest.
 *
 * The `Origin` header is supplied here rather than by `app/auth/api.ts`, and
 * that placement is the point: `Origin` is a forbidden header name, written by
 * the browser and unforgeable from script. Client code that tried to set it
 * would be ignored by every real browser, so the adapter stands in for the
 * browser and the client stays as it should be — sending nothing.
 *
 * Anything that is not an account endpoint is refused rather than passed
 * through: a test that accidentally makes a real network call should fail
 * loudly, not hang.
 */
export function contractFetch(
  contract: AuthApiContract,
  options: FetchAdapterOptions = {},
): typeof fetch {
  const origin = options.origin === undefined ? contract.origin : options.origin;

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = new Headers(init?.headers);

    if (!url.startsWith("/api/auth")) {
      throw new Error(`unexpected request to ${url} in a test`);
    }

    const method = init?.method ?? "GET";
    if (method !== "GET" && origin !== null) headers.set("origin", origin);

    const path = url.slice("/api/auth".length);
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

    const reply = contract.handle(method, path, body, headers);

    // A bodiless refusal really is bodiless: no content type either, which is
    // the shape the client has to read from the status alone.
    if (reply.status === 204 || reply.body === undefined) {
      return new Response(null, { status: reply.status });
    }
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: {
        "content-type":
          reply.status >= 400 ? "application/problem+json" : "application/json",
      },
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
