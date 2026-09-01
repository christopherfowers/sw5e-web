/**
 * What has happened to a document, and how to put a version of it back.
 *
 * ## The diff is built here because the service refuses to build it
 *
 * `GET .../revisions/{id}` answers with a whole document, deliberately. Which
 * fields matter, and what "changed" means for a list of forty class features,
 * is a presentation decision — and a service that picked one answer would have
 * picked it for every client forever. So two revisions are fetched and
 * `app/authoring/diff.ts` compares them. The comparison is the interesting
 * part; see that file for why an inserted list entry has to read as one
 * insertion rather than as forty changes.
 *
 * ## Reverting adds rather than removes
 *
 * The service writes a *new* revision whose body is the old one's. Nothing is
 * deleted and the mistake being undone stays readable, which is what makes a
 * history worth keeping. It also means a revert can be refused: the restored
 * body is re-validated against the schema as it stands now, so a document that
 * was valid under an older schema is refused with the same `schemaErrors` any
 * other write would get. That is reported as what it is rather than as "revert
 * failed".
 *
 * ## The list has a ceiling and says so
 *
 * The service offers `limit` and nothing else — no cursor, no offset — capped
 * at a hundred. A document with a longer history cannot be read past its
 * hundredth most recent change. A page that quietly showed a hundred rows would
 * be presenting a truncated history as a complete one, which is precisely the
 * kind of thing an audit trail must not do.
 *
 * ## No `loader`
 *
 * See `app/routes/authoring.tsx`. Everything below is fetched after hydration.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router";

import { Banner, SessionPending, SubmitButton } from "~/components/auth-ui";
import { getRevision, listRevisions, revertContent } from "~/authoring/api";
import { canonicalTypeKey, findContentType, publishedPathFor } from "~/authoring/content-types";
import { diffDocuments } from "~/authoring/diff";
import { DocumentDiff } from "~/authoring/document-diff";
import { editorPath } from "~/authoring/paths";
import type {
  ContentTypeDescriptor,
  Revision,
  RevisionSummary,
} from "~/authoring/types";
import { FailureBanner, When, messageFor, type Load } from "~/authoring/ui";
import { useContentTypes } from "~/authoring/use-content-types";
import { parseSchemaErrors, readSchemaErrors } from "~/authoring/violations";
import { ApiError } from "~/api/http";
import { authoringMeta, type AuthoringContext } from "./authoring";

export function meta() {
  return authoringMeta("History");
}

/** The service's own cap. Asking for more is a 400, so this is not a guess. */
const REVISION_LIMIT = 100;

/**
 * What a revision says it was.
 *
 * A wording for each action rather than the wire value, because "updated" in a
 * column of forty rows tells a reader nothing they could not have guessed,
 * while "imported" — which is the state of nearly everything in this corpus
 * today — is a genuinely different thing and worth marking.
 */
const ACTION_LABEL: Record<string, string> = {
  imported: "Imported from the archive",
  created: "Created",
  updated: "Edited",
  reverted: "Put back",
};

function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

/* ------------------------------------------------------------------ the diff */

function Comparison({
  type,
  contentKey,
  from,
  to,
}: {
  type: string;
  contentKey: string;
  from: RevisionSummary | null;
  to: RevisionSummary | null;
}) {
  const [load, setLoad] = useState<Load<{ before: Revision | null; after: Revision }>>({
    state: "loading",
  });

  const fromId = from?.id ?? null;
  const toId = to?.id ?? null;

  /*
   * Remounted by the page whenever the pair changes, so this opens in its
   * loading state without an effect having to put it back there. Every state
   * change below therefore happens in a promise callback, which is the rule
   * `app/auth/session.tsx` explains: setting state straight from an effect body
   * cascades an extra render before the browser has painted.
   */
  useEffect(() => {
    if (toId === null) return;

    const controller = new AbortController();

    Promise.all([
      fromId === null
        ? Promise.resolve(null)
        : getRevision(type, contentKey, fromId, controller.signal),
      getRevision(type, contentKey, toId, controller.signal),
    ]).then(
      ([before, after]) => {
        if (!controller.signal.aborted) {
          setLoad({ state: "ready", value: { before, after } });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setLoad({ state: "failed", error });
      },
    );

    return () => controller.abort();
  }, [type, contentKey, fromId, toId]);

  const changes = useMemo(() => {
    if (load.state !== "ready") return [];
    // Comparing against nothing is how the first revision reads: everything in
    // it arrived at once, which is exactly what an import is.
    return diffDocuments(load.value.before?.document ?? {}, load.value.after.document);
  }, [load]);

  if (toId === null) return null;

  if (load.state === "loading") return <SessionPending label="Loading both versions…" />;
  if (load.state === "failed") {
    return <FailureBanner title="Those versions could not be compared." error={load.error} />;
  }

  return (
    <DocumentDiff
      changes={changes}
      fromLabel={from ? `revision ${from.number}` : "an empty document"}
      toLabel={`revision ${load.value.after.number}`}
      emptyMessage="These two hold the same content. A revision that changed nothing is usually a revert that restored what was already there."
    />
  );
}

/* ---------------------------------------------------------------- the revert */

function Revert({
  type,
  contentKey,
  revision,
  onDone,
}: {
  type: string;
  contentKey: string;
  revision: RevisionSummary;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function run() {
    setWorking(true);
    setFailure(null);

    try {
      await revertContent(type, contentKey, revision.id, reason.trim() || null);
      setOpen(false);
      setReason("");
      onDone();
    } catch (error) {
      const schemaErrors =
        error instanceof ApiError ? readSchemaErrors(error.extensions) : [];

      if (schemaErrors.length > 0) {
        // The restored body no longer matches the schema. Saying "revert
        // failed" would send somebody looking for a fault in the revert; the
        // actual answer is that the document as it stood then is not a document
        // this content type accepts now.
        const parsed = parseSchemaErrors(schemaErrors);
        const lines = [
          ...parsed.unplaced,
          ...[...parsed.byPointer.entries()].map(
            ([pointer, entries]) =>
              `${pointer || "the document"}: ${entries.map((entry) => entry.message).join(" ")}`,
          ),
        ];
        setFailure(
          `That version does not match the schema this content type uses now, so it was not restored. ${lines.join(" ")}`,
        );
      } else {
        setFailure(messageFor(error));
      }
    } finally {
      setWorking(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="link-button"
        aria-label={`Put revision ${revision.number} back`}
        onClick={() => setOpen(true)}
      >
        Put this version back
      </button>
    );
  }

  return (
    <div className="authoring-revert">
      <p>
        This writes a new revision holding what revision {revision.number} held.
        Nothing is deleted, and this revert will itself be in the history.
      </p>
      <div className="auth-field">
        <label htmlFor={`revert-reason-${revision.id}`}>Why</label>
        <input
          id={`revert-reason-${revision.id}`}
          className="authoring-input"
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
          aria-describedby={`revert-hint-${revision.id}`}
        />
        <p className="auth-field-hint" id={`revert-hint-${revision.id}`}>
          Recorded against the new revision, so the next person reading this
          history knows what happened. Optional, and worth writing anyway.
        </p>
      </div>
      {failure ? (
        <Banner tone="error" title="That version was not put back.">
          {failure}
        </Banner>
      ) : null}
      <p className="auth-actions">
        <SubmitButton
          type="button"
          variant="danger"
          pending={working}
          pendingLabel="Putting it back…"
          onClick={() => void run()}
        >
          Put revision {revision.number} back
        </SubmitButton>
        <button
          type="button"
          className="button"
          disabled={working}
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------- page */

/**
 * The history of one document.
 *
 * Split out from the page below and remounted whenever the address changes or a
 * revert lands, which is what keeps every state change in this file inside a
 * promise callback: an effect that reset the load state on the way in would
 * repaint before the browser had drawn the previous frame. `app/auth/session.tsx`
 * explains why that rule is worth keeping across this whole app.
 */
function History({
  type,
  contentKey,
  descriptor,
  canPublish,
  onReverted,
}: {
  type: string;
  contentKey: string;
  descriptor: ContentTypeDescriptor | null;
  canPublish: boolean;
  onReverted: () => void;
}) {
  const [load, setLoad] = useState<Load<RevisionSummary[]>>({ state: "loading" });
  const [fromId, setFromId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    listRevisions(type, contentKey, REVISION_LIMIT, controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) return;
        setLoad({ state: "ready", value: answer.revisions });
        // The newest change, against what came before it. That is the question
        // somebody arriving at a history is nearly always asking.
        setToId(answer.revisions[0]?.id ?? null);
        setFromId(answer.revisions[1]?.id ?? null);
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setLoad({ state: "failed", error });
      },
    );

    return () => controller.abort();
  }, [type, contentKey]);

  const revisions = load.state === "ready" ? load.value : [];
  const from = revisions.find((revision) => revision.id === fromId) ?? null;
  const to = revisions.find((revision) => revision.id === toId) ?? null;
  const published = publishedPathFor(descriptor, contentKey);

  return (
    <section className="account-section" aria-labelledby="history-heading">
      <h2 id="history-heading">History</h2>
      <p className="account-section-lede">
        <code>{type}</code> · <code>{contentKey}</code>
        {" · "}
        <Link to={editorPath(type, contentKey)}>Edit this</Link>
        {published ? (
          <>
            {" · "}
            <Link to={published}>Read the page</Link>
          </>
        ) : null}
      </p>

      {load.state === "loading" ? (
        <SessionPending label="Loading the history…" />
      ) : load.state === "failed" ? (
        <FailureBanner title="This history could not be loaded." error={load.error} />
      ) : revisions.length === 0 ? (
        <p className="auth-note">
          Nothing has been published at this address.{" "}
          <Link to={editorPath(type, contentKey)}>Start it</Link>.
        </p>
      ) : (
        <>
          {revisions.length === REVISION_LIMIT ? (
            <Banner tone="info" title="This is the most recent hundred changes.">
              The service does not offer a way to page further back, so anything
              older than these is not readable here. That is the whole history
              for every document in the corpus today, and worth knowing before
              this list is ever read as a complete audit trail.
            </Banner>
          ) : null}

          <div className="authoring-compare">
            <div className="auth-field">
              <label htmlFor="compare-from">Compare from</label>
              <select
                id="compare-from"
                className="authoring-select"
                value={fromId === null ? "" : String(fromId)}
                onChange={(event) =>
                  setFromId(event.target.value === "" ? null : Number(event.target.value))
                }
              >
                <option value="">Nothing — show everything it contains</option>
                {revisions.map((revision) => (
                  <option key={revision.id} value={String(revision.id)}>
                    Revision {revision.number} — {actionLabel(revision.action)}
                  </option>
                ))}
              </select>
            </div>

            <div className="auth-field">
              <label htmlFor="compare-to">Compare to</label>
              <select
                id="compare-to"
                className="authoring-select"
                value={toId === null ? "" : String(toId)}
                onChange={(event) =>
                  setToId(event.target.value === "" ? null : Number(event.target.value))
                }
              >
                {revisions.map((revision) => (
                  <option key={revision.id} value={String(revision.id)}>
                    Revision {revision.number} — {actionLabel(revision.action)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Comparison
            // Remounted per pair, so it opens in its loading state rather than
            // showing the previous comparison while the next one is fetched.
            key={`${fromId}:${toId}`}
            type={type}
            contentKey={contentKey}
            from={from}
            to={to}
          />

          <h3>Every change</h3>
          <ol className="revision-list">
            {revisions.map((revision) => (
              <li key={revision.id} className="revision-row">
                <p className="revision-head">
                  <span className="revision-number">Revision {revision.number}</span>
                  <span className="revision-action" data-action={revision.action}>
                    {actionLabel(revision.action)}
                  </span>
                  <When value={revision.createdAt} />
                </p>
                {/*
                  Free text written by whoever published, rendered as a text
                  node like every other thing a person wrote in this app.
                */}
                {revision.reason ? (
                  <p className="revision-reason">{revision.reason}</p>
                ) : null}
                {revision.revertedFromId !== null ? (
                  <p className="revision-meta">
                    Restored what revision id {revision.revertedFromId} held.
                  </p>
                ) : null}
                <p className="revision-actions">
                  <button
                    type="button"
                    className="link-button"
                    aria-label={`Compare to revision ${revision.number}`}
                    onClick={() => setToId(revision.id)}
                  >
                    Compare to this
                  </button>
                  {/*
                    Not offered for the newest revision: putting the current
                    version back writes a revision that changes nothing, and a
                    control whose only effect is a line in the history teaches
                    whoever reads that history to treat it as noise.
                  */}
                  {canPublish && revision.id !== revisions[0]?.id ? (
                    <Revert
                      type={type}
                      contentKey={contentKey}
                      revision={revision}
                      onDone={onReverted}
                    />
                  ) : null}
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

export default function AuthoringHistory() {
  const { canPublish } = useOutletContext<AuthoringContext>();
  const [params] = useSearchParams();
  const { index, failed } = useContentTypes();
  const [generation, setGeneration] = useState(0);

  const requestedType = params.get("type") ?? "";
  const contentKey = params.get("key") ?? "";

  // See `app/routes/authoring-edit.tsx`: the canonical key is used from the
  // first request so that what is asked for and what comes back are spelled the
  // same way. A registry that could not be fetched is not fatal — the address
  // is sent as it was given and the service resolves it.
  const type = index ? canonicalTypeKey(index, requestedType) : requestedType;
  const descriptor = index ? findContentType(index, requestedType) : null;

  if (!requestedType || !contentKey) {
    return (
      <section className="account-section">
        <h2>History</h2>
        <p className="account-section-lede">
          Pick a document from the <Link to="/authoring">worklist</Link> to read
          its history.
        </p>
      </section>
    );
  }

  if (!index && !failed) {
    return (
      <section className="account-section">
        <h2>History</h2>
        <SessionPending label="Loading the content types…" />
      </section>
    );
  }

  return (
    <History
      key={`${generation}:${type}/${contentKey}`}
      type={type}
      contentKey={contentKey}
      descriptor={descriptor}
      canPublish={canPublish}
      onReverted={() => setGeneration((count) => count + 1)}
    />
  );
}
