/**
 * The shape of the administrative API, written down.
 *
 * The same rule as `app/auth/types.ts` and `app/flags/types.ts`: these are wire
 * strings spelled exactly as the service spells them, and getting one wrong is
 * silent rather than a type error. `docs/account-api-contract.md` is the
 * reconciled contract these implement, and it is committed to both
 * repositories.
 *
 * ## What is in here that is not anywhere else on this site
 *
 * `AdminUser.email` is somebody else's email address. Nothing else this client
 * fetches carries one: the flag queue deliberately shows a display name to
 * contributors, on the grounds that being trusted with content does not entitle
 * you to the address of everyone who ever reported a typo. This does carry
 * addresses, because "somebody wrote to me asking to contribute, find them" has
 * no other answer.
 *
 * That makes every screen built on these types an administrators-only screen,
 * and it makes the ordinary rules stricter rather than looser: nothing here is
 * cached anywhere, nothing here goes into a URL, and nothing here is rendered
 * as markup. Display names, suspension reasons and administrative notes are all
 * written by people, and every one of them reaches the page as a text node.
 */

import type { Role } from "~/auth/types";

/**
 * Why an account cannot sign in, and since when.
 *
 * `null` on an account rather than an object with a false flag: "not suspended"
 * is the *absence* of a suspension, so a component rendering a date has one
 * question to ask rather than two.
 *
 * `reason` is written for the other administrators and is never shown to the
 * account it is about. This client must not surface it anywhere a non-admin can
 * reach, which today means: only on the pages under `/account` that are guarded
 * for `Administrator`.
 */
export interface AccountSuspension {
  /** ISO-8601. */
  at: string;
  reason: string | null;
  /**
   * The administrator who did it. An identifier rather than a name, because the
   * account may itself have been deleted since; the administrative log carries
   * the readable version, copied onto the row at the time.
   */
  byUserId: string | null;
}

/**
 * One account as the directory shows it.
 *
 * Notice what is here and what is not. `secondFactorEnrolled` is a boolean and
 * not a credential list — an administrator needs to know whether granting
 * `Contributor` will produce a role the person can actually use, and does not
 * need anybody else's credential identifiers. There is no security stamp, no
 * lockout end date and no normalised address, because none of them is something
 * an administrator can act on and all of them help somebody holding a stolen
 * administrator session.
 */
export interface AdminUser {
  id: string;
  /** Somebody else's email address. See the note at the top of this file. */
  email: string;
  displayName: string;
  roles: Role[];
  emailConfirmed: boolean;
  /** Whether an authenticator app is enrolled. */
  twoFactorEnabled: boolean;
  /**
   * Whether the account holds a passkey **or** an authenticator app — that is,
   * whether an elevated role granted to it would be usable. Answered by the
   * server rather than derived from `twoFactorEnabled` here, because passkeys
   * are not listed on this response and never should be.
   */
  secondFactorEnrolled: boolean;
  /**
   * Whether failed attempts have currently locked the account out.
   *
   * A different thing from a suspension in every way that matters: this one is
   * the framework counting failures, it expires by itself, and any stranger can
   * cause one against any account they can name. The interface has to keep them
   * apart or an administrator will lift the wrong one.
   */
  lockedOut: boolean;
  suspension: AccountSuspension | null;
  /** ISO-8601. */
  createdAt: string;
}

/** A page of the directory. The same envelope the flag queue uses. */
export interface AdminUserList {
  users: AdminUser[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

/**
 * One account in full.
 *
 * `outstandingDrafts` is `null` — not `0` — on a deployment that serves content
 * from files and has no authoring at all, so an interface never draws "0
 * drafts" beside an account where the concept does not exist. When it is a
 * number above zero, deletion is refused; that is why it is worth fetching
 * before offering the button rather than after pressing it.
 */
export interface AdminUserDetail {
  user: AdminUser;
  outstandingDrafts: number | null;
}

/**
 * What an administrator did.
 *
 * Hyphenated and lower case, which is also what is stored — not the service's
 * C# member names. A rename on either side is a breaking change, and spelling
 * the literals out here is what makes it one that fails a test.
 */
export const ADMINISTRATIVE_ACTIONS = [
  "roles-changed",
  "account-suspended",
  "account-reinstated",
  "account-deleted",
] as const;

export type AdministrativeActionKind = (typeof ADMINISTRATIVE_ACTIONS)[number];

export function isAdministrativeAction(
  value: unknown,
): value is AdministrativeActionKind {
  return (
    typeof value === "string" &&
    (ADMINISTRATIVE_ACTIONS as readonly string[]).includes(value)
  );
}

/**
 * One entry in the administrative log.
 *
 * The display names are copies the service took at the time, which is why they
 * are plain strings rather than the nullable shape the flag queue uses for its
 * accounts. That difference is the whole design: a report can afford to render
 * "a removed account", and the entry recording a deletion cannot, because
 * outliving that deletion is the entire point of it.
 *
 * `rolesBefore` and `rolesAfter` list only assignable roles, so `null` covers
 * both "this action was not about roles" and "the account held none". `action`
 * is what tells those apart — a reader of this type must not infer the kind of
 * action from whether the role fields are present.
 */
export interface AdministrativeAction {
  id: string;
  action: AdministrativeActionKind;
  actorUserId: string;
  actorDisplayName: string;
  subjectUserId: string;
  subjectDisplayName: string;
  rolesBefore: Role[] | null;
  rolesAfter: Role[] | null;
  reason: string | null;
  /** ISO-8601. */
  createdAt: string;
}

/** A page of the administrative log. */
export interface AdministrativeLog {
  actions: AdministrativeAction[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

/**
 * Which accounts the directory should list.
 *
 * `unverified` is registrations that never completed — the accounts an
 * administrator is looking at when somebody reports that a verification email
 * never arrived.
 */
export const ACCOUNT_STATUS_FILTERS = [
  "all",
  "active",
  "suspended",
  "unverified",
] as const;

export type AccountStatusFilter = (typeof ACCOUNT_STATUS_FILTERS)[number];
