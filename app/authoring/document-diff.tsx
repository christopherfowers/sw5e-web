/**
 * Showing what changed, for somebody deciding whether to accept it.
 *
 * `app/authoring/diff.ts` works out the changes; this decides how a reviewer
 * meets them. Three choices carry the weight.
 *
 * **One entry per field, not two columns.** A side-by-side of two whole
 * documents is the obvious rendering and the useless one: these documents are
 * mostly long prose, the columns fall out of step at the first insertion, and
 * the reviewer ends up reading both versions in full to find the clause that
 * moved. A list of changed fields is short, is in document order, and says at
 * the top how many there are.
 *
 * **Prose is shown as one interleaved passage.** Two paragraphs printed one
 * after the other make the reader do the diffing. One paragraph with the
 * removed words struck through and the added words marked shows the change
 * where it happened, in its own sentence.
 *
 * **Nothing is rendered as markup.** These documents are the site's rules text
 * and are markdown, and it is tempting to render it — but the whole point of
 * this view is to show the difference between two versions of the *source*, and
 * a rendered version hides exactly the characters an editor is most likely to
 * have got wrong. Everything below is a text node.
 */

import { diffWords, type FieldChange } from "./diff";
import { humanise } from "./schema";

/** A field's location, written out. `/progression/3/level` → "Progression · 4 · Level". */
export function describePath(path: readonly string[]): string {
  if (path.length === 0) return "The whole document";

  return path
    .map((segment) =>
      // Array indices are stored zero-based and read one-based. A reviewer
      // counting rows on a page counts from one, and an off-by-one here sends
      // them to the wrong row of a forty-row class table.
      /^\d+$/.test(segment) ? `#${Number(segment) + 1}` : humanise(segment),
    )
    .join(" · ");
}

/** Whether a value is worth diffing word by word rather than showing whole. */
function isProse(value: unknown): value is string {
  return typeof value === "string" && (value.length > 60 || value.includes("\n"));
}

function Scalar({ value }: { value: unknown }) {
  if (value === undefined) return <span className="diff-absent">nothing</span>;
  if (value === null) return <span className="diff-absent">null</span>;
  if (typeof value === "string") return <>{value}</>;
  return <>{JSON.stringify(value, null, 2)}</>;
}

function ProseChange({ before, after }: { before: string; after: string }) {
  const spans = diffWords(before, after);

  return (
    <p className="diff-prose">
      {spans.map((span, index) =>
        span.kind === "same" ? (
          <span key={index}>{span.text}</span>
        ) : span.kind === "removed" ? (
          // `<del>`/`<ins>` rather than colour alone. Colour is not available to
          // everybody, and these two elements are what a screen reader uses to
          // say "deletion" and "insertion" out loud.
          <del key={index} className="diff-removed">
            {span.text}
          </del>
        ) : (
          <ins key={index} className="diff-added">
            {span.text}
          </ins>
        ),
      )}
    </p>
  );
}

function ChangeBody({ change }: { change: FieldChange }) {
  if (change.kind === "changed" && isProse(change.before) && isProse(change.after)) {
    return <ProseChange before={change.before} after={change.after} />;
  }

  return (
    <dl className="diff-values">
      {change.kind !== "added" ? (
        <div>
          <dt>Was</dt>
          <dd className="diff-was">
            <Scalar value={change.before} />
          </dd>
        </div>
      ) : null}
      {change.kind !== "removed" ? (
        <div>
          <dt>Now</dt>
          <dd className="diff-now">
            <Scalar value={change.after} />
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

const KIND_LABEL: Record<FieldChange["kind"], string> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
};

export interface DocumentDiffProps {
  changes: FieldChange[];
  /** What the two sides are, in the reader's terms. Used in the summary line. */
  fromLabel: string;
  toLabel: string;
  /** Said when there is no difference at all. */
  emptyMessage?: string;
}

/**
 * The changes between two documents.
 *
 * "No changes" is a real answer with a real sentence, not a blank area. A
 * revision that changed nothing happens — a revert that restored what was
 * already there, a save with a whitespace difference the diff normalised away —
 * and a panel that simply drew nothing would read as a page that failed.
 */
export function DocumentDiff({
  changes,
  fromLabel,
  toLabel,
  emptyMessage = "Nothing is different between these two.",
}: DocumentDiffProps) {
  if (changes.length === 0) {
    return <p className="auth-note">{emptyMessage}</p>;
  }

  return (
    <div className="diff">
      <p className="diff-summary">
        {changes.length === 1 ? "One field" : `${changes.length} fields`} differ
        {changes.length === 1 ? "s" : ""} between {fromLabel} and {toLabel}.
      </p>
      <ol className="diff-list">
        {changes.map((change) => (
          <li key={`${change.kind}:${change.pointer}`} className="diff-change">
            <p className="diff-change-head">
              <span className="diff-kind" data-kind={change.kind}>
                {KIND_LABEL[change.kind]}
              </span>
              <span className="diff-path">{describePath(change.path)}</span>
              {/* The pointer as the server would name it, for anybody
                  reconciling this against a schema refusal. */}
              <code className="diff-pointer">{change.pointer || "/"}</code>
            </p>
            <ChangeBody change={change} />
          </li>
        ))}
      </ol>
    </div>
  );
}
