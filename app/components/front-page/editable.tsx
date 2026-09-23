/**
 * The two things every front page section needs in order to be edited in
 * place: a piece of text, and a list you can rearrange.
 *
 * ## Why the sections take these rather than a flag
 *
 * The front page and its editor draw the same components. That is the whole
 * point of the arrangement: an editor built from a copy of the page drifts
 * from it, silently, the first time somebody changes one and not the other.
 *
 * So the section components below take `editing` as an optional object of
 * callbacks. Absent means the read-only page, and nothing in this file is
 * reached; present means the editor. A boolean would have left every section
 * reaching for handlers from somewhere else, and the read-only path would have
 * had to carry them as undefined.
 */

import { useId, useState } from "react";

import { Prose } from "~/components/prose";

/* --------------------------------------------------------------- text */

export interface EditableTextProps {
  /** The stored markdown, or null when nobody has written any. */
  value: string | null;
  /**
   * What the page draws when `value` is null.
   *
   * A node rather than a string because some of these fall back to a sentence
   * the page computes, and one of them counts the books.
   */
  fallback: React.ReactNode;
  /** The element the text sits in when it is not being edited. */
  className?: string;
  /** Absent means read-only, which is the prerendered page. */
  editing?: {
    label: string;
    onChange(next: string): void;
  };
}

/**
 * A lede or a heading, as a reader sees it or as an author changes it.
 *
 * Read-only and editing draw the same element with the same class, so the
 * editor's line breaks where the page's line breaks. Swapping in a control
 * with a border and a different font would have made the editor a form again,
 * which is the thing it is not supposed to be.
 */
export function EditableText({
  value,
  fallback,
  className,
  editing,
}: EditableTextProps) {
  const id = useId();

  if (!editing) {
    return value ? (
      <Prose markdown={value} className={className} startLevel={3} />
    ) : (
      <p className={className}>{fallback}</p>
    );
  }

  return (
    <div className="fp-editable">
      <label className="fp-editable-label" htmlFor={id}>
        {editing.label}
      </label>
      <textarea
        id={id}
        className={`fp-editable-input ${className ?? ""}`}
        value={value ?? ""}
        rows={value && value.length > 90 ? 3 : 2}
        onChange={(event) => editing.onChange(event.target.value)}
      />
      {value ? null : (
        <p className="fp-editable-fallback">
          Empty, so the page writes this: <span>{fallback}</span>
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- lists */

/** One thing on one of the front page's three lists. */
export interface Arrangeable {
  key: string;
  name: string;
}

export interface ListEditing<T extends Arrangeable> {
  /** What the section is called, for the add control and the announcements. */
  noun: string;
  /** The new order, by key, after a drag or a keyboard move. */
  onReorder(keys: string[]): void;
  /** Take this off the front page. It is not deleted. */
  onRemove(key: string): void;
  /** Everything of this type the corpus holds that the page is not drawing. */
  available: readonly T[];
  /** Put one back on the page. */
  onAdd(key: string): void;
  /**
   * Where this row's own document is edited.
   *
   * This screen owns only where a thing sits and whether it is drawn. A
   * book's name, blurb and cover are the book's own document, and somebody
   * looking at the shelf wanting to fix a blurb should not have to go and
   * find it in a worklist.
   */
  hrefFor?(key: string): string;
}

/**
 * The "Add a book" control, and the menu of what is currently off the page.
 *
 * A disclosure rather than a dialog. There is never much in it, it belongs to
 * the section it sits in, and a dialog would take focus away from a page whose
 * whole purpose is showing you the arrangement you are changing.
 */
export function AddToList<T extends Arrangeable>({
  editing,
}: {
  editing: ListEditing<T>;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const { available, noun } = editing;

  if (available.length === 0) {
    return (
      <p className="fp-add-empty">
        Everything the corpus holds is already on the page.
      </p>
    );
  }

  return (
    <div className="fp-add">
      <button
        type="button"
        className="button fp-add-button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((was) => !was)}
      >
        Add {noun}
      </button>
      {open ? (
        <ul className="fp-add-menu" id={menuId}>
          {available.map((candidate) => (
            <li key={candidate.key}>
              <button
                type="button"
                className="fp-add-option"
                onClick={() => {
                  editing.onAdd(candidate.key);
                  setOpen(false);
                }}
              >
                {candidate.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
