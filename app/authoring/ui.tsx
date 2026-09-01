/**
 * The handful of things every authoring screen needs and none of them owns.
 *
 * Deliberately small. The account screens have `app/components/auth-ui.tsx` for
 * the same job and this does not try to be a second one — what is here is only
 * what all three authoring screens do identically, which is: report a failure
 * in words rather than in a status code, say when something happened, and
 * explain the one refusal that is not anybody's fault.
 */

import { ApiError } from "~/api/http";
import { Banner } from "~/components/auth-ui";
import { AUTHORING_UNAVAILABLE } from "./types";

/** What a section fetching after hydration can be showing. */
export type Load<T> =
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "failed"; error: unknown };

/** The sentence to show a reader for a failure, never a status code. */
export function messageFor(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "That could not be loaded. Try again in a moment.";
}

/**
 * Whether a failure is the deployment saying it stores content in files.
 *
 * Worth telling apart from every other refusal, because it is not a fault and
 * nothing the reader does will change it. A deployment configured this way is
 * read-only by choice; reporting it as "something went wrong" sends a
 * contributor looking for a problem with their own account.
 */
export function isAuthoringUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.code === AUTHORING_UNAVAILABLE;
}

/**
 * The banner for a failed load, with the two cases that deserve their own
 * wording separated out from the general one.
 */
export function FailureBanner({ title, error }: { title: string; error: unknown }) {
  if (isAuthoringUnavailable(error)) {
    return (
      <Banner tone="info" title="Content cannot be edited on this deployment.">
        This site is running against a file-backed content store, which is
        read-only. Everything in the reference is readable; nothing here can be
        changed until it is running against the content database.
      </Banner>
    );
  }

  return (
    <Banner tone="error" title={title}>
      {messageFor(error)}
    </Banner>
  );
}

/**
 * A date, written out.
 *
 * The same decision the reports page made, for the same reason: an ISO instant
 * in a worklist is noise a reader has to decode, and `<time>` keeps the
 * machine-readable value where a machine can still find it. A value this build
 * cannot parse is shown as it arrived rather than as "Invalid Date", which
 * tells nobody anything and hides the problem.
 */
export function When({ value }: { value: string }) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) return <span>{value}</span>;

  return (
    <time dateTime={value}>
      {parsed.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })}
      {", "}
      {parsed.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
    </time>
  );
}
