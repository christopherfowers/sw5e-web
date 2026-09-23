/**
 * The two shelves: the books, and the downloads under them.
 *
 * They are one component because they are one design. A letter page and a book
 * cover are the same shape, which is why the sheets sit beside the shelf above
 * without a layout of their own, and why both draw `shelf-book` cards inside a
 * `shelf` list.
 *
 * What differs is what a card says and where its title goes: a book's title is
 * a `Link` into the router, a download's is a plain anchor with `download` on
 * it, because a PDF this site serves leaves the router entirely and is never
 * opened in a tab on this origin. That difference is the `children` callback
 * rather than a branch in here.
 */

import type { Arrangeable, ListEditing } from "./editable";
import { AddToList, EditableText } from "./editable";
import { SortableShelf } from "./sortable";

export interface ShelfProps<T extends Arrangeable> {
  id: string;
  heading: string | null;
  headingFallback: string;
  lede: string | null;
  ledeFallback: React.ReactNode;
  items: readonly T[];
  /** Drawn under the row, when there is anything to say about the whole of it. */
  note?: React.ReactNode;
  children(item: T): React.ReactNode;
  editing?: ListEditing<T> & {
    onHeadingChange(next: string): void;
    onLedeChange(next: string): void;
  };
}

export function Shelf<T extends Arrangeable>({
  id,
  heading,
  headingFallback,
  lede,
  ledeFallback,
  items,
  note,
  children,
  editing,
}: ShelfProps<T>) {
  return (
    <section className="home-shelf" aria-labelledby={id}>
      <h2 className="section-heading" id={id}>
        {heading ?? headingFallback}
      </h2>

      {/*
        The control sits under the heading rather than inside it. A textarea
        nested in an `h2` is legal markup and a bad idea: the heading's
        accessible name is then computed from the control, so it reads as
        empty until somebody types, and the page's outline goes with it. The
        heading above updates as this is typed, which is the part that mattered.
      */}
      {editing ? (
        <EditableText
          value={heading}
          fallback={headingFallback}
          editing={{ label: "Heading", onChange: editing.onHeadingChange }}
        />
      ) : null}

      <EditableText
        value={lede}
        fallback={ledeFallback}
        className="section-lede"
        editing={
          editing
            ? { label: "Lede", onChange: editing.onLedeChange }
            : undefined
        }
      />

      {editing ? (
        <SortableShelf items={items} editing={editing} className="shelf">
          {children}
        </SortableShelf>
      ) : (
        <ul className="shelf">
          {items.map((item) => (
            <li key={item.key}>{children(item)}</li>
          ))}
        </ul>
      )}

      {editing ? <AddToList editing={editing} /> : null}
      {note}
    </section>
  );
}
