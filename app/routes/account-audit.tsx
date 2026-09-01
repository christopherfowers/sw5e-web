/**
 * The administrative log: every role change, suspension, reinstatement and
 * deletion.
 *
 * ## Why this has an address of its own
 *
 * The per-account history on `/account/people` answers "how did *this* account
 * come to be like this", which is the question somebody disputing a decision
 * asks. This answers a different one — "what has been done lately", and "what
 * has this administrator done" — which is the question asked when an
 * administrator's account is believed to be compromised, and which cannot be
 * asked from a page you reach by first finding the person.
 *
 * ## No loader
 *
 * The same rule as everywhere in this area, and for the sharpest version of the
 * reason: a `loader` runs once on a build machine and its result is written
 * into a static file served to everybody. A build-time snapshot of who
 * suspended whom, cached by every proxy between here and the reader, is about
 * the worst thing this repository could accidentally publish. See
 * `app/routes/account.tsx` and `app/auth/prerender-safety.test.ts`.
 *
 * ## Nothing here is markup
 *
 * Display names and administrators' notes are written by people and are
 * rendered as text nodes. The row itself is drawn by `AuditEntry` in
 * `account-people.tsx` rather than by a second copy here, because two
 * renderings of an audit entry are two chances for one of them to word
 * "revoked" as "granted".
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

import { listAdministrativeActions } from "~/admin/api";
import { describeFailure, type Load } from "~/admin/format";
import {
  ADMINISTRATIVE_ACTIONS,
  type AdministrativeAction,
  type AdministrativeActionKind,
} from "~/admin/types";
import { RequireSession } from "~/auth/guard";
import { Banner, SessionPending } from "~/components/auth-ui";
import { accountMeta } from "./account";
import { AuditEntry } from "./account-people";

import "~/styles/admin.css";

export function meta() {
  return accountMeta("Audit log");
}

/**
 * What the filter row offers.
 *
 * Built from the taxonomy rather than written out beside it, so an action added
 * to `ADMINISTRATIVE_ACTIONS` cannot end up being one nobody can filter for —
 * a failure that would look like an empty list rather than like a mistake.
 */
const ACTION_LABEL: Record<AdministrativeActionKind, string> = {
  "roles-changed": "Role changes",
  "account-suspended": "Suspensions",
  "account-reinstated": "Reinstatements",
  "account-deleted": "Deletions",
};

const ACTION_FILTERS: { key: AdministrativeActionKind | ""; label: string }[] = [
  { key: "", label: "Everything" },
  ...ADMINISTRATIVE_ACTIONS.map((action) => ({
    key: action,
    label: ACTION_LABEL[action],
  })),
];

function Log() {
  const [action, setAction] = useState<AdministrativeActionKind | "">("");
  const [page, setPage] = useState(1);
  const [load, setLoad] = useState<
    Load<{ actions: AdministrativeAction[]; total: number; pages: number }>
  >({ state: "loading" });

  // No synchronous "loading" write here. See the same note in
  // `account-people.tsx`: a state write in an effect body is a cascading render,
  // and blanking the log on every filter press is worse than letting the
  // previous page stand for the length of one request.
  const reload = useCallback(
    (signal?: AbortSignal) => {
      listAdministrativeActions({ action: action || undefined, page }, signal)
        .then((result) => {
          if (signal?.aborted) return;
          setLoad({
            state: "ready",
            value: {
              actions: result.actions,
              total: result.totalCount,
              pages: result.totalPages,
            },
          });
        })
        .catch((error: unknown) => {
          if (signal?.aborted) return;
          setLoad({ state: "failed", message: describeFailure(error) });
        });
    },
    [action, page],
  );

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  return (
    <section className="account-section" aria-labelledby="audit-heading">
      <h2 id="audit-heading">Audit log</h2>
      <p className="account-section-lede">
        Everything administrators have done to accounts, newest first. Nothing
        here can be edited or removed — the database refuses those statements
        outright — which is what makes it worth reading.
      </p>

      <div className="audit-views" role="group" aria-label="Which actions to show">
        {ACTION_FILTERS.map((candidate) => (
          <button
            key={candidate.key || "all"}
            type="button"
            className={action === candidate.key ? "audit-view is-current" : "audit-view"}
            aria-pressed={action === candidate.key}
            onClick={() => {
              setPage(1);
              setAction(candidate.key);
            }}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      {load.state === "loading" ? (
        <SessionPending label="Loading the log…" />
      ) : load.state === "failed" ? (
        <Banner tone="error" title="The log could not be loaded.">
          {load.message}
        </Banner>
      ) : load.value.actions.length === 0 ? (
        <p className="auth-note">
          Nothing has been recorded yet. Role changes, suspensions and deletions
          all appear here as they happen; go to{" "}
          <Link to="/account/people">People</Link> to make one.
        </p>
      ) : (
        <>
          <ul className="audit-list">
            {load.value.actions.map((entry) => (
              <AuditEntry key={entry.id} entry={entry} />
            ))}
          </ul>

          {load.value.pages > 1 ? (
            <p className="people-actions">
              <button
                type="button"
                className="button"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(current - 1, 1))}
              >
                Previous
              </button>
              <span className="people-note">
                Page {page} of {load.value.pages}
              </span>
              <button
                type="button"
                className="button"
                disabled={page >= load.value.pages}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </button>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export default function AccountAudit() {
  return <RequireSession role="Administrator">{() => <Log />}</RequireSession>;
}
