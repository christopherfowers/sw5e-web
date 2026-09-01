/**
 * A stand-in for the authoring API, written to the service rather than to the
 * client.
 *
 * The same rule `tests/auth-api-contract.ts` was rebuilt around: a fixture is
 * only worth having if it models the *server*. The moment it becomes a model of
 * the client it stops being able to fail, and both suites go green while
 * disagreeing about the wire. So this one enforces what the service enforces,
 * even where enforcing it makes tests harder to write:
 *
 *   - an anonymous caller gets a bodiless 401, which is what the cookie scheme
 *     writes before any handler runs
 *   - a signed-in caller without `Contributor` gets a 403 problem document with
 *     no `code`
 *   - a caller who holds the role from a session that only proved an inbox gets
 *     a 403 whose `code` is `strong-authentication-required`
 *   - **publishing and reverting need `Administrator`**, not `Contributor`.
 *     This is the asymmetry the whole interface is shaped around, and a fixture
 *     that let a contributor publish would let a client ship that offers a
 *     button answering 403
 *   - saving a draft silently recaptures its base revision, exactly as the
 *     service does — which is why publishing, not saving, is what refuses
 *   - publishing a draft whose base is no longer the newest revision is refused
 *     with `409` and `code: "draft-stale"`, carrying **nothing else**: no
 *     current revision id and no current document, because the real one carries
 *     neither and a client that assumed otherwise would work only here
 *
 * It records every call, because most of what these tests assert is about the
 * request rather than the reply — above all that a client which must not reach
 * this API did not reach it.
 */

import { contractFetch, type AuthApiContract } from "./auth-api-contract";
import type { CurrentUser } from "../app/auth/types";
import type {
  ContentTypeDescriptor,
  Draft,
  DraftSummary,
  Revision,
  RevisionSummary,
} from "../app/authoring/types";
import { FlagApiStub } from "./flag-api-stub";

export interface AuthoringCall {
  method: string;
  /** Path and query string, exactly as the client asked for it. */
  path: string;
  body: unknown;
}

export interface Reply {
  status: number;
  body?: unknown;
}

/** A revision as this fixture stores it: the summary plus its document. */
export interface StoredRevision extends RevisionSummary {
  schemaVersion: number;
  document: unknown;
}

interface StoredDraft {
  type: string;
  key: string;
  document: unknown;
  baseRevisionId: number | null;
  resolvesFlagId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthoringStubOptions {
  /** The account making these requests. `null` is a signed-out browser. */
  session?: CurrentUser | null;
  /** The registry `GET /api/content-types` answers with. */
  contentTypes?: ContentTypeDescriptor[];
  /** Schemas by canonical type key. A type not listed answers 404, as a service without schemas would. */
  schemas?: Record<string, unknown>;
  /** Revisions by `"type/key"`, oldest first. */
  revisions?: Record<string, StoredRevision[]>;
  /** Drafts by `"type/key"`. */
  drafts?: Record<string, Partial<StoredDraft> & { document: unknown }>;
  /**
   * Refuses a document, as the schema validator would.
   *
   * Answering a non-empty array makes the write fail with 400,
   * `code: "schema-violation"` and those strings as `schemaErrors` — in the
   * validator's real format, `{pointer}: {keyword} — {message}`, so a test
   * proving errors land on the right control is proving it against the shape
   * the service actually sends.
   */
  validate?: (document: unknown, type: string) => string[];
  /** Overrides for one route, keyed `"METHOD /path"` without the query string. */
  replies?: Record<string, Reply>;
}

/** The default registry. Small, and spelled the way the service spells it. */
export const CONTENT_TYPES: ContentTypeDescriptor[] = [
  {
    key: "armor-property",
    name: "Armor property",
    pluralName: "Armor properties",
    routeSegment: "armor-properties",
    itemCount: 12,
  },
  {
    key: "species",
    name: "Species",
    pluralName: "Species",
    routeSegment: "species",
    itemCount: 133,
  },
  {
    // Not a browsable type on this site, and in the registry all the same. The
    // artist of an uncredited picture is recorded here and nowhere else.
    key: "asset-credit",
    name: "Asset credit",
    pluralName: "Asset credits",
    routeSegment: "asset-credits",
    itemCount: 150,
  },
];

/** The real armour-property schema, trimmed to the fields these tests use. */
export const ARMOR_PROPERTY_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://sw5e.com/schemas/armor-property/v1.json",
  title: "Armor property",
  type: "object",
  additionalProperties: false,
  required: ["key", "name", "contentSet", "description"],
  properties: {
    key: {
      type: "string",
      pattern: "^[a-z0-9]+(-[a-z0-9]+)*$",
      description: "Stable slug identifying this property.",
    },
    name: {
      type: "string",
      minLength: 1,
      description: "Display name in title case.",
    },
    contentSet: {
      enum: ["core", "expanded-content"],
      description: "Whether this belongs to the core rules or the supplement.",
    },
    description: {
      type: "string",
      minLength: 1,
      description: "Markdown giving the property's rules.",
    },
  },
} as const;

function problem(status: number, title: string, detail: string, extras: Record<string, unknown> = {}): Reply {
  return {
    status,
    body: {
      type: "https://tools.ietf.org/html/rfc9110#section-15.5.1",
      title,
      status,
      detail,
      ...extras,
    },
  };
}

/** The cookie scheme's own challenge: no body, no content type. */
const UNAUTHENTICATED: Reply = { status: 401 };

function holds(session: CurrentUser | null, role: string): boolean {
  return session?.roles.includes(role as never) ?? false;
}

export class AuthoringApiStub {
  readonly calls: AuthoringCall[] = [];

  session: CurrentUser | null;
  readonly contentTypes: ContentTypeDescriptor[];
  readonly schemas: Record<string, unknown>;
  readonly revisions: Map<string, StoredRevision[]> = new Map();
  readonly drafts: Map<string, StoredDraft> = new Map();

  private nextRevisionId = 1000;
  private readonly options: AuthoringStubOptions;

  constructor(options: AuthoringStubOptions = {}) {
    this.options = options;
    this.session = options.session ?? null;
    this.contentTypes = options.contentTypes ?? CONTENT_TYPES;
    this.schemas = options.schemas ?? { "armor-property": ARMOR_PROPERTY_SCHEMA };

    for (const [address, list] of Object.entries(options.revisions ?? {})) {
      this.revisions.set(address, [...list]);
      for (const revision of list) {
        this.nextRevisionId = Math.max(this.nextRevisionId, revision.id + 1);
      }
    }

    for (const [address, draft] of Object.entries(options.drafts ?? {})) {
      const [type = "", key = ""] = address.split("/");
      this.drafts.set(address, {
        type,
        key,
        document: draft.document,
        baseRevisionId: draft.baseRevisionId ?? this.newestId(address),
        resolvesFlagId: draft.resolvesFlagId ?? null,
        createdAt: draft.createdAt ?? "2026-09-01T09:00:00.000Z",
        updatedAt: draft.updatedAt ?? "2026-09-01T09:30:00.000Z",
      });
    }
  }

  /** The most recent request to one route, or undefined. */
  lastCall(method: string, path: string): AuthoringCall | undefined {
    return [...this.calls]
      .reverse()
      .find((call) => call.method === method && call.path.split("?")[0] === path);
  }

  /** Whether the client asked the authoring API anything at all. */
  get touchedAuthoring(): boolean {
    return this.calls.some((call) => call.path.startsWith("/api/authoring"));
  }

  private newestId(address: string): number | null {
    const list = this.revisions.get(address) ?? [];
    return list.length === 0 ? null : list[list.length - 1]!.id;
  }

  /** Publishes a revision the way the service does: append, never replace. */
  appendRevision(
    type: string,
    key: string,
    document: unknown,
    action: string,
    reason: string | null = null,
    revertedFromId: number | null = null,
  ): StoredRevision {
    const address = `${type}/${key}`;
    const list = this.revisions.get(address) ?? [];
    const revision: StoredRevision = {
      id: this.nextRevisionId++,
      type,
      key,
      number: list.length + 1,
      action,
      actorUserId: this.session?.id ?? null,
      reason,
      revertedFromId,
      createdAt: new Date().toISOString(),
      schemaVersion: 1,
      document,
    };
    this.revisions.set(address, [...list, revision]);
    return revision;
  }

  /**
   * A revision without its body, which is what the list endpoint answers.
   *
   * Rebuilt field by field rather than by deleting two keys off a copy, so that
   * a field added to the full revision does not silently start appearing in the
   * summary — the two shapes differ on the wire and a fixture that let them
   * converge would stop being able to catch a client reading the wrong one.
   */
  private summary(revision: StoredRevision): RevisionSummary {
    return {
      id: revision.id,
      type: revision.type,
      key: revision.key,
      number: revision.number,
      action: revision.action,
      actorUserId: revision.actorUserId,
      reason: revision.reason,
      revertedFromId: revision.revertedFromId,
      createdAt: revision.createdAt,
    };
  }

  /**
   * The gate every authoring route sits behind.
   *
   * Ordered as the service orders it: authentication, then the role, then the
   * strength of the session. Getting that order wrong here would let a test
   * pass that proves the wrong refusal.
   */
  private refuse(needsAdministrator: boolean): Reply | null {
    if (!this.session) return UNAUTHENTICATED;

    const required = needsAdministrator ? "Administrator" : "Contributor";
    const allowed = needsAdministrator
      ? holds(this.session, "Administrator")
      : holds(this.session, "Contributor") || holds(this.session, "Administrator");

    if (!allowed) {
      return problem(403, "Forbidden", `This account may not perform that action. It needs ${required}.`);
    }

    if (!this.session.strongAuthentication) {
      return problem(
        403,
        "Stronger sign-in required",
        "This action needs a passkey or an authenticator app.",
        { code: "strong-authentication-required" },
      );
    }

    return null;
  }

  private validate(document: unknown, type: string): Reply | null {
    const errors = this.options.validate?.(document, type) ?? [];
    if (errors.length === 0) return null;

    return problem(
      400,
      "That change could not be saved",
      "The document does not match the published schema for its content type, so it was refused and nothing was stored.",
      { code: "schema-violation", schemaErrors: errors },
    );
  }

  handle(method: string, path: string, body: unknown): Reply {
    this.calls.push({ method, path, body });

    const [route = ""] = path.split("?");
    const override = this.options.replies?.[`${method} ${route}`];
    if (override) return override;

    if (route === "/api/content-types" && method === "GET") {
      return { status: 200, body: { types: this.contentTypes } };
    }

    /* ------------------------------------------------------------- schemas */

    const schema = /^\/api\/authoring\/schemas\/([^/]+)$/.exec(route);
    if (schema && method === "GET") {
      const refusal = this.refuse(false);
      if (refusal) return refusal;

      const type = decodeURIComponent(schema[1]!);
      const document = this.schemas[type];
      if (!document) {
        return problem(404, "No schema", "No schema is published for that content type.");
      }
      return { status: 200, body: { type, version: 1, schema: document } };
    }

    /* -------------------------------------------------------------- drafts */

    if (route === "/api/authoring/drafts" && method === "GET") {
      const refusal = this.refuse(false);
      if (refusal) return refusal;

      const drafts: DraftSummary[] = [...this.drafts.values()].map((draft) => {
        const address = `${draft.type}/${draft.key}`;
        const named = draft.document as Record<string, unknown> | null;

        return {
          type: draft.type,
          key: draft.key,
          name: typeof named?.name === "string" ? named.name : draft.key,
          targetExists: (this.revisions.get(address) ?? []).length > 0,
          baseRevisionIsCurrent: draft.baseRevisionId === this.newestId(address),
          createdByUserId: this.session?.id ?? "user-1",
          updatedByUserId: this.session?.id ?? "user-1",
          resolvesFlagId: draft.resolvesFlagId,
          createdAt: draft.createdAt,
          updatedAt: draft.updatedAt,
        };
      });

      return { status: 200, body: { drafts } };
    }

    const draftRoute = /^\/api\/authoring\/drafts\/([^/]+)\/([^/]+)$/.exec(route);
    if (draftRoute) {
      const refusal = this.refuse(false);
      if (refusal) return refusal;

      const type = decodeURIComponent(draftRoute[1]!);
      const key = decodeURIComponent(draftRoute[2]!);
      const address = `${type}/${key}`;

      if (method === "GET") {
        const held = this.drafts.get(address);
        if (!held) return problem(404, "Nothing to work on", "There is no draft at that address.");

        const answer: Draft = {
          type,
          key,
          document: held.document,
          createdByUserId: "user-1",
          updatedByUserId: "user-1",
          baseRevisionId: held.baseRevisionId,
          resolvesFlagId: held.resolvesFlagId,
          createdAt: held.createdAt,
          updatedAt: held.updatedAt,
        };
        return { status: 200, body: answer };
      }

      if (method === "PUT") {
        const sent = (body ?? {}) as { document?: unknown; resolvesFlagId?: string | null };
        const refused = this.validate(sent.document, type);
        if (refused) return refused;

        const existing = this.drafts.get(address);
        this.drafts.set(address, {
          type,
          key,
          document: sent.document,
          // Recaptured on every save, exactly as the service does. This is what
          // makes staleness a publish-time refusal rather than a save-time one.
          baseRevisionId: this.newestId(address),
          // Set-only: a later save cannot detach a link already stored.
          resolvesFlagId: sent.resolvesFlagId ?? existing?.resolvesFlagId ?? null,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        return { status: 204 };
      }

      if (method === "DELETE") {
        if (!this.drafts.delete(address)) {
          return problem(404, "Nothing to work on", "There is no draft to discard.");
        }
        return { status: 204 };
      }
    }

    const publishRoute = /^\/api\/authoring\/drafts\/([^/]+)\/([^/]+)\/publish$/.exec(route);
    if (publishRoute && method === "POST") {
      const refusal = this.refuse(true);
      if (refusal) return refusal;

      const type = decodeURIComponent(publishRoute[1]!);
      const key = decodeURIComponent(publishRoute[2]!);
      const address = `${type}/${key}`;
      const draft = this.drafts.get(address);

      if (!draft) return problem(404, "Nothing to work on", "There is no draft to publish.");

      if (draft.baseRevisionId !== this.newestId(address)) {
        // Verbatim, including what it does not carry: no current revision id,
        // no current document. Recovering from this needs a second round trip
        // the client has to make for itself.
        return problem(
          409,
          "That document has moved on",
          "Somebody published a change to this document after this draft was started. Nothing was overwritten.",
          { code: "draft-stale" },
        );
      }

      const refused = this.validate(draft.document, type);
      if (refused) return refused;

      const revision = this.appendRevision(
        type,
        key,
        draft.document,
        (this.revisions.get(address) ?? []).length === 0 ? "created" : "updated",
        (body as { reason?: string | null } | null)?.reason ?? null,
      );
      this.drafts.delete(address);

      return { status: 200, body: this.summary(revision) };
    }

    /* ----------------------------------------------------------- revisions */

    const list = /^\/api\/authoring\/content\/([^/]+)\/([^/]+)\/revisions$/.exec(route);
    if (list && method === "GET") {
      const refusal = this.refuse(false);
      if (refusal) return refusal;

      const address = `${decodeURIComponent(list[1]!)}/${decodeURIComponent(list[2]!)}`;
      // Newest first, and bodiless, as the service answers.
      const revisions = [...(this.revisions.get(address) ?? [])]
        .reverse()
        .map((revision) => this.summary(revision));

      return { status: 200, body: { revisions } };
    }

    const one = /^\/api\/authoring\/content\/([^/]+)\/([^/]+)\/revisions\/(\d+)$/.exec(route);
    if (one && method === "GET") {
      const refusal = this.refuse(false);
      if (refusal) return refusal;

      const address = `${decodeURIComponent(one[1]!)}/${decodeURIComponent(one[2]!)}`;
      const found = (this.revisions.get(address) ?? []).find(
        (revision) => revision.id === Number(one[3]),
      );

      if (!found) return problem(404, "Nothing to work on", "No such revision.");

      const answer: Revision = { ...this.summary(found), schemaVersion: 1, document: found.document };
      return { status: 200, body: answer };
    }

    const revert = /^\/api\/authoring\/content\/([^/]+)\/([^/]+)\/revert$/.exec(route);
    if (revert && method === "POST") {
      const refusal = this.refuse(true);
      if (refusal) return refusal;

      const type = decodeURIComponent(revert[1]!);
      const key = decodeURIComponent(revert[2]!);
      const address = `${type}/${key}`;
      const sent = (body ?? {}) as { revisionId?: number; reason?: string | null };
      const found = (this.revisions.get(address) ?? []).find(
        (revision) => revision.id === sent.revisionId,
      );

      if (!found) return problem(404, "Nothing to work on", "No such revision.");

      const refused = this.validate(found.document, type);
      if (refused) return refused;

      return {
        status: 200,
        body: this.summary(
          this.appendRevision(type, key, found.document, "reverted", sent.reason ?? null, found.id),
        ),
      };
    }

    return problem(404, "Not found", "No such route in the authoring stub.");
  }
}

/** A stored revision, with everything but the interesting fields filled in. */
export function revision(overrides: Partial<StoredRevision> = {}): StoredRevision {
  return {
    id: 1,
    type: "armor-property",
    key: "bulky",
    number: 1,
    action: "imported",
    actorUserId: null,
    reason: null,
    revertedFromId: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    schemaVersion: 1,
    document: {
      key: "bulky",
      name: "Bulky",
      contentSet: "core",
      description: "The wearer has disadvantage on Dexterity (Stealth) checks.",
    },
    ...overrides,
  };
}

/**
 * One `fetch` that serves all four surfaces this feature touches.
 *
 * The account half is the real contract fixture, so the session still resolves
 * the way it does everywhere else in this suite — through a genuine
 * `GET /api/auth/me` — rather than being injected. Anything outside the four
 * prefixes throws, which is what keeps "a request nobody expected" a loud
 * failure rather than a silent one.
 */
export function serveAuthoring(
  auth: AuthApiContract,
  authoring: AuthoringApiStub,
  flags: FlagApiStub = new FlagApiStub(),
): typeof fetch {
  const account = contractFetch(auth);

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

    /*
     * The authoring prefix is tested first, and that ordering is the point:
     * `/api/authoring` also begins with `/api/auth`. Dispatching on the shorter
     * prefix first sent every authoring request to the account fixture, which
     * answered "no such endpoint" — a 404 that looked exactly like a document
     * that did not exist. The account prefix is written with its trailing slash
     * for the same reason.
     */
    if (url.startsWith("/api/authoring") || url.startsWith("/api/content-types")) {
      return respond(authoring.handle(method, url, body));
    }

    if (url.startsWith("/api/flags")) return respond(flags.handle(method, url, body));

    // `/api/site` rides along because the site chrome reads it for the facts it
    // cannot work out for itself, and the account fixture already serves it.
    if (url.startsWith("/api/auth/") || url.startsWith("/api/site")) {
      return account(input, init);
    }

    throw new Error(`unexpected request to ${url} in a test`);
  };
}

function respond(reply: Reply): Response {
  // A bodiless refusal really is bodiless: no content type either, which is the
  // shape the client has to read from the status alone.
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
}
