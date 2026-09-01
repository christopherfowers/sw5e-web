/**
 * What the administrative client actually sends, and how it reads a refusal.
 *
 * These are request-shape tests. Almost nothing here asserts a happy return
 * value, because the interesting failures in a client like this one are not
 * "the wrong object came back" — they are "the filter was never sent", "the
 * reason was sent on a call that refuses one", "a 403 was reported as the wrong
 * kind of 403". Every one of those is invisible to a test that only checks a
 * promise resolved.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthApiContract, user } from "../../tests/auth-api-contract";
import { AdminApiStub, adminUser, serveAdministration } from "../../tests/admin-api-stub";
import { ApiError, STRONG_AUTHENTICATION_REQUIRED } from "~/api/http";
import {
  deleteUser,
  getUser,
  listAdministrativeActions,
  listUsers,
  setSuspension,
} from "./api";

function serve(
  admin: AdminApiStub,
  session = user({ roles: ["Community", "Administrator"] }),
) {
  const auth = new AuthApiContract({ session });
  vi.stubGlobal("fetch", serveAdministration(auth, admin));
  return admin;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the directory request", () => {
  it("sends the search term, the role and the state as the server names them", async () => {
    const admin = serve(new AdminApiStub({ users: [adminUser()] }));

    await listUsers({ q: "zeb", role: "Contributor", status: "suspended", page: 2 });

    const call = admin.lastCall("GET", "/api/auth/admin/users");
    const query = new URLSearchParams(call?.path.split("?")[1] ?? "");

    expect(query.get("q")).toBe("zeb");
    expect(query.get("role")).toBe("Contributor");
    expect(query.get("status")).toBe("suspended");
    expect(query.get("page")).toBe("2");
  });

  it("omits a filter entirely rather than sending it empty", async () => {
    // The service refuses a value it does not recognise rather than ignoring
    // it, so `status=` would be a 400 on a page the reader had simply not
    // filtered. Omitting is the only correct way to say "no filter".
    const admin = serve(new AdminApiStub({ users: [adminUser()] }));

    await listUsers({ q: "", role: undefined, status: undefined });

    const call = admin.lastCall("GET", "/api/auth/admin/users");

    expect(call?.path).toBe("/api/auth/admin/users");
  });

  it("actually filters, so a client that dropped the term would be noticed", async () => {
    serve(
      new AdminApiStub({
        users: [
          adminUser({ id: "a", email: "zeb@example.test", displayName: "Zeb" }),
          adminUser({ id: "b", email: "hera@example.test", displayName: "Hera" }),
        ],
      }),
    );

    const page = await listUsers({ q: "hera" });

    expect(page.users.map((account) => account.id)).toEqual(["b"]);
  });
});

describe("suspension", () => {
  it("sends the reason when suspending", async () => {
    const admin = serve(new AdminApiStub({ users: [adminUser({ id: "u" })] }));

    await setSuspension("u", true, "Scraping the powers index.");

    expect(admin.lastCall("PUT", "/api/auth/admin/users/u/suspension")?.body).toEqual({
      suspended: true,
      reason: "Scraping the powers index.",
    });
  });

  it("drops the reason when reinstating, because the service refuses one", async () => {
    // The form field may still hold text from the suspension that is being
    // lifted. Passing it through would turn a reinstatement into a 400 the
    // administrator did not cause, which is the kind of failure that reads as
    // the feature being broken.
    const admin = serve(
      new AdminApiStub({
        users: [
          adminUser({
            id: "u",
            suspension: { at: "2026-09-01T00:00:00.000Z", reason: "Because", byUserId: "a" },
          }),
        ],
      }),
    );

    const result = await setSuspension("u", false, "left over in the box");

    expect(admin.lastCall("PUT", "/api/auth/admin/users/u/suspension")?.body).toEqual({
      suspended: false,
      reason: null,
    });
    expect(result.suspension).toBeNull();
  });

  it("reports the server's refusal when a suspension has no reason", async () => {
    const admin = serve(new AdminApiStub({ users: [adminUser({ id: "u" })] }));

    await expect(setSuspension("u", true, "")).rejects.toBeInstanceOf(ApiError);

    // And nothing was suspended by the attempt.
    expect(admin.users[0].suspension).toBeNull();
  });
});

describe("deletion", () => {
  it("carries the reason in the body rather than in the URL", async () => {
    // A sentence naming a person does not belong in a query string that every
    // access log between the browser and the process writes down.
    const admin = serve(new AdminApiStub({ users: [adminUser({ id: "u" })] }));

    await deleteUser("u", "Asked to be removed.");

    const call = admin.lastCall("DELETE", "/api/auth/admin/users/u");

    expect(call?.path).toBe("/api/auth/admin/users/u");
    expect(call?.body).toEqual({ reason: "Asked to be removed." });
  });

  it("surfaces the outstanding-drafts refusal as its own thing", async () => {
    const admin = serve(
      new AdminApiStub({ users: [adminUser({ id: "u" })], outstandingDrafts: 2 }),
    );

    const failure = await deleteUser("u").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).kind).toBe("conflict");
    expect((failure as ApiError).code).toBe("drafts-outstanding");

    // The refusal was real: the account is still there.
    expect(admin.users).toHaveLength(1);
  });
});

describe("what a refusal says", () => {
  it("reports a non-administrator as forbidden", async () => {
    serve(new AdminApiStub({ users: [] }), user({ roles: ["Contributor"] }));

    const failure = await listUsers().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).kind).toBe("forbidden");
    expect((failure as ApiError).code).toBeNull();
  });

  it("reports an administrator who signed in with a code as needing a stronger sign-in", async () => {
    // The distinction this whole surface depends on. Both are 403s; only one of
    // them is something the reader can fix in a minute.
    serve(
      new AdminApiStub({ users: [] }),
      user({
        roles: ["Community", "Administrator"],
        authenticationMethod: "email",
        strongAuthentication: false,
      }),
    );

    const failure = await listUsers().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).kind).toBe("forbidden");
    expect((failure as ApiError).code).toBe(STRONG_AUTHENTICATION_REQUIRED);
  });

  it("reports an anonymous caller as unauthenticated", async () => {
    const auth = new AuthApiContract({ session: null });
    vi.stubGlobal("fetch", serveAdministration(auth, new AdminApiStub()));

    const failure = await listUsers().catch((error: unknown) => error);

    expect((failure as ApiError).kind).toBe("unauthenticated");
  });

  it("says nothing about whether the account exists", async () => {
    // The refusal a non-administrator meets must be the same whether the
    // identifier they asked about is real or invented. It is, because the
    // service refuses before it looks — and the fixture models that ordering
    // rather than reproducing the answer.
    serve(
      new AdminApiStub({ users: [adminUser({ id: "real" })] }),
      user({ roles: ["Community"] }),
    );

    // Cast after the await rather than inside the handler: `.catch` widens the
    // result to the union of the resolved value and whatever the handler
    // returns, and asserting on that union is a type error rather than a test.
    const known = (await getUser("real").catch((error: unknown) => error)) as ApiError;
    const unknown = (await getUser("invented").catch(
      (error: unknown) => error,
    )) as ApiError;

    expect(known.status).toBe(unknown.status);
    expect(known.message).toBe(unknown.message);
    expect(known.code).toBe(unknown.code);
  });
});

describe("the administrative log request", () => {
  it("filters by subject, which is how an account's own history is fetched", async () => {
    const admin = serve(new AdminApiStub({ actions: [] }));

    await listAdministrativeActions({ subjectId: "user-2" });

    const call = admin.lastCall("GET", "/api/auth/admin/audit");
    const query = new URLSearchParams(call?.path.split("?")[1] ?? "");

    expect(query.get("subjectId")).toBe("user-2");
  });
});
