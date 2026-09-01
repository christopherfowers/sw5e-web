/**
 * The one place this app talks to the flagging API.
 *
 * The transport, and every decision behind it, lives in `app/api/http.ts`:
 * relative paths so `connect-src 'self'` can stay closed, `same-origin`
 * credentials, no CSRF token, and problem documents decoded into `ApiError`.
 * This module is the path prefix and the shapes.
 *
 * Nothing here escapes or sanitises anything. Free text goes out as the reader
 * typed it and comes back as it was stored, and the components that render it
 * put it in a text node — which is the only place that knows what it is
 * escaping for. A helper here that "cleaned" the text would double-encode what
 * React is already going to escape, and would quietly change what a reporter
 * actually said.
 */

import { apiRequest } from "~/api/http";
import type {
  Flag,
  FlagList,
  FlagStatus,
  FlagSummary,
  RaiseFlagRequest,
} from "./types";

const API_ROOT = "/api/flags";

/**
 * Files a report.
 *
 * Answers 201 with the stored report. The failures worth branching on are a
 * 404 — nothing here has that key — a 409 with `code: "duplicate-report"`, and
 * a 429 which may be either the per-caller window or the account's own daily
 * quota. `ApiError.fieldErrors` names the field on a 400.
 */
export function raiseFlag(body: RaiseFlagRequest): Promise<Flag> {
  return apiRequest<Flag>(API_ROOT, { method: "POST", body });
}

/**
 * The reports the signed-in account has filed.
 *
 * Reviewer notes are never present here: the service withholds them, because
 * they are written between the people working the queue. What a reporter gets
 * is the state their report reached and when, which is what stops reporting
 * feeling like writing into a void.
 */
export function listOwnFlags(signal?: AbortSignal): Promise<FlagList> {
  return apiRequest<FlagList>(`${API_ROOT}/mine`, { signal });
}

export interface QueueFilters {
  /** A status, or "all". Omitted means the outstanding ones. */
  status?: FlagStatus | "all";
  reason?: string;
  targetKind?: "document" | "image";
  targetType?: string;
  targetKey?: string;
  page?: number;
}

/**
 * The review queue. Contributors and administrators only, and only from a
 * session that used a passkey or an authenticator code.
 *
 * Filters are omitted rather than sent empty, because the service refuses a
 * value it does not recognise rather than ignoring it — which is the behaviour
 * this client wants and the reason an empty string must never be sent as one.
 */
export function listFlags(
  filters: QueueFilters = {},
  signal?: AbortSignal,
): Promise<FlagList> {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }

  const search = query.toString();

  return apiRequest<FlagList>(search ? `${API_ROOT}?${search}` : API_ROOT, { signal });
}

/** Counts by status and reason, and the documents carrying the most reports. */
export function flagSummary(signal?: AbortSignal): Promise<FlagSummary> {
  return apiRequest<FlagSummary>(`${API_ROOT}/summary`, { signal });
}

/**
 * Moves one report through the lifecycle.
 *
 * A 409 with `code: "invalid-transition"` means somebody else acted on the row
 * since this page was drawn — its `status` extension says where it got to — and
 * is worth reporting as that rather than as a generic conflict.
 *
 * The identifier is percent-encoded on its way into the path. It is a
 * server-issued GUID today, and a value that reaches a URL should never depend
 * on that staying true.
 */
export function updateFlagStatus(
  id: string,
  status: FlagStatus,
  note?: string | null,
): Promise<Flag> {
  return apiRequest<Flag>(`${API_ROOT}/${encodeURIComponent(id)}/status`, {
    method: "PUT",
    body: { status, note: note ?? null },
  });
}
