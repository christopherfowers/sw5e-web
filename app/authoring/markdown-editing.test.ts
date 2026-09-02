import { describe, expect, it } from "vitest";

import { parseMarkdown, type BlockNode } from "~/content/markdown";
import {
  insertLink,
  insertRule,
  insertTable,
  LINK_PLACEHOLDER,
  safeHref,
  setHeading,
  toggleEmphasis,
  toggleLineStyle,
  type EditorSelection,
} from "./markdown-editing";

/**
 * Selects the first occurrence of `needle`, the way somebody double-clicking a
 * word would.
 */
function at(text: string, needle: string): EditorSelection {
  const start = text.indexOf(needle);
  if (start === -1) throw new Error(`"${needle}" is not in "${text}"`);
  return { text, start, end: start + needle.length };
}

/** A caret with nothing selected. */
function caret(text: string, offset = text.length): EditorSelection {
  return { text, start: offset, end: offset };
}

/**
 * The result as one string, selection and all.
 *
 * Asserting on the text alone would let half of every one of these tests pass
 * against an action that puts the caret in the wrong place — which is the
 * failure authors actually notice, because it is the one that happens on every
 * keystroke rather than once.
 */
function show(state: EditorSelection): string {
  return `${state.text.slice(0, state.start)}«${state.text.slice(state.start, state.end)}»${state.text.slice(state.end)}`;
}

describe("toggleEmphasis", () => {
  it("wraps a selection in bold and leaves the words selected", () => {
    expect(show(toggleEmphasis(at("the rules text", "rules"), 2))).toBe(
      "the **«rules»** text",
    );
  });

  it("takes bold back off when the caret is inside the markers", () => {
    expect(show(toggleEmphasis(at("the **rules** text", "rules"), 2))).toBe(
      "the «rules» text",
    );
  });

  it("takes bold back off when the markers are inside the selection", () => {
    expect(show(toggleEmphasis(at("the **rules** text", "**rules**"), 2))).toBe(
      "the «rules» text",
    );
  });

  it("returns the document to exactly where it started", () => {
    const before = at("the rules text", "rules");
    const after = toggleEmphasis(toggleEmphasis(before, 2), 2);
    expect(after).toEqual(before);
  });

  it("italicises bold text into bold-italic rather than stacking markers", () => {
    expect(show(toggleEmphasis(at("**rules**", "rules"), 1))).toBe("***«rules»***");
  });

  it("leaves bold behind when italic is taken off bold-italic", () => {
    expect(show(toggleEmphasis(at("***rules***", "rules"), 1))).toBe("**«rules»**");
  });

  it("leaves italic behind when bold is taken off bold-italic", () => {
    expect(show(toggleEmphasis(at("***rules***", "rules"), 2))).toBe("*«rules»*");
  });

  it("writes the markers and sits between them when nothing is selected", () => {
    expect(show(toggleEmphasis(caret(""), 1))).toBe("*«»*");
  });

  it("emits emphasis the site's parser recognises", () => {
    const { text } = toggleEmphasis(at("the rules text", "rules"), 2);
    expect(parseMarkdown(text)).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "text", value: "the " },
          { kind: "strong", children: [{ kind: "text", value: "rules" }] },
          { kind: "text", value: " text" },
        ],
      },
    ]);
  });

  it("emits bold-italic the site's parser recognises", () => {
    const { text } = toggleEmphasis(at("**rules**", "rules"), 1);
    expect(parseMarkdown(text)).toEqual([
      {
        kind: "paragraph",
        children: [
          {
            kind: "strong",
            children: [
              { kind: "emphasis", children: [{ kind: "text", value: "rules" }] },
            ],
          },
        ],
      },
    ]);
  });
});

describe("insertLink", () => {
  it("wraps the selection and leaves the label selected", () => {
    expect(show(insertLink(at("see the rules", "rules"), "/rules/combat"))).toBe(
      "see the [«rules»](/rules/combat)",
    );
  });

  it("writes a placeholder label when there is nothing selected", () => {
    expect(show(insertLink(caret("see "), "/rules/combat"))).toBe(
      `see [«${LINK_PLACEHOLDER}»](/rules/combat)`,
    );
  });

  it("encodes the characters that would truncate the address", () => {
    expect(safeHref("/rules/combat (revised)")).toBe("/rules/combat%20%28revised%29");
  });

  it("emits a link the site's parser recognises, address intact", () => {
    const { text } = insertLink(at("see the rules", "rules"), "/rules/combat (revised)");
    expect(parseMarkdown(text)).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "text", value: "see the " },
          {
            kind: "link",
            href: "/rules/combat%20%28revised%29",
            children: [{ kind: "text", value: "rules" }],
          },
        ],
      },
    ]);
  });
});

describe("toggleLineStyle", () => {
  it("turns every selected line into a bullet", () => {
    const state = at("first\nsecond\nthird", "second");
    expect(toggleLineStyle({ ...state, start: 0 }, "bullet").text).toBe(
      "- first\n- second\nthird",
    );
  });

  it("takes the bullets back off when every touched line has one", () => {
    expect(toggleLineStyle(at("- first\n- second", "first"), "bullet").text).toBe(
      "first\n- second",
    );
  });

  it("replaces bullets with numbers rather than stacking the markers", () => {
    const state: EditorSelection = { text: "- first\n- second", start: 0, end: 16 };
    expect(toggleLineStyle(state, "ordered").text).toBe("1. first\n2. second");
  });

  it("numbers the lines it writes in order", () => {
    const state: EditorSelection = { text: "a\nb\nc", start: 0, end: 5 };
    expect(toggleLineStyle(state, "ordered").text).toBe("1. a\n2. b\n3. c");
  });

  it("quotes a list without disturbing the list", () => {
    const state: EditorSelection = { text: "- first\n- second", start: 0, end: 16 };
    const quoted = toggleLineStyle(state, "quote");
    expect(quoted.text).toBe("> - first\n> - second");
    expect(parseMarkdown(quoted.text)).toEqual<BlockNode[]>([
      {
        kind: "quote",
        children: [
          {
            kind: "list",
            ordered: false,
            items: [
              [{ kind: "text", value: "first" }],
              [{ kind: "text", value: "second" }],
            ],
          },
        ],
      },
    ]);
  });

  it("unquotes when every touched line is already quoted", () => {
    const state: EditorSelection = { text: "> - first\n> - second", start: 0, end: 20 };
    expect(toggleLineStyle(state, "quote").text).toBe("- first\n- second");
  });

  it("does not let a trailing blank line vote on whether to toggle off", () => {
    // The selection is dragged one line too far, which is ordinary. If the
    // blank line counted, this would read as "not all bullets" and add a
    // second marker to lines that already have one.
    const state: EditorSelection = { text: "- first\n- second\n", start: 0, end: 17 };
    expect(toggleLineStyle(state, "bullet").text).toBe("first\nsecond\n");
  });

  it("emits a list the site's parser recognises", () => {
    const state: EditorSelection = { text: "a\nb", start: 0, end: 3 };
    expect(parseMarkdown(toggleLineStyle(state, "bullet").text)).toEqual<BlockNode[]>([
      {
        kind: "list",
        ordered: false,
        items: [[{ kind: "text", value: "a" }], [{ kind: "text", value: "b" }]],
      },
    ]);
  });
});

describe("setHeading", () => {
  it("makes the line a heading at the level asked for", () => {
    expect(setHeading(at("Combat", "Combat"), 2).text).toBe("## Combat");
  });

  it("clears the heading when the level asked for is the one already there", () => {
    expect(setHeading(at("## Combat", "Combat"), 2).text).toBe("Combat");
  });

  it("changes level rather than adding hashes to what is there", () => {
    expect(setHeading(at("## Combat", "Combat"), 3).text).toBe("### Combat");
  });

  it("drops a list marker, because a heading is a whole block", () => {
    expect(setHeading(at("- Combat", "Combat"), 2).text).toBe("## Combat");
  });

  it("emits a heading the site's parser recognises at the right depth", () => {
    expect(parseMarkdown(setHeading(at("Combat", "Combat"), 3).text)).toEqual<BlockNode[]>(
      [{ kind: "heading", depth: 3, children: [{ kind: "text", value: "Combat" }] }],
    );
  });
});

describe("insertRule", () => {
  it("separates the rule from the paragraph above it", () => {
    const { text } = insertRule(caret("Some text"));
    expect(text).toBe("Some text\n\n---\n");
    expect(parseMarkdown(text)).toEqual<BlockNode[]>([
      { kind: "paragraph", children: [{ kind: "text", value: "Some text" }] },
      { kind: "rule" },
    ]);
  });

  it("does not add blank lines that are already there", () => {
    expect(insertRule(caret("Some text\n\n")).text).toBe("Some text\n\n---\n");
  });
});

describe("insertTable", () => {
  it("lays down a skeleton the site's parser reads as a table", () => {
    const { text } = insertTable(caret(""));
    expect(text).toBe(
      "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|   |   |   |\n|   |   |   |\n",
    );

    const blocks = parseMarkdown(text);
    expect(blocks).toHaveLength(1);
    const table = blocks[0];
    if (table.kind !== "table") throw new Error(`parsed as ${table.kind}, not a table`);
    expect(table.header).toHaveLength(3);
    expect(table.rows).toHaveLength(2);
  });

  it("selects the first header so it can be typed straight over", () => {
    const state = insertTable(caret(""));
    expect(state.text.slice(state.start, state.end)).toBe("Column 1");
  });

  it("keeps the paragraph above it a paragraph", () => {
    const { text } = insertTable(caret("Intro"), 2, 1);
    expect(text).toBe("Intro\n\n| Column 1 | Column 2 |\n| --- | --- |\n|   |   |\n");
    expect(parseMarkdown(text).map((block) => block.kind)).toEqual([
      "paragraph",
      "table",
    ]);
  });
});
