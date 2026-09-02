/**
 * The editor: one document, from opening it to publishing it.
 *
 * ## Drafting and publishing are two acts, because the service says so
 *
 * Writing a draft needs `Contributor`; publishing it needs `Administrator`.
 * That is the service's rule, not this client's, and it is a good one — a
 * contributor proposes a correction and somebody with the books open agrees to
 * it — so the interface is built around it rather than hiding it. A contributor
 * sees "Save draft" and a sentence saying who publishes; an administrator sees
 * both buttons. Neither is shown a control that would answer 403.
 *
 * ## Publishing never silently saves first
 *
 * It is tempting to have "Publish" write the draft and then publish it, so a
 * reader cannot publish something other than what they are looking at. That
 * would be the single most damaging line in this file. Writing a draft
 * recaptures its base revision on the server, so a save-then-publish would
 * *erase the staleness check* — and staleness is exactly the condition where
 * publishing overwrites somebody else's published work.
 *
 * So publishing publishes the stored draft, the button says so, and it is
 * unavailable while there are unsaved edits. Overriding a conflict is a
 * separate, explicit act with its own button and its own sentence.
 *
 * ## What happens when two people edit the same document
 *
 * This is a real event with a real shape, not an error dialog. It shows up
 * three ways and all three are handled:
 *
 *   the worklist marks a draft whose base is no longer current;
 *
 *   opening such a draft shows, before a single keystroke is spent, what was
 *   published underneath it — field by field, so the author can fold those
 *   changes into what they are writing;
 *
 *   publishing one is refused with `409 draft-stale`, and that refusal changes
 *   nothing in the editor. The text stays exactly as it was typed, the panel
 *   opens, and the author chooses.
 *
 * ## Nothing that has been typed is ever thrown away
 *
 * Every edit is mirrored into `localStorage` (`app/authoring/recovery.ts`), so
 * a closed tab, a reload, an expired session or a dropped connection does not
 * cost somebody the four paragraphs they pasted out of Discord. On the way in,
 * a recovered copy that differs from what the service holds is *offered* and
 * never applied: silently preferring the wrong one is the accident this exists
 * to prevent.
 *
 * ## No `loader`
 *
 * See `app/routes/authoring.tsx`. Everything below is fetched after hydration.
 */

import { useEffect, useId, useMemo, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router";

import { ApiError } from "~/api/http";
import { Banner, SessionPending, SubmitButton } from "~/components/auth-ui";
import {
  discardDraft,
  getContentSchema,
  getDraft,
  getRevision,
  listRevisions,
  publishDraft,
  saveDraft,
} from "~/authoring/api";
import { canonicalTypeKey, findContentType, publishedPathFor } from "~/authoring/content-types";
import { diffDocuments, stableJson } from "~/authoring/diff";
import { DocumentDiff } from "~/authoring/document-diff";
import { DocumentForm, fieldId } from "~/authoring/form";
import { historyPath } from "~/authoring/paths";
import {
  forgetRecovery,
  keepRecovery,
  readRecovery,
  type RecoveredWork,
} from "~/authoring/recovery";
import { blankDocument, describeDocument, type ObjectControl } from "~/authoring/schema";
import type { ContentTypeDescriptor, Draft, Revision, RevisionSummary } from "~/authoring/types";
import { DRAFT_STALE } from "~/authoring/types";
import { FailureBanner, When, messageFor, type Load } from "~/authoring/ui";
import { useContentTypes } from "~/authoring/use-content-types";
import {
  allViolations,
  isEmpty,
  noViolations,
  parseSchemaErrors,
  placeSchemaViolations,
  readSchemaErrors,
  readSchemaViolations,
  type SchemaViolations,
} from "~/authoring/violations";
import { authoringMeta, type AuthoringContext } from "./authoring";

export function meta() {
  return authoringMeta("Editor");
}

/** How much history is read to work out what the current revision is. */
const REVISION_WINDOW = 100;

/** How long after the last keystroke the recovery copy is written. */
const RECOVERY_DEBOUNCE_MS = 400;

/** Everything one document needs before it can be edited. */
interface Subject {
  type: string;
  key: string;
  descriptor: ContentTypeDescriptor | null;
  control: ObjectControl | null;
  /** True when the service publishes no schema, so the whole document is JSON. */
  schemaMissing: boolean;
  draft: Draft | null;
  /** The newest revision's id, or null for a document that does not exist. */
  currentRevisionId: number | null;
  /** What the draft was written against; null when there was nothing to write against. */
  baseRevisionId: number | null;
  document: unknown;
}

/** The two documents a conflict is explained with. */
interface Conflict {
  current: Revision;
  /** What the draft was based on. Null when the draft predates the document. */
  base: Revision | null;
}

function isStale(subject: Subject): boolean {
  return subject.draft !== null && subject.baseRevisionId !== subject.currentRevisionId;
}

/* ------------------------------------------------------------------ loading */

async function loadSubject(
  type: string,
  key: string,
  descriptor: ContentTypeDescriptor | null,
  signal: AbortSignal,
): Promise<Subject> {
  // Three requests that do not depend on each other, so three at once. The
  // service allows 120 a minute; this is four per document opened.
  const [draft, history, schema] = await Promise.all([
    getDraft(type, key, signal),
    listRevisions(type, key, REVISION_WINDOW, signal),
    getContentSchema(type, signal),
  ]);

  const control = schema ? describeDocument(schema) : null;
  const currentRevisionId = history.revisions[0]?.id ?? null;

  // A draft is what the author was last working on and wins over the published
  // document, which is what they already decided to change.
  if (draft) {
    return {
      type,
      key,
      descriptor,
      control,
      schemaMissing: schema === null,
      draft,
      currentRevisionId,
      baseRevisionId: draft.baseRevisionId,
      document: draft.document,
    };
  }

  if (currentRevisionId !== null) {
    const published = await getRevision(type, key, currentRevisionId, signal);
    return {
      type,
      key,
      descriptor,
      control,
      schemaMissing: schema === null,
      draft: null,
      currentRevisionId,
      baseRevisionId: currentRevisionId,
      document: published.document,
    };
  }

  return {
    type,
    key,
    descriptor,
    control,
    schemaMissing: schema === null,
    draft: null,
    currentRevisionId: null,
    baseRevisionId: null,
    document: blankDocument(control, key),
  };
}

/* --------------------------------------------------------------- the editor */

interface EditorProps {
  subject: Subject;
  flagId: string | null;
  canPublish: boolean;
  /**
   * Told what was published, so the page above can say so.
   *
   * The confirmation cannot live in this component: publishing re-reads the
   * document, and re-reading remounts this component, so a banner held here
   * would be destroyed by the very thing it was announcing.
   */
  onPublished: (revision: RevisionSummary) => void;
  /** Re-reads everything from the service, after discarding a draft. */
  reload: () => void;
}

function Editor({ subject, flagId, canPublish, onPublished, reload }: EditorProps) {
  const scope = useId();

  const [document, setDocument] = useState<unknown>(subject.document);
  /** The last thing the service is known to hold. What "unsaved" is measured against. */
  const [stored, setStored] = useState<unknown>(subject.document);
  const [violations, setViolations] = useState<SchemaViolations>(noViolations());

  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  /**
   * Whether a publish has just been refused as stale.
   *
   * A separate flag from {@link isStale}, which is derived from what was
   * loaded. The refusal is newer information than the load — it means somebody
   * published in the seconds since — and it has to hold the panel open even
   * though nothing about the loaded subject has changed.
   */
  const [refused, setRefused] = useState(false);

  /**
   * Whether a draft exists to publish.
   *
   * `subject.draft` answers that for the moment the document was opened, and
   * saving a brand-new draft does not change it — so without this, the first
   * save of something new would leave the publish control disabled until the
   * page was reloaded, which reads as the save not having worked.
   */
  const [savedOnce, setSavedOnce] = useState(false);

  /*
   * A copy left behind by a previous visit that does not match what the service
   * holds. Read once, as this component's opening state, rather than in an
   * effect: an effect would paint the editor without the offer and then paint
   * it again with one, and the reader would see the banner appear underneath
   * whatever they had already started reading.
   *
   * Reading storage in a state initialiser is safe here and nowhere else in
   * this app: this component only exists once a document has loaded, which can
   * only have happened in a browser. Nothing on the prerender path reaches it.
   */
  const [offered, setOffered] = useState<RecoveredWork | null>(() => {
    const held = readRecovery(subject.type, subject.key);
    if (!held) return null;
    // A copy identical to what the service holds has nothing to offer. It is
    // left in storage rather than deleted here: it costs nothing, the sweep
    // collects it, and deleting during a render would be a side effect in the
    // one place React is entitled to run twice.
    return stableJson(held.document) === stableJson(subject.document) ? null : held;
  });

  const dirty = useMemo(
    () => stableJson(document) !== stableJson(stored),
    [document, stored],
  );

  /*
   * The recovery copy, written a moment after typing stops.
   *
   * Debounced rather than written per keystroke because a class document is a
   * few hundred kilobytes and serializing it forty times a second is work the
   * browser is doing instead of drawing. Four hundred milliseconds is far
   * inside the time it takes to close a tab by accident.
   */
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(
      () => keepRecovery(subject.type, subject.key, document),
      RECOVERY_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [document, dirty, subject.type, subject.key]);

  // Shown straight away when the draft is already known to be behind, so the
  // author sees what was published underneath before spending any effort on it,
  // and again the moment a publish is refused for the same reason.
  const conflicted = isStale(subject) || refused;

  function absorb(error: unknown): void {
    if (error instanceof ApiError) {
      /*
        The structured violations first, and the lines only when they are not
        there. The service sends both; the older one sent only the lines, and
        this deployment can be either side of that for as long as the two
        images are deployed separately.

        `readSchemaViolations` answers null for "not sent" and an empty array
        for "sent and empty", which is why this checks for null rather than for
        length — an empty structured list means there was nothing to place, not
        that the parser should have a go.
      */
      const structured = readSchemaViolations(error.extensions);
      if (structured && structured.length > 0) {
        setViolations(placeSchemaViolations(structured));
        setFailure(null);
        return;
      }

      const errors = readSchemaErrors(error.extensions);
      if (errors.length > 0) {
        setViolations(parseSchemaErrors(errors));
        setFailure(null);
        return;
      }
    }
    setViolations(noViolations());
    setFailure(error);
  }

  async function save(): Promise<boolean> {
    setSaving(true);
    setNotice(null);
    setFailure(null);

    try {
      await saveDraft(subject.type, subject.key, {
        document,
        // Sent only when there is one. The link is set-only on the service —
        // a later save cannot detach it — so this client never pretends to
        // offer a control that would clear it.
        ...(flagId ? { resolvesFlagId: flagId } : {}),
      });

      setStored(document);
      setSavedOnce(true);
      setViolations(noViolations());
      // The work is on the service now, which outlives this browser. The
      // spare copy has done its job.
      forgetRecovery(subject.type, subject.key);
      setNotice("Draft saved.");
      return true;
    } catch (error) {
      absorb(error);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function publish(force: boolean): Promise<void> {
    setPublishing(true);
    setNotice(null);
    setFailure(null);

    try {
      if (force) {
        // The deliberate override, and the only path that writes the draft on
        // its way to publishing. Re-saving recaptures the base revision, which
        // is exactly what makes the publish below succeed — and exactly why it
        // is never done implicitly.
        await saveDraft(subject.type, subject.key, {
          document,
          ...(flagId ? { resolvesFlagId: flagId } : {}),
        });
        setStored(document);
      }

      const revision = await publishDraft(subject.type, subject.key, null);

      setRefused(false);
      setViolations(noViolations());
      forgetRecovery(subject.type, subject.key);
      // Handed up before the reload, because the reload is what unmounts this.
      onPublished(revision);
    } catch (error) {
      if (error instanceof ApiError && error.code === DRAFT_STALE) {
        /*
         * Somebody published between this draft being written and this button
         * being pressed. Nothing about the editor changes: not the document,
         * not the fields, not the caret. What changes is that there is now a
         * panel above explaining what happened, and the author decides.
         *
         * The copy in local storage is refreshed here rather than waited for,
         * because this is the moment at which somebody is most likely to
         * navigate away in frustration.
         */
        keepRecovery(subject.type, subject.key, document);
        setFailure(error);
        setRefused(true);
      } else {
        absorb(error);
      }
    } finally {
      setPublishing(false);
    }
  }

  async function discard(): Promise<void> {
    setSaving(true);
    setFailure(null);

    try {
      await discardDraft(subject.type, subject.key);
      forgetRecovery(subject.type, subject.key);
      reload();
    } catch (error) {
      absorb(error);
    } finally {
      setSaving(false);
    }
  }

  const summary = allViolations(violations);

  return (
    <>
      {offered ? (
        <Banner tone="warning" title="You have unsaved work from an earlier visit.">
          Something was being typed here on{" "}
          <When value={offered.savedAt} /> and never reached the server. It is
          still on this device.{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setDocument(offered.document);
              setOffered(null);
            }}
          >
            Put it back
          </button>{" "}
          or{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              forgetRecovery(subject.type, subject.key);
              setOffered(null);
            }}
          >
            throw it away
          </button>
          .
        </Banner>
      ) : null}

      {conflicted ? (
        <ConflictPanel
          type={subject.type}
          contentKey={subject.key}
          baseRevisionId={subject.baseRevisionId}
          currentRevisionId={subject.currentRevisionId}
          canPublish={canPublish}
          publishing={publishing}
          onOverride={() => void publish(true)}
        />
      ) : null}

      {failure && !(failure instanceof ApiError && failure.code === DRAFT_STALE) ? (
        <FailureBanner title="That could not be done." error={failure} />
      ) : null}

      {notice ? (
        <Banner tone="success" title={notice}>
          {canPublish
            ? "It is not published yet."
            : "An administrator publishes it from here."}
        </Banner>
      ) : null}

      {subject.schemaMissing ? (
        <Banner tone="info" title="No schema is published for this content type.">
          The document is edited directly as JSON. It is still checked against
          the schema by the service when it is saved, so a mistake is refused
          rather than stored — the refusal simply arrives at the end instead of
          against the field.
        </Banner>
      ) : null}

      <DocumentForm
        control={subject.control}
        document={document}
        violations={violations}
        onChange={setDocument}
        disabled={saving || publishing}
        scope={scope}
      >
        {!isEmpty(violations) ? (
          <div className="authoring-errors" role="alert" tabIndex={-1}>
            <p className="authoring-errors-title">
              {summary.length === 1
                ? "One field was refused."
                : `${summary.length} fields were refused.`}{" "}
              Nothing was stored.
            </p>
            {summary.length > 0 ? (
              <ul>
                {summary.map((violation, position) => (
                  <li key={`${violation.pointer}-${position}`}>
                    {/*
                      An anchor rather than a button. Following it moves focus
                      to the control, which is what a keyboard reader needs and
                      what a click gives a mouse reader for free.
                    */}
                    <a href={`#${fieldId(scope, violation.pointer)}`}>
                      {violation.pointer || "The document"}
                    </a>{" "}
                    — {violation.message}
                  </li>
                ))}
              </ul>
            ) : null}
            {violations.unplaced.length > 0 ? (
              <>
                <p className="authoring-errors-title">
                  The service also said, in its own words:
                </p>
                <ul>
                  {violations.unplaced.map((line, position) => (
                    <li key={position}>{line}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </DocumentForm>

      <div className="authoring-actions">
        <SubmitButton
          type="button"
          pending={saving}
          pendingLabel="Saving…"
          disabled={publishing}
          onClick={() => void save()}
        >
          Save draft
        </SubmitButton>

        {canPublish ? (
          <SubmitButton
            type="button"
            variant="secondary"
            pending={publishing}
            pendingLabel="Publishing…"
            // Publishing publishes what the service holds, not what is on the
            // screen. Offering it with unsaved edits would publish something
            // other than what the reader is looking at.
            disabled={saving || dirty || !(subject.draft !== null || savedOnce)}
            onClick={() => void publish(false)}
          >
            Publish the saved draft
          </SubmitButton>
        ) : null}

        {subject.draft || savedOnce ? (
          <SubmitButton
            type="button"
            variant="danger"
            pending={false}
            pendingLabel="Discarding…"
            disabled={saving || publishing}
            onClick={() => void discard()}
          >
            Discard the draft
          </SubmitButton>
        ) : null}
      </div>

      <p className="auth-note" role="status">
        {dirty
          ? "You have changes that are not saved."
          : subject.draft || savedOnce
            ? "Everything on this screen is saved as a draft."
            : "Nothing has been changed yet."}
        {canPublish
          ? null
          : " Publishing is an administrator's job; saving a draft is how a correction is proposed."}
      </p>
    </>
  );
}

/* -------------------------------------------------------- the conflict panel */

/**
 * What to do when somebody published while this draft was open.
 *
 * The panel shows the other person's change rather than only announcing it.
 * That is the difference between a conflict a contributor can resolve and one
 * they can only be blocked by: the service offers no merge and no re-base, so
 * folding the two together is done by hand — and doing it by hand requires
 * being able to read what the other change was, right next to the editor.
 *
 * There is no "take theirs" button, and that is deliberate. It would have to
 * replace what is in the editor, which is the one thing this whole screen is
 * arranged not to do.
 */
function ConflictPanel({
  type,
  contentKey,
  baseRevisionId,
  currentRevisionId,
  canPublish,
  publishing,
  onOverride,
}: {
  type: string;
  contentKey: string;
  baseRevisionId: number | null;
  currentRevisionId: number | null;
  canPublish: boolean;
  publishing: boolean;
  onOverride: () => void;
}) {
  const [load, setLoad] = useState<Load<Conflict>>({ state: "loading" });

  /*
   * The panel fetches what it explains rather than being handed it.
   *
   * That keeps two whole documents out of the editor's state, where they would
   * have to be cleared on every transition that could invalidate them, and it
   * keeps every state change in this file inside a promise callback — the rule
   * `app/auth/session.tsx` sets out for the whole app.
   */
  useEffect(() => {
    if (currentRevisionId === null) return;

    const controller = new AbortController();

    Promise.all([
      getRevision(type, contentKey, currentRevisionId, controller.signal),
      baseRevisionId === null
        ? Promise.resolve(null)
        : getRevision(type, contentKey, baseRevisionId, controller.signal),
    ]).then(
      ([current, base]) => {
        if (!controller.signal.aborted) {
          setLoad({ state: "ready", value: { current, base } });
        }
      },
      (error: unknown) => {
        // The conflict is real whether or not it can be explained. Saying the
        // explanation failed is honest; pretending there is no conflict is not,
        // and would invite somebody to publish over the top of it.
        if (!controller.signal.aborted) setLoad({ state: "failed", error });
      },
    );

    return () => controller.abort();
  }, [type, contentKey, baseRevisionId, currentRevisionId]);

  // Not memoised. Two revisions of one document, compared on the handful of
  // renders this panel does; the compiler holds the result across renders that
  // did not change `load` anyway, and a hook here only obscures that.
  const conflict = load.state === "ready" ? load.value : null;
  const changes = conflict?.base
    ? diffDocuments(conflict.base.document, conflict.current.document)
    : [];

  return (
    <section className="authoring-conflict" aria-labelledby="conflict-heading">
      <h2 id="conflict-heading">This document has moved on</h2>
      <p>
        Something was published to this document after this draft was started.
        Nothing has been overwritten and nothing you have typed has been
        touched. What follows is what changed underneath, so it can be folded
        into what is on the screen.
      </p>

      {load.state === "failed" ? (
        <Banner tone="error" title="What changed could not be loaded.">
          {messageFor(load.error)} The conflict is still real — publishing will
          be refused until the draft is saved again.
        </Banner>
      ) : load.state === "loading" ? (
        <SessionPending label="Loading what changed…" />
      ) : load.value.base ? (
        <DocumentDiff
          changes={changes}
          fromLabel={`revision ${load.value.base.number}`}
          toLabel={`revision ${load.value.current.number}`}
          emptyMessage="The published document has been rewritten, but its content is the same."
        />
      ) : (
        <p className="auth-note">
          This draft was started for a document that did not exist. It exists
          now, at revision {load.value.current.number}, published{" "}
          <When value={load.value.current.createdAt} />.
        </p>
      )}

      {canPublish ? (
        <p className="auth-actions">
          <SubmitButton
            type="button"
            variant="danger"
            pending={publishing}
            pendingLabel="Publishing…"
            onClick={onOverride}
          >
            Publish what is on screen over it
          </SubmitButton>
        </p>
      ) : (
        <p className="auth-note">
          Saving the draft again bases it on the current version. Whatever is on
          screen then becomes what an administrator publishes, so anything above
          that should survive has to be folded in first.
        </p>
      )}
    </section>
  );
}

/* --------------------------------------------------------------------- page */

/**
 * One document, from the moment its address is known.
 *
 * Split out from the page below and remounted whenever that address changes,
 * which is what makes "start again from scratch" the default rather than
 * something a dozen effects have to remember to do. It is also what keeps every
 * state change in this file inside a promise callback: an effect that reset the
 * load state on the way in would repaint the page before the browser had drawn
 * the previous one — the same rule `app/auth/session.tsx` is built around.
 */
function DocumentWorkspace({
  type,
  contentKey,
  descriptor,
  flagId,
  canPublish,
  onPublished,
  reload,
}: {
  type: string;
  contentKey: string;
  descriptor: ContentTypeDescriptor | null;
  flagId: string | null;
  canPublish: boolean;
  onPublished: (revision: RevisionSummary) => void;
  reload: () => void;
}) {
  const [load, setLoad] = useState<Load<Subject>>({ state: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    loadSubject(type, contentKey, descriptor, controller.signal).then(
      (subject) => {
        if (!controller.signal.aborted) setLoad({ state: "ready", value: subject });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setLoad({ state: "failed", error });
      },
    );

    return () => controller.abort();
    // `descriptor` is derived from the registry and the address, both of which
    // this component is remounted for, so it is deliberately not a dependency:
    // including it would restart the load on every render that produced an
    // equal object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, contentKey]);

  return (
    <section className="account-section" aria-labelledby="editor-heading">
      <h2 id="editor-heading">
        {load.state === "ready" ? headingFor(load.value) : "Editor"}
      </h2>

      {load.state === "loading" ? (
        <SessionPending label="Opening the document…" />
      ) : load.state === "failed" ? (
        <FailureBanner title="This document could not be opened." error={load.error} />
      ) : (
        <>
          <p className="account-section-lede">
            <code>{load.value.type}</code> · <code>{load.value.key}</code>
            {load.value.currentRevisionId === null
              ? " · not published yet"
              : ` · published, revision id ${load.value.currentRevisionId}`}
            {" · "}
            <Link to={historyPath(load.value.type, load.value.key)}>History</Link>
          </p>
          <Editor
            subject={load.value}
            flagId={flagId}
            canPublish={canPublish}
            onPublished={onPublished}
            reload={reload}
          />
        </>
      )}
    </section>
  );
}

export default function AuthoringEdit() {
  const { canPublish } = useOutletContext<AuthoringContext>();
  const [params] = useSearchParams();
  const { index, failed } = useContentTypes();
  const [generation, setGeneration] = useState(0);

  /*
   * What was published, and which document it was published to.
   *
   * The address is carried alongside so the confirmation cannot outlive its
   * subject: this component is not remounted when the query string changes, so
   * a bare revision here would still be announcing a publish after the reader
   * had moved on to the next document.
   */
  const [published, setPublished] = useState<{
    address: string;
    revision: RevisionSummary;
  } | null>(null);

  const requestedType = params.get("type") ?? "";
  const key = params.get("key") ?? "";
  const flagId = params.get("flag");

  /*
   * The canonical key, once the registry is available.
   *
   * The service accepts a route segment as well and answers with the canonical
   * key either way, so asking with one spelling and comparing with the other
   * would make every draft look as though it belonged to a different document.
   * A registry that could not be fetched is not fatal: the address is sent as
   * it was given and the service resolves it.
   */
  const type = index ? canonicalTypeKey(index, requestedType) : requestedType;
  const descriptor = index ? findContentType(index, requestedType) : null;
  const address = `${type}/${key}`;
  const publishedPath = publishedPathFor(descriptor, key);

  if (!requestedType) {
    return (
      <section className="account-section">
        <h2>Editor</h2>
        <p className="account-section-lede">
          Open something to edit it. The <Link to="/authoring">worklist</Link>{" "}
          lists the reports waiting on a correction, the drafts already in
          progress, and how to start something new.
        </p>
      </section>
    );
  }

  if (!key) {
    /*
     * A type with no key. Reachable only by typing the address, because every
     * link into here carries one — and it has to, because the key is the
     * document's address on the service as well as on this site: a draft is
     * written to `/drafts/{type}/{key}`, and the service refuses a document
     * whose own `key` disagrees with it.
     *
     * Said here rather than left to the load, which would otherwise fire three
     * requests at paths with an empty segment and report their refusals as the
     * document failing to open.
     */
    return (
      <section className="account-section">
        <h2>Editor</h2>
        <p className="account-section-lede">
          A document needs a key before it can be edited — it is the address the
          published page lives at, and the service stores the draft under it.{" "}
          <Link to="/authoring">Start from the worklist</Link>, which asks for
          one.
        </p>
      </section>
    );
  }

  if (!index && !failed) {
    return (
      <section className="account-section">
        <h2>Editor</h2>
        <SessionPending label="Loading the content types…" />
      </section>
    );
  }

  return (
    <>
      {published?.address === address ? (
        <Banner
          tone="success"
          title={`Published as revision ${published.revision.number}.`}
        >
          {flagId ? "The report this answers has been closed. " : null}
          <Link to={historyPath(type, key)}>See the history</Link>
          {publishedPath ? (
            <>
              {" or "}
              <Link to={publishedPath}>read the page</Link>
            </>
          ) : null}
          .
        </Banner>
      ) : null}

      <DocumentWorkspace
        // Remounted when the address changes or after a publish, so no state
        // from the last document — a half-typed field, an open conflict panel —
        // can survive into the next. The alternative is a dozen effects
        // resetting a dozen pieces of state, and one of them being forgotten.
        key={`${generation}:${address}`}
        type={type}
        contentKey={key}
        descriptor={descriptor}
        flagId={flagId}
        canPublish={canPublish}
        onPublished={(revision) => {
          setPublished({ address, revision });
          setGeneration((count) => count + 1);
        }}
        reload={() => {
          setPublished(null);
          setGeneration((count) => count + 1);
        }}
      />
    </>
  );
}

function headingFor(subject: Subject): string {
  const name =
    subject.document &&
    typeof subject.document === "object" &&
    !Array.isArray(subject.document) &&
    typeof (subject.document as Record<string, unknown>).name === "string"
      ? ((subject.document as Record<string, unknown>).name as string)
      : subject.key;

  const kind = subject.descriptor?.name ?? subject.type;
  return `${name || "New document"} — ${kind}`;
}
