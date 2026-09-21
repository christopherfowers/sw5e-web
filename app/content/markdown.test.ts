import { describe, expect, it } from "vitest";

import { parseInline, parseMarkdown } from "./markdown";

describe("parsing corpus markdown", () => {
  it("reads headings at their own depth", () => {
    const blocks = parseMarkdown("### Biology\n\n#### Names");

    expect(blocks).toEqual([
      { kind: "heading", depth: 3, children: [{ kind: "text", value: "Biology" }] },
      { kind: "heading", depth: 4, children: [{ kind: "text", value: "Names" }] },
    ]);
  });

  it("joins wrapped lines into one paragraph", () => {
    const blocks = parseMarkdown("first line\nsecond line\n\nnext paragraph");

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      children: [{ kind: "text", value: "first line second line" }],
    });
  });

  it("reads bullet lists", () => {
    const blocks = parseMarkdown("- one\n- two");

    expect(blocks[0]).toMatchObject({ kind: "list", ordered: false });
    expect(blocks[0]).toHaveProperty("items.length", 2);
  });

  it("reads pipe tables that have a divider row", () => {
    const blocks = parseMarkdown("| d8 | Trait |\n|---|---|\n| 1 | Brave |");

    expect(blocks[0]).toMatchObject({ kind: "table" });
    expect(blocks[0]).toHaveProperty("rows.length", 1);
  });

  it("reads a horizontal rule written with underscores", () => {
    expect(parseMarkdown("___")).toEqual([{ kind: "rule" }]);
  });

  /**
   * This one is load-bearing. A pipe row with no divider under it fails the
   * table test, and an earlier version of the paragraph branch also refused to
   * consume it, so the parser looped forever pushing empty paragraphs. It took
   * the whole prerender build down with an out-of-memory crash rather than an
   * error anyone could read.
   */
  it("terminates on a pipe row that has no divider row", () => {
    const blocks = parseMarkdown("| stray row |\ntext after");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      children: [{ kind: "text", value: "| stray row | text after" }],
    });
  });

  it("terminates on every section of the corpus it is given", () => {
    // A blunt guard against any other non-advancing branch: every one of these
    // shapes must be consumed, not merely recognised.
    for (const source of [
      "|",
      "||",
      "> quoted\n\nafter",
      "1. first\n2. second",
      "***",
      "text\n|row|\nmore text",
    ]) {
      expect(() => parseMarkdown(source)).not.toThrow();
      expect(parseMarkdown(source).length).toBeGreaterThan(0);
    }
  });
});

describe("parsing inline markup", () => {
  it("reads bold-italic before bold", () => {
    expect(parseInline("***Overcharge Tech.***")).toEqual([
      {
        kind: "strong",
        children: [
          { kind: "emphasis", children: [{ kind: "text", value: "Overcharge Tech." }] },
        ],
      },
    ]);
  });

  it("reads bold inside a longer sentence", () => {
    expect(parseInline("a **bold** word")).toEqual([
      { kind: "text", value: "a " },
      { kind: "strong", children: [{ kind: "text", value: "bold" }] },
      { kind: "text", value: " word" },
    ]);
  });

  it("reads underscore emphasis without breaking snake_case words", () => {
    expect(parseInline("_3rd level_")).toEqual([
      { kind: "emphasis", children: [{ kind: "text", value: "3rd level" }] },
    ]);
    expect(parseInline("power_cell_name")).toEqual([
      { kind: "text", value: "power_cell_name" },
    ]);
  });

  it("reads links that the dataset builder rewrote into site routes", () => {
    expect(parseInline("[force push](/powers/force-push)")).toEqual([
      {
        kind: "link",
        href: "/powers/force-push",
        children: [{ kind: "text", value: "force push" }],
      },
    ]);
  });
});
