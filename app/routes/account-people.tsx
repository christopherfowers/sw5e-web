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
 * window when asking a colleague to look. The managed account *is* in the URL,
 * because a version 7 GUID is opaque and being able to send somebody a link to
 * "this account" is worth having.
 *
 * ## This page is the list, and nothing else
 *
 * It used to be both. Managing an account opened a panel underneath the
 * directory, on the same address, which meant that pressing Manage on a list
 * long enough to scroll produced no visible change whatsoever — the thing the
 * reader asked for was drawn below the fold, so the button read as broken.
 * Managing one account is now its own address, `/account/people/manage?user=…`,
 * and lives in `app/routes/account-people-manage.tsx`.
 *
 * That page is a **child route** of this one, and the nesting is the mechanism
 * rather than a filing decision. React Router keeps a parent route's component
 * mounted while a child renders, so `Directory` below survives the trip into an
 * account and back — with its search term, its filters and its page number
 * intact. Nothing else here could carry them: the term is somebody's email
 * address, which rules out the query string, `history.state` and storage alike.
 * So `Directory` renders the outlet *instead of* the list when the child is
 * matched, rather than beside it, and the list it comes back to is the one the
 * reader left.
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
import { Link, useNavigate, useOutlet, useSearchParams } from "react-router";

import { listUsers } from "~/admin/api";
import { describeFailure, When, type Load } from "~/admin/format";
import {
  ACCOUNT_STATUS_FILTERS,
  type AccountStatusFilter,
  type AdministrativeAction,
  type AdminUser,
} from "~/admin/types";
import { RequireSession } from "~/auth/guard";
import { ROLE_META } from "~/auth/roles";
import { ROLES, type Role } from "~/auth/types";
import { Banner, SessionPending, SubmitButton } from "~/components/auth-ui";
import { accountMeta } from "./account";

import "~/styles/admin.css";

export function meta() {
  return accountMeta("People");
}

/**
 * Which query parameter names the account being managed.
 *
 * A version 7 GUID and nothing else. Everything else this page holds — the
 * search term above all — stays out of the address bar; see the note at the top
 * of this file.
 */
export const SELECTED = "user";

/** The address that manages one account. */
export function managePath(userId: string): string {
  return `/account/people/manage?${SELECTED}=${encodeURIComponent(userId)}`;
}

/* --------------------------------------------------------------- the list */

/**
 * How an account's state reads at a glance.
 *
 * Suspended and locked out are separate markers and never one, because they are
 * separate things and an administrator who conflates them lifts the wrong one.
 * A suspension is a decision somebody made and lasts until somebody undoes it;
 * a lockout is the framework counting failed attempts, expires by itself, and
 * can be caused against any account by any stranger who knows its address.
 *
 * Exported so that the page which manages one account draws the same markers
 * the row did. Two renderings of "suspended" are two chances for one of them to
 * go quietly out of date.
 */
export function AccountState({ account }: { account: AdminUser }) {
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

/** The roles an account holds, as badges. Exported for the same reason. */
export function Roles({ roles }: { roles: Role[] }) {
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

/* ------------------------------------------------- the administrative log */

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

function Directory() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // The child route — `/account/people/manage` — when one is matched. This
  // component stays mounted while that page is drawn, which is the whole reason
  // the two are nested: everything below is the reader's search, and it has to
  // still be here when they come back. It is rendered *instead of* the list
  // rather than beneath it, because a management panel below a directory is
  // exactly what this page stopped doing.
  const managing = useOutlet();

  // Anybody holding a link to the address this page used to open an account at.
  // Those links were meant to be sent between administrators, so they are
  // honoured rather than ignored: the identifier is the same one the new page
  // reads, and it is only ever an opaque GUID.
  const legacySelection = params.get(SELECTED);

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

  const showingList = !managing && !legacySelection;

  // No `setList({ state: "loading" })` here, deliberately. This runs from an
  // effect, and a synchronous state write inside one is a cascading render the
  // lint rule refuses — but it is also the wrong behaviour: the refetch that
  // happens on returning from managing an account would blank the list for a
  // round trip, so somebody who suspended one person would come back to a
  // spinner where their search results were. The list keeps showing what it has
  // until the new page arrives, which is what the flag queue already does.
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

  // Fetched when the list is what the reader is looking at, and refetched when
  // they come back to it. That second half is what carries a change made on the
  // management page home: a role granted, a suspension lifted or an account
  // deleted shows in the row on arrival, with no signal passed between the two
  // pages and nothing for either of them to forget to send.
  useEffect(() => {
    if (!showingList) return;
    const controller = new AbortController();
    reload(controller.signal);
    return () => controller.abort();
  }, [reload, showingList]);

  // The old address for an open account, `/account/people?user=…`, sent on to
  // the page that now manages one. `replace`, so the link somebody followed
  // does not become a history entry that bounces them forward again on Back.
  useEffect(() => {
    if (!legacySelection) return;
    void navigate(managePath(legacySelection), { replace: true });
  }, [legacySelection, navigate]);

  if (managing) return managing;

  // Mid-redirect, and for one frame only. Drawing the list underneath would
  // fetch a directory the reader is already leaving.
  if (legacySelection) return null;

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
                <li key={account.id} className="people-row">
                  <div className="people-identity">
                    <p className="people-name">{account.displayName}</p>
                    <p className="people-email">{account.email}</p>
                    <Roles roles={account.roles} />
                    <AccountState account={account} />
                  </div>
                  {/*
                    A link, not a disclosure toggle. It goes somewhere, so it
                    behaves like everything else that does: middle-click opens it
                    in a tab, the browser shows where it leads, and the reader
                    who presses it lands on a page rather than on the same list
                    with something appended below the fold.

                    The accessible name carries the account's own name. A list of
                    twenty rows whose every control is called "Manage" is a list
                    that reads, to anybody moving through it by control, as
                    twenty identical buttons.
                  */}
                  <Link
                    className="button"
                    to={managePath(account.id)}
                    aria-label={`Manage ${account.displayName}`}
                  >
                    Manage
                  </Link>
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
    </>
  );
}

export default function AccountPeople() {
  return (
    <RequireSession role="Administrator">
      {() => <Directory />}
    </RequireSession>
  );
}
