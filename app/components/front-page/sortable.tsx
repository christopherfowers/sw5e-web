/**
 * Rearranging one of the front page's three lists.
 *
 * ## Why a library
 *
 * These lists are short: five books, four downloads, three links. Short enough
 * that the HTML5 drag events would do it in sixty lines, which is the argument
 * for hand-rolling it. The argument against is that those sixty lines only
 * cover a mouse. Native drag and drop does not fire on a touch screen at all,
 * and it has no keyboard story whatsoever, so the hand-rolled version is one
 * that works for some of the people some of the time.
 *
 * dnd-kit carries pointer, touch and keyboard on one abstraction and announces
 * every move to a screen reader. It loads with the authoring route, so nobody
 * reading the rules pays for it.
 *
 * ## Why the read-only page never reaches this file
 *
 * `SortableShelf` is only rendered when a section is being edited. The page
 * itself draws a plain `<ul>`, so the reader's bundle holds no sensors, no
 * listeners and no drag state, and the prerendered HTML is the same markup it
 * was before any of this existed.
 */

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Link } from "react-router";

import type { Arrangeable, ListEditing } from "./editable";

export interface SortableShelfProps<T extends Arrangeable> {
  items: readonly T[];
  editing: ListEditing<T>;
  /** The class the read-only list uses, so the editor lays out identically. */
  className: string;
  children(item: T): React.ReactNode;
}

export function SortableShelf<T extends Arrangeable>({
  items,
  editing,
  className,
  children,
}: SortableShelfProps<T>) {
  /*
    A pointer has to travel a little before a drag starts. Without the
    constraint, a click on the remove button inside a draggable card is read as
    the beginning of a drag and the button never fires.
  */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const keys = items.map((item) => item.key);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = keys.indexOf(String(active.id));
    const to = keys.indexOf(String(over.id));
    if (from < 0 || to < 0) return;

    editing.onReorder(arrayMove(keys, from, to));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) =>
            `Picked up ${nameOf(items, active.id)}. Use the arrow keys to move it, space to drop it, escape to cancel.`,
          onDragOver: ({ active, over }) =>
            over
              ? `${nameOf(items, active.id)} is over ${nameOf(items, over.id)}.`
              : undefined,
          onDragEnd: ({ active, over }) =>
            over
              ? `${nameOf(items, active.id)} dropped. It is now in position ${
                  keys.indexOf(String(over.id)) + 1
                } of ${keys.length}.`
              : `${nameOf(items, active.id)} returned to where it was.`,
          onDragCancel: ({ active }) =>
            `Move cancelled. ${nameOf(items, active.id)} is back where it was.`,
        },
      }}
    >
      <SortableContext items={keys} strategy={rectSortingStrategy}>
        <ul className={className}>
          {items.map((item) => (
            <SortableItem key={item.key} item={item} editing={editing}>
              {children(item)}
            </SortableItem>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function nameOf<T extends Arrangeable>(
  items: readonly T[],
  id: string | number,
): string {
  return items.find((item) => item.key === String(id))?.name ?? String(id);
}

function SortableItem<T extends Arrangeable>({
  item,
  editing,
  children,
}: {
  item: T;
  editing: ListEditing<T>;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.key });

  return (
    <li
      ref={setNodeRef}
      className="fp-sortable"
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {/*
        The handle is its own control rather than the whole card. A card that is
        entirely draggable cannot hold a link or a button, and these hold both:
        a book's title goes to its page and the remove control sits in the
        corner. The handle is also what carries the keyboard listeners, so it
        has to be something focus can land on.
      */}
      <button
        type="button"
        className="fp-drag-handle"
        aria-label={`Move ${item.name}`}
        {...attributes}
        {...listeners}
      >
        <span aria-hidden="true">⠿</span>
      </button>

      {/*
        Straight to the document behind the card, because the two edits sit
        next to each other in a person's head: this book is in the wrong
        place, and also its blurb is wrong.
      */}
      {editing.hrefFor ? (
        <Link
          className="fp-open"
          to={editing.hrefFor(item.key)}
          aria-label={`Edit ${item.name}`}
          title={`Edit ${item.name}`}
        >
          <span aria-hidden="true">✎</span>
        </Link>
      ) : null}

      <button
        type="button"
        className="fp-remove"
        aria-label={`Take ${item.name} off the front page`}
        title={`Take ${item.name} off the front page`}
        onClick={() => editing.onRemove(item.key)}
      >
        <span aria-hidden="true">×</span>
      </button>

      {children}
    </li>
  );
}
