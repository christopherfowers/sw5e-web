/**
 * Turning a content type's JSON Schema into a description of a form.
 *
 * ## Why the form is generated
 *
 * There are thirty-one content types and they have thirty-one different shapes.
 * A creature has senses, an ability-score block and three damage affinities; a
 * class has a level progression; an armour property has four fields. Writing
 * thirty-one forms by hand is a week of work that is wrong the first time a
 * schema changes, and nothing would say it had gone wrong — the form would
 * simply stop offering a field, and a contributor saving through it would
 * quietly delete that field from the document, because a draft carries the
 * whole document rather than a patch.
 *
 * The schemas are already the authority: the service validates every write
 * against them and refuses anything that does not conform. So the form is
 * derived from the same document the refusal is derived from, and the two
 * cannot disagree.
 *
 * ## What this module will and will not claim to understand
 *
 * The schemas use a small, consistent vocabulary — `type`, `enum`, `const`,
 * `$ref` into `$defs`, `items`, `required`, `minLength`, `pattern`, `minimum`,
 * `format`, and a handful of object-level `oneOf`/`anyOf`/`not` constraints.
 * Everything in that list is rendered as a control.
 *
 * Everything outside it falls through to {@link JsonControl}, which is a text
 * area holding the value as JSON. That fallback is the most important thing
 * here. A generator that skipped what it did not understand would produce a
 * form that silently drops a field, and the first symptom would be a published
 * document missing a section nobody touched. Falling through means the worst
 * case is an ugly control rather than data loss, and
 * `app/authoring/schema.test.ts` pins that.
 *
 * The object-level combinators are a deliberate exception to "render
 * everything". `asset-credit` says, in effect, "either a cited work with an
 * artist and a title, or an inherited record with neither"; `species` says "an
 * ability increase names abilities or a count, not both". Those are conditions
 * on a whole object rather than alternative shapes for it — every branch draws
 * from the same property list — so the properties are rendered once and the
 * branch descriptions are carried through as {@link ObjectControl.conditions}
 * for the form to show as rules the author has to satisfy. Trying to render
 * them as a mode switch would invent a control the schema does not describe,
 * and the server would still be the one deciding.
 */

import type { ContentSchema } from "./types";

/** A JSON Schema, treated as what it is: a document this client did not write. */
export type SchemaNode = Record<string, unknown>;

export interface ChoiceOption {
  value: string | number | boolean;
  label: string;
}

interface ControlBase {
  /** The schema's own `title`, when it has one. */
  title: string | null;
  /** The schema's own `description`. Shown as the field's hint. */
  description: string | null;
}

export interface ObjectControl extends ControlBase {
  kind: "object";
  properties: PropertyControl[];
  /**
   * Rules the object as a whole has to satisfy, in the schema's own words.
   *
   * These come from `oneOf` and `anyOf` branch descriptions and from `required`
   * lists inside them. They are shown rather than enforced: the service is the
   * one that decides, and a client that tried to enforce them would be a second
   * implementation of a rule that already exists.
   */
  conditions: string[];
  /** Whether the schema forbids properties it does not name. */
  closed: boolean;
}

export interface PropertyControl {
  name: string;
  /** The label a reader sees. Derived from `name` unless the schema titles it. */
  label: string;
  required: boolean;
  control: Control;
}

export interface ArrayControl extends ControlBase {
  kind: "array";
  item: Control;
  minItems: number | null;
  maxItems: number | null;
  /** What one entry is called, singular, for the "Add another …" control. */
  itemLabel: string;
}

export interface ChoiceControl extends ControlBase {
  kind: "choice";
  options: ChoiceOption[];
}

export interface ProseControl extends ControlBase {
  kind: "prose";
  minLength: number | null;
  maxLength: number | null;
}

export interface LineControl extends ControlBase {
  kind: "line";
  inputType: "text" | "url" | "date";
  minLength: number | null;
  maxLength: number | null;
  pattern: string | null;
}

export interface NumberControl extends ControlBase {
  kind: "number";
  integer: boolean;
  minimum: number | null;
  maximum: number | null;
}

export interface ToggleControl extends ControlBase {
  kind: "toggle";
}

/**
 * The fallback: edit the value as JSON.
 *
 * `reason` is shown to the author, because "this is a text box full of braces"
 * with no explanation reads as the tool being broken rather than as the tool
 * being honest about a shape it was not taught.
 */
export interface JsonControl extends ControlBase {
  kind: "json";
  reason: string;
}

export type Control =
  | ObjectControl
  | ArrayControl
  | ChoiceControl
  | ProseControl
  | LineControl
  | NumberControl
  | ToggleControl
  | JsonControl;

/* ------------------------------------------------------------------ reading */

function isNode(value: unknown): value is SchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(node: SchemaNode, key: string): string | null {
  const value = node[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(node: SchemaNode, key: string): number | null {
  const value = node[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(node: SchemaNode, key: string): string[] {
  const value = node[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Follows a `$ref`, and only a local one.
 *
 * Every reference in this corpus is `#/$defs/name`. A reference to another
 * document would be a request to fetch a URL, which this site's policy does not
 * permit and this module has no business initiating, so anything that is not a
 * local pointer is left unresolved and falls through to the JSON control with
 * that as its stated reason.
 *
 * The depth limit is not paranoia about these schemas; it is what makes a
 * malformed or circular one a rendered fallback instead of a hung tab.
 */
function resolve(node: SchemaNode, root: SchemaNode, depth = 0): SchemaNode {
  const ref = readString(node, "$ref");
  if (!ref || depth > 8) return node;
  if (!ref.startsWith("#/")) return node;

  let cursor: unknown = root;
  for (const token of ref.slice(2).split("/")) {
    const segment = token.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isNode(cursor)) return node;
    cursor = cursor[segment];
  }

  if (!isNode(cursor)) return node;

  // The referring node's own keywords win over the target's. That is what lets
  // `{"$ref": "#/$defs/damageAffinity", "description": "…"}` — which the
  // creature schema does three times — say what *this* use of the shape means.
  const merged = { ...resolve(cursor, root, depth + 1), ...node };
  delete merged.$ref;
  return merged;
}

/* ------------------------------------------------------------------ labelling */

/**
 * A property name, written for a person.
 *
 * `archetypeIntroduction` becomes "Archetype introduction" and `hitPoints`
 * becomes "Hit points". Sentence case rather than title case, because the rest
 * of this site's field labels are sentence case and a generated form that
 * shouted would be the only place that did.
 */
export function humanise(name: string): string {
  const spaced = name
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();

  if (spaced.length === 0) return name;
  return spaced[0]!.toUpperCase() + spaced.slice(1).toLowerCase();
}

/** An enum value, written for a person. `expanded-content` → "Expanded content". */
function optionLabel(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return JSON.stringify(value) ?? "";
  return humanise(value);
}

/** English-ish singular, for the "Add another …" control on a list. */
function singularise(label: string): string {
  if (/ies$/i.test(label)) return `${label.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/i.test(label)) return label.slice(0, -2);
  if (/[^s]s$/i.test(label)) return label.slice(0, -1);
  return label;
}

/* ------------------------------------------------------------------ deciding */

/**
 * Whether a string field holds prose rather than a value.
 *
 * The schemas say so themselves. Every long-form field in this corpus opens its
 * description with the word "Markdown" — it is the convention the schema
 * authors used to mark the difference between "the rules text of this feature"
 * and "the name of this feature" — so that is what is read, rather than a list
 * of field names compiled here that would have to grow with every new type.
 *
 * The test is deliberately forgiving: the word anywhere in the description, not
 * only at the front. The two failures are not equally bad. A false positive
 * gives a name field a text area, which is untidy. A false negative puts three
 * paragraphs of rules text in a control one line high, which is close to
 * unusable — and the renderer widens the net further by refusing to put a value
 * that already contains a line break into a single-line control at all.
 */
function readsAsProse(node: SchemaNode): boolean {
  const description = readString(node, "description");
  if (!description) return false;
  return /\bmarkdown\b/i.test(description);
}

function typeOf(node: SchemaNode): string | null {
  const declared = node.type;
  if (typeof declared === "string") return declared;
  // `type: ["string", "null"]` does not occur in this corpus, but a schema that
  // grew one must not be mistaken for a schema with no type at all.
  if (Array.isArray(declared)) {
    const named = declared.find(
      (entry) => typeof entry === "string" && entry !== "null",
    );
    return typeof named === "string" ? named : null;
  }
  return null;
}

function base(node: SchemaNode): ControlBase {
  return {
    title: readString(node, "title"),
    description: readString(node, "description"),
  };
}

/**
 * The conditions an object has to satisfy beyond its own `required` list.
 *
 * Read out of `oneOf` and `anyOf` in the schema's own words where it wrote
 * them, and reconstructed from the branch's `required` list where it did not —
 * `background`'s roll-table entries say only "one of `name` or `description`",
 * and a reader meeting the refusal deserves to have been told beforehand.
 */
function readConditions(node: SchemaNode): string[] {
  const out: string[] = [];

  for (const keyword of ["oneOf", "anyOf"] as const) {
    const branches = node[keyword];
    if (!Array.isArray(branches)) continue;

    const written = branches
      .filter(isNode)
      .map((branch) => {
        const described = readString(branch, "description");
        if (described) return described;

        const needs = readStringArray(branch, "required").map(humanise);
        if (needs.length === 0) return null;
        return `${needs.join(" and ")} must be filled in.`;
      })
      .filter((entry): entry is string => entry !== null);

    if (written.length === 0) continue;

    out.push(
      keyword === "oneOf"
        ? "Exactly one of these has to be true:"
        : "At least one of these has to be true:",
    );
    out.push(...written);
  }

  return out;
}

/**
 * Describes one schema node as a control.
 *
 * `root` is the whole schema document, and is carried through every recursion
 * purely so that `$ref` can be resolved. It is passed rather than closed over
 * so that this function can be called on a `$defs` entry directly, which is
 * what the tests do.
 */
export function describeControl(
  node: SchemaNode,
  root: SchemaNode,
  depth = 0,
): Control {
  if (depth > 24) {
    return { ...base(node), kind: "json", reason: "This shape nests too deeply to draw." };
  }

  const schema = resolve(node, root);
  const meta = base(schema);

  if (schema.$ref !== undefined) {
    return {
      ...meta,
      kind: "json",
      reason: "This field points at a schema published somewhere else.",
    };
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return {
      ...meta,
      kind: "choice",
      options: schema.enum
        .filter(
          (value): value is string | number | boolean =>
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean",
        )
        .map((value) => ({ value, label: optionLabel(value) })),
    };
  }

  if (schema.const !== undefined) {
    const value = schema.const;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return {
        ...meta,
        kind: "choice",
        options: [{ value, label: optionLabel(value) }],
      };
    }
  }

  const declared = typeOf(schema);

  if (declared === "object" || isNode(schema.properties)) {
    const properties = isNode(schema.properties) ? schema.properties : {};
    const required = new Set(readStringArray(schema, "required"));

    return {
      ...meta,
      kind: "object",
      closed: schema.additionalProperties === false,
      conditions: readConditions(schema),
      // Schema order, which is authored order. Sorting required fields first
      // would read better in the abstract and wrongly in practice: these
      // documents are written in the order a reader meets them on the page, and
      // an editor that reorders them stops matching the thing being edited.
      properties: Object.entries(properties)
        .filter((entry): entry is [string, SchemaNode] => isNode(entry[1]))
        .map(([name, child]) => {
          const control = describeControl(child, root, depth + 1);
          return {
            name,
            label: control.title ?? humanise(name),
            required: required.has(name),
            control,
          };
        }),
    };
  }

  if (declared === "array") {
    const items = isNode(schema.items) ? schema.items : null;
    const item: Control = items
      ? describeControl(items, root, depth + 1)
      : {
          title: null,
          description: null,
          kind: "json",
          reason: "This list does not say what one entry looks like.",
        };

    return {
      ...meta,
      kind: "array",
      item,
      minItems: readNumber(schema, "minItems"),
      maxItems: readNumber(schema, "maxItems"),
      itemLabel: singularise(meta.title ?? "entry").toLowerCase(),
    };
  }

  if (declared === "string") {
    const format = readString(schema, "format");

    if (readsAsProse(schema)) {
      return {
        ...meta,
        kind: "prose",
        minLength: readNumber(schema, "minLength"),
        maxLength: readNumber(schema, "maxLength"),
      };
    }

    return {
      ...meta,
      kind: "line",
      inputType: format === "uri" ? "url" : format === "date" ? "date" : "text",
      minLength: readNumber(schema, "minLength"),
      maxLength: readNumber(schema, "maxLength"),
      pattern: readString(schema, "pattern"),
    };
  }

  if (declared === "integer" || declared === "number") {
    return {
      ...meta,
      kind: "number",
      integer: declared === "integer",
      minimum: readNumber(schema, "minimum"),
      maximum: readNumber(schema, "maximum"),
    };
  }

  if (declared === "boolean") {
    return { ...meta, kind: "toggle" };
  }

  return {
    ...meta,
    kind: "json",
    reason:
      "The schema does not say what shape this is, so it is edited as JSON to " +
      "make sure nothing is lost.",
  };
}

/**
 * The form for a whole content type, or `null` when the schema is not an object
 * this module can start from.
 *
 * A schema whose root is not an object describes something that is not a
 * content document, and there is nothing sensible to draw for it. The editor
 * treats that the same way it treats a service with no schemas at all: it edits
 * the document as JSON and says why.
 */
export function describeDocument(schema: ContentSchema): ObjectControl | null {
  if (!isNode(schema.schema)) return null;
  const control = describeControl(schema.schema, schema.schema);
  return control.kind === "object" ? control : null;
}

/**
 * A blank document for a type, with the shape its schema implies.
 *
 * Only required objects and required arrays are created, and no scalar is given
 * a value. That is deliberate: a generated form that pre-filled `name` with an
 * empty string would produce a document whose `name` fails `minLength` rather
 * than one whose `name` is missing, and "must be at least 1 character" is a
 * worse thing to say to somebody starting a new entry than "this is required".
 *
 * `key` is filled in, because the address the document is being written to
 * already decides it and the service refuses a document whose key disagrees
 * with its address.
 */
export function blankDocument(control: ObjectControl | null, key: string): unknown {
  const document: Record<string, unknown> = {};

  for (const property of control?.properties ?? []) {
    if (!property.required) continue;
    if (property.control.kind === "object") {
      document[property.name] = blankDocument(property.control, "");
    } else if (property.control.kind === "array") {
      document[property.name] = [];
    }
  }

  if (key) document.key = key;
  return document;
}

/**
 * A blank value of whatever shape a control edits.
 *
 * Used when a reader adds an entry to a list: an empty object for a list of
 * objects, an empty string for a list of strings. The alternative — adding
 * `null` and letting the schema refuse it — puts an error on a row the reader
 * has not had a chance to fill in yet.
 */
export function blankValue(control: Control): unknown {
  switch (control.kind) {
    case "object":
      return blankDocument(control, "");
    case "array":
      return [];
    case "number":
      return control.minimum ?? 0;
    case "toggle":
      return false;
    case "choice":
      return control.options[0]?.value ?? "";
    default:
      return "";
  }
}
