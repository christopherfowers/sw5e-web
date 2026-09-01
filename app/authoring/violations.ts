/**
 * Turning the service's schema refusal back into something to put beside a
 * control.
 *
 * When a write is refused for not matching its schema, the API answers 400 with
 * `code: "schema-violation"` and a `schemaErrors` array. Each entry is one
 * line, and each line is built by the validator as:
 *
 *     {instance location}: {keyword} — {message}
 *
 * The instance location is a JSON Pointer — empty for the document root — and
 * the keyword is the JSON Schema keyword that failed. So the information needed
 * to put an error next to the field that caused it is in the string, and this
 * module is where it is taken back out.
 *
 * ## This is a copy of a format the service owns, and that is stated on purpose
 *
 * Nothing on the wire promises this shape. It is `string[]`, the service's own
 * tests assert only that it is not empty, and the format is produced by a
 * validator in a third repository. So this parser is a bet, and the whole
 * module is arranged around losing that bet safely:
 *
 *   - a line that does not parse is not dropped and is not mangled. It goes to
 *     {@link SchemaViolations.unplaced}, which the form shows in full, in the
 *     service's own words, above the fields.
 *   - a line that does parse still carries its original text, so a reader is
 *     never shown a paraphrase without the thing it paraphrases.
 *
 * The failure mode of a wrong guess is therefore an error message in the wrong
 * *place*, never an error message that is missing. That is the difference
 * between a fragile optimisation and a fragile requirement, and `schemaErrors`
 * being unstructured is the reason it has to be the first one.
 *
 * ## Required is reported at the parent, and has to be moved
 *
 * A missing property is a failure of the object that should have contained it,
 * so the validator reports it at the parent's location: `": required — Required
 * properties ["description"] were not present"`. Left there, every missing
 * field on a document would stack up at the root and none of them would be next
 * to the control the reader has to fill in. The property names are in the
 * message, so they are lifted out and the error is moved onto each one.
 */

import { escapeToken } from "./pointer";

export interface SchemaViolation {
  /** JSON Pointer to the value, matching the pointers the form names controls by. */
  pointer: string;
  /** The JSON Schema keyword that failed, when the line named one. */
  keyword: string | null;
  /** A sentence written for a contributor. */
  message: string;
  /** The line exactly as the service sent it, so nothing is hidden. */
  detail: string;
}

export interface SchemaViolations {
  /** Violations that named a location, grouped by the pointer they belong to. */
  byPointer: Map<string, SchemaViolation[]>;
  /**
   * Lines that named no location this client could use, kept verbatim.
   *
   * These are real and there are several: the document not being a JSON object
   * at all, its `key` not matching the address it is being saved to, a JSON
   * parse failure, and the service having no schema published for the type.
   * None of them belongs to a field, and all of them have to be shown.
   */
  unplaced: string[];
}

/**
 * `{pointer}: {keyword} — {message}`.
 *
 * The pointer group excludes `:` because a JSON Pointer in this corpus is a
 * path made of property names and array indices, none of which contain one. The
 * separator is a literal em dash with a space either side, which is what the
 * validator writes; anything using a hyphen is not this format and is left
 * alone rather than being cut in half at the wrong place.
 */
const VIOLATION = /^(?<pointer>[^:]*):\s(?<keyword>[A-Za-z$][A-Za-z0-9_]*)\s—\s(?<message>.+)$/s;

/** The property names inside `Required properties ["a", "b"] were not present`. */
const QUOTED = /"([^"]+)"/g;

/**
 * What a keyword means, in a sentence.
 *
 * Preferred over the validator's own wording where there is an entry, because
 * the validator is writing for whoever is debugging a schema and this is
 * writing for whoever is correcting a rules page. "All values fail against the
 * false schema" is a true and accurate sentence that tells a contributor
 * nothing.
 *
 * Anything not listed keeps the service's wording, which is always better than
 * a guess.
 */
const PLAIN_ENGLISH: Record<string, string> = {
  required: "This has to be filled in.",
  minLength: "This cannot be left empty.",
  maxLength: "This is longer than this field allows.",
  pattern: "This is not written in the form this field accepts.",
  enum: "That is not one of the values this field accepts.",
  const: "This field only accepts one value, and that is not it.",
  type: "That is the wrong kind of value for this field.",
  minimum: "That number is too small.",
  maximum: "That number is too large.",
  minItems: "This list needs more entries than it has.",
  maxItems: "This list has more entries than it allows.",
  uniqueItems: "Two entries in this list are the same.",
  minProperties: "This needs at least one entry.",
  format: "This is not in the format this field expects.",
  additionalProperties:
    "Something here is not part of this content type. Anything below marked as " +
    "not described by the schema has to be removed.",
};

function add(
  into: Map<string, SchemaViolation[]>,
  violation: SchemaViolation,
): void {
  const existing = into.get(violation.pointer);
  if (existing) existing.push(violation);
  else into.set(violation.pointer, [violation]);
}

/**
 * Reads the `schemaErrors` extension off a refusal.
 *
 * Takes `unknown` because that is what it is — an extension member of a problem
 * document, typed by nobody — and answers an empty list for anything that is
 * not an array of strings. A service that changed the shape gets the generic
 * refusal message rather than a page that throws while rendering an error.
 */
export function readSchemaErrors(extensions: Readonly<Record<string, unknown>>): string[] {
  const value = extensions.schemaErrors;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Parses the lines into something a form can place. */
export function parseSchemaErrors(lines: readonly string[]): SchemaViolations {
  const byPointer = new Map<string, SchemaViolation[]>();
  const unplaced: string[] = [];

  for (const line of lines) {
    const match = VIOLATION.exec(line.trim());

    if (!match?.groups) {
      unplaced.push(line);
      continue;
    }

    const pointer = match.groups.pointer ?? "";
    const keyword = match.groups.keyword ?? "";
    const message = match.groups.message ?? "";

    // A location that is neither the root nor a pointer is not something this
    // client can place, and guessing would put an error on an unrelated field.
    if (pointer !== "" && !pointer.startsWith("/")) {
      unplaced.push(line);
      continue;
    }

    if (keyword === "required") {
      const names = [...message.matchAll(QUOTED)].map((found) => found[1]!);

      if (names.length > 0) {
        for (const name of names) {
          add(byPointer, {
            pointer: `${pointer}/${escapeToken(name)}`,
            keyword,
            message: PLAIN_ENGLISH.required!,
            detail: line,
          });
        }
        continue;
      }
    }

    add(byPointer, {
      pointer,
      keyword,
      message: PLAIN_ENGLISH[keyword] ?? message,
      detail: line,
    });
  }

  return { byPointer, unplaced };
}

/** Nothing wrong anywhere. Used as the starting state and after a clean save. */
export function noViolations(): SchemaViolations {
  return { byPointer: new Map(), unplaced: [] };
}

export function isEmpty(violations: SchemaViolations): boolean {
  return violations.byPointer.size === 0 && violations.unplaced.length === 0;
}

/**
 * Every violation in the document, in no particular order, for the summary that
 * sits at the top of the form.
 *
 * A form with an error twelve fields down needs to say so before the reader
 * scrolls, and a summary that links to each one is the pattern that works for
 * a keyboard and a screen reader alike.
 */
export function allViolations(violations: SchemaViolations): SchemaViolation[] {
  return [...violations.byPointer.values()].flat();
}
