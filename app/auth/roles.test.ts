import { describe, expect, it } from "vitest";

import {
  canAdministerAccounts,
  canUploadContent,
  effectiveRole,
  hasAtLeast,
  ROLE_META,
} from "./roles";
import { ROLES, type Role } from "./types";

function account(roles: Role[]) {
  return { roles };
}

describe("the wire names", () => {
  /**
   * Spelled out by hand rather than derived from `ROLES`, because a test that
   * reads the same constant it is checking asserts nothing at all: rename the
   * constant and the test renames itself.
   *
   * These three strings are what `/api/auth/me` puts on the wire. They are
   * capitalised, and the top one is `Administrator`, not `admin`. The failure
   * this guards against is entirely silent — when these were lowercase,
   * `effectiveRole` recognised none of them, answered `Community` for
   * everybody, and hid the contributor and admin surfaces from the people who
   * held those roles without logging or showing anything.
   */
  it("are exactly the names the service uses, in ascending privilege", () => {
    expect([...ROLES]).toEqual(["Community", "Contributor", "Administrator"]);
  });

  it("is what a role parsed from a live response resolves to", () => {
    // The literal here stands in for a response body, so this fails if the
    // union is ever re-spelled without the service agreeing.
    const fromTheWire = JSON.parse('["Community","Contributor"]') as Role[];

    expect(effectiveRole(account(fromTheWire))).toBe("Contributor");
  });

  it("describes every role it declares, so the account page cannot read undefined", () => {
    for (const role of ROLES) {
      expect(ROLE_META[role].label.length).toBeGreaterThan(0);
      expect(ROLE_META[role].summary.length).toBeGreaterThan(0);
    }
  });
});

describe("effectiveRole", () => {
  it("is Community for a signed-out reader", () => {
    expect(effectiveRole(null)).toBe("Community");
  });

  it("is the highest role held, not the first one listed", () => {
    expect(effectiveRole(account(["Community", "Administrator"]))).toBe("Administrator");
    expect(effectiveRole(account(["Administrator", "Community"]))).toBe("Administrator");
  });

  it("falls back to Community for a role this client does not recognise", () => {
    // A newer server adding a role must not accidentally unlock anything here.
    expect(effectiveRole(account(["Moderator" as Role]))).toBe("Community");
  });

  it("does not recognise a lowercased role name", () => {
    // The precise shape of the bug this file exists to keep out: the names are
    // case-sensitive wire values, and a client that lowercases them quietly
    // demotes everybody rather than failing.
    expect(effectiveRole(account(["administrator" as Role]))).toBe("Community");
  });
});

describe("privileges", () => {
  it("does not let a community account upload content", () => {
    expect(canUploadContent(account(["Community"]))).toBe(false);
    expect(canUploadContent(null)).toBe(false);
  });

  it("lets a contributor upload content", () => {
    expect(canUploadContent(account(["Contributor"]))).toBe(true);
  });

  it("lets an administrator do everything a contributor can", () => {
    // The bug this exists to prevent: an inline `roles.includes("Contributor")`
    // check that silently excludes administrators.
    expect(canUploadContent(account(["Administrator"]))).toBe(true);
    expect(canAdministerAccounts(account(["Administrator"]))).toBe(true);
  });

  it("does not let a contributor administer accounts", () => {
    expect(canAdministerAccounts(account(["Contributor"]))).toBe(false);
  });

  it("treats the hierarchy as inclusive downwards", () => {
    expect(hasAtLeast(account(["Administrator"]), "Community")).toBe(true);
    expect(hasAtLeast(account(["Community"]), "Contributor")).toBe(false);
  });
});
