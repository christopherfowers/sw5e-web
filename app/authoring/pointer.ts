/**
 * RFC 6901 JSON Pointers, and reading and writing through them.
 *
 * One notation runs through the whole authoring feature, and it is this one.
 * The form generator names every control by the pointer to the value it edits,
 * the diff reports every change at a pointer, and the service's schema
 * refusals arrive with a pointer at the front of each message. Because all
 * three agree, an error from the server can be placed against the control that
 * caused it and beside the change that introduced it without any of the three
 * knowing about the others.
 *
 * The write helpers are immutable. The editor holds one document in state and
 * React has to see a new object to re-render; mutating in place produces an
 * editor where typing does nothing until something else happens to re-render
 * it, which is a bug that takes an afternoon to find and one sentence to
 * prevent.
 */

/** `~` becomes `~0` and `/` becomes `~1`, in that order — the order matters. */
export function escapeToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** The inverse, and in the inverse order for the same reason. */
export function unescapeToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function joinPointer(parent: string, token: string | number): string {
  return `${parent}/${escapeToken(String(token))}`;
}

/** A pointer split into unescaped segments. The root pointer has none. */
export function splitPointer(pointer: string): string[] {
  if (pointer === "" || pointer === "/") return [];
  return pointer.replace(/^\//, "").split("/").map(unescapeToken);
}

/** The last segment of a pointer, unescaped, or null for the root. */
export function lastToken(pointer: string): string | null {
  const segments = splitPointer(pointer);
  return segments.length === 0 ? null : segments[segments.length - 1]!;
}

/** Everything but the last segment. The root's parent is itself. */
export function parentPointer(pointer: string): string {
  const segments = splitPointer(pointer);
  if (segments.length === 0) return "";
  return segments
    .slice(0, -1)
    .map((token) => `/${escapeToken(token)}`)
    .join("");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The value at a pointer, or `undefined` if nothing is there.
 *
 * `undefined` deliberately does not distinguish "absent" from "present and
 * undefined", because the second cannot occur: this only ever walks parsed
 * JSON, in which `undefined` is not a value.
 */
export function getAtPointer(document: unknown, pointer: string): unknown {
  let cursor: unknown = document;

  for (const token of splitPointer(pointer)) {
    if (Array.isArray(cursor)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) return undefined;
      cursor = cursor[index];
      continue;
    }
    if (!isObject(cursor)) return undefined;
    cursor = cursor[token];
  }

  return cursor;
}

/**
 * A copy of `document` with `value` written at `pointer`.
 *
 * Containers that do not exist along the way are created, and which kind is
 * created is decided by the *next* segment: a numeric segment makes an array
 * and anything else makes an object. That rule is what lets the form add the
 * first item to a list the document does not have yet without the caller having
 * to prepare the ground.
 *
 * Only the containers on the path are copied. Everything else is shared with
 * the original, which is what keeps typing in a class document — a few hundred
 * kilobytes of features — from copying the whole thing on every keystroke.
 */
export function setAtPointer(
  document: unknown,
  pointer: string,
  value: unknown,
): unknown {
  const segments = splitPointer(pointer);
  if (segments.length === 0) return value;

  const write = (node: unknown, depth: number): unknown => {
    const token = segments[depth]!;
    const last = depth === segments.length - 1;
    const index = Number(token);
    const wantsArray = Number.isInteger(index) && index >= 0 && String(index) === token;

    if (wantsArray && Array.isArray(node)) {
      const next = [...node];
      next[index] = last ? value : write(next[index], depth + 1);
      return next;
    }

    if (wantsArray && node === undefined) {
      const next: unknown[] = [];
      next[index] = last ? value : write(undefined, depth + 1);
      return next;
    }

    const base = isObject(node) ? node : {};
    return { ...base, [token]: last ? value : write(base[token], depth + 1) };
  };

  return write(document, 0);
}

/**
 * A copy of `document` with whatever is at `pointer` taken out.
 *
 * Removing from an array closes the gap rather than leaving a hole, because a
 * hole would serialize as `null` and the schema would refuse it — which would
 * report deleting the third feature of a class as a type error on the third
 * feature of a class.
 *
 * Removing something that is not there is not an error. It is what happens when
 * a reader clears an optional field twice, and answering with the document
 * unchanged is the correct outcome.
 */
export function removeAtPointer(document: unknown, pointer: string): unknown {
  const segments = splitPointer(pointer);
  if (segments.length === 0) return undefined;

  const drop = (node: unknown, depth: number): unknown => {
    const token = segments[depth]!;
    const last = depth === segments.length - 1;

    if (Array.isArray(node)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= node.length) return node;
      if (last) return [...node.slice(0, index), ...node.slice(index + 1)];
      const next = [...node];
      next[index] = drop(next[index], depth + 1);
      return next;
    }

    if (!isObject(node) || !(token in node)) return node;

    if (last) {
      const next = { ...node };
      delete next[token];
      return next;
    }

    return { ...node, [token]: drop(node[token], depth + 1) };
  };

  return drop(document, 0);
}

/**
 * Moves an array item, for the controls that reorder a list.
 *
 * Order is content in this corpus — a class's progression is read top to
 * bottom — so a list editor that could only add and remove would force somebody
 * to retype four rows to put one in the right place.
 */
export function moveArrayItem(
  document: unknown,
  arrayPointer: string,
  from: number,
  to: number,
): unknown {
  const list = getAtPointer(document, arrayPointer);
  if (!Array.isArray(list)) return document;
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return document;
  }

  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);

  return setAtPointer(document, arrayPointer, next);
}
