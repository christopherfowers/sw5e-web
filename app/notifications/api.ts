/**
 * Reading and clearing this account's notifications.
 *
 * Every route here answers for whoever is signed in and takes no account
 * parameter. There is no way to ask for somebody else's, which is a property
 * of the service rather than of this file, but worth knowing while reading it:
 * nothing below needs to pass an identity, so nothing below can pass the wrong
 * one.
 */

import { apiRequest } from "~/api/http";

/** What happened. The service writes only these. */
export type NotificationKind =
  | "content.published"
  | "content.reverted"
  | "flag.raised"
  | "flag.resolved"
  | "account.role_granted"
  | "account.suspended";

export interface Notification {
  id: number;
  kind: NotificationKind;
  subjectType: string | null;
  subjectKey: string | null;
  /**
   * What the line needs in order to read.
   *
   * Carried by the notification rather than looked up, so a document renamed
   * after the fact does not rewrite what this said at the time. Every value is
   * text somebody typed, and is drawn as text.
   */
  detail: Record<string, string>;
  createdAt: string;
  read: boolean;
}

export interface NotificationPage {
  items: Notification[];
  /** Pass as `before` for the next page, or null at the end. */
  nextCursor: number | null;
}

/**
 * How many this account has not read.
 *
 * Its own call because the header asks on every page, while the list is asked
 * for only when somebody opens the panel.
 */
export function countUnread(signal?: AbortSignal): Promise<{ unread: number }> {
  return apiRequest<{ unread: number }>("/api/notifications/count", { signal });
}

export function listNotifications(
  options: { unread?: boolean; limit?: number; before?: number } = {},
  signal?: AbortSignal,
): Promise<NotificationPage> {
  const query = new URLSearchParams();
  if (options.unread) query.set("unread", "true");
  if (options.limit) query.set("limit", String(options.limit));
  if (options.before) query.set("before", String(options.before));

  const suffix = query.size > 0 ? `?${query.toString()}` : "";

  return apiRequest<NotificationPage>(`/api/notifications/${suffix}`, { signal });
}

export function markRead(ids: number[]): Promise<{ marked: number }> {
  return apiRequest<{ marked: number }>("/api/notifications/read", {
    method: "POST",
    body: { ids },
  });
}

export function markAllRead(): Promise<{ marked: number }> {
  return apiRequest<{ marked: number }>("/api/notifications/read-all", {
    method: "POST",
  });
}
