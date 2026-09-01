/**
 * The shape of the flagging API, written down.
 *
 * The same rule as `app/auth/types.ts`: these are wire strings, spelled exactly
 * as the service spells them, and getting one wrong is silent. A reason name
 * that does not match is not a type error — it is a 400 the reader meets after
 * writing out what they wanted to report.
 *
 * Nothing here is rendered as markup anywhere. `details` and `reviewerNote` are
 * written by people, and every component that shows them puts them in a text
 * node. See `app/routes/account-flags.tsx`.
 */

/**
 * Why somebody is reporting something.
 *
 * Ordered as the service orders them: the five that are about pictures, the
 * four that are about writing, and `other`, which belongs to both. The split
 * matters to this client because the two menus it draws are drawn from it — a
 * reader reporting a portrait is never offered "the saving throw is wrong".
 */
export const IMAGE_REASONS = [
  "image-artist-known",
  "image-attribution-missing",
  "image-replacement-wanted",
  "image-rights-complaint",
  "image-wrong-subject",
  "other",
] as const;

export const DOCUMENT_REASONS = [
  "text-error",
  "content-incorrect",
  "content-missing",
  "source-attribution",
  "other",
] as const;

export type ImageReason = (typeof IMAGE_REASONS)[number];
export type DocumentReason = (typeof DOCUMENT_REASONS)[number];
export type FlagReason = ImageReason | DocumentReason;

/**
 * Where a report has got to.
 *
 * `open` and `accepted` are both outstanding: the first means nobody has
 * looked, the second means a reviewer agreed and the work is not done. The
 * distinction is the queue's whole reason for being usable — see the service's
 * own notes — and this client has to keep it rather than collapsing both into
 * "pending".
 */
export const FLAG_STATUSES = ["open", "accepted", "declined", "resolved"] as const;

export type FlagStatus = (typeof FLAG_STATUSES)[number];

/** Whether a report is about a picture or about writing. Derived by the server. */
export type FlagTargetKind = "document" | "image";

export function isFlagStatus(value: unknown): value is FlagStatus {
  return typeof value === "string" && (FLAG_STATUSES as readonly string[]).includes(value);
}

/**
 * An account named on a report.
 *
 * `displayName` is genuinely nullable: a report outlives the account that filed
 * it, so every place that shows this needs an answer for the empty case rather
 * than rendering "null" at somebody.
 *
 * It is also user-chosen text and is shown to reviewers, so it is escaped
 * exactly like the free text is.
 */
export interface FlagAccount {
  id: string;
  displayName: string | null;
}

/** `POST /api/flags` */
export interface RaiseFlagRequest {
  reason: FlagReason;
  /**
   * A content type key or route segment. For a picture this is
   * `asset-credit`, and the key is `{group}-{key}` — the site's own image
   * naming, so `species-wookiee` and `classes-guardian`.
   */
  targetType: string;
  targetKey: string;
  /** Optional except for `other`. Capped by the service at 1,000 characters. */
  details?: string | null;
}

/**
 * One report.
 *
 * `reviewerNote` is always null on a reporter's own list: it is a triage note
 * written between the people working the queue, and the service withholds it
 * rather than this client choosing not to draw it.
 */
export interface Flag {
  id: string;
  targetKind: FlagTargetKind;
  targetType: string;
  targetKey: string;
  /**
   * The document's name as it was when the report was filed. Copied by the
   * service rather than joined, so a report about something since renamed or
   * retired still says what the reporter was looking at.
   */
  targetName: string;
  reason: string;
  details: string | null;
  status: FlagStatus;
  /** ISO-8601. */
  createdAt: string;
  reporter: FlagAccount;
  reviewedAt: string | null;
  reviewedBy: FlagAccount | null;
  reviewerNote: string | null;
}

export interface FlagList {
  flags: Flag[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

/** A count against one named bucket. */
export interface FlagCount {
  key: string;
  count: number;
}

/** One document, with how many outstanding reports it carries. */
export interface FlagTargetSummary {
  targetKind: FlagTargetKind;
  targetType: string;
  targetKey: string;
  targetName: string;
  outstandingCount: number;
}

/**
 * `GET /api/flags/summary`
 *
 * The queue is entered through this rather than through rows. Around a hundred
 * and fifty of the site's pictures have no recorded artist, so the raw list is
 * long and repetitive on its first day, and one typo report in the middle of it
 * would never be seen by anybody paging through in date order.
 *
 * `byReason` carries only the reasons with something outstanding. `byStatus`
 * carries all four, including the empty ones, because the page draws a row per
 * state and a missing one would read as a page that failed to load.
 */
export interface FlagSummary {
  total: number;
  outstanding: number;
  byStatus: FlagCount[];
  byReason: FlagCount[];
  mostFlagged: FlagTargetSummary[];
}

/** `PUT /api/flags/{id}/status` */
export interface UpdateFlagStatusRequest {
  status: FlagStatus;
  note?: string | null;
}
