/**
 * One notification, as a sentence and a destination.
 *
 * ## Why the wording lives here and not on the service
 *
 * The service stores what happened and the few words the line needs: a
 * document's name as it was, a revision number, who did it. Turning that into
 * English is a presentation decision, and a service that picked one phrasing
 * would have picked it for every client forever, including ones that want it
 * in a different language or a different length.
 *
 * ## Every value is text somebody typed
 *
 * `detail` holds display names, which are authored. They are rendered as text,
 * never as markup, and never into an attribute that could become a URL. The
 * destination is built from `subjectType` and `subjectKey`, which the service
 * constrains to a content type and a slug.
 */

import { Link } from "react-router";

import { editorPath, historyPath } from "~/authoring/paths";

import type { Notification } from "./api";

export interface LineProps {
  notification: Notification;
  /** Called when the reader follows it, so the bell can mark it read. */
  onFollow?: (id: number) => void;
}

export function NotificationLine({ notification, onFollow }: LineProps) {
  const { kind, detail, subjectKey } = notification;
  const name = detail.name ?? subjectKey ?? "a document";
  const actor = detail.actor ?? "somebody";
  const destination = destinationFor(notification);

  const sentence = (() => {
    switch (kind) {
      case "content.published":
        return (
          <>
            <strong>{actor}</strong> published <strong>{name}</strong>
            {detail.revision ? <> as revision {detail.revision}</> : null}.
          </>
        );
      case "content.reverted":
        return (
          <>
            <strong>{actor}</strong> put <strong>{name}</strong> back to an
            earlier version.
          </>
        );
      case "flag.raised":
        return (
          <>
            Somebody reported a problem with <strong>{name}</strong>.
          </>
        );
      case "flag.resolved":
        return (
          <>
            The report about <strong>{name}</strong> was closed.
          </>
        );
      case "account.role_granted":
        return (
          <>
            Your account is now <strong>{detail.role ?? "a different role"}</strong>.
          </>
        );
      case "account.suspended":
        return <>Your account has been suspended.</>;
      default:
        /*
          A kind this build does not know about still draws a line.

          The service's set of kinds can run ahead of a browser holding an
          older bundle, and the alternative to a plain sentence is a blank row
          that counts towards the unread total and can never be understood or
          cleared.
        */
        return <>Something happened to {name}.</>;
    }
  })();

  const body = (
    <>
      <span className="notification-text">{sentence}</span>
      <time className="notification-when" dateTime={notification.createdAt}>
        {when(notification.createdAt)}
      </time>
    </>
  );

  if (!destination) {
    return <div className="notification-line">{body}</div>;
  }

  return (
    <Link
      className="notification-line"
      to={destination}
      onClick={() => onFollow?.(notification.id)}
    >
      {body}
    </Link>
  );
}

/**
 * Where following a notification goes.
 *
 * A content change goes to that document's history, where the diff already
 * exists and answers the question the line raises: what actually changed.
 */
function destinationFor({ kind, subjectType, subjectKey }: Notification): string | null {
  if (!subjectType || !subjectKey) {
    return kind.startsWith("account.") ? "/account" : null;
  }

  switch (kind) {
    case "content.published":
    case "content.reverted":
      return historyPath(subjectType, subjectKey);
    case "flag.raised":
    case "flag.resolved":
      return editorPath(subjectType, subjectKey);
    default:
      return null;
  }
}

/**
 * How long ago, in words.
 *
 * Coarse on purpose. The exact minute is in the `dateTime` attribute for
 * anything that wants it, and a bell that says "4 minutes ago" is a bell that
 * is wrong one minute later unless something re-renders it on a timer, which
 * is a lot of machinery for a line nobody is watching that closely.
 */
function when(iso: string): string {
  const then = new Date(iso).getTime();

  if (Number.isNaN(then)) return "";

  const minutes = Math.floor((Date.now() - then) / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(then).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}
