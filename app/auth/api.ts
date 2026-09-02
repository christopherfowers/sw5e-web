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

import { apiRequest, ApiError, type RequestOptions } from "~/api/http";

export {
  ApiError,
  STRONG_AUTHENTICATION_REQUIRED,
  type ApiFailure,
} from "~/api/http";

const API_ROOT = "/api/auth";

/**
 * One request to the account API.
 *
 * A thin prefix over the shared transport in `app/api/http.ts`, which holds
 * everything about how this site talks to its own service. The prefix stays
 * here so that no caller in this module writes `/api/auth` out by hand.
 */
function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return apiRequest<T>(`${API_ROOT}${path}`, options);
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

/* ----------------------------------------------------------- re-authentication */

/**
 * Proving a second factor on a session that already exists.
 *
 * Separate endpoints from the sign-in pair above, and separate for a reason
 * worth stating where the calls are: these require a session and cannot create
 * one, so neither is a route into an account. What they change is the claim on
 * the cookie the caller already holds — see the guard, which is the only place
 * that offers them.
 *
 * The begin call names the signed-in account server-side, so the browser
 * prompts for that account's credentials rather than for every passkey it
 * holds for the site.
 */
export function beginReauthentication(): Promise<PasskeyLoginBeginResponse> {
  return request<PasskeyLoginBeginResponse>("/reauthenticate/passkey/begin", {
    method: "POST",
  });
}

export function completeReauthentication(
  credential: PasskeyAuthenticationCredential,
): Promise<CurrentUser> {
  return request<CurrentUser>("/reauthenticate/passkey/complete", {
    method: "POST",
    body: { credential },
  });
}

export function reauthenticateWithTotp(code: string): Promise<CurrentUser> {
  return request<CurrentUser>("/reauthenticate/totp", {
    method: "POST",
    body: { code },
  });
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
