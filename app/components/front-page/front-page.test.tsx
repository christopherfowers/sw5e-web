/**
 * The front page's sections, drawn as a reader sees them and as an author
 * changes them.
 *
 * The point of these components is that the page and its editor are the same
 * markup, so the tests that matter are the ones asserting that: the read-only
 * path draws exactly what it drew when this was one file, and the editing path
 * adds affordances without taking any of it away.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AddToList, EditableText, type ListEditing } from "./editable";
import { Shelf } from "./shelf";

interface Row {
  key: string;
  name: string;
}

const BOOKS: Row[] = [
  { key: "phb", name: "Player's Handbook" },
  { key: "ec", name: "Expanded Content" },
];

function listEditing(overrides: Partial<ListEditing<Row>> = {}): ListEditing<Row> {
  return {
    noun: "a book",
    available: [],
    onReorder: vi.fn(),
    onRemove: vi.fn(),
    onAdd: vi.fn(),
    ...overrides,
  };
}

describe("EditableText", () => {
  it("draws the stored words when there are some", () => {
    render(<EditableText value="Written by somebody." fallback={<>Computed.</>} />);

    expect(screen.getByText("Written by somebody.")).toBeInTheDocument();
    expect(screen.queryByText("Computed.")).not.toBeInTheDocument();
  });

  it("draws the fallback when nobody has written any", () => {
    render(<EditableText value={null} fallback={<>Computed.</>} />);

    expect(screen.getByText("Computed.")).toBeInTheDocument();
  });

  it("renders stored markdown rather than printing its marks", () => {
    // The whole reason these fields carry contentMediaType. An author who
    // types **bold** must not ship a reader two pairs of asterisks.
    render(<EditableText value="A **firm** word." fallback={<>none</>} />);

    expect(screen.getByText("firm").tagName).toBe("STRONG");
  });

  it("offers a labelled control, and says what the page writes when it is empty", async () => {
    const onChange = vi.fn();
    render(
      <EditableText
        value={null}
        fallback={<>Counted from the shelf.</>}
        editing={{ label: "Lede", onChange }}
      />,
    );

    const field = screen.getByLabelText("Lede");
    expect(screen.getByText("Counted from the shelf.")).toBeInTheDocument();

    await userEvent.type(field, "H");
    expect(onChange).toHaveBeenCalledWith("H");
  });
});

describe("Shelf, read-only", () => {
  it("draws a plain list with no editing affordances on it", () => {
    render(
      <Shelf
        id="the-books"
        heading={null}
        headingFallback="The rulebooks"
        lede={null}
        ledeFallback={<>Two books.</>}
        items={BOOKS}
      >
        {(book) => <span>{book.name}</span>}
      </Shelf>,
    );

    expect(screen.getByRole("heading", { name: "The rulebooks" })).toBeInTheDocument();
    expect(screen.getByText("Two books.")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);

    // Nothing a reader could drag, remove or add. This is what keeps the
    // prerendered file identical to what it was before any of this existed.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Shelf, editing", () => {
  it("puts a move handle and a remove control on every row", () => {
    render(
      <Shelf
        id="the-books"
        heading={null}
        headingFallback="The rulebooks"
        lede={null}
        ledeFallback={<>Two books.</>}
        items={BOOKS}
        editing={{
          ...listEditing(),
          onHeadingChange: vi.fn(),
          onLedeChange: vi.fn(),
        }}
      >
        {(book) => <span>{book.name}</span>}
      </Shelf>,
    );

    expect(screen.getByLabelText("Move Player's Handbook")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Take Player's Handbook off the front page"),
    ).toBeInTheDocument();
  });

  it("takes a book off the page by key", async () => {
    const onRemove = vi.fn();
    render(
      <Shelf
        id="the-books"
        heading={null}
        headingFallback="The rulebooks"
        lede={null}
        ledeFallback={<>Two books.</>}
        items={BOOKS}
        editing={{
          ...listEditing({ onRemove }),
          onHeadingChange: vi.fn(),
          onLedeChange: vi.fn(),
        }}
      >
        {(book) => <span>{book.name}</span>}
      </Shelf>,
    );

    await userEvent.click(
      screen.getByLabelText("Take Expanded Content off the front page"),
    );
    expect(onRemove).toHaveBeenCalledWith("ec");
  });
});

describe("AddToList", () => {
  it("says so plainly when everything is already on the page", () => {
    render(<AddToList editing={listEditing({ available: [] })} />);

    expect(
      screen.getByText("Everything the corpus holds is already on the page."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers what is hidden, and puts one back", async () => {
    const onAdd = vi.fn();
    render(
      <AddToList
        editing={listEditing({
          available: [{ key: "snv", name: "Scum and Villainy" }],
          onAdd,
        })}
      />,
    );

    const open = screen.getByRole("button", { name: "Add a book" });
    expect(open).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(open);
    expect(open).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(
      within(screen.getByRole("list")).getByRole("button", {
        name: "Scum and Villainy",
      }),
    );
    expect(onAdd).toHaveBeenCalledWith("snv");
  });
});
