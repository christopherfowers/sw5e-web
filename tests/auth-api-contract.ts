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

/**
 * The only emailed sign-in code this fixture accepts.
 *
 * Deliberately not the same six digits as `VALID_TOTP_CODE`. The two codes
 * enter the client through different endpoints and mean different things, and
 * a fixture where either value satisfies either check cannot notice a client
 * that posts the emailed code to `/mfa/totp/verify` — which is precisely the
 * mistake available now that both steps look identical on screen.
 */
export const VALID_EMAIL_CODE = "654321";

/**
 * The budgets the real service keeps on emailed codes, modelled here so that a
 * client which ignores them fails against the fixture rather than against
 * production.
 *
 * The per-address budget is the interesting one, because exhausting it is
 * *invisible*: the caller still gets the same 202, and simply never receives a
 * code. That is the contract, not an oversight — a different answer for an
 * address that has run out is a different answer for an address that exists.
 */
export const EMAIL_CODE_REQUEST_BUDGET = 5;
export const EMAIL_CODES_PER_ADDRESS = 3;
export const EMAIL_CODE_ATTEMPT_BUDGET = 5;

/** What the 202 promises, in seconds. Both are the service's own numbers. */
export const EMAIL_CODE_RESEND_AFTER_SECONDS = 60;
export const EMAIL_CODE_EXPIRES_IN_SECONDS = 600;

/**
 * The non-answer `POST /email/code` gives every caller.
 *
 * Held as a constant so that a test can assert two responses are identical by
 * comparing them to the same object, rather than by comparing them to two
 * literals somebody could drift apart.
 */
export const EMAIL_CODE_PENDING_BODY = {
  status: "pending",
  message: "If that address has an account, a sign-in code is on its way.",
  resendAfterSeconds: EMAIL_CODE_RESEND_AFTER_SECONDS,
  expiresInSeconds: EMAIL_CODE_EXPIRES_IN_SECONDS,
} as const;

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

/**
 * Whether a role set obliges the account to hold a second factor.
 *
 * The server answers `secondFactorRequired` itself rather than letting clients
 * compute it, so the fixture has to compute it the same way the server does or
 * it is modelling a different policy. Contributor and Administrator; nothing
 * else.
 */
function requiresSecondFactor(roles: readonly Role[]): boolean {
  return roles.some((role) => role === "Contributor" || role === "Administrator");
}

/**
 * The account this fixture knows about.
 *
 * The three session fields default to a strongly authenticated passkey
 * session, because that is what almost every test means by "signed in" and
 * because the weaker case is the one worth spelling out at the call site. A
 * test about the emailed-code path says so explicitly —
 * `user({ authenticationMethod: "email", strongAuthentication: false })` — and
 * reads as what it is.
 *
 * `secondFactorRequired` is derived from the roles rather than defaulted flat,
 * so that `user({ roles: ["Contributor"] })` produces the account the server
 * would produce instead of one that quietly disagrees with it about its own
 * obligations. An explicit override still wins, for the test that wants the
 * combination the policy does not currently produce.
 */
export function user(overrides: Partial<CurrentUser> = {}): CurrentUser {
  const account: CurrentUser = {
    id: "user-1",
    email: VALID_VERIFICATION_EMAIL,
    displayName: "Jen Ordo",
    roles: ["Community"] as Role[],
    twoFactorEnabled: false,
    passkeys: [passkey()],
    authenticationMethod: "passkey",
    strongAuthentication: true,
    secondFactorRequired: false,
    ...overrides,
  };
  return {
    ...account,
    secondFactorRequired:
      overrides.secondFactorRequired ?? requiresSecondFactor(account.roles),
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
  /**
   * How long the service says a caller must wait before asking for another
   * emailed code. Defaults to the real sixty seconds.
   *
   * Configurable because the number is the *server's*, and the client is
   * required to obey whatever it is told rather than counting to sixty on its
   * own. A test that shortens it and then watches the resend control come back
   * is proving exactly that; one that could only ever see sixty could not tell
   * an obedient client from a hard-coded one.
   */
  resendAfterSeconds?: number;
  /**
   * Whether the deployment's mail relay is accepting anything. Defaults to
   * true, so every test that is not about a mail outage sees the wording the
   * site has always used.
   *
   * One boolean for the whole deployment, mirroring the service: there is no
   * per-address form of this question, because a per-address answer to it is an
   * account-existence oracle.
   */
  accountEmailDelivering?: boolean;
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
  readonly resendAfterSeconds: number;

  /**
   * Whether the deployment's mail relay is accepting anything.
   *
   * Part of the contract rather than a per-test `fetch` stub, because it is
   * part of the contract: `GET /api/site/environment` publishes it, and the
   * account screens read it to decide whether they may say a message is on its
   * way. Modelled as one global boolean with no per-address dimension, exactly
   * as the service models it — a fixture that let a test answer differently for
   * different addresses would be a fixture in which the account-existence
   * oracle is reachable, and the client tests would go on passing.
   *
   * Mutable so that a test can break the relay between two requests, which is
   * what the resend path does.
   */
  accountEmailDelivering: boolean;

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

  /**
   * Emailed sign-in codes, by address.
   *
   * One live code per address — asking for another replaces the previous one,
   * which is why `redeemed` is reset rather than a second entry appended.
   * `issued` counts against the per-address budget and is never reset, since
   * the budget is what makes the endpoint useless as a way to mail somebody
   * repeatedly.
   */
  private emailCodes = new Map<
    string,
    { attempts: number; redeemed: boolean; issued: number }
  >();

  /** Requests this caller has spent against its own per-IP budget. */
  private emailCodeRequests = 0;

  constructor(options: ContractOptions = {}) {
    this.session = options.session ?? null;
    this.mfaRequired = options.mfaRequired ?? false;
    this.offline = options.offline ?? false;
    this.origin = options.origin ?? PAGE_ORIGIN;
    this.resendAfterSeconds =
      options.resendAfterSeconds ?? EMAIL_CODE_RESEND_AFTER_SECONDS;
    this.accountEmailDelivering = options.accountEmailDelivering ?? true;
  }

  /** Whether an unexpired enrolment ticket is being held. */
  private holdsEnrolmentTicket(): boolean {
    return (
      this.enrolmentTicketExpiresAt !== null &&
      this.enrolmentTicketExpiresAt > Date.now()
    );
  }

  /**
   * Whether the fixture would post a code to this address at all.
   *
   * It holds exactly one account, so "known" is that account's address — the
   * configured session's when there is one, and the registered address the
   * rest of the fixture uses when there is not. Crucially, the answer to
   * `POST /email/code` does not depend on this in any way; only whether a code
   * is actually issued does, and that difference is invisible until somebody
   * tries to redeem one.
   */
  private knowsAddress(address: string): boolean {
    const known = (this.session?.email ?? VALID_VERIFICATION_EMAIL).toLowerCase();
    return address.trim().toLowerCase() === known;
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
        // "Every half-finished flow" includes a code that was mailed and never
        // redeemed; leaving it live past a sign-out would keep a credential
        // usable that the reader has every reason to believe is gone.
        this.emailCodes.clear();
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

      /*
       * The whole point of this endpoint is that it answers the same thing to
       * everybody, so the code below is written to make that hard to break:
       * there is exactly one `return` for the success path, it is the same
       * frozen object every time, and every branch above it either falls
       * through to it or is about the *caller* rather than about the address.
       *
       * The address decides one thing only, and it is invisible from here:
       * whether a code is actually put in the map for `verify` to find later.
       */
      case "POST /email/code": {
        const payload = body as { email?: string };
        const address = typeof payload?.email === "string" ? payload.email.trim() : "";

        // A malformed address is a bad request, and saying so leaks nothing:
        // the caller already knows what they typed.
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
          return problem(400, "That is not a valid email address.", "invalid-email");
        }

        // The caller's own budget, which is about this caller and not about
        // any address — so it is the one refusal this endpoint may show.
        this.emailCodeRequests += 1;
        if (this.emailCodeRequests > EMAIL_CODE_REQUEST_BUDGET) {
          return problem(
            429,
            "Too many sign-in codes requested. Wait a few minutes and try again.",
            "rate-limited",
          );
        }

        if (this.knowsAddress(address)) {
          const key = address.toLowerCase();
          const existing = this.emailCodes.get(key);
          const issued = existing?.issued ?? 0;
          // Over its own budget, the address silently stops receiving codes.
          // The reply below is unchanged, which is the contract: an address
          // that has run out must not be distinguishable from one that never
          // had an account.
          if (issued < EMAIL_CODES_PER_ADDRESS) {
            this.emailCodes.set(key, {
              attempts: 0,
              redeemed: false,
              issued: issued + 1,
            });
          }
        }

        return {
          status: 202,
          body: {
            ...EMAIL_CODE_PENDING_BODY,
            resendAfterSeconds: this.resendAfterSeconds,
          },
        };
      }

      /*
       * And the mirror image: one 401, for every possible reason.
       *
       * Wrong code, expired code, code already redeemed, code issued for a
       * different address, attempts exhausted, address with no account,
       * locked-out account — all of them land on the same problem document
       * with the same wording. A fixture that distinguished any of them would
       * let a client ship copy that distinguishes them too, and that copy is
       * an account-existence oracle written in reader-facing English.
       */
      case "POST /email/code/verify": {
        const payload = body as { email?: string; code?: string };
        const address =
          typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
        const refused = problem(
          401,
          "That code was not accepted. Request a new one and try again.",
          "invalid-code",
        );

        const record = this.emailCodes.get(address);
        if (!record || record.redeemed) return refused;
        if (record.attempts >= EMAIL_CODE_ATTEMPT_BUDGET) return refused;
        if (payload?.code !== VALID_EMAIL_CODE) {
          record.attempts += 1;
          return refused;
        }

        // One use, and the code is spent whether or not a second factor is
        // still to come — otherwise a code that stopped at `mfaRequired` would
        // remain redeemable by whoever else had it.
        record.redeemed = true;

        if (this.mfaRequired) {
          return { status: 200, body: { status: "mfaRequired", user: null } };
        }
        /*
         * The session an emailed code establishes is deliberately the weaker
         * kind. It proves control of an inbox and nothing about this device,
         * so it is marked as such and the contributor endpoints refuse it —
         * see the roles endpoint below.
         */
        this.session = {
          ...(this.session ?? user()),
          authenticationMethod: "email",
          strongAuthentication: false,
        };
        this.enrolmentTicketExpiresAt = null;
        return { status: 200, body: { status: "authenticated", user: this.session } };
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
            // The relying party the assertion is bound to. The service always
            // sends it and `webauthn.ts` reads it straight through to
            // navigator.credentials.get(); leaving it out here meant the
            // fixture was quietly exercising a code path with one fewer field
            // than production ever produces.
            rpId: new URL(this.origin).hostname,
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
        // A passkey is a second factor in its own right, so the session it
        // establishes is the strong kind.
        this.session = {
          ...(this.session ?? user()),
          authenticationMethod: "passkey",
          strongAuthentication: true,
        };
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
        // Whichever door the first leg came through, answering an
        // authenticator challenge makes the session a strong one: the reader
        // has demonstrated a second factor.
        this.session = {
          ...(this.session ?? user({ twoFactorEnabled: true })),
          twoFactorEnabled: true,
          authenticationMethod: "totp",
          strongAuthentication: true,
        };
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
          /*
           * The role check and this one are both 403s and they are not the
           * same refusal. The first is final — the account does not hold the
           * role. This one is temporary — the account holds it, but the
           * session behind the request was established with an emailed code,
           * which proves an inbox and not a device. Enrolling a passkey or an
           * authenticator app clears it in a minute, and the client is
           * expected to say so rather than showing the dead-end wording.
           */
          if (!this.session.strongAuthentication) {
            return problem(
              403,
              "This action needs a passkey or an authenticator app. Sign in again with one, or add one to your account.",
              "strong-authentication-required",
            );
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
          /*
           * True when the grant landed on an account that holds neither a
           * passkey nor an authenticator app, and therefore now has a role it
           * cannot use until it enrols one.
           *
           * This fixture holds exactly one account, so it can only answer
           * honestly about that one; a grant aimed at any other id is reported
           * as `false` rather than guessed at. That is a limit of the fixture
           * and not of the contract, and it is written down here so nobody
           * reads the `false` as a claim.
           */
          const target = decodeURIComponent(roles[1] ?? "");
          const grantedToKnownAccount = target === this.session.id;
          const awaitingSecondFactor =
            grantedToKnownAccount &&
            requested.length > 0 &&
            this.session.passkeys.length === 0 &&
            !this.session.twoFactorEnabled;

          return {
            status: 200,
            body: {
              userId: target,
              roles: ["Community", ...requested],
              awaitingSecondFactor,
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
 * Two prefixes are served. `/api/auth` is the account surface. `/api/site` is
 * the small anonymous document the prerendered site reads for the facts it
 * cannot work out for itself, including whether mail is getting out — which the
 * account screens consult before they tell anybody to check an inbox.
 *
 * Anything else is refused rather than passed through: a test that accidentally
 * makes a real network call should fail loudly, not hang.
 */
export function contractFetch(
  contract: AuthApiContract,
  options: FetchAdapterOptions = {},
): typeof fetch {
  const origin = options.origin === undefined ? contract.origin : options.origin;

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = new Headers(init?.headers);

    if (url.startsWith("/api/site/environment")) {
      contract.calls.push({
        method: init?.method ?? "GET",
        path: "/site/environment",
        body: undefined,
      });

      // The real body, field for field. Notably it says nothing about any
      // address and does not carry the provider's reply — the service refuses
      // to publish either, and a fixture that invented a richer body would let
      // a client start depending on something it will never be sent.
      return new Response(
        JSON.stringify({
          name: "Test",
          isProduction: false,
          accountEmailDelivering: contract.accountEmailDelivering,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

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
