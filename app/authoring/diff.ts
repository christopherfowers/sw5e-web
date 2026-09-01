/**
 * What changed between two versions of a document.
 *
 * The service deliberately does not compute this. `GET .../revisions/{id}`
 * answers with a whole document and says so in its own notes: which fields
 * matter, and what "changed" should even mean for a list, is a presentation
 * decision, and a diff computed on the server would have to pick one answer for
 * every client forever. So this module picks ours, and everything in it is a
 * decision about what a reviewer needs to see rather than about JSON.
 *
 * Three of those decisions are worth stating outright, because the naive
 * version of each produces a diff that is technically correct and useless.
 *
 * **Arrays are matched, not zipped.** A class document carries its features in
 * a list. Inserting one feature at level 3 shifts every later entry by one, and
 * an index-wise comparison reports that all forty of them changed — which is
 * both wrong and the single most common edit anybody will make. Items are
 * therefore matched by identity where they have one, and by a longest common
 * subsequence where they do not, so an insertion reads as one insertion.
 *
 * **An edited item is a change, not a removal and an addition.** Once the
 * matching above has decided which items are new and which are gone, an
 * unmatched removal sitting next to an unmatched addition is almost always
 * somebody rewriting that entry. Pairing them and recursing turns "this
 * paragraph vanished and a different one appeared" into "this sentence in this
 * paragraph changed", which is the thing a reviewer is actually looking for.
 *
 * **Prose is diffed by word.** Two versions of a three-hundred-word rule shown
 * side by side are two walls of text; the sentence that moved is invisible.
 * {@link diffWords} exists so the component can show the one clause that
 * changed inside them.
 *
 * Nothing here renders anything or knows what a content type is. It walks two
 * pieces of parsed JSON and answers what is different, which is exactly as much
 * as a diff should know.
 */

import { joinPointer } from "./pointer";

/** How a value at one location differs. */
export type ChangeKind = "added" | "removed" | "changed";

export interface FieldChange {
  /**
   * RFC 6901 JSON Pointer to the value. This is the same notation the API's
   * `schemaErrors[]` uses to say where a write was rejected, so a component can
   * key both off one string and put an error and a change on the same control.
   */
  pointer: string;
  /**
   * The pointer split into readable segments, already unescaped. Array indices
   * arrive as their decimal string, which the presentation layer renders as an
   * ordinal rather than as a key.
   */
  path: string[];
  kind: ChangeKind;
  /** `undefined` exactly when `kind` is `"added"`. */
  before: unknown;
  /** `undefined` exactly when `kind` is `"removed"`. */
  after: unknown;
}

/**
 * The point past which arrays stop being matched and start being zipped.
 *
 * The subsequence match below is quadratic, and the largest documents in this
 * corpus are enhanced-item lists and class feature tables in the low hundreds.
 * Four hundred squared is a hundred and sixty thousand comparisons of already
 * serialized strings, which is imperceptible; four thousand squared is not, and
 * it would run on a reviewer's laptop while they waited to see a typo fix.
 *
 * Above the cap the diff degrades to index-wise comparison, which is noisier
 * but never slow. A degraded diff is a fair trade for a page that still
 * responds; a hung page is not.
 */
const MATCH_LIMIT = 400;

/** Keys, in order of preference, that identify an item across two versions. */
const IDENTITY_KEYS = ["key", "id", "slug", "name"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether two values are the same document content.
 *
 * Serialized rather than compared structurally, because the comparison has to
 * be stable for objects whose keys arrived in a different order — two API
 * responses for the same revision are not guaranteed to serialize their
 * properties identically, and a diff that reported every field of an untouched
 * object as changed because a key moved would be worse than no diff.
 */
function sameValue(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

/** JSON with object keys in sorted order, all the way down. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
  return out;
}

/* ----------------------------------------------------------- array matching */

/**
 * Which identity key, if any, both sides agree on.
 *
 * Every item on both sides has to be an object carrying the key, and the values
 * on each side have to be unique, or matching by it would silently pair the
 * wrong two rows. Two features both called "Extra Attack" — which really happens
 * across archetypes — must not be matched by name, and this is what stops it.
 */
function identityKeyFor(before: unknown[], after: unknown[]): string | null {
  for (const candidate of IDENTITY_KEYS) {
    if (!usableIdentity(before, candidate)) continue;
    if (!usableIdentity(after, candidate)) continue;
    return candidate;
  }
  return null;
}

function usableIdentity(items: unknown[], key: string): boolean {
  const seen = new Set<string>();

  for (const item of items) {
    if (!isObject(item)) return false;
    const value = item[key];
    if (typeof value !== "string" && typeof value !== "number") return false;
    const token = String(value);
    if (seen.has(token)) return false;
    seen.add(token);
  }

  return items.length > 0;
}

/** One aligned position: an index on each side, or `null` where there is none. */
interface Pairing {
  before: number | null;
  after: number | null;
}

/**
 * Aligns two arrays by a longest common subsequence of their serialized items.
 *
 * The table is built over strings that have already been serialized once, so
 * the inner loop is a string comparison rather than a structural walk. That
 * matters: this is the only quadratic thing in the module.
 */
function alignBySubsequence(before: unknown[], after: unknown[]): Pairing[] {
  const left = before.map(stableJson);
  const right = after.map(stableJson);

  // lengths[i][j] is the LCS length of left[i..] and right[j..].
  const lengths: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i]![j] =
        left[i] === right[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }

  const pairs: Pairing[] = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      pairs.push({ before: i, after: j });
      i += 1;
      j += 1;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      pairs.push({ before: i, after: null });
      i += 1;
    } else {
      pairs.push({ before: null, after: j });
      j += 1;
    }
  }

  // Whatever is left over once one side has run out. Both sides cannot have
  // anything left, because the loop above only stops when one of them is spent.
  while (i < left.length) pairs.push({ before: i++, after: null });
  while (j < right.length) pairs.push({ before: null, after: j++ });

  return pairs;
}

/** Alignment by a shared identity key. Order changes alone are not reported. */
function alignByIdentity(
  before: unknown[],
  after: unknown[],
  key: string,
): Pairing[] {
  const afterIndex = new Map<string, number>();
  after.forEach((item, index) => {
    afterIndex.set(String((item as Record<string, unknown>)[key]), index);
  });

  const pairs: Pairing[] = [];
  const matched = new Set<number>();

  before.forEach((item, index) => {
    const token = String((item as Record<string, unknown>)[key]);
    const partner = afterIndex.get(token);

    if (partner === undefined) {
      pairs.push({ before: index, after: null });
      return;
    }

    matched.add(partner);
    pairs.push({ before: index, after: partner });
  });

  after.forEach((_, index) => {
    if (!matched.has(index)) pairs.push({ before: null, after: index });
  });

  return pairs;
}

function alignByIndex(before: unknown[], after: unknown[]): Pairing[] {
  const pairs: Pairing[] = [];

  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    pairs.push({
      before: index < before.length ? index : null,
      after: index < after.length ? index : null,
    });
  }

  return pairs;
}

/**
 * Turns unmatched removals and additions into rewrites where that is plainly
 * what they are.
 *
 * The subsequence alignment above emits a removal and an addition for an item
 * somebody edited, because the serialized strings no longer match. Left alone,
 * a corrected sentence reads as a paragraph deleted and an unrelated paragraph
 * inserted, and the reviewer has to find the difference themselves.
 *
 * Only adjacent runs are paired, and only positionally within the run. Pairing
 * across the whole array would confidently marry a deletion at the top of a
 * list to an insertion at the bottom, and then present two unrelated entries as
 * one edit — a diff that invents a change is worse than one that misses it.
 */
function pairRewrites(pairs: Pairing[]): Pairing[] {
  const out: Pairing[] = [];
  let index = 0;

  while (index < pairs.length) {
    const start = index;
    while (index < pairs.length && pairs[index]!.after === null) index += 1;
    const removals = pairs.slice(start, index);

    const addStart = index;
    while (index < pairs.length && pairs[index]!.before === null) index += 1;
    const additions = pairs.slice(addStart, index);

    const shared = Math.min(removals.length, additions.length);
    for (let n = 0; n < shared; n += 1) {
      out.push({ before: removals[n]!.before, after: additions[n]!.after });
    }
    out.push(...removals.slice(shared), ...additions.slice(shared));

    // A run that matched neither pattern is a paired position; keep it and move
    // on, or this loop never advances.
    if (index === start) {
      out.push(pairs[index]!);
      index += 1;
    }
  }

  return out;
}

/* ------------------------------------------------------------------- walking */

function walk(
  before: unknown,
  after: unknown,
  pointer: string,
  path: string[],
  out: FieldChange[],
): void {
  if (sameValue(before, after)) return;

  if (before === undefined) {
    out.push({ pointer, path, kind: "added", before: undefined, after });
    return;
  }

  if (after === undefined) {
    out.push({ pointer, path, kind: "removed", before, after: undefined });
    return;
  }

  if (isObject(before) && isObject(after)) {
    // Both sides' keys, in the order the newer document lists them, with keys
    // that only the older one had appended. A reviewer reads a document in the
    // order it is written, and the order it is written now is the newer one.
    const keys = [
      ...Object.keys(after),
      ...Object.keys(before).filter((key) => !(key in after)),
    ];

    for (const key of keys) {
      walk(before[key], after[key], joinPointer(pointer, key), [...path, key], out);
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    walkArray(before, after, pointer, path, out);
    return;
  }

  out.push({ pointer, path, kind: "changed", before, after });
}

function walkArray(
  before: unknown[],
  after: unknown[],
  pointer: string,
  path: string[],
  out: FieldChange[],
): void {
  const oversized = before.length > MATCH_LIMIT || after.length > MATCH_LIMIT;
  const identity = oversized ? null : identityKeyFor(before, after);

  const pairs = oversized
    ? alignByIndex(before, after)
    : identity
      ? alignByIdentity(before, after, identity)
      : pairRewrites(alignBySubsequence(before, after));

  for (const pair of pairs) {
    // The index the reader is shown is the item's place in the document they
    // are looking at, which is the newer one wherever there is one.
    const shown = String(pair.after ?? pair.before);

    walk(
      pair.before === null ? undefined : before[pair.before],
      pair.after === null ? undefined : after[pair.after],
      joinPointer(pointer, shown),
      [...path, shown],
      out,
    );
  }
}

/**
 * Every difference between two documents, in document order.
 *
 * An empty result means the two are the same content — which is a real answer a
 * reviewer needs, because a revision that changed nothing is a thing that
 * happens and "no changes" is more use than a blank panel.
 */
export function diffDocuments(before: unknown, after: unknown): FieldChange[] {
  const out: FieldChange[] = [];
  walk(before, after, "", [], out);
  return out;
}

/* ---------------------------------------------------------------- word diff */

export interface WordSpan {
  text: string;
  kind: "same" | "removed" | "added";
}

/**
 * Splits prose into diffable tokens, keeping the whitespace.
 *
 * Whitespace is kept as its own token rather than trimmed, so that reassembling
 * the spans reproduces the original text exactly — including the paragraph
 * breaks, which in this corpus are meaningful and are a thing an editor changes
 * on purpose.
 */
function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/**
 * The two versions of a piece of prose, interleaved.
 *
 * Runs of unchanged text arrive as `same` spans, so the caller can show the
 * sentence a change sits in rather than only the change. The result reads left
 * to right in the order of the newer text, with removals in the place they were
 * taken from.
 *
 * The same quadratic cap as the array matcher applies, for the same reason: the
 * rules chapters run to thousands of words, and a reviewer must not wait on a
 * table the size of a spreadsheet. Past the cap the two versions are reported
 * whole, which is what a side-by-side would have shown anyway.
 */
export function diffWords(before: string, after: string): WordSpan[] {
  if (before === after) return before ? [{ text: before, kind: "same" }] : [];

  const left = tokenize(before);
  const right = tokenize(after);

  if (left.length > MATCH_LIMIT * 10 || right.length > MATCH_LIMIT * 10) {
    return [
      { text: before, kind: "removed" },
      { text: after, kind: "added" },
    ];
  }

  const lengths: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i]![j] =
        left[i] === right[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }

  const spans: WordSpan[] = [];
  let i = 0;
  let j = 0;

  const push = (text: string, kind: WordSpan["kind"]) => {
    const last = spans[spans.length - 1];
    // Merged as they are produced. One span per word would put a separate
    // element around every token, which is both enormous and unreadable to a
    // screen reader moving through it.
    if (last && last.kind === kind) last.text += text;
    else spans.push({ text, kind });
  };

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      push(left[i]!, "same");
      i += 1;
      j += 1;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      push(left[i]!, "removed");
      i += 1;
    } else {
      push(right[j]!, "added");
      j += 1;
    }
  }

  while (i < left.length) push(left[i++]!, "removed");
  while (j < right.length) push(right[j++]!, "added");

  return spans;
}
