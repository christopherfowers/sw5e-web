/**
 * Reports: what you filed, and — for a contributor — what everybody filed.
 *
 * ## One route, two audiences
 *
 * A community account sees its own reports; a contributor sees those and the
 * review queue underneath. That is one address rather than two on purpose. The
 * intention is to open reporting wider over time, and a site where "your
 * reports" and "the queue" are separate pages is a site where widening the
 * first means inventing the second's navigation all over again. It also keeps
 * the prerendered route count down by one, which is arithmetic this repository
 * has to state deliberately — see `react-router.config.ts` and the container
 * job.
 *
 * ## No loader, and it matters here more than anywhere
 *
 * `app/routes/account.tsx` explains the rule: this site prerenders every
 * published path, so a `loader` runs once on a build machine and its result is
 * written into a file served to everybody. A loader on this page would bake
 * either nothing or — worse — one build machine's view of a moderation queue,
 * carrying the display names of everybody who had reported anything, into a
 * static file behind a CDN. Everything below is fetched after hydration.
 *
 * ## Everything from the server is untrusted text
 *
 * Report details are written by anybody with an account. Reviewer notes are
 * written by contributors, whose accounts can be compromised. Display names are
 * chosen by their owners. All three are rendered as text nodes and never as
 * markup: React's raw-HTML escape hatch does not appear on this page and may
 * not be added, and none of this goes near `app/content/markdown.ts`. A stored
 * cross-site scripting hole in a moderation queue hands an attacker the session
 * of a contributor or an administrator, which is the most valuable session on
 * the platform.
 *
 * The prop is not named here, deliberately. `account-flags.test.tsx` guards
 * that rule with a plain substring search over this file, which is the only
 * kind of guard that also catches it appearing in a comment somebody later
 * turns into code — so the name must not be written out even to explain it.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router";

import { ApiError } from "~/api/http";
import { RequireSession } from "~/auth/guard";
import { canUploadContent } from "~/auth/roles";
import type { CurrentUser } from "~/auth/types";
import { Banner, SessionPending } from "~/components/auth-ui";
import { flagSummary, listFlags, listOwnFlags, updateFlagStatus } from "~/flags/api";
import {
  NEXT_STATUSES,
  reasonLabel,
  STATUS_META,
  statusLabel,
} from "~/flags/reasons";
import { isFlagStatus, type Flag, type FlagStatus, type FlagSummary } from "~/flags/types";
import { accountMeta, type AccountContext } from "./account";

import "~/styles/flags.css";

export function meta() {
  return accountMeta("Reports");
}

/** What a fetch-after-hydration section can be showing. */
type Load<T> =
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "failed"; message: string };

function messageFor(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "That could not be loaded. Try again in a moment.";
}

/**
 * A date, written out.
 *
 * `toLocaleDateString` with an explicit option set rather than a raw ISO
 * string, because "2026-09-01T04:12:55.113Z" in a queue is noise a reviewer has
 * to decode. The `<time>` element keeps the machine-readable value where a
 * machine can still find it.
 */
function When({ value }: { value: string }) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    // A value this build cannot parse is shown as it arrived rather than as
    // "Invalid Date", which tells a reader nothing and hides the problem.
    return <span>{value}</span>;
  }

  return (
    <time dateTime={value}>
      {parsed.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })}
    </time>
  );
}

/**
 * Who filed or reviewed something.
 *
 * A null display name is a report that outlived the account behind it. Saying
 * so is better than a blank space, and far better than the account identifier,
 * which is neither readable nor anybody's business.
 */
function Who({ name }: { name: string | null }) {
  return name ? <>{name}</> : <span className="flag-anonymous">a removed account</span>;
}

/** The page a report points at, when the site publishes one to point at. */
function targetHref(flag: Flag): string | null {
  // An asset-credit record is not a published page — the picture is on the page
  // that uses it, and this client cannot work out which page that is from the
  // key alone. Linking to a 404 is worse than not linking.
  return flag.targetKind === "image"
    ? null
    : `/${flag.targetType}/${flag.targetKey}`;
}

function FlagTarget({ flag }: { flag: Flag }) {
  const href = targetHref(flag);

  return (
    <>
      {href ? <Link to={href}>{flag.targetName}</Link> : <>{flag.targetName}</>}{" "}
      <span className="flag-target-kind">
        {flag.targetKind === "image" ? "picture" : flag.targetType}
      </span>
    </>
  );
}

/* ------------------------------------------------------------ own reports */

function OwnReports() {
  const [load, setLoad] = useState<Load<Flag[]>>({ state: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    listOwnFlags(controller.signal)
      .then((page) => setLoad({ state: "ready", value: page.flags }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ state: "failed", message: messageFor(error) });
      });

    return () => controller.abort();
  }, []);

  return (
    <section className="account-section" aria-labelledby="own-reports-heading">
      <h2 id="own-reports-heading">Your reports</h2>
      <p className="account-section-lede">
        Anything you have reported, and what became of it. Use the “Report a
        problem” link at the foot of any page or picture to add one.
      </p>

      {load.state === "loading" ? (
        <SessionPending label="Loading your reports…" />
      ) : load.state === "failed" ? (
        <Banner tone="error" title="Your reports could not be loaded.">
          {load.message}
        </Banner>
      ) : load.value.length === 0 ? (
        <p className="auth-note">
          You have not reported anything yet. If you recognise a picture whose
          artist is not credited, that is the single most useful thing anybody
          can tell us right now.
        </p>
      ) : (
        <ul className="flag-list">
          {load.value.map((flag) => (
            <li key={flag.id} className="flag-row" data-status={flag.status}>
              <p className="flag-row-head">
                <span className="flag-status" data-status={flag.status}>
                  {statusLabel(flag.status)}
                </span>
                <FlagTarget flag={flag} />
              </p>
              <p className="flag-reason">{reasonLabel(flag.reason)}</p>
              {/*
                A text node. This is what the reader themselves wrote, and it is
                still rendered as text — the rule does not have an exception for
                "their own", because a reader is not always the person whose
                browser is showing it.
              */}
              {flag.details ? <p className="flag-details">{flag.details}</p> : null}
              <p className="flag-meta">
                Filed <When value={flag.createdAt} />
                {flag.reviewedAt ? (
                  <>
                    {" · "}
                    {STATUS_META[flag.status]?.summary ?? "Reviewed"}{" "}
                    <When value={flag.reviewedAt} />
                  </>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ queue */

const QUEUE_VIEWS = [
  { key: "outstanding", label: "Outstanding" },
  { key: "open", label: "Open" },
  { key: "accepted", label: "Accepted" },
  { key: "all", label: "Everything" },
] as const;

type QueueView = (typeof QUEUE_VIEWS)[number]["key"];

function ReviewQueue() {
  const [view, setView] = useState<QueueView>("outstanding");
  const [reason, setReason] = useState<string | null>(null);
  const [summary, setSummary] = useState<Load<FlagSummary>>({ state: "loading" });
  const [queue, setQueue] = useState<Load<Flag[]>>({ state: "loading" });
  const [acting, setActing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(
    (signal?: AbortSignal) => {
      const filters = {
        // "outstanding" is the service's own default, expressed by sending no
        // status at all rather than by naming two — the server decides what
        // counts as outstanding, and a client that listed the states here would
        // silently stop agreeing with it the day a fifth one is added.
        status: view === "outstanding" ? undefined : (view as FlagStatus | "all"),
        reason: reason ?? undefined,
      };

      Promise.all([listFlags(filters, signal), flagSummary(signal)])
        .then(([page, counts]) => {
          if (signal?.aborted) return;
          setQueue({ state: "ready", value: page.flags });
          setSummary({ state: "ready", value: counts });
        })
        .catch((error: unknown) => {
          if (signal?.aborted) return;
          const message = messageFor(error);
          setQueue({ state: "failed", message });
          setSummary({ state: "failed", message });
        });
    },
    [view, reason],
  );

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  async function move(flag: Flag, next: FlagStatus) {
    setActing(flag.id);
    setActionError(null);

    try {
      await updateFlagStatus(flag.id, next);
      reload();
    } catch (error) {
      // A 409 here means somebody else acted on this row since the page was
      // drawn. Saying so is the difference between a page that looks broken and
      // one that tells a reviewer to reload — and the service names the status
      // it actually reached.
      setActionError(
        error instanceof ApiError && error.code === "invalid-transition"
          ? `${error.message} Reload to see where it got to.`
          : messageFor(error),
      );
    } finally {
      setActing(null);
    }
  }

  return (
    <section className="account-section" aria-labelledby="queue-heading">
      <h2 id="queue-heading">Review queue</h2>
      <p className="account-section-lede">
        Everything the community has reported. Start from the counts rather than
        from the list: about a hundred and fifty of this site’s pictures have no
        recorded artist, so the raw queue is long and repetitive, and one typo
        report in the middle of it is easy to page straight past.
      </p>

      {summary.state === "ready" ? (
        <QueueSummary
          summary={summary.value}
          reason={reason}
          onReason={(next) => setReason(next)}
        />
      ) : null}

      <div className="flag-views" role="group" aria-label="Which reports to show">
        {QUEUE_VIEWS.map((candidate) => (
          <button
            key={candidate.key}
            type="button"
            className={
              view === candidate.key ? "flag-view is-current" : "flag-view"
            }
            aria-pressed={view === candidate.key}
            onClick={() => setView(candidate.key)}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      {actionError ? (
        <Banner tone="error" title="That could not be done.">
          {actionError}
        </Banner>
      ) : null}

      {queue.state === "loading" ? (
        <SessionPending label="Loading the queue…" />
      ) : queue.state === "failed" ? (
        <Banner tone="error" title="The queue could not be loaded.">
          {queue.message}
        </Banner>
      ) : queue.value.length === 0 ? (
        <p className="auth-note">Nothing here. That is a good sign.</p>
      ) : (
        <ul className="flag-list">
          {queue.value.map((flag) => (
            <li key={flag.id} className="flag-row" data-status={flag.status}>
              <p className="flag-row-head">
                <span className="flag-status" data-status={flag.status}>
                  {statusLabel(flag.status)}
                </span>
                <FlagTarget flag={flag} />
              </p>
              <p className="flag-reason">{reasonLabel(flag.reason)}</p>
              {flag.details ? <p className="flag-details">{flag.details}</p> : null}
              <p className="flag-meta">
                Filed <When value={flag.createdAt} /> by{" "}
                <Who name={flag.reporter.displayName} />
                {flag.reviewedAt && flag.reviewedBy ? (
                  <>
                    {" · last touched "}
                    <When value={flag.reviewedAt} /> by{" "}
                    <Who name={flag.reviewedBy.displayName} />
                  </>
                ) : null}
              </p>
              {flag.reviewerNote ? (
                <p className="flag-note">
                  <span className="flag-note-label">Reviewer note</span>
                  {flag.reviewerNote}
                </p>
              ) : null}
              <p className="flag-actions">
                {(NEXT_STATUSES[flag.status] ?? []).map((next) => (
                  <button
                    key={next}
                    type="button"
                    className="button"
                    disabled={acting === flag.id}
                    onClick={() => void move(flag, next)}
                  >
                    {/*
                      Named as the action rather than as the state, because
                      "Declined" as a button label reads as a description of
                      where the report already is.
                    */}
                    {next === "open" ? "Reopen" : STATUS_META[next].label}
                  </button>
                ))}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function QueueSummary({
  summary,
  reason,
  onReason,
}: {
  summary: FlagSummary;
  reason: string | null;
  onReason: (reason: string | null) => void;
}) {
  return (
    <div className="flag-summary">
      <dl className="account-facts">
        <div>
          <dt>Outstanding</dt>
          <dd>{summary.outstanding}</dd>
        </div>
        {summary.byStatus
          .filter((entry) => !isFlagStatus(entry.key) || !STATUS_META[entry.key].outstanding)
          .map((entry) => (
            <div key={entry.key}>
              <dt>{statusLabel(entry.key)}</dt>
              <dd>{entry.count}</dd>
            </div>
          ))}
      </dl>

      {summary.byReason.length > 0 ? (
        <>
          <h3>By reason</h3>
          <p className="flag-summary-hint">
            Pick one to work through it. This is what keeps a hundred and fifty
            attribution reports from burying a single correction.
          </p>
          <ul className="flag-facets">
            <li>
              <button
                type="button"
                className={reason === null ? "flag-facet is-current" : "flag-facet"}
                aria-pressed={reason === null}
                onClick={() => onReason(null)}
              >
                Everything
              </button>
            </li>
            {summary.byReason.map((entry) => (
              <li key={entry.key}>
                <button
                  type="button"
                  className={
                    reason === entry.key ? "flag-facet is-current" : "flag-facet"
                  }
                  aria-pressed={reason === entry.key}
                  onClick={() => onReason(reason === entry.key ? null : entry.key)}
                >
                  {reasonLabel(entry.key)}
                  <span className="flag-facet-count">{entry.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {summary.mostFlagged.length > 0 ? (
        <>
          <h3>Most reported</h3>
          <ul className="flag-facets">
            {summary.mostFlagged.map((entry) => (
              <li key={`${entry.targetType}/${entry.targetKey}`}>
                <span className="flag-facet is-static">
                  {entry.targetName}
                  <span className="flag-facet-count">{entry.outstandingCount}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- page */

function Sections({ user }: { user: CurrentUser }) {
  return (
    <>
      <OwnReports />

      {canUploadContent(user) ? (
        user.strongAuthentication ? (
          <ReviewQueue />
        ) : (
          // The account holds the role and this session cannot use it. Worth
          // saying rather than drawing an empty queue: the API refuses
          // contributor work to a session established with an emailed code, and
          // enrolling a passkey clears it in about a minute.
          <section className="account-section" aria-labelledby="queue-locked-heading">
            <h2 id="queue-locked-heading">Review queue</h2>
            <Banner
              tone="error"
              title="The queue needs a passkey or an authenticator app."
            >
              You signed in with a code sent to your email address, which
              confirms the address but says nothing about this device. The queue
              carries the names of everybody who has reported anything and what
              they wrote, so it stays closed to this session.{" "}
              <Link to="/account/passkeys">Add a passkey</Link> or{" "}
              <Link to="/account/security">set up an authenticator app</Link>,
              then sign in again with it.
            </Banner>
          </section>
        )
      ) : null}
    </>
  );
}

export default function AccountFlags() {
  // Read here rather than inside the guard so this page fails to compile if it
  // is ever moved out from under the account layout that supplies it.
  useOutletContext<AccountContext>();

  // No `role` on the guard: this page belongs to every signed-in account, and
  // the queue below it is what belongs to contributors. Guarding the whole page
  // on the role would take a community account's own reports away from them.
  return <RequireSession>{(user) => <Sections user={user} />}</RequireSession>;
}
