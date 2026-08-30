/**
 * What a role lets someone do, in one place.
 *
 * Every role question in the UI goes through this module rather than
 * comparing strings at the call site. That is not tidiness: a check written
 * inline as `roles.includes("contributor")` silently stops being true for an
 * admin, and the bug it produces — an administrator who cannot see the
 * contributor tools — is the kind nobody reports because it looks like a
 * permissions decision rather than a mistake.
 *
 * None of this is a security boundary. The browser decides what to *draw*;
 * the API decides what to *allow*, and it has to make every one of these
 * judgements again on its own, because everything below runs on hardware the
 * reader controls.
 */

import { ROLES, type CurrentUser, type Role } from "./types";

export interface RoleDescription {
  label: string;
  /** One line, written for the reader, shown on the account page. */
  summary: string;
}

export const ROLE_META: Record<Role, RoleDescription> = {
  community: {
    label: "Community",
    summary:
      "Read the whole reference, and keep your own account. This is what every new account starts as.",
  },
  contributor: {
    label: "Contributor",
    summary:
      "Everything a community account can do, plus uploading and correcting base game content.",
  },
  admin: {
    label: "Admin",
    summary:
      "Everything a contributor can do, plus managing accounts and the roles they hold.",
  },
};

/** Where each role sits in the hierarchy. Higher includes lower. */
const RANK: Record<Role, number> = {
  community: 0,
  contributor: 1,
  admin: 2,
};

/**
 * The most privileged role an account holds. An account with no recognised
 * role is treated as `community`: read-only is the safe reading of a value
 * this client does not understand, and it means a role added by a newer
 * server cannot accidentally unlock anything here.
 */
export function effectiveRole(user: Pick<CurrentUser, "roles"> | null): Role {
  if (!user) return "community";
  let best: Role = "community";
  for (const role of user.roles) {
    if (ROLES.includes(role) && RANK[role] > RANK[best]) best = role;
  }
  return best;
}

/** True when the account holds `required`, or anything above it. */
export function hasAtLeast(
  user: Pick<CurrentUser, "roles"> | null,
  required: Role,
): boolean {
  return RANK[effectiveRole(user)] >= RANK[required];
}

/** Uploading base game content is the contributor privilege. */
export function canUploadContent(user: Pick<CurrentUser, "roles"> | null): boolean {
  return hasAtLeast(user, "contributor");
}

/** Managing other people's accounts is the admin privilege. */
export function canAdministerAccounts(
  user: Pick<CurrentUser, "roles"> | null,
): boolean {
  return hasAtLeast(user, "admin");
}
