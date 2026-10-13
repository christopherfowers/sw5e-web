/**
 * The bell in the site header.
 *
 * ## It draws nothing until the session resolves
 *
 * Every page on this site is a static file served to everybody, written at
 * build time when nobody was signed in. A bell baked into those files would
 * appear for anonymous readers and then change its mind, which is the same
 * mistake `AccountControl` goes to some trouble to avoid. This renders null
 * while the session is loading and for anyone signed out.
 *
 * ## The count is polled, because there is nothing to push from
 *
 * There is no runtime server and no socket. The count is fetched when the bell
 * mounts, again on navigation, and on a slow interval. Sixty seconds is plenty
 * for a reference site: this is somewhere people correct rules text, not a
 * chat application, and a tighter loop would buy nothing but requests.
 *
 * The interval is also paused while the tab is hidden. A browser left open on
 * this site for a week should not spend that week asking.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

import { useSession } from "~/auth/session";

import { countUnread, listNotifications, markAllRead, markRead, type Notification } from "./api";
import { NotificationLine } from "./line";

/** How often to ask, while the tab is in front. */
const POLL_MS = 60_000;

/** How many the panel shows before sending somebody to the full list. */
const PANEL_SIZE = 8;

export function NotificationBell() {
  const session = useSession();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const signedIn = session.status === "authenticated";

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const { unread: count } = await countUnread(signal);
      if (!signal?.aborted) setUnread(count);
    } catch {
      // Left at whatever it was. A failed count is not worth telling anybody
      // about: the bell is an affordance, not the work, and a reader who is
      // briefly offline does not need an error in the header about it.
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;

    const abort = new AbortController();

    /*
      Queued rather than called straight away.

      `refresh` settles into a setState, and starting it in the effect body
      makes that a synchronous update on a component that has only just
      painted, which costs a second render of every page on the site. A
      timeout of zero puts the first ask after the paint, where the interval's
      asks already are.
    */
    const first = window.setTimeout(() => void refresh(abort.signal), 0);

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(abort.signal);
    }, POLL_MS);

    return () => {
      abort.abort();
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
    // The location is a dependency so that navigating asks again, which is
    // what makes the count feel current without a tighter interval.
  }, [signedIn, location.key, refresh]);

  // Closes on a click anywhere else, as a menu should.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!panel.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!signedIn) return null;

  async function toggle() {
    const next = !open;
    setOpen(next);

    if (!next) return;

    try {
      const page = await listNotifications({ limit: PANEL_SIZE });
      setItems(page.items);
    } catch {
      setItems([]);
    }
  }

  async function clearAll() {
    // Moved first, then written. The reader pressed a button whose entire
    // purpose is to empty the count; leaving it full until a round trip
    // finishes reads as the button not having worked.
    setUnread(0);
    setItems((was) => was?.map((one) => ({ ...one, read: true })) ?? was);

    try {
      await markAllRead();
    } catch {
      void refresh();
    }
  }

  async function follow(id: number) {
    setUnread((count) => Math.max(0, count - 1));

    try {
      await markRead([id]);
    } catch {
      void refresh();
    }
  }

  return (
    <div className="notification-bell" ref={panel}>
      <button
        type="button"
        className="notification-bell-button"
        aria-expanded={open}
        aria-haspopup="true"
        /*
          The count is in the label rather than only in the badge, because a
          badge is a number with no noun attached and reads as "3" to anybody
          not looking at it.
        */
        aria-label={
          unread === 0
            ? "Notifications, none unread"
            : `Notifications, ${unread} unread`
        }
        onClick={toggle}
      >
        <BellIcon />
        {unread > 0 ? (
          <span className="notification-badge" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="notification-panel" role="dialog" aria-label="Notifications">
          <div className="notification-panel-head">
            <h2>Notifications</h2>
            {unread > 0 ? (
              <button type="button" className="notification-clear" onClick={clearAll}>
                Mark all read
              </button>
            ) : null}
          </div>

          {items === null ? (
            <p className="auth-note">Reading&hellip;</p>
          ) : items.length === 0 ? (
            <p className="auth-note">Nothing yet.</p>
          ) : (
            <ul className="notification-list">
              {items.map((one) => (
                <li key={one.id} data-unread={one.read ? undefined : true}>
                  <NotificationLine notification={one} onFollow={follow} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function BellIcon() {
  return (
    <svg
      className="notification-bell-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}
