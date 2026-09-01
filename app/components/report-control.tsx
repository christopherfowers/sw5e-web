/**
 * "Something here is wrong" — from the page it is wrong on.
 *
 * ## Why it looks like almost nothing
 *
 * This is a reference people read at the table, mid-sentence, on a phone,
 * looking for one number. It is not a moderation tool with a reference
 * attached. So the affordance is a single quiet line of text at the foot of
 * what it is about, it never moves anything above it, and it stays collapsed
 * until somebody asks for it. A reader who never wants it should be able to use
 * this site for a year without noticing it is there.
 *
 * The counterweight is that it has to be *on the thing*. A "contact us" page
 * collects reports that say "one of the species pages has the wrong picture",
 * which is a report nobody can act on. A control that already knows what it is
 * attached to collects reports that name the document, which is the difference
 * between a queue and a mailbox.
 *
 * ## Why it is a disclosure and not a modal
 *
 * A modal has to trap focus, restore it, close on Escape, and be inert to
 * everything behind it — four things to get right, on every page of the site,
 * for a form that is used once. A disclosure that expands in place has none of
 * that: the reader stays where they were, the page behind it stays readable,
 * and Escape means what it always meant. It also degrades honestly, since what
 * it expands is an ordinary form.
 *
 * ## Prerender safety
 *
 * Report text passes through this module untouched: it is sent as the reader
 * typed it, and neither this file nor anything it calls interpolates it into
 * markup. React's raw-HTML escape hatch does not appear here and may not be
 * added — `app/routes/account-flags.test.tsx` searches this file for it by
 * name, which is why the name is not written out even in this comment.
 *
 * Every content page on this site is a static file written at build time and
 * served to everybody. This component therefore renders the same markup for
 * every visitor — a button, collapsed — and resolves who the reader is only
 * after hydration, through the session context. Nothing identity-shaped is in
 * the file nginx serves, and there is no state in which the button is absent,
 * so the markup does not change under hydration.
 */

import { useId, useState } from "react";
import { Link, useLocation } from "react-router";

import { ApiError } from "~/api/http";
import { signInPathFor } from "~/auth/redirect";
import { useSession } from "~/auth/session";
import { raiseFlag } from "~/flags/api";
import {
  MAX_DETAILS_LENGTH,
  REASON_META,
  reasonsFor,
  requiresDetails,
} from "~/flags/reasons";
import type { FlagReason, FlagTargetKind } from "~/flags/types";

import "~/styles/flags.css";

export interface ReportTarget {
  /**
   * Whether this is a picture or a page. It decides which reasons are offered,
   * and the server derives the same thing from whichever one is chosen — so a
   * mismatch here is refused rather than filed.
   */
  kind: FlagTargetKind;
  /**
   * The API's content type. A page sends its own route segment — `species`,
   * `enhanced-items` — which the service resolves against its registry. A
   * picture sends `asset-credit`, because every image this site publishes has
   * an attribution record and that record is what a reviewer edits to put the
   * report right.
   */
  type: string;
  /**
   * The document key. For a page that is its slug; for a picture it is
   * `{group}-{key}`, the site's own image naming — `species-wookiee`,
   * `classes-guardian`.
   */
  key: string;
  /** What the reader is looking at, for the button's accessible name. */
  name: string;
}

interface ReportControlProps {
  target: ReportTarget;
  /** The visible text. Kept short; the accessible name carries the subject. */
  label?: string;
}

type Outcome =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "filed" }
  | { kind: "duplicate" }
  | { kind: "failed"; message: string; field: string | null };

export function ReportControl({ target, label = "Report a problem" }: ReportControlProps) {
  const session = useSession();
  const location = useLocation();
  const panelId = useId();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<FlagReason | null>(null);
  const [details, setDetails] = useState("");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  const reasons = reasonsFor(target.kind);
  const sending = outcome.kind === "sending";

  // The subject is in the accessible name rather than only in the visible
  // text. A screen-reader user listing the buttons on a species page would
  // otherwise hear "Report a problem" twice — once for the page and once for
  // its portrait — with nothing to tell them apart.
  const accessibleName =
    target.kind === "image"
      ? `Report a problem with the picture of ${target.name}`
      : `Report a problem with ${target.name}`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!reason || sending) return;

    setOutcome({ kind: "sending" });

    try {
      await raiseFlag({
        reason,
        targetType: target.type,
        targetKey: target.key,
        // Sent as the reader typed it. Trimming is the server's job and
        // sanitising is nobody's — see app/flags/api.ts.
        details: details.trim() === "" ? null : details,
      });

      setOutcome({ kind: "filed" });
      setDetails("");
      setReason(null);
    } catch (error) {
      if (error instanceof ApiError && error.code === "duplicate-report") {
        setOutcome({ kind: "duplicate" });
        return;
      }

      // The server's own wording where it sent one. It knows things this
      // client does not — which of two rate limits was reached, that the
      // document has since been retired — and paraphrasing would lose them.
      const message =
        error instanceof ApiError
          ? error.message
          : "That report could not be sent. Try again in a moment.";

      const field =
        error instanceof ApiError ? (Object.keys(error.fieldErrors)[0] ?? null) : null;

      setOutcome({ kind: "failed", message, field });
    }
  }

  function toggle() {
    setOpen((wasOpen) => !wasOpen);
    setOutcome({ kind: "idle" });
  }

  return (
    <div className="report-control">
      <button
        type="button"
        className="report-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={accessibleName}
        onClick={toggle}
      >
        {label}
      </button>

      {open ? (
        <div className="report-panel" id={panelId}>
          {session.status === "authenticated" ? (
            <ReportForm
              target={target}
              reasons={reasons}
              reason={reason}
              onReason={(next) => {
                setReason(next);
                setOutcome({ kind: "idle" });
              }}
              details={details}
              onDetails={setDetails}
              outcome={outcome}
              onSubmit={submit}
              onClose={() => setOpen(false)}
            />
          ) : session.status === "loading" ? (
            <p className="report-note" role="status">
              Checking your account…
            </p>
          ) : (
            // Anonymous, or the account service is unreachable. Both end in
            // the same place — there is no session to file under — and the
            // sign-in link remembers where the reader was, so they come back
            // to the page they were reporting rather than to their account.
            <p className="report-note">
              <Link to={signInPathFor(`${location.pathname}${location.search}`)}>
                Sign in
              </Link>{" "}
              to report a problem. Reports are attached to an account so that a
              reviewer can ask a follow-up question, and so one person cannot
              file the same thing a thousand times.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ReportForm({
  target,
  reasons,
  reason,
  onReason,
  details,
  onDetails,
  outcome,
  onSubmit,
  onClose,
}: {
  target: ReportTarget;
  reasons: readonly FlagReason[];
  reason: FlagReason | null;
  onReason: (reason: FlagReason) => void;
  details: string;
  onDetails: (value: string) => void;
  outcome: Outcome;
  onSubmit: (event: React.FormEvent) => void;
  onClose: () => void;
}) {
  const groupId = useId();
  const detailsId = useId();

  if (outcome.kind === "filed") {
    return (
      <div className="report-note" role="status">
        <p>
          Filed. A contributor will look at it — you can see what happens to it
          on <Link to="/account/flags">your reports</Link>.
        </p>
        <p>
          <button type="button" className="report-trigger" onClick={onClose}>
            Close
          </button>
        </p>
      </div>
    );
  }

  const meta = reason ? REASON_META[reason] : null;
  const detailsRequired = reason ? requiresDetails(reason) : false;
  const remaining = MAX_DETAILS_LENGTH - details.length;

  return (
    <form className="report-form" onSubmit={onSubmit}>
      <fieldset>
        {/*
          The subject is restated in the legend rather than assumed from
          position. Somebody arriving here with a screen reader has not
          necessarily read the heading above, and a form that files a report
          against "this" is one people abandon.
        */}
        <legend id={groupId}>
          What is wrong with{" "}
          {target.kind === "image" ? `the picture of ${target.name}` : target.name}?
        </legend>

        <ul className="report-reasons">
          {reasons.map((candidate) => (
            <li key={candidate}>
              <label>
                <input
                  type="radio"
                  name="reason"
                  value={candidate}
                  checked={reason === candidate}
                  onChange={() => onReason(candidate)}
                />
                <span className="report-reason-label">
                  {REASON_META[candidate].label}
                </span>
                <span className="report-reason-hint">
                  {REASON_META[candidate].hint}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      {reason ? (
        <div className="report-details">
          <label htmlFor={detailsId}>
            {detailsRequired ? "What is wrong?" : "Anything you can add"}
            {detailsRequired ? null : (
              <span className="auth-field-optional">Optional</span>
            )}
          </label>
          <p className="report-details-prompt" id={`${detailsId}-prompt`}>
            {meta?.detailsPrompt}
          </p>
          <textarea
            id={detailsId}
            name="details"
            rows={4}
            value={details}
            maxLength={MAX_DETAILS_LENGTH}
            required={detailsRequired}
            aria-describedby={`${detailsId}-prompt ${detailsId}-count`}
            onChange={(event) => onDetails(event.target.value)}
          />
          {/*
            A count rather than a silent truncation. The server refuses text
            past its limit rather than cutting it down, so somebody who writes
            past the end without being told would lose the part they cared most
            about — which, for an attribution report, is the evidence at the
            end.
          */}
          <p className="report-details-count" id={`${detailsId}-count`}>
            {remaining} characters left
          </p>
        </div>
      ) : null}

      {outcome.kind === "duplicate" ? (
        <p className="auth-banner" data-tone="info" role="status">
          You have already reported this, and it is still waiting for a
          reviewer. Nothing has been lost.
        </p>
      ) : null}

      {outcome.kind === "failed" ? (
        <p className="auth-banner" data-tone="error" role="alert">
          {outcome.message}
        </p>
      ) : null}

      <div className="report-actions">
        <button
          type="submit"
          className="button button-primary"
          disabled={!reason || outcome.kind === "sending"}
          aria-busy={outcome.kind === "sending" || undefined}
        >
          {outcome.kind === "sending" ? "Sending…" : "Send report"}
        </button>
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
