import { describe, expect, it } from "vitest";

import {
  canAdministerAccounts,
  canUploadContent,
  effectiveRole,
  hasAtLeast,
} from "./roles";
import type { Role } from "./types";

function account(roles: Role[]) {
  return { roles };
}

describe("effectiveRole", () => {
  it("is community for a signed-out reader", () => {
    expect(effectiveRole(null)).toBe("community");
  });

  it("is the highest role held, not the first one listed", () => {
    expect(effectiveRole(account(["community", "admin"]))).toBe("admin");
    expect(effectiveRole(account(["admin", "community"]))).toBe("admin");
  });

  it("falls back to community for a role this client does not recognise", () => {
    // A newer server adding a role must not accidentally unlock anything here.
    expect(effectiveRole(account(["moderator" as Role]))).toBe("community");
  });
});

describe("privileges", () => {
  it("does not let a community account upload content", () => {
    expect(canUploadContent(account(["community"]))).toBe(false);
    expect(canUploadContent(null)).toBe(false);
  });

  it("lets a contributor upload content", () => {
    expect(canUploadContent(account(["contributor"]))).toBe(true);
  });

  it("lets an admin do everything a contributor can", () => {
    // The bug this exists to prevent: an inline `roles.includes("contributor")`
    // check that silently excludes administrators.
    expect(canUploadContent(account(["admin"]))).toBe(true);
    expect(canAdministerAccounts(account(["admin"]))).toBe(true);
  });

  it("does not let a contributor administer accounts", () => {
    expect(canAdministerAccounts(account(["contributor"]))).toBe(false);
  });

  it("treats the hierarchy as inclusive downwards", () => {
    expect(hasAtLeast(account(["admin"]), "community")).toBe(true);
    expect(hasAtLeast(account(["community"]), "contributor")).toBe(false);
  });
});
