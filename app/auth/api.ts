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
 */

import type {
  CurrentUser,
  PasskeyAuthenticationCredential,
  PasskeyLoginBeginRequest,
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
 * The readable half of the double-submit CSRF pair.
 *
 * The session cookie is HttpOnly and `SameSite`, which stops a cross-site form
 * post from carrying it in every browser that honours `SameSite` — but
 * `SameSite` is a defence this client cannot verify and does not control, and
 * it does nothing about a same-site subdomain. So the server also sets a
 * second, deliberately readable cookie, and every state-changing request
 * echoes it back in a header. An attacker on another origin can cause the
 * browser to *send* cookies; it cannot *read* them, so it cannot produce the
 * header.
 *
 * CONTRACT GAP: the specification does not mention CSRF at all. Cookie
 * authentication is not finished without it, so this is the shape assumed
 * here — cookie `sw5e_csrf`, header `X-CSRF-Token`.
 */
const CSRF_COOKIE = "sw5e_csrf";
const CSRF_HEADER = "X-CSRF-Token";

export function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== CSRF_COOKIE) continue;
    const value = decodeURIComponent(part.slice(separator + 1).trim());
    return value.length > 0 ? value : null;
  }
  return null;
}

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
 * form ends up looking like it did nothing.
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

interface ErrorBody {
  code?: unknown;
  message?: unknown;
  error?: unknown;
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

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };

  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  // Safe methods do not change state, so they neither need nor should carry a
  // CSRF token. Sending one anyway would make GET look like it mutates.
  if (method !== "GET") {
    const token = readCsrfToken();
    if (token) headers[CSRF_HEADER] = token;
  }

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
  const isJson = contentType.includes("application/json");

  if (!response.ok) {
    // A non-JSON error body means something other than the API answered:
    // the static host's 404 page, or a proxy's error page. Reporting its
    // status would blame the API for not being there.
    if (!isJson) {
      throw new ApiError("unavailable", DEFAULT_MESSAGE.unavailable, {
        status: response.status,
      });
    }
    const body = (await response.json().catch(() => ({}))) as ErrorBody;
    const kind = failureFor(response.status);
    const message =
      typeof body.message === "string" && body.message.trim().length > 0
        ? body.message
        : DEFAULT_MESSAGE[kind];
    throw new ApiError(kind, message, {
      status: response.status,
      code: typeof body.code === "string" ? body.code : null,
      fieldErrors: readFieldErrors(body.fieldErrors),
    });
  }

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
 * answer for an unauthenticated caller. Every other failure is re-thrown,
 * because "the service is down" and "you are signed out" must not look the
 * same to the caller — treating an outage as a sign-out would throw a
 * signed-in reader back to the sign-in page for a network blip.
 */
export async function getCurrentUser(signal?: AbortSignal): Promise<CurrentUser | null> {
  try {
    const body = await request<{ user: CurrentUser }>("/me", { signal });
    return body.user;
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

export function verifyEmail(token: string): Promise<VerifyEmailResponse> {
  return request<VerifyEmailResponse>("/email/verify", {
    method: "POST",
    body: { token },
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
  label?: string,
): Promise<PasskeyRegisterCompleteResponse> {
  return request<PasskeyRegisterCompleteResponse>("/passkey/register/complete", {
    method: "POST",
    body: { credential, label },
  });
}

export function beginPasskeyLogin(
  body: PasskeyLoginBeginRequest = {},
): Promise<PasskeyLoginBeginResponse> {
  return request<PasskeyLoginBeginResponse>("/passkey/login/begin", {
    method: "POST",
    body,
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

/** See the `CONTRACT GAP` note on `PasskeyRemoveResponse`. */
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
