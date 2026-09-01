/**
 * A stand-in for the flagging API, alongside the account one.
 *
 * The account contract fixture refuses any request that is not under
 * `/api/auth` — deliberately, so a test cannot silently hit something it did
 * not mean to. Every flag test needs both: the session has to resolve through
 * the real `AuthProvider` before a page can draw anything, and then the page
 * talks to `/api/flags`.
 *
 * So this composes the two rather than replacing either. Anything under
 * `/api/auth` goes to the real contract fixture; anything under `/api/flags`
 * is answered here; anything else throws, which keeps the "no request I did
 * not expect" property the account fixture was built for.
 *
 * It records every call, because most of what these tests assert is about the
 * request rather than the reply: which path, which method, and — for the
 * reporting form — that the body carried the reason and target the reader
 * actually chose.
 */

import { contractFetch, type AuthApiContract } from "./auth-api-contract";
import type { Flag, FlagList, FlagSummary } from "../app/flags/types";

export interface FlagCall {
  method: string;
  /** Path and query string, exactly as the client asked for it. */
  path: string;
  body: unknown;
}

export interface FlagReply {
  status: number;
  body?: unknown;
}

export interface FlagStubOptions {
  /** What `GET /api/flags/mine` answers. */
  mine?: Flag[];
  /** What `GET /api/flags` answers. */
  queue?: Flag[];
  summary?: FlagSummary;
  /** Overrides for one route, keyed `"METHOD /path"` without the query string. */
  replies?: Record<string, FlagReply>;
}

export class FlagApiStub {
  readonly calls: FlagCall[] = [];

  constructor(private readonly options: FlagStubOptions = {}) {}

  /** The most recent request to one route, or undefined. */
  lastCall(method: string, path: string): FlagCall | undefined {
    return [...this.calls]
      .reverse()
      .find((call) => call.method === method && call.path.split("?")[0] === path);
  }

  handle(method: string, path: string, body: unknown): FlagReply {
    this.calls.push({ method, path, body });

    const route = `${method} ${path.split("?")[0]}`;
    const override = this.options.replies?.[route];
    if (override) return override;

    if (method === "GET" && path.split("?")[0] === "/api/flags/mine") {
      return { status: 200, body: page(this.options.mine ?? []) };
    }

    if (method === "GET" && path.split("?")[0] === "/api/flags/summary") {
      return { status: 200, body: this.options.summary ?? emptySummary() };
    }

    if (method === "GET" && path.split("?")[0] === "/api/flags") {
      return { status: 200, body: page(this.options.queue ?? []) };
    }

    if (method === "POST" && path === "/api/flags") {
      return { status: 201, body: filed(body) };
    }

    if (method === "PUT" && /^\/api\/flags\/[^/]+\/status$/.test(path.split("?")[0])) {
      return { status: 200, body: this.options.queue?.[0] ?? filed(body) };
    }

    return {
      status: 404,
      body: { title: "Not found", detail: "No such route in the flag stub." },
    };
  }
}

function page(flags: Flag[]): FlagList {
  return {
    flags,
    page: 1,
    pageSize: 25,
    totalCount: flags.length,
    totalPages: flags.length === 0 ? 0 : 1,
  };
}

function emptySummary(): FlagSummary {
  return {
    total: 0,
    outstanding: 0,
    byStatus: [
      { key: "open", count: 0 },
      { key: "accepted", count: 0 },
      { key: "declined", count: 0 },
      { key: "resolved", count: 0 },
    ],
    byReason: [],
    mostFlagged: [],
  };
}

/** A plausible stored report, echoing whatever was posted. */
function filed(body: unknown): Flag {
  const sent = (body ?? {}) as Record<string, unknown>;

  return {
    id: "flag-1",
    targetKind: sent.targetType === "asset-credit" ? "image" : "document",
    targetType: String(sent.targetType ?? "species"),
    targetKey: String(sent.targetKey ?? "wookiee"),
    targetName: "Wookiee",
    reason: String(sent.reason ?? "text-error"),
    details: typeof sent.details === "string" ? sent.details : null,
    status: "open",
    createdAt: "2026-09-01T10:00:00.000Z",
    reporter: { id: "user-1", displayName: "Jen Ordo" },
    reviewedAt: null,
    reviewedBy: null,
    reviewerNote: null,
  };
}

/** A report, with everything but the interesting fields filled in. */
export function flag(overrides: Partial<Flag> = {}): Flag {
  return {
    id: "flag-1",
    targetKind: "document",
    targetType: "species",
    targetKey: "wookiee",
    targetName: "Wookiee",
    reason: "text-error",
    details: null,
    status: "open",
    createdAt: "2026-09-01T10:00:00.000Z",
    reporter: { id: "user-1", displayName: "Jen Ordo" },
    reviewedAt: null,
    reviewedBy: null,
    reviewerNote: null,
    ...overrides,
  };
}

/**
 * One `fetch` that serves both APIs.
 *
 * The account half is the real contract fixture, so the session still resolves
 * the way it does in every other test in this suite — through a genuine
 * `GET /api/auth/me` — rather than being injected.
 */
export function serveBoth(auth: AuthApiContract, flags: FlagApiStub): typeof fetch {
  const account = contractFetch(auth);

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.startsWith("/api/auth")) return account(input, init);

    if (!url.startsWith("/api/flags")) {
      throw new Error(`unexpected request to ${url} in a test`);
    }

    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const reply = flags.handle(method, url, body);

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
