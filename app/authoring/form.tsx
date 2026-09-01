/**
 * The form, drawn from the schema.
 *
 * `app/authoring/schema.ts` decides what controls a content type needs;
 * this draws them, and holds the rules that make a generated form usable rather
 * than merely present.
 *
 * ## Every control is named by the pointer to the value it edits
 *
 * That is what lets a refusal from the service land on the right field without
 * this component knowing anything about schema errors: the form names a control
 * `/progression/3/features`, the service refuses `/progression/3/features`, and
 * `app/authoring/violations.ts` hands the message over. It is also what the
 * error summary links to, and what the diff points at.
 *
 * ## Nothing is ever dropped
 *
 * A draft carries the whole document rather than a patch, so a field this form
 * does not draw is a field the next save deletes. Two rules follow, and both
 * have tests:
 *
 *   a shape the generator does not understand still gets a control — a text
 *   area holding it as JSON — rather than being skipped;
 *
 *   a property in the *document* that the schema does not describe is drawn
 *   too, under a heading that says so, with a control to remove it. Hiding it
 *   would leave the author unable to remove the thing the service is refusing,
 *   and unable to see that it is there.
 *
 * ## Clearing a field removes it rather than emptying it
 *
 * An optional field left blank must not be saved as `""`. The schemas set
 * `minLength: 1` on nearly every string, so an empty string is refused where an
 * absent property is accepted, and a form that stored empty strings would make
 * "I do not have a summary for this" impossible to express. The same rule is
 * applied to required fields, deliberately: it makes the refusal say "this has
 * to be filled in", which is what is actually wrong, instead of "this is
 * shorter than one character".
 *
 * ## The browser is not the judge
 *
 * The form carries `noValidate`, and the constraint attributes on each control
 * are hints rather than gates. The service validates every write against the
 * schema and is the only thing that can — it re-validates at publish as well as
 * at save, and it knows about the object-level conditions this form only
 * describes. A browser that refused to submit would be a second, weaker
 * validator that stops the real one from ever answering.
 */

import { useId, useMemo, useState } from "react";

import {
  blankValue,
  humanise,
  type ArrayControl,
  type ChoiceControl,
  type Control,
  type JsonControl,
  type LineControl,
  type NumberControl,
  type ObjectControl,
  type ProseControl,
  type ToggleControl,
} from "./schema";
import {
  joinPointer,
  moveArrayItem,
  removeAtPointer,
  setAtPointer,
} from "./pointer";
import type { SchemaViolation, SchemaViolations } from "./violations";

/**
 * How a control reports an edit.
 *
 * `undefined` means "take this property out of the document", which is a
 * different thing from an empty value and is the whole of the clearing rule
 * above. Every control calls this and none of them touches the document
 * directly, so there is exactly one place that decides what an edit does.
 */
export type EditHandler = (pointer: string, value: unknown) => void;

interface FieldProps {
  control: Control;
  pointer: string;
  label: string;
  required: boolean;
  value: unknown;
  onEdit: EditHandler;
  violations: SchemaViolations;
  disabled: boolean;
  /** Prefix for every generated element id, so two forms cannot collide. */
  scope: string;
}

interface ControlFieldProps extends FieldProps {
  /** Reordering, offered only where there is a list to reorder. */
  onMove?: (arrayPointer: string, from: number, to: number) => void;
}

/**
 * A DOM id for a pointer.
 *
 * Pointers contain slashes and may contain almost anything a property name may
 * contain, so they are reduced to something safe rather than used raw. The
 * mapping only has to be injective enough that two fields on one form do not
 * collide, and prefixing with a `useId` scope means two forms on one page
 * cannot either.
 */
export function fieldId(scope: string, pointer: string): string {
  return `${scope}${pointer.replace(/[^A-Za-z0-9]+/g, "-")}`;
}

function violationsAt(violations: SchemaViolations, pointer: string): SchemaViolation[] {
  return violations.byPointer.get(pointer) ?? [];
}

/**
 * The label, hint and error furniture every control shares.
 *
 * Written once because the association between the four is the part that
 * quietly stops working when it is written out by hand for the fifteenth
 * control — which is exactly what a generated form would otherwise be.
 */
function Field({
  id,
  label,
  required,
  description,
  errors,
  children,
}: {
  id: string;
  label: string;
  required: boolean;
  description: string | null;
  errors: SchemaViolation[];
  children: (aria: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": true | undefined;
  }) => React.ReactNode;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  // Both, not one replacing the other: an error does not stop the schema's
  // description of the field from being the thing that explains how to fix it.
  const describedBy =
    [description ? hintId : null, errors.length > 0 ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className="authoring-field">
      <label htmlFor={id}>
        {label}
        {required ? null : <span className="auth-field-optional">Optional</span>}
      </label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": errors.length > 0 ? true : undefined,
      })}
      {description ? (
        <p className="auth-field-hint" id={hintId}>
          {description}
        </p>
      ) : null}
      {errors.length > 0 ? (
        <p className="auth-field-error" id={errorId}>
          {errors.map((error) => error.message).join(" ")}
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- the controls */

function LineField(props: ControlFieldProps & { control: LineControl }) {
  const { control, pointer, value, onEdit, disabled, scope } = props;
  const id = fieldId(scope, pointer);
  const text = typeof value === "string" ? value : value === undefined ? "" : String(value);

  /*
   * A value carrying a line break is never put in a single-line control, no
   * matter what the schema said. The heuristic that decides prose from a
   * description is good but not perfect, and the cost of it being wrong in this
   * direction is that a reader cannot see or repair the text they already have.
   */
  if (text.includes("\n")) {
    return <ProseField {...props} />;
  }

  return (
    <Field
      id={id}
      label={props.label}
      required={props.required}
      description={control.description}
      errors={violationsAt(props.violations, pointer)}
    >
      {(aria) => (
        <input
          {...aria}
          className="authoring-input"
          type={control.inputType}
          value={text}
          disabled={disabled}
          maxLength={control.maxLength ?? undefined}
          onChange={(event) =>
            onEdit(pointer, event.target.value === "" ? undefined : event.target.value)
          }
        />
      )}
    </Field>
  );
}

function ProseField(props: ControlFieldProps & { control: ProseControl | LineControl }) {
  const { control, pointer, value, onEdit, disabled, scope } = props;
  const id = fieldId(scope, pointer);
  const text = typeof value === "string" ? value : value === undefined ? "" : String(value);

  return (
    <Field
      id={id}
      label={props.label}
      required={props.required}
      description={control.description}
      errors={violationsAt(props.violations, pointer)}
    >
      {(aria) => (
        <textarea
          {...aria}
          className="authoring-prose"
          value={text}
          disabled={disabled}
          rows={Math.min(24, Math.max(4, text.split("\n").length + 1))}
          onChange={(event) =>
            onEdit(pointer, event.target.value === "" ? undefined : event.target.value)
          }
        />
      )}
    </Field>
  );
}

function NumberField(props: ControlFieldProps & { control: NumberControl }) {
  const { control, pointer, value, onEdit, disabled, scope } = props;
  const id = fieldId(scope, pointer);

  return (
    <Field
      id={id}
      label={props.label}
      required={props.required}
      description={control.description}
      errors={violationsAt(props.violations, pointer)}
    >
      {(aria) => (
        <input
          {...aria}
          className="authoring-input authoring-input-number"
          type="number"
          inputMode={control.integer ? "numeric" : "decimal"}
          step={control.integer ? 1 : "any"}
          min={control.minimum ?? undefined}
          max={control.maximum ?? undefined}
          value={typeof value === "number" ? String(value) : ""}
          disabled={disabled}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === "") {
              onEdit(pointer, undefined);
              return;
            }
            const parsed = Number(raw);
            // A half-typed number — "-", "1e" — parses as NaN, and storing NaN
            // would serialize as null and be refused as the wrong type. The
            // document keeps whatever it had until the reader has typed
            // something that is a number.
            if (Number.isFinite(parsed)) onEdit(pointer, parsed);
          }}
        />
      )}
    </Field>
  );
}

function ChoiceField(props: ControlFieldProps & { control: ChoiceControl }) {
  const { control, pointer, value, onEdit, disabled, scope } = props;
  const id = fieldId(scope, pointer);
  const current = control.options.find((option) => option.value === value);

  return (
    <Field
      id={id}
      label={props.label}
      required={props.required}
      description={control.description}
      errors={violationsAt(props.violations, pointer)}
    >
      {(aria) => (
        <select
          {...aria}
          className="authoring-select"
          value={current ? String(current.value) : ""}
          disabled={disabled}
          onChange={(event) => {
            const chosen = control.options.find(
              (option) => String(option.value) === event.target.value,
            );
            onEdit(pointer, chosen ? chosen.value : undefined);
          }}
        >
          {/*
            Always offered, and not only for optional fields. A required field
            whose value is not yet chosen has to be able to *show* that it is
            not yet chosen; a select that silently reads as its first option
            would let somebody publish "core" because they never touched it.
          */}
          <option value="">
            {props.required ? "Choose one…" : "Not set"}
          </option>
          {control.options.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

function ToggleField(props: ControlFieldProps & { control: ToggleControl }) {
  const { control, pointer, value, onEdit, disabled, scope } = props;
  const id = fieldId(scope, pointer);
  const errors = violationsAt(props.violations, pointer);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className="authoring-field authoring-field-toggle">
      <input
        id={id}
        type="checkbox"
        checked={value === true}
        disabled={disabled}
        aria-invalid={errors.length > 0 ? true : undefined}
        aria-describedby={
          [control.description ? hintId : null, errors.length > 0 ? errorId : null]
            .filter(Boolean)
            .join(" ") || undefined
        }
        onChange={(event) => onEdit(pointer, event.target.checked)}
      />
      <label htmlFor={id}>{props.label}</label>
      {control.description ? (
        <p className="auth-field-hint" id={hintId}>
          {control.description}
        </p>
      ) : null}
      {errors.length > 0 ? (
        <p className="auth-field-error" id={errorId}>
          {errors.map((error) => error.message).join(" ")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The fallback control: the value, as JSON, in a text area.
 *
 * Its own state, because a document cannot hold half-typed JSON. What the
 * reader is typing lives here until it parses; only then does it reach the
 * document. Without that, deleting one character of `{"a":1}` would either
 * throw the value away or make the field impossible to edit.
 */
function JsonField(props: ControlFieldProps & { control: JsonControl }) {
  const { control, pointer, value, onEdit, disabled, scope } = props;
  const id = fieldId(scope, pointer);
  const serialized = useMemo(
    () => (value === undefined ? "" : JSON.stringify(value, null, 2)),
    [value],
  );

  const [text, setText] = useState(serialized);
  const [broken, setBroken] = useState<string | null>(null);

  /*
   * Re-synchronised when the value changes underneath — a draft reloaded, a
   * recovered copy put back, an entry above this one removed.
   *
   * Adjusted during the render that notices, rather than in an effect. An
   * effect would paint the stale text once and then paint again, and the caret
   * lands in the wrong place in between; React re-runs this component before
   * touching the DOM, so nobody sees the intermediate state. The comparison is
   * against the last value this control was told about, so it does not fire
   * on every render and does not overwrite what somebody is typing.
   */
  const [lastSeen, setLastSeen] = useState(serialized);
  if (lastSeen !== serialized) {
    setLastSeen(serialized);
    setText(serialized);
    setBroken(null);
  }

  const errors = violationsAt(props.violations, pointer);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const messages = [
    ...errors.map((error) => error.message),
    ...(broken ? [broken] : []),
  ];

  return (
    <div className="authoring-field">
      <label htmlFor={id}>
        {props.label}
        {props.required ? null : <span className="auth-field-optional">Optional</span>}
      </label>
      <textarea
        id={id}
        className="authoring-prose authoring-json"
        value={text}
        disabled={disabled}
        rows={Math.min(20, Math.max(3, text.split("\n").length + 1))}
        spellCheck={false}
        aria-invalid={messages.length > 0 ? true : undefined}
        aria-describedby={
          [hintId, messages.length > 0 ? errorId : null].filter(Boolean).join(" ") ||
          undefined
        }
        onChange={(event) => {
          const next = event.target.value;
          setText(next);

          if (next.trim() === "") {
            setBroken(null);
            onEdit(pointer, undefined);
            return;
          }

          try {
            onEdit(pointer, JSON.parse(next));
            setBroken(null);
          } catch {
            setBroken("This is not valid JSON yet, so it has not been saved.");
          }
        }}
      />
      <p className="auth-field-hint" id={hintId}>
        {control.description ? `${control.description} ` : ""}
        {control.reason}
      </p>
      {messages.length > 0 ? (
        <p className="auth-field-error" id={errorId}>
          {messages.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

function ArrayField(props: ControlFieldProps & { control: ArrayControl }) {
  const { control, pointer, value, onEdit, disabled } = props;
  const items = Array.isArray(value) ? value : [];
  const errors = violationsAt(props.violations, pointer);

  return (
    <fieldset className="authoring-group authoring-list">
      <legend>
        {props.label}
        <span className="authoring-count">{items.length}</span>
      </legend>
      {control.description ? (
        <p className="auth-field-hint">{control.description}</p>
      ) : null}
      {errors.length > 0 ? (
        <p className="auth-field-error">{errors.map((error) => error.message).join(" ")}</p>
      ) : null}

      {items.length === 0 ? (
        <p className="auth-note">Nothing here yet.</p>
      ) : (
        <ol className="authoring-list-items">
          {items.map((item, index) => (
            // Keyed by position, which is right here and unusual. These entries
            // have no identity of their own — an entry *is* its position in the
            // document — and a key derived from the content would remount every
            // row on every keystroke, taking the caret with it.
            <li key={index} className="authoring-list-item">
              <div className="authoring-list-item-head">
                <span className="authoring-list-item-number">{index + 1}</span>
                <span className="authoring-list-item-actions">
                  {/*
                    Every one of these carries the entry it acts on in its
                    accessible name. A list of twelve features otherwise offers
                    thirty-six controls called "Move up", "Move down" and
                    "Remove", which is what a screen reader reads out when it
                    lists the controls on the page.
                  */}
                  <button
                    type="button"
                    className="link-button"
                    disabled={disabled || index === 0}
                    aria-label={`Move up — ${control.itemLabel} ${index + 1}`}
                    onClick={() => props.onMove?.(pointer, index, index - 1)}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    disabled={disabled || index === items.length - 1}
                    aria-label={`Move down — ${control.itemLabel} ${index + 1}`}
                    onClick={() => props.onMove?.(pointer, index, index + 1)}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    className="link-button authoring-remove"
                    disabled={disabled}
                    aria-label={`Remove — ${control.itemLabel} ${index + 1}`}
                    onClick={() => onEdit(joinPointer(pointer, index), undefined)}
                  >
                    Remove
                  </button>
                </span>
              </div>
              <ControlField
                {...props}
                control={control.item}
                pointer={joinPointer(pointer, index)}
                label={`${humanise(control.itemLabel)} ${index + 1}`}
                required
                value={item}
              />
            </li>
          ))}
        </ol>
      )}

      <p className="authoring-list-add">
        <button
          type="button"
          className="button"
          disabled={disabled}
          aria-label={`Add ${items.length === 0 ? "a" : "another"} ${control.itemLabel} to ${props.label}`}
          onClick={() =>
            onEdit(joinPointer(pointer, items.length), blankValue(control.item))
          }
        >
          Add {items.length === 0 ? "a" : "another"} {control.itemLabel}
        </button>
      </p>
    </fieldset>
  );
}

function ObjectField(props: ControlFieldProps & { control: ObjectControl }) {
  const { control, pointer, value, onEdit, disabled } = props;
  const held = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

  const described = new Set(control.properties.map((property) => property.name));
  const extras = Object.keys(held).filter((name) => !described.has(name));
  const errors = violationsAt(props.violations, pointer);

  const body = (
    <>
      {control.conditions.length > 0 ? (
        <div className="authoring-conditions">
          {control.conditions.map((condition, index) => (
            <p key={index}>{condition}</p>
          ))}
        </div>
      ) : null}

      {errors.length > 0 ? (
        <p className="auth-field-error">{errors.map((error) => error.message).join(" ")}</p>
      ) : null}

      {control.properties.map((property) => (
        <ControlField
          {...props}
          key={property.name}
          control={property.control}
          pointer={joinPointer(pointer, property.name)}
          label={property.label}
          required={property.required}
          value={held[property.name]}
        />
      ))}

      {extras.length > 0 ? (
        <div className="authoring-extras">
          <p className="auth-field-hint">
            {control.closed
              ? "Not described by the schema. This content type does not allow " +
                "properties it does not name, so these have to be removed before " +
                "the document can be saved."
              : "Not described by the schema. Shown so it can be read and edited " +
                "rather than silently carried along."}
          </p>
          {extras.map((name) => (
            <div key={name} className="authoring-extra">
              <ControlField
                {...props}
                control={{
                  kind: "json",
                  title: null,
                  description: null,
                  reason: "This property is not part of this content type.",
                }}
                pointer={joinPointer(pointer, name)}
                label={humanise(name)}
                required={false}
                value={held[name]}
              />
              <p>
                <button
                  type="button"
                  className="link-button authoring-remove"
                  disabled={disabled}
                  onClick={() => onEdit(joinPointer(pointer, name), undefined)}
                >
                  Remove {humanise(name).toLowerCase()}
                </button>
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );

  // The root object is the form itself and needs no group around it. A nested
  // one is a group, and gets a legend so it is announced as what it is.
  if (pointer === "") return <div className="authoring-root">{body}</div>;

  return (
    <fieldset className="authoring-group">
      <legend>{props.label}</legend>
      {control.description ? (
        <p className="auth-field-hint">{control.description}</p>
      ) : null}
      {body}
    </fieldset>
  );
}

function ControlField(props: ControlFieldProps) {
  switch (props.control.kind) {
    case "object":
      return <ObjectField {...props} control={props.control} />;
    case "array":
      return <ArrayField {...props} control={props.control} />;
    case "choice":
      return <ChoiceField {...props} control={props.control} />;
    case "prose":
      return <ProseField {...props} control={props.control} />;
    case "line":
      return <LineField {...props} control={props.control} />;
    case "number":
      return <NumberField {...props} control={props.control} />;
    case "toggle":
      return <ToggleField {...props} control={props.control} />;
    case "json":
      return <JsonField {...props} control={props.control} />;
  }
}

/* ------------------------------------------------------------------- the form */

export interface DocumentFormProps {
  /** The shape, or `null` when there is no schema and the whole document is JSON. */
  control: ObjectControl | null;
  document: unknown;
  violations: SchemaViolations;
  onChange: (document: unknown) => void;
  disabled?: boolean;
  /**
   * The prefix for every generated element id.
   *
   * Supplied by the page when it needs to build links to the controls — the
   * error summary above the form is a list of anchors, and an anchor needs the
   * id before the control exists. Left out, the form makes its own.
   */
  scope?: string;
  /** Rendered above the fields. Used for the error summary and the save state. */
  children?: React.ReactNode;
}

/**
 * The whole document as a form.
 *
 * With no `control` — a service that publishes no schemas, or a schema whose
 * root is not an object — the document is edited as JSON in one control. That
 * is not a degraded mode to be embarrassed about: it is what makes this
 * interface deployable against a service one version behind, and it is the
 * reason the editor never simply refuses to open.
 */
export function DocumentForm({
  control,
  document,
  violations,
  onChange,
  disabled = false,
  scope: givenScope,
  children,
}: DocumentFormProps) {
  const generatedScope = useId();
  const scope = givenScope ?? generatedScope;

  const onEdit: EditHandler = (pointer, value) => {
    onChange(
      value === undefined
        ? removeAtPointer(document, pointer)
        : setAtPointer(document, pointer, value),
    );
  };

  const onMove = (arrayPointer: string, from: number, to: number) => {
    onChange(moveArrayItem(document, arrayPointer, from, to));
  };

  const shared = {
    pointer: "",
    label: "Document",
    required: true,
    value: document,
    onEdit,
    onMove,
    violations,
    disabled,
    scope,
  };

  return (
    <form
      className="authoring-form"
      // The service is the judge. See the note at the top of this file.
      noValidate
      onSubmit={(event) => event.preventDefault()}
    >
      {children}
      {control ? (
        <ControlField {...shared} control={control} />
      ) : (
        <ControlField
          {...shared}
          control={{
            kind: "json",
            title: null,
            description: null,
            reason:
              "This deployment does not publish a schema for this content type, " +
              "so the document is edited directly. It is still checked against " +
              "the schema when it is saved.",
          }}
          label="Document"
        />
      )}
    </form>
  );
}
