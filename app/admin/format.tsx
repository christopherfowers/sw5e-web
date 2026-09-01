/**
 * The small shared pieces both administrative screens need.
 *
 * Two screens is exactly the point at which these stop being local helpers and
 * start being a place where the two can drift apart — one page rendering a date
 * as an ISO string while the other writes it out, one reporting a failure with
 * the server's sentence while the other says "something went wrong".
 *
 * They live here rather than in a shared UI module because they are about the
 * administrative surface specifically: `needsStrongerSignIn` knows about the
 * one refusal this surface produces that no other part of the site does.
 */

import type { ReactNode } from "react";

import { ApiError, STRONG_AUTHENTICATION_REQUIRED } from "~/api/http";

/** What a fetch-after-hydration section can be showing. */
export type Load<T> =
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "failed"; message: string };

/**
 * The sentence to show for a failure.
 *
 * The server's own wording is preferred when there is one, because it is
 * specific — "That is not a status", "A reason is required when suspending an
 * account" — and a client that replaced it with a generic sentence would be
 * throwing away the only part of the answer the reader can act on.
 */
export function describeFailure(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "That could not be loaded. Try again in a moment.";
}

/**
 * Whether a refusal was "sign in more strongly" rather than "you may not".
 *
 * Worth telling apart everywhere it can be. A plain 403 on this surface is the
 * end of the conversation; this one means the account holds the role and simply
 * signed in with an emailed code, which enrolling a passkey and signing in
 * again fixes in about a minute. Branching on the machine-readable code rather
 * than on the wording is what keeps that true when the copy is reworded.
 */
export function needsStrongerSignIn(error: unknown): boolean {
  return error instanceof ApiError && error.code === STRONG_AUTHENTICATION_REQUIRED;
}

/**
 * A date and time, written out.
 *
 * Administrative screens need the time as well as the day — "who suspended this
 * account, and was it before or after the report came in" is a question about
 * hours — which is the one place this differs from the flag queue's date, and
 * why it is not shared with it.
 *
 * The `<time>` element keeps the machine-readable value where a machine can
 * still find it, and a value this build cannot parse is shown exactly as it
 * arrived rather than as "Invalid Date", which tells a reader nothing and hides
 * the problem.
 */
export function When({ value }: { value: string }): ReactNode {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) return <span>{value}</span>;

  return (
    <time dateTime={value}>
      {parsed.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}
    </time>
  );
}
