/**
 * What there is to do, and where to start.
 *
 * The workspace opens on this rather than on an empty editor, because "edit the
 * content" is not one job. It is three, and they arrive from different places:
 *
 *   a report somebody filed and a reviewer accepted, which names the document
 *   it is about and is currently a dead end — the queue can say "yes, that is
 *   wrong" and then has nowhere to send anybody;
 *
 *   a draft already started, by this account or another, which may or may not
 *   still be based on the current version of what it edits;
 *
 *   something that does not exist yet.
 *
 * The first is listed first on purpose. It is the only one where somebody
 * outside the contributor group is waiting for an answer, and closing that loop
 * is the reason this interface exists at all.
 *
 * ## No `loader`
 *
 * See `app/routes/authoring.tsx`. This page in particular must never have one:
 * a prerendered draft queue would write the display name of everybody with work
 * outstanding into a static file every visitor is served.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router";

import { Banner, SessionPending } from "~/components/auth-ui";
import { listDrafts } from "~/authoring/api";
import {
  findContentType,
  publishedPathFor,
  typeLabel,
} from "~/authoring/content-types";
import { editorPath, historyPath } from "~/authoring/paths";
import type { DraftSummary } from "~/authoring/types";
import { FailureBanner, When, type Load } from "~/authoring/ui";
import { useContentTypes } from "~/authoring/use-content-types";
import { listFlags } from "~/flags/api";
import { reasonLabel } from "~/flags/reasons";
import type { Flag } from "~/flags/types";
import { authoringMeta, type AuthoringContext } from "./authoring";

export function meta() {
  return authoringMeta("Worklist");
}

/* --------------------------------------------------------- accepted reports */

/**
 * Reports a reviewer has agreed with, waiting for somebody to act.
 *
 * Only `accepted`. An open report has not been triaged and belongs in the
 * review queue rather than here; a resolved one is done. The distinction
 * between open and accepted is the queue's whole reason for being usable, and
 * this page is the other half of it: accepting a report used to be the end of
 * the road, and now it is the start of an edit.
 */
function AcceptedReports() {
  const [load, setLoad] = useState<Load<Flag[]>>({ state: "loading" });
  const { index } = useContentTypes();

  useEffect(() => {
    const controller = new AbortController();

    listFlags({ status: "accepted" }, controller.signal)
      .then((page) => setLoad({ state: "ready", value: page.flags }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ state: "failed", error });
      });

    return () => controller.abort();
  }, []);

  return (
    <section className="account-section" aria-labelledby="accepted-heading">
      <h2 id="accepted-heading">Reports waiting on a correction</h2>
      <p className="account-section-lede">
        Somebody reported these and a reviewer agreed. Correcting one from here
        ties the edit to the report, so publishing it closes the report for the
        person who filed it.
      </p>

      {load.state === "loading" ? (
        <SessionPending label="Loading accepted reports…" />
      ) : load.state === "failed" ? (
        <FailureBanner title="The accepted reports could not be loaded." error={load.error} />
      ) : load.value.length === 0 ? (
        <p className="auth-note">
          Nothing accepted is waiting. <Link to="/account/flags">The review
          queue</Link> is where reports are triaged.
        </p>
      ) : (
        <ul className="work-list">
          {load.value.map((flag) => {
            const descriptor = index ? findContentType(index, flag.targetType) : null;
            const type = descriptor?.key ?? flag.targetType;
            const published = publishedPathFor(descriptor, flag.targetKey);

            return (
              <li key={flag.id} className="work-row">
                <p className="work-row-head">
                  <span className="work-kind" data-kind="report">
                    Report
                  </span>
                  <span className="work-name">{flag.targetName}</span>
                  <span className="work-type">
                    {index ? typeLabel(index, flag.targetType) : flag.targetType}
                  </span>
                </p>
                <p className="work-reason">{reasonLabel(flag.reason)}</p>
                {/*
                  A text node, like everywhere else this appears. Report details
                  are written by anybody with an account and are being shown to
                  a contributor, whose session is the most valuable on the
                  platform.
                */}
                {flag.details ? <p className="flag-details">{flag.details}</p> : null}
                <p className="work-meta">
                  Filed <When value={flag.createdAt} />
                  {flag.reviewedAt ? (
                    <>
                      {" · accepted "}
                      <When value={flag.reviewedAt} />
                    </>
                  ) : null}
                </p>
                <p className="work-actions">
                  {descriptor || !index ? (
                    <Link
                      className="button button-primary"
                      to={editorPath(type, flag.targetKey, flag.id)}
                      /*
                        Named for what it acts on. Half a dozen rows each
                        offering "Correct this" are six identical links to
                        anything reading them out of context — which is what a
                        screen reader's list of links is.
                      */
                      aria-label={`Correct this — ${flag.targetName}`}
                    >
                      Correct this
                    </Link>
                  ) : (
                    // A report about something whose type this service does not
                    // recognise. Saying so beats a link to an editor that would
                    // meet a 404 on arrival.
                    <span className="auth-note">
                      Nothing here manages “{flag.targetType}”.
                    </span>
                  )}
                  {published ? (
                    <Link
                      className="button"
                      to={published}
                      aria-label={`Read the page for ${flag.targetName}`}
                    >
                      Read the page
                    </Link>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------- drafts */

function DraftRows({ drafts, canPublish }: { drafts: DraftSummary[]; canPublish: boolean }) {
  const { index } = useContentTypes();

  return (
    <ul className="work-list">
      {drafts.map((draft) => {
        const descriptor = index ? findContentType(index, draft.type) : null;
        const published = publishedPathFor(descriptor, draft.key);

        return (
          <li
            key={`${draft.type}/${draft.key}`}
            className="work-row"
            data-stale={draft.baseRevisionIsCurrent ? undefined : "true"}
          >
            <p className="work-row-head">
              <span
                className="work-kind"
                data-kind={draft.targetExists ? "draft" : "new"}
              >
                {draft.targetExists ? "Draft" : "New"}
              </span>
              <span className="work-name">{draft.name}</span>
              <span className="work-type">
                {index ? typeLabel(index, draft.type) : draft.type}
              </span>
            </p>

            {draft.baseRevisionIsCurrent ? null : (
              /*
               * The case the whole feature has to handle well. This draft was
               * started against a version of the document that is no longer the
               * current one, so publishing it will be refused — and saving over
               * it would replace whatever was published in between, because a
               * draft carries the whole document rather than a patch.
               *
               * Said here, on the row, rather than left for the author to
               * discover at the end. It is not an error; it is a state, and it
               * is the state two people editing the same page produce.
               */
              <p className="work-stale">
                Overtaken. Something was published to this document after the
                draft was started, so it has to be reconciled before it can go
                out.
              </p>
            )}

            <p className="work-meta">
              Last touched <When value={draft.updatedAt} />
              {draft.resolvesFlagId ? " · answers a report" : null}
            </p>

            <p className="work-actions">
              <Link
                className="button button-primary"
                to={editorPath(draft.type, draft.key)}
                aria-label={`${canPublish ? "Review and publish" : "Keep editing"} — ${draft.name}`}
              >
                {canPublish ? "Review and publish" : "Keep editing"}
              </Link>
              {draft.targetExists ? (
                <Link
                  className="button"
                  to={historyPath(draft.type, draft.key)}
                  aria-label={`History of ${draft.name}`}
                >
                  History
                </Link>
              ) : null}
              {published && draft.targetExists ? (
                <Link
                  className="button"
                  to={published}
                  aria-label={`Read the page for ${draft.name}`}
                >
                  Read the page
                </Link>
              ) : null}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function Drafts({ canPublish }: { canPublish: boolean }) {
  const [load, setLoad] = useState<Load<DraftSummary[]>>({ state: "loading" });

  const reload = useCallback((signal?: AbortSignal) => {
    listDrafts(signal)
      .then((answer) => {
        if (signal?.aborted) return;
        setLoad({ state: "ready", value: answer.drafts });
      })
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        setLoad({ state: "failed", error });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  // Overtaken drafts first. They are the ones that will refuse to publish, and
  // burying them under a long list of healthy ones is how a queue accumulates
  // drafts nobody can finish.
  const ordered = useMemo(() => {
    if (load.state !== "ready") return [];
    return [...load.value].sort((left, right) => {
      if (left.baseRevisionIsCurrent !== right.baseRevisionIsCurrent) {
        return left.baseRevisionIsCurrent ? 1 : -1;
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }, [load]);

  const overtaken = ordered.filter((draft) => !draft.baseRevisionIsCurrent).length;

  return (
    <section className="account-section" aria-labelledby="drafts-heading">
      <h2 id="drafts-heading">Drafts in progress</h2>
      <p className="account-section-lede">
        Every draft anybody has open, newest first. Drafts are shared — two
        people cannot hold separate ones for the same document — so a draft here
        is a piece of work somebody is in the middle of.
      </p>

      {load.state === "loading" ? (
        <SessionPending label="Loading drafts…" />
      ) : load.state === "failed" ? (
        <FailureBanner title="The drafts could not be loaded." error={load.error} />
      ) : ordered.length === 0 ? (
        <p className="auth-note">
          No drafts are open. Start one from an accepted report above, or from a
          content type below.
        </p>
      ) : (
        <>
          {overtaken > 0 ? (
            <Banner
              tone="warning"
              title={
                overtaken === 1
                  ? "One draft has been overtaken."
                  : `${overtaken} drafts have been overtaken.`
              }
            >
              Something was published to those documents after the drafts were
              started. They are listed first, and each one shows what changed
              underneath it when it is opened.
            </Banner>
          ) : null}
          <DraftRows drafts={ordered} canPublish={canPublish} />
        </>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- new things */

/**
 * Starting from nothing.
 *
 * A type and a key, and the editor does the rest. The key is asked for here
 * rather than derived from a name typed later, because the key is the
 * document's address: it is in the URL of the published page, it is what every
 * cross-reference in the corpus resolves through, and it is the one field a
 * contributor should have to think about before they start writing.
 */
function StartSomething() {
  const { index, failed } = useContentTypes();
  const [type, setType] = useState("");
  const [key, setKey] = useState("");

  const types = useMemo(() => {
    if (!index) return [];
    // The index holds every type twice — once under its key, once under its
    // route segment — so it is reduced back to one entry each before it is
    // offered as a menu.
    const unique = new Map(
      [...index.values()].map((descriptor) => [descriptor.key, descriptor]),
    );
    return [...unique.values()].sort((left, right) =>
      left.pluralName.localeCompare(right.pluralName),
    );
  }, [index]);

  const slug = key.trim().toLowerCase();
  const wellFormed = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);

  return (
    <section className="account-section" aria-labelledby="start-heading">
      <h2 id="start-heading">Start something new</h2>
      <p className="account-section-lede">
        A new document begins as a draft like any other, checked against the
        content type&apos;s schema from the first save.
      </p>

      {failed ? (
        <Banner tone="error" title="The content types could not be loaded.">
          Nothing new can be started until this list is available. Editing an
          existing document still works.
        </Banner>
      ) : null}

      <div className="auth-field">
        <label htmlFor="new-type">Content type</label>
        <select
          id="new-type"
          className="authoring-select"
          value={type}
          disabled={types.length === 0}
          onChange={(event) => setType(event.target.value)}
        >
          <option value="">Choose one…</option>
          {types.map((descriptor) => (
            <option key={descriptor.key} value={descriptor.key}>
              {descriptor.pluralName}
            </option>
          ))}
        </select>
      </div>

      <div className="auth-field">
        <label htmlFor="new-key">Key</label>
        <input
          id="new-key"
          className="authoring-input"
          value={key}
          spellCheck={false}
          aria-describedby="new-key-hint"
          aria-invalid={key.length > 0 && !wellFormed ? true : undefined}
          onChange={(event) => setKey(event.target.value)}
        />
        <p className="auth-field-hint" id="new-key-hint">
          Lower case, digits and single hyphens — <code>bo-rifle</code>,{" "}
          <code>heavy-blaster-pistol</code>. This becomes the address of the
          published page and cannot be changed afterwards without leaving the old
          one behind.
        </p>
      </div>

      <p className="auth-actions">
        {type && wellFormed ? (
          <Link className="button button-primary" to={editorPath(type, slug)}>
            Start drafting
          </Link>
        ) : (
          <button type="button" className="button button-primary" disabled>
            Start drafting
          </button>
        )}
      </p>
    </section>
  );
}

/* --------------------------------------------------------------------- page */

export default function AuthoringWorklist() {
  const { canPublish } = useOutletContext<AuthoringContext>();

  return (
    <>
      <AcceptedReports />
      <Drafts canPublish={canPublish} />
      <StartSomething />
    </>
  );
}
