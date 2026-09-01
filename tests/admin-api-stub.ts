/**
 * A stand-in for the administrative API, alongside the account one.
 *
 * The account contract fixture serves everything under `/api/auth` and refuses
 * anything else, so a test cannot silently reach something it did not mean to.
 * The administrative routes live *inside* that prefix — `/api/auth/admin/…` —
 * which means this cannot simply sit beside the account fixture the way the
 * flag stub does. It sits in front of it: anything under `/api/auth/admin` is
 * answered here, everything else under `/api/auth` falls through to the real
 * contract fixture, and anything else throws.
 *
 * ## Why it is strict about who may call it
 *
 * Most of what these tests assert is a refusal, and a stub that answered every
 * caller would make every one of them pass by accident. So this enforces what
 * the service enforces, in the same order:
 *
 *   - no session at all is a bodiless 401, exactly as the cookie scheme answers
 *   - a session without the Administrator role is a 403
 *   - an administrator whose session was established with an emailed code is a
 *     403 with `code: "strong-authentication-required"`
 *
 * The third is the one worth having a fixture for. It is a real 403 that the
 * interface must not word as "you do not have access", because the account
 * does — and no amount of role-checking in the client can tell the two apart
 * without the code.
 *
 * ## And about what it will not do
 *
 * It records every call, because most of these tests are about the request
 * rather than the reply: whether the search term reached the server, whether
 * the role assignment sent the complete set, whether a reinstatement sent a
 * reason it should not have.
 */

import { contractFetch, type AuthApiContract } from "./auth-api-contract";
import type {
  AdministrativeAction,
  AdministrativeLog,
  AdminUser,
  AdminUserDetail,
  AdminUserList,
} from "../app/admin/types";

export interface AdminCall {
  method: string;
  /** Path and query string, exactly as the client asked for it. */
  path: string;
  body: unknown;
}

export interface AdminReply {
  status: number;
  body?: unknown;
}

export interface AdminStubOptions {
  /** The directory, before any filter this stub applies. */
  users?: AdminUser[];
  /** The audit log, before any filter this stub applies. */
  actions?: AdministrativeAction[];
  /** How many unpublished drafts the detail endpoint reports. */
  outstandingDrafts?: number | null;
  /** Overrides for one route, keyed `"METHOD /path"` without the query string. */
  replies?: Record<string, AdminReply>;
}

/** A directory row, with everything but the interesting fields filled in. */
export function adminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: "user-2",
    email: "zeb@example.test",
    displayName: "Zeb Orrelios",
    roles: ["Community"],
    emailConfirmed: true,
    twoFactorEnabled: false,
    secondFactorEnrolled: true,
    lockedOut: false,
    suspension: null,
    createdAt: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

/** One administrative log entry. */
export function adminAction(
  overrides: Partial<AdministrativeAction> = {},
): AdministrativeAction {
  return {
    id: "action-1",
    action: "roles-changed",
    actorUserId: "user-1",
    actorDisplayName: "Jen Ordo",
    subjectUserId: "user-2",
    subjectDisplayName: "Zeb Orrelios",
    rolesBefore: null,
    rolesAfter: ["Contributor"],
    reason: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

const UNAUTHENTICATED: AdminReply = { status: 401 };

function problem(status: number, detail: string, code?: string): AdminReply {
  return { status, body: { status, title: "Refused", detail, code } };
}

export class AdminApiStub {
  readonly calls: AdminCall[] = [];

  /** The directory this stub is serving. Mutable, so a test can suspend a row. */
  users: AdminUser[];

  actions: AdministrativeAction[];

  constructor(private readonly options: AdminStubOptions = {}) {
    this.users = options.users ?? [];
    this.actions = options.actions ?? [];
  }

  /** The most recent request to one route, or undefined. */
  lastCall(method: string, path: string): AdminCall | undefined {
    return [...this.calls]
      .reverse()
      .find((call) => call.method === method && call.path.split("?")[0] === path);
  }

  handle(
    method: string,
    path: string,
    body: unknown,
    session: AuthApiContract["session"],
  ): AdminReply {
    this.calls.push({ method, path, body });

    const [route, search] = path.split("?");
    const override = this.options.replies?.[`${method} ${route}`];
    if (override) return override;

    // The three refusals, in the order the service applies them. Every one of
    // them happens before any handler, which is what keeps this surface from
    // being an enumeration oracle: the answer cannot depend on whether the
    // account named in the path exists, because nothing has looked.
    if (!session) return UNAUTHENTICATED;

    if (!session.roles.includes("Administrator")) {
      return problem(403, "This account may not perform that action.");
    }

    if (!session.strongAuthentication) {
      return problem(
        403,
        "This action needs a passkey or an authenticator app. Sign in again with one, or enrol one first if the account has neither.",
        "strong-authentication-required",
      );
    }

    const query = new URLSearchParams(search ?? "");

    if (method === "GET" && route === "/api/auth/admin/users") {
      return { status: 200, body: this.directory(query) };
    }

    if (method === "GET" && route === "/api/auth/admin/audit") {
      return { status: 200, body: this.log(query) };
    }

    const single = /^\/api\/auth\/admin\/users\/([^/]+)$/.exec(route);

    if (single) {
      const id = decodeURIComponent(single[1]);
      const found = this.users.find((user) => user.id === id);

      if (!found) {
        return problem(404, "No account with that identifier exists.");
      }

      if (method === "GET") {
        const detail: AdminUserDetail = {
          user: found,
          outstandingDrafts: this.options.outstandingDrafts ?? null,
        };
        return { status: 200, body: detail };
      }

      if (method === "DELETE") {
        if (id === session.id) {
          return problem(400, "An administrator cannot delete their own account.");
        }

        const drafts = this.options.outstandingDrafts ?? 0;

        if (drafts > 0) {
          return {
            status: 409,
            body: {
              status: 409,
              title: "Drafts outstanding",
              detail: `That account owns ${drafts} unpublished draft${drafts === 1 ? "" : "s"}.`,
              code: "drafts-outstanding",
              draftCount: drafts,
            },
          };
        }

        this.users = this.users.filter((user) => user.id !== id);
        return { status: 200, body: { userId: id, authorshipRetained: true } };
      }
    }

    const suspension = /^\/api\/auth\/admin\/users\/([^/]+)\/suspension$/.exec(route);

    if (method === "PUT" && suspension) {
      const id = decodeURIComponent(suspension[1]);
      const found = this.users.find((user) => user.id === id);

      if (!found) return problem(404, "No account with that identifier exists.");

      if (id === session.id) {
        return problem(
          400,
          "An administrator cannot suspend or reinstate their own account.",
        );
      }

      const sent = (body ?? {}) as { suspended?: unknown; reason?: unknown };
      const wanted = sent.suspended === true;
      const reason = typeof sent.reason === "string" ? sent.reason.trim() : "";

      // The two refusals the client has to get right, and they point in
      // opposite directions: a suspension without a reason is refused, and a
      // reinstatement *with* one is refused too, because nothing stores it.
      if (wanted && reason.length === 0) {
        return problem(400, "A reason is required when suspending an account.");
      }

      if (!wanted && reason.length > 0) {
        return problem(400, "A reason cannot be given when reinstating an account.");
      }

      if (wanted === (found.suspension !== null)) {
        return problem(
          400,
          wanted ? "That account is already suspended." : "That account is not suspended.",
        );
      }

      const updated: AdminUser = {
        ...found,
        suspension: wanted
          ? { at: "2026-09-01T12:00:00.000Z", reason, byUserId: session.id }
          : null,
      };

      this.users = this.users.map((user) => (user.id === id ? updated : user));

      return { status: 200, body: { userId: id, suspension: updated.suspension } };
    }

    const roles = /^\/api\/auth\/admin\/users\/([^/]+)\/roles$/.exec(route);

    if (method === "PUT" && roles) {
      const id = decodeURIComponent(roles[1]);
      const found = this.users.find((user) => user.id === id);

      if (!found) return problem(404, "No account with that identifier exists.");

      const requested = Array.isArray((body as { roles?: unknown })?.roles)
        ? ((body as { roles: string[] }).roles)
        : [];

      if (requested.some((role) => !["Contributor", "Administrator"].includes(role))) {
        return problem(400, "That is not a role that can be assigned.");
      }

      const updated: AdminUser = {
        ...found,
        roles: ["Community", ...requested] as AdminUser["roles"],
      };

      this.users = this.users.map((user) => (user.id === id ? updated : user));

      return {
        status: 200,
        body: {
          userId: id,
          roles: updated.roles,
          awaitingSecondFactor:
            requested.length > 0 && !found.secondFactorEnrolled,
        },
      };
    }

    return {
      status: 404,
      body: { title: "Not found", detail: "No such route in the administration stub." },
    };
  }

  /**
   * The directory, filtered the way the service filters it.
   *
   * Modelled rather than ignored, because a stub that answered every search
   * with the same rows could not notice a client that forgot to send the term
   * at all — which is the most likely way this feature breaks.
   */
  private directory(query: URLSearchParams): AdminUserList {
    let rows = this.users;

    const term = query.get("q");

    if (term) {
      const needle = term.toLowerCase();
      rows = rows.filter(
        (user) =>
          user.email.toLowerCase().includes(needle) ||
          user.displayName.toLowerCase().includes(needle),
      );
    }

    const role = query.get("role");
    if (role) rows = rows.filter((user) => user.roles.includes(role as never));

    const status = query.get("status");
    if (status === "suspended") rows = rows.filter((user) => user.suspension !== null);
    if (status === "unverified") rows = rows.filter((user) => !user.emailConfirmed);
    if (status === "active") {
      rows = rows.filter((user) => user.suspension === null && user.emailConfirmed);
    }

    return {
      users: rows,
      page: Number(query.get("page") ?? 1),
      pageSize: 25,
      totalCount: rows.length,
      totalPages: rows.length === 0 ? 0 : 1,
    };
  }

  private log(query: URLSearchParams): AdministrativeLog {
    let rows = this.actions;

    const subject = query.get("subjectId");
    if (subject) rows = rows.filter((entry) => entry.subjectUserId === subject);

    const action = query.get("action");
    if (action) rows = rows.filter((entry) => entry.action === action);

    return {
      actions: rows,
      page: Number(query.get("page") ?? 1),
      pageSize: 25,
      totalCount: rows.length,
      totalPages: rows.length === 0 ? 0 : 1,
    };
  }
}

/**
 * One `fetch` that serves the account API and the administrative one.
 *
 * The account half is the real contract fixture, so the session still resolves
 * the way it does in every other test in this suite — through a genuine
 * `GET /api/auth/me` — rather than being injected. The administrative half
 * reads that same fixture's session to decide what to refuse, which is what
 * makes "an administrator who signed in with an emailed code is refused" a
 * property of the pair rather than a value a test set by hand.
 */
export function serveAdministration(
  auth: AuthApiContract,
  admin: AdminApiStub,
): typeof fetch {
  const account = contractFetch(auth);

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (!url.startsWith("/api/auth/admin")) return account(input, init);

    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const reply = admin.handle(method, url, body, auth.session);

    if (reply.status === 204 || reply.body === undefined) {
      return new Response(null, { status: reply.status });
    }

    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: {
        "content-type":
          reply.status >= 400 ? "application/problem+json" : "application/json",
      },
    });
  };
}
