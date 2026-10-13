/**
 * Everything this account has been told.
 *
 * Under the account rather than under authoring, because every account has one.
 * Somebody told their role changed should not have to visit a contributor's
 * workspace to read it, and most accounts never see the authoring area at all.
 *
 * The bell's panel shows the most recent few; this is the whole of it, read and
 * unread, with paging. The two draw the same line component, so a notification
 * cannot say one thing in the panel and another here.
 */

import { useCallback, useEffect, useState } from "react";

import { RequireSession } from "~/auth/guard";
import {
  listNotifications,
  markAllRead,
  markRead,
  type Notification,
} from "~/notifications/api";
import { NotificationLine } from "~/notifications/line";

const PAGE_SIZE = 25;

export function meta() {
  return [{ title: "Notifications | Star Wars 5e" }];
}

export default function AccountNotificationsRoute() {
  return <RequireSession>{() => <Feed />}</RequireSession>;
}

function Feed() {
  const [items, setItems] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = useCallback(
    async (before: number | null, replace: boolean, signal?: AbortSignal) => {
      setFailed(false);

      try {
        const page = await listNotifications(
          { limit: PAGE_SIZE, unread: unreadOnly, before: before ?? undefined },
          signal,
        );

        if (signal?.aborted) return;

        setItems((was) => (replace ? page.items : [...was, ...page.items]));
        setCursor(page.nextCursor);
      } catch {
        if (!signal?.aborted) setFailed(true);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [unreadOnly],
  );

  /*
    The reload is queued rather than started in the effect body.

    `load` settles into setState, and starting it synchronously makes that an
    update on a component that has only just painted. `loading` begins true
    and is put back up by whatever changes the filter, so the page says it is
    reading from the first frame without this effect having to say so.
  */
  useEffect(() => {
    const abort = new AbortController();
    const queued = window.setTimeout(
      () => void load(null, true, abort.signal),
      0,
    );

    return () => {
      abort.abort();
      window.clearTimeout(queued);
    };
  }, [load]);

  async function clearAll() {
    setItems((was) => was.map((one) => ({ ...one, read: true })));

    try {
      await markAllRead();
    } catch {
      void load(null, true);
    }
  }

  async function follow(id: number) {
    setItems((was) =>
      was.map((one) => (one.id === id ? { ...one, read: true } : one)),
    );

    try {
      await markRead([id]);
    } catch {
      // Left as read on screen. The reader has followed it and is now looking
      // at the thing it was about; insisting it is still unread would be
      // arguing with them about something they can see.
    }
  }

  const anyUnread = items.some((one) => !one.read);

  return (
    <section className="account-section">
      <div className="account-section-head">
        <h1>Notifications</h1>
        {anyUnread ? (
          <button type="button" className="button" onClick={clearAll}>
            Mark all read
          </button>
        ) : null}
      </div>

      <p className="account-section-lede">
        What has happened to the reference, and to your account.
      </p>

      <label className="notification-filter">
        <input
          type="checkbox"
          checked={unreadOnly}
          onChange={(event) => {
            setLoading(true);
            setUnreadOnly(event.target.checked);
          }}
        />
        <span>Only what I have not read</span>
      </label>

      {failed ? (
        <p className="auth-error" role="alert">
          Could not read your notifications. Try again shortly.
        </p>
      ) : null}

      {items.length === 0 && !loading && !failed ? (
        <p className="auth-note">
          {unreadOnly ? "Nothing unread." : "Nothing yet."}
        </p>
      ) : null}

      <ul className="notification-list is-full">
        {items.map((one) => (
          <li key={one.id} data-unread={one.read ? undefined : true}>
            <NotificationLine notification={one} onFollow={follow} />
          </li>
        ))}
      </ul>

      {loading ? <p className="auth-note">Reading&hellip;</p> : null}

      {cursor !== null && !loading ? (
        <p className="auth-actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              setLoading(true);
              void load(cursor, false);
            }}
          >
            Show older
          </button>
        </p>
      ) : null}
    </section>
  );
}
