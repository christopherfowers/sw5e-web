/**
 * Managing one account.
 *
 * ## Why this is a page and not a panel
 *
 * All of this used to be drawn underneath the directory on `/account/people`.
 * It worked, and it read as broken: on a directory long enough to scroll —
 * which is every directory worth searching — pressing Manage appended a panel
 * somewhere below the fold and left the reader looking at an unchanged list.
 * The commonest reaction to that is to press the button again, which closed it.
 * An action whose entire result is off-screen is indistinguishable from an
 * action that did nothing.
 *
 * So managing an account is its own address, and arriving at it looks like
 * arriving somewhere: the account's name is the heading, the page says nothing
 * else, and the way back to the directory is the first thing on it.
 *
 * ## Which address, and why it is not `/account/people/:userId`
 *
 * A path segment would have been the obvious shape and is not available here.
 * This site has no runtime server: every published path is prerendered to a
 * file and anything without one falls through to nginx's SPA fallback, which is
 * wired to `error_page 404`. A dynamic segment cannot be prerendered — there is
 * no bounded list of accounts to enumerate, and an account directory is the
 * last thing a build machine should be enumerating — so `/account/people/<id>`
 * would render correctly in a browser while answering 404 to a shared link, a
 * crawler and a monitor. The account therefore travels in the query string on a
 * static path, exactly as the document being edited does in the authoring
 * workspace. See `react-router.config.ts` and `app/routes.ts`.
 *
 * A version 7 GUID is the *only* thing allowed in that query string. The search
 * term on the directory is somebody's email address and stays out of the URL
 * entirely; `app/routes/account-people.tsx` sets out why.
 *
 * ## What keeps the reader's search alive across the trip
 *
 * This is a child route of `/account/people`, so React Router keeps the
 * directory's component mounted while this page is drawn. "Back to the
 * directory" is an ordinary link to `/account/people` and lands on the list the
 * reader left — same search, same filters, same page — because that state never
 * went anywhere. It could not have been stored: the term is an address, so the
 * query string, `history.state` and `sessionStorage` are all closed to it.
 *
 * ## Everything from the server is text
 *
 * Display names are chosen by their owners; suspension reasons and
 * administrative notes are written by administrators, whose accounts can be
 * compromised. All of them are rendered as text nodes, and React's raw-HTML
 * escape hatch does not appear on this page and may not be added.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { ApiError } from "~/api/http";
import {
  assignRoles,
  deleteUser,
  getUser,
  listAdministrativeActions,
  setSuspension,
} from "~/admin/api";
import { describeFailure, When, type Load } from "~/admin/format";
import type {
  AdministrativeAction,
  AdminUser,
  AdminUserDetail,
} from "~/admin/types";
import { RequireSession } from "~/auth/guard";
import { ROLE_META } from "~/auth/roles";
import type { AssignableRole, CurrentUser } from "~/auth/types";
import { Banner, SessionPending, SubmitButton } from "~/components/auth-ui";
import { accountMeta } from "./account";
import { AccountState, AuditEntry, Roles, SELECTED } from "./account-people";

import "~/styles/admin.css";

export function meta() {
  return accountMeta("Manage an account");
}

/**
 * Where the way out goes.
 *
 * Bare, with no query string of its own. The directory is still mounted behind
 * this page and is holding the reader's search; anything appended here would be
 * either redundant or — if it were the search term — the one thing that must
 * never reach a URL.
 */
const DIRECTORY = "/account/people";

/** The roles an administrator may grant. `Community` is the floor, not a gift. */
const ASSIGNABLE: AssignableRole[] = ["Contributor", "Administrator"];

/**
 * The way back, drawn above the heading rather than below the last control.
 *
 * At the top because that is where somebody looks when they have opened the
 * wrong account, which is the commonest reason to want it — and because the
 * last control on this page is the one that deletes an account, which is not
 * the neighbour a "never mind" link should have.
 */
function BackToDirectory() {
  return (
    <p className="people-back">
      <Link to={DIRECTORY}>Back to the directory</Link>
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
      <h3 id="people-roles-heading">Roles</h3>

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
      <h3 id="people-suspension-heading">Suspension</h3>

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
      // reason to reload, since this page may have been open since before
      // somebody else saved a draft.
      setError(
        failure instanceof ApiError && failure.code === "drafts-outstanding"
          ? `${failure.message} Reload this page to see the current count.`
          : describeFailure(failure),
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="people-action" aria-labelledby="people-delete-heading">
      <h3 id="people-delete-heading">Delete</h3>

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
      <h3 id="people-history-heading">Administrative history</h3>

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

/* --------------------------------------------------------------- the page */

/**
 * One account, and everything that can be done to it.
 *
 * Fetched by identifier rather than handed down from the row that linked here,
 * so that a link somebody was sent opens the same page without needing the
 * search that found it — and so that nothing here is a stale copy of a row the
 * directory fetched some time ago, which on a page whose last action is
 * "delete" is worth a round trip.
 */
function ManagedAccount({ userId, viewer }: { userId: string; viewer: CurrentUser }) {
  const navigate = useNavigate();
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

  if (load.state === "loading") {
    return (
      <>
        <BackToDirectory />
        <SessionPending label="Loading that account…" />
      </>
    );
  }

  if (load.state === "failed") {
    return (
      <>
        <BackToDirectory />
        <Banner tone="error" title="That account could not be loaded.">
          {load.message}
        </Banner>
      </>
    );
  }

  const account = load.value.user;

  // Every self-directed action the service refuses is refused here too, with
  // the reason. The server is what actually enforces it — this page runs on
  // hardware the reader controls — but a button that exists only to answer 400
  // is a button that reads as broken.
  const isSelf = account.id === viewer.id;

  return (
    <>
      <BackToDirectory />

      <section
        className="account-section people-panel"
        aria-labelledby="people-panel-heading"
      >
        {/*
          Who is being managed, before anything that acts on them. The whole
          reason this stopped being a panel is that an administrator could press
          Manage and not see what they had opened; the answer is not to make the
          panel louder but to put the account's own name where the page's
          subject belongs.
        */}
        <h2 id="people-panel-heading">{account.displayName}</h2>
        <p className="people-email">{account.email}</p>
        <p className="people-note">
          Joined <When value={account.createdAt} />.
        </p>
        <Roles roles={account.roles} />
        <AccountState account={account} />

        <RoleEditor
          account={account}
          disabled={isSelf}
          onChanged={() => setReloads((count) => count + 1)}
        />
        <SuspensionEditor
          account={account}
          disabled={isSelf}
          onChanged={() => setReloads((count) => count + 1)}
        />
        <DeleteAccount
          detail={load.value}
          disabled={isSelf}
          // `replace`, so that Back from the directory does not return to the
          // page of an account that no longer exists and sit on a 404 from the
          // API. The directory refetches itself on arrival, so the deleted row
          // is gone rather than lingering until the next search.
          onDeleted={() => void navigate(DIRECTORY, { replace: true })}
        />
        <AccountHistory userId={account.id} />
      </section>
    </>
  );
}

function Manage({ viewer }: { viewer: CurrentUser }) {
  const [params] = useSearchParams();
  const userId = params.get(SELECTED);

  // Reachable by hand and by a truncated link, so it says what is missing
  // rather than rendering an empty frame or throwing.
  if (!userId) {
    return (
      <>
        <BackToDirectory />
        <section className="account-section" aria-labelledby="people-panel-heading">
          <h2 id="people-panel-heading">Manage an account</h2>
          <p className="auth-note">
            This address needs to name an account. Find one in{" "}
            <Link to={DIRECTORY}>the directory</Link> and press Manage.
          </p>
        </section>
      </>
    );
  }

  return <ManagedAccount userId={userId} viewer={viewer} />;
}

/**
 * Guarded here as well as by the directory above it.
 *
 * Redundant while this is a child of `/account/people`, and deliberately so: a
 * route module that only holds because of where it happens to sit in the tree
 * is one re-parenting away from being unguarded, and this one draws somebody
 * else's email address. The guard is the usability half in any case — the API
 * refuses every request under `/api/auth/admin` on its own, which is the
 * boundary that actually holds.
 */
export default function AccountPeopleManage() {
  return (
    <RequireSession role="Administrator">
      {(user) => <Manage viewer={user} />}
    </RequireSession>
  );
}
