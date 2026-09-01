/**
 * The shape of the authoring API, written down.
 *
 * The same rule as `app/auth/types.ts` and `app/flags/types.ts`: these are wire
 * strings spelled exactly as the service spells them, and getting one wrong is
 * silent. There is no contract document for `/api/authoring` on the service
 * side — the source is the contract — so this file and `docs/authoring-api-contract.md`
 * beside it are where this client records what it believes, and
 * `tests/authoring-api-stub.ts` is where that belief is made to fail if it is
 * wrong.
 *
 * ## Two asymmetries that are not mistakes
 *
 * A draft in the worklist and a draft fetched on its own are different shapes.
 * The list carries `baseRevisionIsCurrent` — a boolean the server computes by
 * comparing the draft's base against the newest revision — while the single
 * draft carries `baseRevisionId`, the raw number, and no boolean. Neither
 * carries both. The client therefore works out staleness two different ways
 * depending on which endpoint it came from, and {@link DraftSummary} and
 * {@link Draft} are separate types so that a component cannot read a field the
 * response it was handed does not have.
 *
 * The `type` in every one of these is the service's **canonical key**, which is
 * singular — `armor-property`, `class`, `species` — and is not the segment this
 * site publishes content under, which is plural. The service accepts either on
 * the way in and always answers with the canonical key, so this client sends
 * canonical keys everywhere and translates only at the edges where a site URL
 * is being built. See `app/authoring/content-types.ts`.
 *
 * ## Nothing here is markup
 *
 * A document is arbitrary JSON authored by a contributor, and a revision reason
 * is free text. Both are rendered as text nodes by every component that shows
 * them. A publish reason written by somebody whose account was taken is exactly
 * the sort of string a moderation surface must not evaluate.
 */

/** What a revision records having happened to a document. */
export const REVISION_ACTIONS = ["imported", "created", "updated", "reverted"] as const;

export type RevisionAction = (typeof REVISION_ACTIONS)[number];

/**
 * A revision, without its document.
 *
 * Answered by the revision list, by publishing and by reverting. `id` is a
 * number rather than a string — it is a database sequence, and it is the only
 * identifier in this API that is not a GUID.
 */
export interface RevisionSummary {
  id: number;
  type: string;
  key: string;
  /** Per-document and one-based, so "revision 3" means something to a reader. */
  number: number;
  /** One of {@link REVISION_ACTIONS}, but treated as an open string: an action
   * a newer service adds must still be displayable rather than blanking a row. */
  action: string;
  /** Null only for `imported`, which nobody did by hand. */
  actorUserId: string | null;
  /** Why, in the publisher's own words. Free text; never rendered as markup. */
  reason: string | null;
  /** The revision that was restored, set only when `action` is `reverted`. */
  revertedFromId: number | null;
  /** ISO-8601. */
  createdAt: string;
}

/** `GET /api/authoring/content/{type}/{key}/revisions` */
export interface RevisionList {
  revisions: RevisionSummary[];
}

/** One revision with the whole document as it stood after that change. */
export interface Revision extends RevisionSummary {
  /** Which version of the type's schema the body was validated against. */
  schemaVersion: number;
  document: unknown;
}

/**
 * A draft as the worklist lists it.
 *
 * `baseRevisionIsCurrent` is the field this whole interface is arranged around.
 * `false` means somebody published a change to the document after this draft
 * was started, so publishing it will be refused and saving over it would throw
 * their work away — a draft carries the *whole* document, not a patch. It is
 * therefore drawn as a state of the row rather than as an error at the end.
 */
export interface DraftSummary {
  type: string;
  key: string;
  /** Lifted from the document's own `name` when the draft was saved. */
  name: string;
  /** Whether a published document already exists at this address. */
  targetExists: boolean;
  baseRevisionIsCurrent: boolean;
  createdByUserId: string;
  updatedByUserId: string;
  /** The report this draft was started to answer, if it was started from one. */
  resolvesFlagId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET /api/authoring/drafts` — unpaged and unfiltered; every outstanding draft. */
export interface DraftList {
  drafts: DraftSummary[];
}

/** One draft, with its document. */
export interface Draft {
  type: string;
  key: string;
  document: unknown;
  createdByUserId: string;
  updatedByUserId: string;
  /**
   * The revision this draft was written against, or `null` when the document
   * did not exist yet. Compared against the newest revision to decide whether
   * the draft has been overtaken; the service does not answer that question on
   * this endpoint.
   */
  baseRevisionId: number | null;
  resolvesFlagId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `PUT /api/authoring/drafts/{type}/{key}` — answers 204, so there is no response type. */
export interface SaveDraftRequest {
  /**
   * The complete document, not a patch. Its `key` property has to equal the key
   * in the address or the service refuses it.
   */
  document: unknown;
  /**
   * The report this edit answers. Set-only: sending `null` later does not
   * detach a link already stored, so this client only ever sends it when it has
   * one, and says as much in the interface rather than offering a control that
   * would not work.
   */
  resolvesFlagId?: string | null;
}

/** `POST /api/authoring/content/{type}/{key}/revert` */
export interface RevertRequest {
  revisionId: number;
  reason?: string | null;
}

/**
 * The `code` on the 409 that means somebody published while this draft was open.
 *
 * The body carries nothing else — no current revision id, no current document —
 * so recovering from it is a second round trip this client has to make for
 * itself. `app/routes/authoring-edit.tsx` is where that happens, and why it
 * never touches what the author has typed.
 */
export const DRAFT_STALE = "draft-stale";

/** The `code` on the 400 that means the document did not match its schema. */
export const SCHEMA_VIOLATION = "schema-violation";

/**
 * The `code` on the 503 that means this deployment stores content in files
 * rather than in a database, so nothing here can be written at all.
 *
 * Worth naming, because it is not a fault and it is not the reader's doing. A
 * deployment configured this way is read-only by choice, and an interface that
 * reported it as "something went wrong" would send a contributor looking for a
 * problem with their own account.
 */
export const AUTHORING_UNAVAILABLE = "authoring-unavailable";

/**
 * One content type, as the service describes itself.
 *
 * Read from `GET /api/content-types` rather than hard-coded, and that is a
 * decision rather than laziness. This site publishes twenty-seven browsable
 * types; the service manages thirty-one, the four extra being the credit
 * records that are site metadata rather than game content. A list compiled here
 * would be a fourth place that has to be kept in step with the registry, and
 * the failure when it drifts is a content type nobody can edit with nothing
 * anywhere saying so.
 */
export interface ContentTypeDescriptor {
  /** The canonical key. What every authoring path is built from. */
  key: string;
  name: string;
  pluralName: string;
  /** The plural segment the published site uses in its own URLs. */
  routeSegment: string;
  itemCount: number;
}

export interface ContentTypeList {
  types: ContentTypeDescriptor[];
}

/**
 * A JSON Schema for one content type.
 *
 * `schema` is a whole draft 2020-12 document and is deliberately typed as
 * `unknown` here: `app/authoring/schema.ts` is the only module allowed to make
 * claims about its shape, and it makes them defensively, because this is a
 * document the client did not write.
 */
export interface ContentSchema {
  type: string;
  version: number;
  schema: unknown;
}
