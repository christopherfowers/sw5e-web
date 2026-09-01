/**
 * The one place this app talks to the authoring API.
 *
 * The transport, and every decision behind it, lives in `app/api/http.ts`:
 * relative paths so `connect-src 'self'` can stay closed, `same-origin`
 * credentials, no CSRF token because the service checks provenance directly,
 * and problem documents decoded into `ApiError`. This module is the path
 * prefix, the shapes, and four pieces of knowledge about the service that a
 * caller should not have to hold.
 *
 * **A body is always sent on a write.** The two write endpoints that take an
 * optional reason are minimal-API handlers that answer 415 to a request with no
 * `Content-Type`, and the transport only sets one when there is a body. So
 * {@link publishDraft} sends `{ reason }` even when the reason is null, rather
 * than sending nothing and meeting a content-negotiation error that has nothing
 * to do with what was asked.
 *
 * **`type` and `key` are percent-encoded on their way into a path.** Both are
 * constrained today — the type comes from the service's own registry and the
 * key is a slug — and a value that reaches a URL should never depend on a
 * constraint staying true somewhere else.
 *
 * **Publishing and reverting need an administrator; everything else needs a
 * contributor.** That asymmetry is the service's, not this client's, and it is
 * the reason the interface is shaped as drafting-then-publishing rather than as
 * saving. It is written down at {@link publishDraft}.
 *
 * **A missing schema endpoint is a fact, not a failure.** {@link getContentSchema}
 * answers `null` for a service that does not publish schemas, so the editor can
 * fall back to editing the document as JSON instead of refusing to open.
 */

import { apiRequest, ApiError } from "~/api/http";
import type {
  ContentSchema,
  ContentTypeList,
  Draft,
  DraftList,
  Revision,
  RevisionList,
  RevisionSummary,
  SaveDraftRequest,
} from "./types";

const API_ROOT = "/api/authoring";

/** One address segment, safe to put in a path. */
function segment(value: string): string {
  return encodeURIComponent(value);
}

function draftPath(type: string, key: string): string {
  return `${API_ROOT}/drafts/${segment(type)}/${segment(key)}`;
}

function contentPath(type: string, key: string): string {
  return `${API_ROOT}/content/${segment(type)}/${segment(key)}`;
}

/* ---------------------------------------------------------------- the types */

/**
 * Every content type the service manages.
 *
 * On the read API rather than the authoring one, and anonymous, because it
 * describes what is published rather than who may change it. Fetched rather
 * than hard-coded: this site browses twenty-seven types and the service manages
 * thirty-one, and a list written down here would be a fourth copy to keep in
 * step. See {@link ContentTypeDescriptor}.
 */
export function listContentTypes(signal?: AbortSignal): Promise<ContentTypeList> {
  return apiRequest<ContentTypeList>("/api/content-types", { signal });
}

/* -------------------------------------------------------------------- drafts */

/**
 * Every outstanding draft, newest first.
 *
 * Unpaged and unfiltered — the service takes no query parameters here at all —
 * so the grouping and the ordering a reviewer sees are this client's work. That
 * is fine at the scale this starts at and is worth knowing before somebody adds
 * a filter control that would have to be applied in the browser.
 */
export function listDrafts(signal?: AbortSignal): Promise<DraftList> {
  return apiRequest<DraftList>(`${API_ROOT}/drafts`, { signal });
}

/**
 * One draft, or `null` when there is not one.
 *
 * A 404 here is an ordinary answer — most documents have no draft open — and
 * turning it into a value rather than an exception is what lets the editor open
 * on a published document without a branch at every call site. Every other
 * failure is re-thrown: "there is no draft" and "the service refused you" must
 * not look the same, or a contributor whose session went weak would be shown an
 * empty editor and invited to retype the document.
 */
export async function getDraft(
  type: string,
  key: string,
  signal?: AbortSignal,
): Promise<Draft | null> {
  try {
    return await apiRequest<Draft>(draftPath(type, key), { signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Writes the draft. Answers 204, so there is nothing to read back.
 *
 * The document is the whole document rather than a patch, which is the single
 * most important thing about this endpoint: saving a draft that was started
 * against an older revision silently replaces everything somebody else
 * published in the meantime. The service does not refuse that — it recaptures
 * the base revision and carries on — so noticing it is entirely this client's
 * job, and `app/routes/authoring-edit.tsx` does it before the author has spent
 * any effort rather than after.
 */
export function saveDraft(
  type: string,
  key: string,
  body: SaveDraftRequest,
): Promise<void> {
  return apiRequest<void>(draftPath(type, key), { method: "PUT", body });
}

/** Throws the draft away. The published document is untouched. */
export function discardDraft(type: string, key: string): Promise<void> {
  return apiRequest<void>(draftPath(type, key), { method: "DELETE" });
}

/**
 * Publishes the draft as a new revision. **Administrators only.**
 *
 * Two refusals are worth branching on and both are ordinary events rather than
 * bugs. A 409 with `code: "draft-stale"` means somebody published while this
 * draft was open; it carries nothing else, so recovering from it needs a second
 * round trip the caller has to make. A 400 with `code: "schema-violation"`
 * carries `schemaErrors`, which `app/authoring/violations.ts` turns back into
 * something to put beside a control.
 *
 * A body is always sent, even when the reason is null: the handler answers 415
 * to a request with no content type, and the transport only writes one when
 * there is a body to write.
 */
export function publishDraft(
  type: string,
  key: string,
  reason: string | null,
): Promise<RevisionSummary> {
  return apiRequest<RevisionSummary>(`${draftPath(type, key)}/publish`, {
    method: "POST",
    body: { reason },
  });
}

/* ----------------------------------------------------------------- revisions */

/**
 * The newest revisions of a document, newest first.
 *
 * `limit` is the only control the service offers — there is no cursor and no
 * offset — and it is capped at 100, so a document with a longer history cannot
 * be read past its hundredth most recent change. The history page says so
 * rather than presenting a truncated list as a complete one.
 *
 * A key that has never been published answers 200 with an empty list rather
 * than 404, which is how the editor tells "new document" from "unknown type".
 */
export function listRevisions(
  type: string,
  key: string,
  limit?: number,
  signal?: AbortSignal,
): Promise<RevisionList> {
  const query = limit === undefined ? "" : `?limit=${encodeURIComponent(limit)}`;
  return apiRequest<RevisionList>(`${contentPath(type, key)}/revisions${query}`, {
    signal,
  });
}

/** One revision, with the whole document as it stood after that change. */
export function getRevision(
  type: string,
  key: string,
  revisionId: number,
  signal?: AbortSignal,
): Promise<Revision> {
  return apiRequest<Revision>(
    `${contentPath(type, key)}/revisions/${encodeURIComponent(revisionId)}`,
    { signal },
  );
}

/**
 * Puts an earlier revision back. **Administrators only.**
 *
 * Writes a *new* revision rather than deleting anything, so the history stays
 * append-only and the mistake being undone remains readable. The restored body
 * is re-validated against the schema as it stands now, so a document that was
 * valid under an older schema can be refused — which is a 400 carrying
 * `schemaErrors` like any other refusal, and has to be reported as one rather
 * than as "revert failed".
 */
export function revertContent(
  type: string,
  key: string,
  revisionId: number,
  reason: string | null,
): Promise<RevisionSummary> {
  return apiRequest<RevisionSummary>(`${contentPath(type, key)}/revert`, {
    method: "POST",
    body: { revisionId, reason },
  });
}

/* ------------------------------------------------------------------- schemas */

/**
 * The JSON Schema the service validates one content type against, or `null` if
 * this deployment does not publish schemas.
 *
 * The null is the whole point of the signature. Thirty-one content types with
 * thirty-one different shapes cannot be edited through thirty-one hand-built
 * forms — that does not scale and it rots the first time a schema changes — so
 * the form is generated from the schema. But an interface that cannot open at
 * all against a service one version behind is an interface nobody can deploy,
 * so a 404 here is an answer rather than an error and the editor falls back to
 * editing the document as JSON. That fallback is not a nicety: it is also what
 * the editor uses for a type whose schema uses a construct the form generator
 * does not understand.
 *
 * A 403 is *not* converted. "This deployment has no schemas" and "your session
 * may not read them" are different facts, and treating the second as the first
 * would drop a contributor into a raw JSON editor without telling them why.
 */
export async function getContentSchema(
  type: string,
  signal?: AbortSignal,
): Promise<ContentSchema | null> {
  try {
    return await apiRequest<ContentSchema>(
      `${API_ROOT}/schemas/${segment(type)}`,
      { signal },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
