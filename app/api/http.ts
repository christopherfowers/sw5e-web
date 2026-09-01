/**
 * The one transport this app uses to reach its own API.
 *
 * Lifted out of `app/auth/api.ts` when a second feature — content flagging —
 * needed to talk to the same service under a different path prefix. Nothing
 * about the rules below is specific to accounts, and duplicating them for a
 * second client is how one of the two copies quietly stops treating
 * `application/problem+json` as JSON, or starts following a redirect off this
 * origin.
 *
 * Three decisions are worth more than the code they produce.
 *
 * **Same-origin, always.** Every path handed to `apiRequest` is relative, so
 * requests go to the origin serving the page. That is not a convenience: this
 * site's Content-Security-Policy sets `connect-src 'self'` with no host named,
 * and CI fails the build if any external origin appears in it. An API on
 * another origin would have to widen that policy, and would drag CORS
 * preflights and third-party cookie rules along with it. The deployment puts
 * the API behind the same reverse proxy under `/api`, which keeps the policy at
 * `'self'` and lets the session cookie be `SameSite=Strict`.
 *
 * **`credentials: "same-origin"`, not `"include"`.** The two behave alike for a
 * same-origin request, but they fail differently: `"include"` would keep
 * sending the session cookie if a path here ever became absolute, which is
 * precisely the mistake worth making impossible. `"same-origin"` drops
 * credentials the moment the request stops being same-origin.
 *
 * **The session cookie is never read here.** It is HttpOnly, so JavaScript
 * cannot see it, and code that tries teaches the next reader that the cookie is
 * readable. A round trip is how this client learns whether it has a session.
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
 * The practical consequence is that a 403 is a real answer rather than a bug to
 * paper over. It means the request did not look like it came from this site,
 * and no header this code can set would change that.
 */

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
  /**
   * Everything else the problem document carried.
   *
   * RFC 9457 lets a problem document carry members beyond the five it defines,
   * and this API uses that: a schema refusal carries `schemaErrors`, a refused
   * flag transition carries the `status` the report actually reached. Those are
   * facts about one feature, and teaching this transport the name of each one
   * would make a module that is supposed to know nothing about features
   * accumulate a field per feature.
   *
   * So the standard members are lifted out above and the rest is handed over
   * whole, for the feature that understands it to read. It is `unknown` on
   * purpose: this is a document written by somebody else, and the only honest
   * type for it is one that forces the reader to check.
   */
  readonly extensions: Readonly<Record<string, unknown>>;

  constructor(
    kind: ApiFailure,
    message: string,
    options: {
      status?: number;
      code?: string | null;
      fieldErrors?: Record<string, string>;
      extensions?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = options.status ?? 0;
    this.code = options.code ?? null;
    this.fieldErrors = options.fieldErrors ?? {};
    this.extensions = options.extensions ?? {};
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

/**
 * The five members RFC 9457 defines, plus the ones this module already reads
 * out of the body by name above. Everything outside this set is an extension
 * and is handed to the caller untouched.
 *
 * `message` is here because {@link readMessage} reads it — it is not an RFC
 * member, and it is listed for the same reason the real ones are: a member this
 * module has already turned into a field must not also arrive as an extension,
 * or a feature reading extensions would find a second copy of something it has
 * been given properly.
 */
const STANDARD_PROBLEM_MEMBERS = new Set([
  "type",
  "title",
  "status",
  "detail",
  "instance",
  "message",
  "code",
  "fieldErrors",
]);

function readExtensions(body: ErrorBody): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [member, value] of Object.entries(body as Record<string, unknown>)) {
    if (!STANDARD_PROBLEM_MEMBERS.has(member)) out[member] = value;
  }
  return out;
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

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * One request to this site's own API.
 *
 * `path` is an absolute path on this origin — `/api/auth/me`, `/api/flags` —
 * and never a URL. A caller that assembled an absolute URL here would defeat
 * both the CSP rule and the `same-origin` credentials mode in one line, so the
 * prefix belongs to the caller and the origin belongs to nobody.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };

  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(path, {
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
      extensions: readExtensions(body),
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
