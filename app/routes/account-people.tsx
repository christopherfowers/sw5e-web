/**
 * People: finding an account, and acting on it.
 *
 * ## What this page is, before anything else
 *
 * It is a directory of real people's email addresses. Nothing else on this site
 * shows one that is not the reader's own — the flag queue deliberately shows
 * contributors a display name and never an address — and the whole shape of
 * this page follows from that.
 *
 * It is guarded for `Administrator`, and the guard is the *usability* half. The
 * real boundary is the API, which refuses every request under `/api/auth/admin`
 * unless the caller holds the role and established this session with a passkey
 * or an authenticator app. Everything below runs on hardware the reader
 * controls and could be edited from a console; nothing here is a secret being
 * kept, because nothing here exists until the server answers.
 *
 * ## The search term stays out of the URL
 *
 * Deliberately, and it is the one place this page departs from what a list page
 * normally does. A shareable `?q=` is a nice affordance for a catalogue and a
 * bad one for a box people type email addresses into: the address would land in
 * browser history, in a bookmark, and in whatever the reader pastes into a chat
 * window when asking a colleague to look. The selected account *is* in the URL,
 * because a version 7 GUID is opaque and being able to send somebody a link to
 * "this account" is worth having.
 *
 * ## No loader, and it matters here as much as anywhere
 *
 * `app/routes/account.tsx` sets out the rule: this site prerenders every
 * published path, so a `loader` runs once on a build machine and its result is
 * written into a static file served to everybody and cached by everything in
 * between. A loader here would bake either nothing or — far worse — one build
 * machine's view of the account directory, addresses and all, into a file
 * behind a CDN. Everything below is fetched after hydration.
 * `app/auth/prerender-safety.test.ts` fails the build if a loader reappears.
 *
 * ## Everything from the server is text
 *
 * Display names are chosen by their owners. Suspension reasons and
 * administrative notes are written by administrators, whose accounts can be
 * compromised. All of them are rendered as text nodes; React's raw-HTML escape
 * hatch does not appear on this page and may not be added. A stored cross-site
 * scripting hole on the one page that lists everybody's address would be the
 * worst one this platform could have.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { ApiError } from "~/api/http";
import {
  assignRoles,
  deleteUser,
  getUser,
  listAdministrativeActions,
  listUsers,
  setSuspension,
} from "~/admin/api";
import { describeFailure, When, type Load } from "~/admin/format";
import {
  ACCOUNT_STATUS_FILTERS,
  type AccountStatusFilter,
  type AdministrativeAction,
  type AdminUser,
  type AdminUserDetail,
} from "~/admin/types";
import { RequireSession } from "~/auth/guard";
import { ROLE_META } from "~/auth/roles";
import { ROLES, type AssignableRole, type CurrentUser, type Role } from "~/auth/types";
import { Banner, SessionPending, SubmitButton } from "~/components/auth-ui";
import { accountMeta } from "./account";

import "~/styles/admin.css";

export function meta() {
  return accountMeta("People");
}

/** Which query parameter names the open account. */
const SELECTED = "user";

/** The roles an administrator may grant. `Community` is the floor, not a gift. */
const ASSIGNABLE: AssignableRole[] = ["Contributor", "Administrator"];

/* --------------------------------------------------------------- the list */

/**
 * How an account's state reads at a glance.
 *
 * Suspended and locked out are separate markers and never one, because they are
 * separate things and an administrator who conflates them lifts the wrong one.
 * A suspension is a decision somebody made and lasts until somebody undoes it;
 * a lockout is the framework counting failed attempts, expires by itself, and
 * can be caused against any account by any stranger who knows its address.
 */
function AccountState({ account }: { account: AdminUser }) {
  return (
    <p className="people-state">
      {account.suspension ? (
        <span className="people-flag" data-tone="suspended">
          Suspended
        </span>
      ) : null}
      {account.lockedOut ? (
        <span className="people-flag" data-tone="locked">
          Locked out by failed attempts
        </span>
      ) : null}
      {account.emailConfirmed ? null : (
        <span className="people-flag" data-tone="unverified">
          Address never verified
        </span>
      )}
      {account.secondFactorEnrolled ? null : (
        <span className="people-flag" data-tone="no-factor">
          No passkey or authenticator
        </span>
      )}
    </p>
  );
}

function Roles({ roles }: { roles: Role[] }) {
  // Rendered in the ladder's own order rather than the order the server
  // happened to send, so two rows never disagree about where Contributor sits.
  const held = ROLES.filter((role) => roles.includes(role));

  return (
    <p className="people-roles">
      {held.map((role) => (
        <span key={role} className="people-role" data-role={role}>
          {ROLE_META[role].label}
        </span>
      ))}
    </p>
  );
}

/* ------------------------------------------------------------ the actions */

/**
 * The role editor.
 *
 * Checkboxes and one Save rather than a grant button per role, because the API
 * is declarative: the request names the complete set the account should end up
 * holding, and anything absent is revoked. A per-role button would have to read
 * the current set, add or remove one, and send the result — which is the same
 * request with a chance of sending a stale set alongside it.
 */
function RoleEditor({
  account,
  disabled,
  onChanged,
}: {
  account: AdminUser;
  disabled: boolean;
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<AssignableRole[]>(() =>
    ASSIGNABLE.filter((role) => account.roles.includes(role)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setNote(null);

    try {
      const result = await assignRoles(account.id, selected);

      setNote(
        result.awaitingSecondFactor
          ? "Saved. This account holds neither a passkey nor an authenticator app, " +
              "so it cannot use an elevated role until it enrols one — it has been " +
              "emailed and told what to add."
          : "Saved.",
      );

      onChanged();
    } catch (failure) {
      setError(describeFailure(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="people-action" aria-labelledby="people-roles-heading">
      <h4 id="people-roles-heading">Roles</h4>

      <fieldset className="people-role-choices" disabled={disabled || saving}>
        <legend className="people-legend">
          What this account may do. Anything unticked is revoked when you save.
        </legend>
        {ASSIGNABLE.map((role) => (
          <label key={role} className="people-choice">
            <input
              type="checkbox"
              checked={selected.includes(role)}
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, role]
                    : current.filter((held) => held !== role),
                )
              }
            />
            <span>
              <strong>{ROLE_META[role].label}</strong>
              <span className="people-choice-summary">{ROLE_META[role].summary}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {/*
        The rule the service enforces, said here as well. An administrator who
        unticks their own Administrator box meets a 400 otherwise, and a refusal
        that arrives after the click reads as a bug rather than as a design.
      */}
      {disabled ? (
        <p className="people-note">
          You cannot change your own roles. The administrator role is the only
          thing that can grant the administrator role, so the last one revoking
          themselves would leave nobody able to appoint another. Ask another
          administrator.
        </p>
      ) : null}

      {error ? (
        <Banner tone="error" title="Those roles were not saved.">
          {error}
        </Banner>
      ) : null}
      {note ? (
        <Banner tone="info" title="Roles updated.">
          {note}
        </Banner>
      ) : null}

      <p className="people-actions">
        <SubmitButton
          type="button"
          pending={saving}
          pendingLabel="Saving…"
          disabled={disabled}
          onClick={() => void save()}
        >
          Save roles
        </SubmitButton>
      </p>
    </section>
  );
}

/**
 * Suspending, and lifting a suspension.
 *
 * The copy carries the two facts an administrator needs before pressing it and
 * would otherwise have to learn from the API documentation: that the account's
 * open sessions end immediately rather than at expiry, and that its passkeys
 * survive — so reinstating gives the account back rather than requiring it to
 * be credentialled again.
 */
function SuspensionEditor({
  account,
  disabled,
  onChanged,
}: {
  account: AdminUser;
  disabled: boolean;
  onChanged: () => void;
}) {
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const standing = account.suspension;

  async function apply(next: boolean) {
    setWorking(true);
    setError(null);

    try {
      await setSuspension(account.id, next, next ? reason : null);
      setReason("");
      onChanged();
    } catch (failure) {
      setError(describeFailure(failure));
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="people-action" aria-labelledby="people-suspension-heading">
      <h4 id="people-suspension-heading">Suspension</h4>

      {standing ? (
        <>
          <p className="people-note">
            Suspended <When value={standing.at} />.
          </p>
          {/*
            The reason, as a text node. It is written by an administrator, and
            an administrator's account can be stolen; being trusted is not the
            same as being safe to interpolate.
          */}
          {standing.reason ? (
            <blockquote className="people-reason">{standing.reason}</blockquote>
          ) : null}
          <p className="people-note">
            The account cannot sign in and cannot use a session it already had.
            Its passkeys are untouched, so reinstating gives it straight back —
            nobody has to enrol anything again.
          </p>
        </>
      ) : (
        <>
          <label className="people-field">
            <span>Why</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={512}
              rows={3}
              disabled={disabled || working}
            />
          </label>
          <p className="people-note">
            Required, written for the other administrators, and never shown to
            the account — where the reason is an investigation, quoting it back
            would tell them what is being looked into. They are emailed that
            they have been suspended and told who to write to.
          </p>
          <p className="people-note">
            Suspending ends the sessions this account has open now, not when
            their cookies expire. Nothing is deleted: the passkeys stay, the
            reports and revisions stay, and lifting the suspension restores
            everything.
          </p>
        </>
      )}

      {disabled ? (
        <p className="people-note">
          You cannot suspend your own account. Ask another administrator.
        </p>
      ) : null}

      {error ? (
        <Banner tone="error" title="That did not go through.">
          {error}
        </Banner>
      ) : null}

      <p className="people-actions">
        <SubmitButton
          type="button"
          pending={working}
          pendingLabel={standing ? "Reinstating…" : "Suspending…"}
          variant={standing ? "secondary" : "danger"}
          disabled={disabled || (!standing && reason.trim().length === 0)}
          onClick={() => void apply(!standing)}
        >
          {standing ? "Lift the suspension" : "Suspend this account"}
        </SubmitButton>
      </p>
    </section>
  );
}

/**
 * Deletion, behind a step the reader has to take on purpose.
 *
 * Two presses rather than a confirm dialogue: a dialogue is dismissed by
 * reflex, and this is the one action on the site that cannot be undone. The
 * second step also carries the sentence that most changes what somebody expects
 * — that the account's revisions and reports stay behind, attributed to a
 * removed account — because an administrator who believed deletion erased
 * authorship would be using it for something it does not do.
 */
function DeleteAccount({
  detail,
  disabled,
  onDeleted,
}: {
  detail: AdminUserDetail;
  disabled: boolean;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outstanding = detail.outstandingDrafts ?? 0;
  const blocked = outstanding > 0;

  async function remove() {
    setWorking(true);
    setError(null);

    try {
      await deleteUser(detail.user.id, reason.trim() || null);
      onDeleted();
    } catch (failure) {
      // A 409 with this code is not a generic conflict, and the difference is
      // worth surfacing: it means the account owns unpublished work that would
      // be left attributed to nobody and would keep everyone else out of those
      // entries. The service's own sentence already names the count and says
      // what to do, so it is shown rather than paraphrased; what is added is a
      // reason to reload, since this panel may have been open since before
      // somebody else saved a draft.
      setError(
        failure instanceof ApiError && failure.code === "drafts-outstanding"
          ? `${failure.message} Reopen this account to see the current count.`
          : describeFailure(failure),
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="people-action" aria-labelledby="people-delete-heading">
      <h4 id="people-delete-heading">Delete</h4>

      <p className="people-note">
        Removes the account and everything that identifies it: the address, the
        name, the roles, the passkeys and the authenticator. The address becomes
        free to register again.
      </p>
      <p className="people-note">
        It does <strong>not</strong> remove what they wrote. Their revisions and
        their reports stay exactly where they are and are shown afterwards as
        coming from a removed account. A history that can be edited by deleting
        somebody is not a history.
      </p>

      {blocked ? (
        <Banner tone="warning" title="This account has unpublished drafts.">
          {outstanding === 1
            ? "One draft is outstanding."
            : `${outstanding} drafts are outstanding.`}{" "}
          Publish or discard {outstanding === 1 ? "it" : "them"} first — deleting
          now would leave the work attributed to nobody and would keep anyone
          else from editing those entries.
        </Banner>
      ) : null}

      {disabled ? (
        <p className="people-note">
          You cannot delete your own account. Ask another administrator.
        </p>
      ) : null}

      {error ? (
        <Banner tone="error" title="That account was not deleted.">
          {error}
        </Banner>
      ) : null}

      {confirming ? (
        <>
          <label className="people-field">
            <span>Why, for the record</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={512}
              rows={2}
              disabled={working}
            />
          </label>
          <p className="people-note">
            Optional, and kept in the administrative log — which survives the
            deletion, along with the name of the account it was aimed at.
          </p>
          <p className="people-actions">
            <SubmitButton
              type="button"
              pending={working}
              pendingLabel="Deleting…"
              variant="danger"
              disabled={disabled || blocked}
              onClick={() => void remove()}
            >
              Yes, delete this account
            </SubmitButton>
            <button
              type="button"
              className="button"
              onClick={() => setConfirming(false)}
              disabled={working}
            >
              Cancel
            </button>
          </p>
        </>
      ) : (
        <p className="people-actions">
          <button
            type="button"
            className="button button-danger"
            disabled={disabled || blocked}
            onClick={() => setConfirming(true)}
          >
            Delete this account
          </button>
        </p>
      )}
    </section>
  );
}

/* -------------------------------------------------- what happened to them */

/**
 * What has been done to this account, and by whom.
 *
 * On the account rather than only on the log page, because this is where the
 * question is actually asked. Somebody disputing a suspension, or wondering how
 * an account came to hold a role, is looking at that account — sending them to
 * a separate page and asking them to filter it is asking them to do the join by
 * hand.
 */
function AccountHistory({ userId }: { userId: string }) {
  const [load, setLoad] = useState<Load<AdministrativeAction[]>>({ state: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    listAdministrativeActions({ subjectId: userId }, controller.signal)
      .then((page) => setLoad({ state: "ready", value: page.actions }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ state: "failed", message: describeFailure(error) });
      });

    return () => controller.abort();
  }, [userId]);

  return (
    <section className="people-action" aria-labelledby="people-history-heading">
      <h4 id="people-history-heading">Administrative history</h4>

      {load.state === "loading" ? (
        <SessionPending label="Loading this account’s history…" />
      ) : load.state === "failed" ? (
        <Banner tone="error" title="That history could not be loaded.">
          {load.message}
        </Banner>
      ) : load.value.length === 0 ? (
        <p className="people-note">
          Nothing has been done to this account through the administration
          screens.
        </p>
      ) : (
        <ul className="audit-list">
          {load.value.map((entry) => (
            <AuditEntry key={entry.id} entry={entry} showSubject={false} />
          ))}
        </ul>
      )}

      <p className="people-note">
        <Link to="/account/audit">Everything administrators have done</Link>.
      </p>
    </section>
  );
}

const ACTION_LABEL: Record<AdministrativeAction["action"], string> = {
  "roles-changed": "Roles changed",
  "account-suspended": "Suspended",
  "account-reinstated": "Reinstated",
  "account-deleted": "Deleted",
};

/**
 * One line of the administrative log.
 *
 * Exported so the log page draws the same row rather than its own. Two
 * renderings of an audit entry are two chances for one of them to word
 * "revoked" as "granted".
 */
export function AuditEntry({
  entry,
  showSubject = true,
}: {
  entry: AdministrativeAction;
  showSubject?: boolean;
}) {
  return (
    <li className="audit-row" data-action={entry.action}>
      <p className="audit-head">
        <span className="audit-action" data-action={entry.action}>
          {ACTION_LABEL[entry.action]}
        </span>
        {showSubject ? <strong>{entry.subjectDisplayName}</strong> : null}
      </p>
      {entry.action === "roles-changed" ? (
        <p className="audit-detail">
          {describeRoles(entry.rolesBefore)} → {describeRoles(entry.rolesAfter)}
        </p>
      ) : null}
      {/* A text node. Written by an administrator, and rendered to others. */}
      {entry.reason ? (
        <blockquote className="people-reason">{entry.reason}</blockquote>
      ) : null}
      <p className="audit-meta">
        by {entry.actorDisplayName} · <When value={entry.createdAt} />
      </p>
    </li>
  );
}

/**
 * A stored role set, written out.
 *
 * `null` means "no assignable role", which on this platform is a plain
 * community account — and saying so is more useful than an empty space. It also
 * covers "this action was not about roles", which is why only the
 * `roles-changed` row draws it.
 */
function describeRoles(roles: Role[] | null): string {
  if (!roles || roles.length === 0) return "Community";
  return ROLES.filter((role) => roles.includes(role))
    .map((role) => ROLE_META[role].label)
    .join(" + ");
}

/* --------------------------------------------------------------- the page */

const STATUS_LABEL: Record<AccountStatusFilter, string> = {
  all: "Every account",
  active: "Active",
  suspended: "Suspended",
  unverified: "Never verified",
};

function Directory({ viewer }: { viewer: CurrentUser }) {
  const [params, setParams] = useSearchParams();

  // The search box, held here and never written into the URL. See the note at
  // the top of this file.
  const [term, setTerm] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<AccountStatusFilter | "">("");
  const [page, setPage] = useState(1);

  const [list, setList] = useState<
    Load<{ users: AdminUser[]; total: number; pages: number }>
  >({ state: "loading" });

  const selectedId = params.get(SELECTED);

  // No `setList({ state: "loading" })` here, deliberately. This runs from an
  // effect, and a synchronous state write inside one is a cascading render the
  // lint rule refuses — but it is also the wrong behaviour: refetching after a
  // suspension or a role change would blank the panel the administrator is
  // looking at. The list keeps showing what it has until the new page arrives,
  // which is what the flag queue already does.
  const reload = useCallback(
    (signal?: AbortSignal) => {
      listUsers(
        {
          q: submitted || undefined,
          role: role || undefined,
          status: status || undefined,
          page,
        },
        signal,
      )
        .then((result) => {
          if (signal?.aborted) return;
          setList({
            state: "ready",
            value: {
              users: result.users,
              total: result.totalCount,
              pages: result.totalPages,
            },
          });
        })
        .catch((error: unknown) => {
          if (signal?.aborted) return;
          setList({ state: "failed", message: describeFailure(error) });
        });
    },
    [submitted, role, status, page],
  );

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  function select(id: string | null) {
    const next = new URLSearchParams(params);
    if (id) next.set(SELECTED, id);
    else next.delete(SELECTED);
    // `replace`, so opening and closing accounts does not fill the history with
    // steps a Back press has to walk through one at a time.
    setParams(next, { replace: true });
  }

  return (
    <>
      <section className="account-section" aria-labelledby="people-heading">
        <h2 id="people-heading">People</h2>
        <p className="account-section-lede">
          Every account on the site. This is the only page here that shows
          somebody else’s email address, which is why it is administrators only
          and why nothing typed into it is written into the address bar.
        </p>

        <form
          className="people-search"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSubmitted(term.trim());
          }}
        >
          <label className="people-field">
            <span>Search by address or name</span>
            <input
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              // Off, deliberately. This box takes other people's addresses, and
              // an autofill store that learned them is a copy of the directory
              // sitting on whatever machine an administrator happened to use.
              autoComplete="off"
              maxLength={254}
            />
          </label>

          <label className="people-field">
            <span>Role</span>
            <select
              value={role}
              onChange={(event) => {
                setPage(1);
                setRole(event.target.value);
              }}
            >
              <option value="">Any role</option>
              {ROLES.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {ROLE_META[candidate].label}
                </option>
              ))}
            </select>
          </label>

          <label className="people-field">
            <span>State</span>
            <select
              value={status}
              onChange={(event) => {
                setPage(1);
                setStatus(event.target.value as AccountStatusFilter | "");
              }}
            >
              <option value="">Any state</option>
              {ACCOUNT_STATUS_FILTERS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {STATUS_LABEL[candidate]}
                </option>
              ))}
            </select>
          </label>

          <SubmitButton pending={false} pendingLabel="Searching…">
            Search
          </SubmitButton>
        </form>

        {list.state === "loading" ? (
          <SessionPending label="Loading accounts…" />
        ) : list.state === "failed" ? (
          <Banner tone="error" title="The directory could not be loaded.">
            {list.message}
          </Banner>
        ) : list.value.users.length === 0 ? (
          <p className="auth-note">
            {submitted ? "No account matches that." : "There are no accounts to show."}
          </p>
        ) : (
          <>
            <p className="people-count">
              {list.value.total === 1 ? "One account" : `${list.value.total} accounts`}
              {submitted ? " matching that search" : ""}.
            </p>
            <ul className="people-list">
              {list.value.users.map((account) => (
                <li
                  key={account.id}
                  className={
                    account.id === selectedId ? "people-row is-open" : "people-row"
                  }
                >
                  <div className="people-identity">
                    <p className="people-name">{account.displayName}</p>
                    <p className="people-email">{account.email}</p>
                    <Roles roles={account.roles} />
                    <AccountState account={account} />
                  </div>
                  <button
                    type="button"
                    className="button"
                    aria-expanded={account.id === selectedId}
                    onClick={() => select(account.id === selectedId ? null : account.id)}
                  >
                    {account.id === selectedId ? "Close" : "Manage"}
                  </button>
                </li>
              ))}
            </ul>

            {list.value.pages > 1 ? (
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
                  Page {page} of {list.value.pages}
                </span>
                <button
                  type="button"
                  className="button"
                  disabled={page >= list.value.pages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </button>
              </p>
            ) : null}
          </>
        )}
      </section>

      {selectedId ? (
        <AccountPanel
          key={selectedId}
          userId={selectedId}
          viewer={viewer}
          onChanged={() => reload()}
          onDeleted={() => {
            select(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * One account, opened.
 *
 * Fetched by identifier rather than reused from the list row, so that a link
 * somebody was sent — `/account/people?user=…` — opens the same panel without
 * needing the search that found it. It also means the panel is never showing a
 * stale copy of a row the list fetched some time ago, which on a page whose
 * next action is "delete" is worth a round trip.
 */
function AccountPanel({
  userId,
  viewer,
  onChanged,
  onDeleted,
}: {
  userId: string;
  viewer: CurrentUser;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [load, setLoad] = useState<Load<AdminUserDetail>>({ state: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    getUser(userId, controller.signal)
      .then((detail) => setLoad({ state: "ready", value: detail }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ state: "failed", message: describeFailure(error) });
      });

    return () => controller.abort();
  }, [userId, reloads]);

  function refresh() {
    setReloads((count) => count + 1);
    onChanged();
  }

  if (load.state === "loading") {
    return <SessionPending label="Loading that account…" />;
  }

  if (load.state === "failed") {
    return (
      <Banner tone="error" title="That account could not be loaded.">
        {load.message}
      </Banner>
    );
  }

  const account = load.value.user;

  // Every self-directed action the service refuses is refused here too, with
  // the reason. The server is what actually enforces it — this page runs on
  // hardware the reader controls — but a button that exists only to answer 400
  // is a button that reads as broken.
  const isSelf = account.id === viewer.id;

  return (
    <section className="account-section people-panel" aria-labelledby="people-panel-heading">
      <h3 id="people-panel-heading">{account.displayName}</h3>
      <p className="people-email">{account.email}</p>
      <p className="people-note">
        Joined <When value={account.createdAt} />.
      </p>
      <AccountState account={account} />

      <RoleEditor account={account} disabled={isSelf} onChanged={refresh} />
      <SuspensionEditor account={account} disabled={isSelf} onChanged={refresh} />
      <DeleteAccount detail={load.value} disabled={isSelf} onDeleted={onDeleted} />
      <AccountHistory userId={account.id} />
    </section>
  );
}

export default function AccountPeople() {
  return (
    <RequireSession role="Administrator">
      {(user) => <Directory viewer={user} />}
    </RequireSession>
  );
}
