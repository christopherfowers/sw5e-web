/**
 * The one place this app talks to the account API.
 *
 * Three decisions are worth more than the code they produce.
 *
 * **Same-origin, always.** Every path here is relative, so requests go to the
 * origin serving the page. That is not a convenience: this site's
 * Content-Security-Policy sets `connect-src 'self'` with no host named, and
 * CI fails the build if any external origin appears in it. An API on another
 * origin would have to widen that policy, and would drag CORS preflights and
 * third-party cookie rules along with it. The deployment puts the API behind
 * the same reverse proxy under `/api`, which keeps the policy at `'self'` and
 * lets the session cookie be `SameSite=Strict`.
 *
 * **`credentials: "same-origin"`, not `"include"`.** The two behave alike for
 * a same-origin request, but they fail differently: `"include"` would keep
 * sending the session cookie if a path here ever became absolute, which is
 * precisely the mistake worth making impossible. `"same-origin"` drops
 * credentials the moment the request stops being same-origin.
 *
 * **The session cookie is never read here.** It is HttpOnly, so JavaScript
 * cannot see it, and code that tries teaches the next reader that the cookie
 * is readable. `getCurrentUser()` — a round trip — is how this client learns
 * whether it has a session.
 *
 * ## Cross-site request protection, and why there is no token in this file
 *
 * There is no CSRF token here and there must not be one. The API does not use
 * double-submit; it checks provenance directly. Every unsafe method is required
 * to arrive with `Sec-Fetch-Site: same-origin` or with an `Origin` on the
 * service's allow-list, and anything else is refused with a bodiless 403. That
 * was confirmed against the running service: no `Origin` header answers 403, a
 * foreign `Origin` answers 403, and the site's own origin answers 200.
 *
 * The browser writes both of those headers itself on every state-changing
 * fetch, and script cannot forge or suppress either — they are forbidden header
 * names. So a same-origin client has nothing to do, which is the whole appeal
 * of the scheme. A readable CSRF cookie would only hand JavaScript a credential
 * to look after, and buy nothing in exchange: the case double-submit is usually
 * defended for, a hostile same-site subdomain, is covered here too, because a
 * subdomain is a different origin and a different origin is not on the
 * allow-list.
 *
 * The practical consequence for this module is that a 403 is a real answer
 * rather than a bug to paper over. It means the request did not look like it
 * came from this site, and no header this code can set would change that.
 */

import type {
  AssignableRole,
  AssignRolesResponse,
  CurrentUser,
  EmailCodeResponse,
  EmailCodeVerifyResponse,
  PasskeyAuthenticationCredential,
  PasskeyLoginBeginResponse,
  PasskeyLoginCompleteResponse,
  PasskeyRegisterBeginResponse,
  PasskeyRegisterCompleteResponse,
  PasskeyRegistrationCredential,
  PasskeyRemoveResponse,
  RegisterRequest,
  RegisterResponse,
  TotpEnrollResponse,
  TotpVerifyResponse,
  VerifyEmailResponse,
} from "./types";

const API_ROOT = "/api/auth";

/**
 * Everything this UI needs to tell a reader why a request failed, without
 * showing them a status code.
 *
 * `unavailable` is its own kind rather than a status, because it is the only
 * failure a reader can do nothing about and the only one where retrying is
 * the right advice. It covers a dropped connection and the case that matters
 * during a partial deploy: the API is not mounted, so `/api/auth/me` is
 * answered by the static host with an HTML page instead of JSON.
 */
export type ApiFailure =
  | "unauthenticated"
  | "forbidden"
  | "invalid"
  | "conflict"
  | "rate-limited"
  | "server"
  | "unavailable";

/**
 * The `code` on the 403 that means "this session is not strong enough", as
 * opposed to "this account is not allowed".
 *
 * The two are worth telling apart everywhere they can be. A plain forbidden is
 * the end of the conversation — the account does not hold the role, and
 * nothing the reader does in this browser changes that. This one is the
 * opposite: the account holds the role, the session was simply established
 * with an emailed code rather than with a passkey or an authenticator, and
 * enrolling either one fixes it in about a minute. Rendering the first
 * sentence at somebody in the second situation tells them to give up on
 * something they are two clicks from having.
 *
 * The literal lives here rather than at the call sites so that a rename on the
 * service is one edit, and so that a typo is a compile error at every site
 * that imports it rather than a branch that silently stops matching.
 */
export const STRONG_AUTHENTICATION_REQUIRED = "strong-authentication-required";

export class ApiError extends Error {
  readonly kind: ApiFailure;
  readonly status: number;
  /** A machine-readable reason from the server, when it sent one. */
  readonly code: string | null;
  /** Field name to message, for a response that rejected specific input. */
  readonly fieldErrors: Record<string, string>;

  constructor(
    kind: ApiFailure,
    message: string,
    options: {
      status?: number;
      code?: string | null;
      fieldErrors?: Record<string, string>;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = options.status ?? 0;
    this.code = options.code ?? null;
    this.fieldErrors = options.fieldErrors ?? {};
  }
}

function failureFor(status: number): ApiFailure {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 409) return "conflict";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "server";
  return "invalid";
}

/**
 * The reader-facing default for each kind of failure.
 *
 * A server message is preferred when one arrives, but there has to be
 * something sensible to say when it does not — an empty error region is how a
 * form ends up looking like it did nothing. These defaults carry more weight
 * than they look like they should: the API answers several of its most common
 * failures with no body at all, deliberately, so this table is what the reader
 * actually sees for a signed-out session and for a refused cross-site request.
 */
const DEFAULT_MESSAGE: Record<ApiFailure, string> = {
  unauthenticated: "You are not signed in.",
  forbidden: "Your account does not have access to that.",
  invalid: "That request could not be completed. Check the details and try again.",
  conflict: "That conflicts with something already on the account.",
  "rate-limited": "Too many attempts. Wait a moment and try again.",
  server: "The account service had a problem. Try again shortly.",
  unavailable:
    "The account service could not be reached. Check your connection and try again.",
};

/**
 * An RFC 9457 problem document, plus the two properties this client also
 * accepts. The API sends `detail`; `message` is kept because a proxy or an
 * older build may still answer with one, and reading both costs nothing.
 */
interface ErrorBody {
  code?: unknown;
  detail?: unknown;
  title?: unknown;
  message?: unknown;
  fieldErrors?: unknown;
}

function readFieldErrors(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [field, message] of Object.entries(value as Record<string, unknown>)) {
    if (typeof message === "string") out[field] = message;
  }
  return out;
}

/**
 * Whether a body is worth parsing as JSON.
 *
 * `application/problem+json` is the content type every error from this API
 * carries, and it does not contain the substring `application/json` — so the
 * obvious check silently classified every 400, 409 and 429 as "the service is
 * not there". Matching the structured-syntax suffix as well is what stops that.
 */
function isJsonContentType(contentType: string): boolean {
  return contentType.includes("application/json") || contentType.includes("+json");
}

/** The first usable sentence out of a problem document, or null. */
function readMessage(body: ErrorBody): string | null {
  for (const candidate of [body.detail, body.message, body.title]) {
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate;
  }
  return null;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };

  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method,
      headers,
      credentials: "same-origin",
      // A cross-origin redirect would take the request somewhere this policy
      // never agreed to; failing is better than following.
      redirect: "error",
      cache: "no-store",
      signal: options.signal,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    // An aborted request is the caller's own doing — a component unmounting,
    // usually — and must not be reported to the reader as a failure.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("unavailable", DEFAULT_MESSAGE.unavailable);
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = isJsonContentType(contentType);

  if (!response.ok) {
    /*
     * The status decides what the failure *is*; the body only decides how it
     * is worded. That ordering is the whole point of this branch, and getting
     * it backwards is what made a signed-out visitor look like an outage.
     *
     * Several of this API's most common refusals carry no body whatsoever. The
     * anonymous 401 from `/me` is the cookie scheme's own challenge, written
     * before any handler runs, so it has no content-type and zero bytes; the
     * 403 from the cross-site filter is deliberately mute, because the service
     * will not say which header it disliked. Deriving the kind from the body
     * meant both fell through to `unavailable`, and every signed-out reader was
     * told the account service was down instead of simply being offered a way
     * to sign in.
     *
     * The one thing a body still decides is whether this was the API at all. A
     * 404 or a 5xx carrying HTML is the static host or a proxy answering in the
     * API's place during a partial deploy, and reporting its status would blame
     * the API for not being mounted. An authentication status is never that:
     * nothing but the API has any reason to answer 401 or 403.
     */
    const kind = failureFor(response.status);
    const speaksForTheApi = kind === "unauthenticated" || kind === "forbidden";

    if (!isJson && !speaksForTheApi) {
      throw new ApiError("unavailable", DEFAULT_MESSAGE.unavailable, {
        status: response.status,
      });
    }

    const body = isJson
      ? ((await response.json().catch(() => ({}))) as ErrorBody)
      : ({} as ErrorBody);

    throw new ApiError(kind, readMessage(body) ?? DEFAULT_MESSAGE[kind], {
      status: response.status,
      code: typeof body.code === "string" ? body.code : null,
      fieldErrors: readFieldErrors(body.fieldErrors),
    });
  }

  // A success that is not JSON is the partial-deploy case in its purest form:
  // the static host answered 200 with the SPA shell for a path the API was
  // supposed to own.
  if (!isJson) {
    throw new ApiError("unavailable", DEFAULT_MESSAGE.unavailable, {
      status: response.status,
    });
  }

  return (await response.json()) as T;
}

/* ------------------------------------------------------------------ session */

/**
 * Who the browser is, according to the server.
 *
 * `null` means "definitely nobody": a 401, which is the API's documented
 * answer for an unauthenticated caller — bodiless, since the cookie scheme
 * challenges before any handler runs. Every other failure is re-thrown,
 * because "the service is down" and "you are signed out" must not look the
 * same to the caller — treating an outage as a sign-out would throw a
 * signed-in reader back to the sign-in page for a network blip.
 */
export async function getCurrentUser(signal?: AbortSignal): Promise<CurrentUser | null> {
  try {
    // No envelope. The account object is the entire response body.
    return await request<CurrentUser>("/me", { signal });
  } catch (error) {
    if (error instanceof ApiError && error.kind === "unauthenticated") return null;
    throw error;
  }
}

export async function logout(): Promise<void> {
  await request<void>("/logout", { method: "POST" });
}

/* ------------------------------------------------------------- registration */

export function register(body: RegisterRequest): Promise<RegisterResponse> {
  return request<RegisterResponse>("/register", { method: "POST", body });
}

/**
 * Both halves of the emailed link are required. The token is scoped to the
 * address it was issued for, so a link that arrived without its `email`
 * parameter cannot be completed at all.
 */
export function verifyEmail(email: string, token: string): Promise<VerifyEmailResponse> {
  return request<VerifyEmailResponse>("/email/verify", {
    method: "POST",
    body: { email, token },
  });
}

/* ------------------------------------------------- signing in with a code */

/**
 * Asks for a one-time code to be emailed to `email`.
 *
 * The answer is a 202 for every address the service will parse — registered,
 * unregistered, or already over its budget of codes for the last quarter hour.
 * A caller that tries to read anything else out of it has misunderstood the
 * endpoint; see `EmailCodeResponse`.
 *
 * A 400 means the address was malformed and a 429 means this caller's own IP
 * budget is spent, and those two really are different from each other and from
 * the 202. Both arrive as an `ApiError` like every other refusal here.
 */
export function requestSignInCode(email: string): Promise<EmailCodeResponse> {
  return request<EmailCodeResponse>("/email/code", {
    method: "POST",
    body: { email },
  });
}

/**
 * Redeems a code for the address it was sent to.
 *
 * Both halves are required and both are checked: a code is issued for one
 * address, and offering it with another fails the same way a wrong code does.
 *
 * A 401 is a real answer rather than a bug — the same 401 for every possible
 * reason, by design — so callers report it as "that code was not accepted" and
 * must not try to say which of the reasons applied. `getCurrentUser` is the
 * only place in this module where a 401 is converted into a value instead of
 * being thrown.
 */
export function verifySignInCode(
  email: string,
  code: string,
): Promise<EmailCodeVerifyResponse> {
  return request<EmailCodeVerifyResponse>("/email/code/verify", {
    method: "POST",
    body: { email, code },
  });
}

/* ----------------------------------------------------------------- passkeys */

export function beginPasskeyRegistration(): Promise<PasskeyRegisterBeginResponse> {
  return request<PasskeyRegisterBeginResponse>("/passkey/register/begin", {
    method: "POST",
  });
}

export function completePasskeyRegistration(
  credential: PasskeyRegistrationCredential,
  name?: string | null,
): Promise<PasskeyRegisterCompleteResponse> {
  return request<PasskeyRegisterCompleteResponse>("/passkey/register/complete", {
    method: "POST",
    body: { credential, name: name ?? null },
  });
}

/**
 * No argument and no body. The API ignores anything sent here and never takes
 * an email address, so accepting one would be offering the caller a parameter
 * that cannot affect the answer.
 */
export function beginPasskeyLogin(): Promise<PasskeyLoginBeginResponse> {
  return request<PasskeyLoginBeginResponse>("/passkey/login/begin", {
    method: "POST",
  });
}

export function completePasskeyLogin(
  credential: PasskeyAuthenticationCredential,
): Promise<PasskeyLoginCompleteResponse> {
  return request<PasskeyLoginCompleteResponse>("/passkey/login/complete", {
    method: "POST",
    body: { credential },
  });
}

/**
 * Revokes one credential. The server answers 409 with `code:
 * "last-credential"` rather than stranding an account with no way back in, so
 * callers have to be ready for a refusal as well as a 404.
 */
export function removePasskey(id: string): Promise<PasskeyRemoveResponse> {
  return request<PasskeyRemoveResponse>(
    `/passkey/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

/* --------------------------------------------------------------------- MFA */

export function enrollTotp(): Promise<TotpEnrollResponse> {
  return request<TotpEnrollResponse>("/mfa/totp/enroll", { method: "POST" });
}

export function verifyTotp(code: string): Promise<TotpVerifyResponse> {
  return request<TotpVerifyResponse>("/mfa/totp/verify", {
    method: "POST",
    body: { code },
  });
}

/* ----------------------------------------------------------------- admin */

/**
 * Sets an account's roles, for an administrator.
 *
 * `PUT` rather than `POST` because the call is declarative: `roles` is the
 * complete set the account should end up holding, and anything left out of it
 * is revoked. A caller granting one role has to send the ones already held
 * alongside it.
 *
 * `AssignableRole` rather than `Role`: `Community` is the floor every account
 * already stands on, and the API answers 400 to any attempt to assign it.
 */
export function assignRoles(
  userId: string,
  roles: AssignableRole[],
): Promise<AssignRolesResponse> {
  return request<AssignRolesResponse>(
    `/admin/users/${encodeURIComponent(userId)}/roles`,
    { method: "PUT", body: { roles } },
  );
}
