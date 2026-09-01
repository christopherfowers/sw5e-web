/**
 * The one place this app talks to the administrative API.
 *
 * The transport, and every decision behind it, lives in `app/api/http.ts`:
 * relative paths so `connect-src 'self'` can stay closed, `same-origin`
 * credentials, no CSRF token, and problem documents decoded into `ApiError`.
 * This module is the path prefix and the shapes.
 *
 * ## Two refusals this module's callers have to tell apart
 *
 * Every route here answers **403** in two quite different situations, and the
 * `code` on the problem document is the only thing that distinguishes them. A
 * plain 403 means the account is not an administrator and that is the end of
 * the conversation. A 403 with `strong-authentication-required` means the
 * account *is* an administrator and this session was established with an
 * emailed code, which proves an inbox and nothing about a device — enrolling a
 * passkey or an authenticator and signing in again clears it in about a minute.
 * `ApiError.code` carries it, and `~/api/http` exports the literal.
 *
 * ## What must never happen to the values that come back
 *
 * `AdminUser.email` is somebody else's email address, and this is the only
 * client on the site that receives one. It must not be written into a URL, a
 * query string, `localStorage`, a log line or a link, and it must not be sent
 * anywhere except back to this API. The search term is passed as a query
 * parameter on the request itself, which is unavoidable and is same-origin over
 * TLS; the pages built on this module deliberately keep it out of the browser's
 * own address bar, where it would land in history.
 */

import { apiRequest } from "~/api/http";
import { assignRoles } from "~/auth/api";
import type {
  AccountStatusFilter,
  AdministrativeActionKind,
  AdministrativeLog,
  AdminUser,
  AdminUserDetail,
  AdminUserList,
} from "./types";

const API_ROOT = "/api/auth/admin";

/**
 * Builds a query string, omitting anything empty.
 *
 * Omitted rather than sent blank, because the service refuses a filter value it
 * does not recognise rather than ignoring it — which is the behaviour this
 * client wants, and the reason an empty string must never be sent as one. It is
 * also why `q` disappears entirely when the box is cleared instead of becoming
 * `q=`.
 */
function query(values: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }

  const rendered = search.toString();
  return rendered ? `?${rendered}` : "";
}

export interface UserDirectoryFilters {
  /**
   * An email address or a display name, matched case-insensitively.
   *
   * The service refuses anything shorter than two characters with a 400, on the
   * grounds that below that a search is an expensive synonym for "list
   * everything". Callers that want everything omit this rather than sending one
   * letter.
   */
  q?: string;
  role?: string;
  status?: AccountStatusFilter;
  page?: number;
}

/**
 * The account directory. Administrators only.
 *
 * This is the response that made the role grant usable at all: before it, the
 * grant was addressed by an account identifier that nothing in the API would
 * disclose. It carries email addresses — see the note at the top of this file
 * and `app/admin/types.ts`.
 */
export function listUsers(
  filters: UserDirectoryFilters = {},
  signal?: AbortSignal,
): Promise<AdminUserList> {
  return apiRequest<AdminUserList>(`${API_ROOT}/users${query({ ...filters })}`, {
    signal,
  });
}

/**
 * One account, with the count of drafts it has not published.
 *
 * The draft count is the one thing that will refuse a deletion, which is why it
 * is on the detail response rather than only in the 409: an administrator
 * should meet it while deciding rather than while acting.
 */
export function getUser(userId: string, signal?: AbortSignal): Promise<AdminUserDetail> {
  return apiRequest<AdminUserDetail>(
    `${API_ROOT}/users/${encodeURIComponent(userId)}`,
    { signal },
  );
}

/** What the suspension endpoint answers. */
export interface SuspensionResult {
  userId: string;
  suspension: AdminUser["suspension"];
}

/**
 * Suspends an account, or lifts a suspension.
 *
 * Declarative rather than two verbs: `suspended` is the state the account
 * should end up in, so a replayed request cannot deepen a suspension and
 * "reinstate" is not a second route somebody has to remember exists.
 *
 * A reason is **required** to suspend and **refused** when reinstating — the
 * service has nowhere to store the second, and accepting it silently would mean
 * an administrator writing an explanation that goes nowhere. Both refusals are
 * a 400.
 */
export function setSuspension(
  userId: string,
  suspended: boolean,
  reason?: string | null,
): Promise<SuspensionResult> {
  return apiRequest<SuspensionResult>(
    `${API_ROOT}/users/${encodeURIComponent(userId)}/suspension`,
    {
      method: "PUT",
      // The reason is dropped rather than passed through when reinstating: the
      // service refuses a reason on that branch with a 400, and sending one
      // because a form field happened to still hold text would turn a
      // reinstatement into an error the administrator did not cause.
      body: { suspended, reason: suspended ? (reason ?? null) : null },
    },
  );
}

/** What the deletion endpoint answers. */
export interface DeletionResult {
  userId: string;
  /**
   * Always true, and worth reading anyway. Deleting an account does not delete
   * what it wrote; the interface repeats this to the administrator who pressed
   * the button rather than leaving it in a document they read once.
   */
  authorshipRetained: boolean;
}

/**
 * Deletes an account. Not reversible.
 *
 * The reason travels in the body rather than in a query string, because a
 * sentence naming a person and describing their conduct does not belong in a
 * URL that every access log between here and the process writes down.
 *
 * The refusal worth branching on is a **409** with
 * `code: "drafts-outstanding"`. It is not a generic conflict: it means the
 * account owns unpublished work that would otherwise be left attributed to
 * nobody, blocking anybody else from editing those entries, and the fix is to
 * publish or discard it first.
 */
export function deleteUser(
  userId: string,
  reason?: string | null,
): Promise<DeletionResult> {
  return apiRequest<DeletionResult>(`${API_ROOT}/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    body: { reason: reason ?? null },
  });
}

export interface AdministrativeLogFilters {
  subjectId?: string;
  actorId?: string;
  action?: AdministrativeActionKind;
  page?: number;
}

/**
 * The administrative log: role changes, suspensions, reinstatements and
 * deletions, newest first.
 *
 * Filtering by `subjectId` is what answers "how did this account get that
 * role", which is the question somebody disputing a decision actually asks.
 * Filtering by `actorId` answers "what has this administrator done", which is
 * the question asked when an administrator's account is believed to be
 * compromised.
 */
export function listAdministrativeActions(
  filters: AdministrativeLogFilters = {},
  signal?: AbortSignal,
): Promise<AdministrativeLog> {
  return apiRequest<AdministrativeLog>(`${API_ROOT}/audit${query({ ...filters })}`, {
    signal,
  });
}

/**
 * Sets an account's roles.
 *
 * Re-exported through this module rather than imported from `~/auth/api` at
 * every call site. The endpoint belongs to the administrative surface, and a
 * page that reached into the account client for one of its five calls is a page
 * whose imports no longer say what it talks to.
 */
export { assignRoles };
