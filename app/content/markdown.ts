/**
 * A small markdown parser for the subset the SW5e corpus actually uses.
 *
 * The archive's prose is markdown written by hand for a rulebook: headings,
 * bold and italic runs, bullet lists, pipe tables, horizontal rules, and
 * cross-references that the dataset builder has already rewritten into site
 * links. Nothing here produces HTML strings — it produces a node tree that
 * components render as React elements, so there is no `dangerouslySetInnerHTML`
 * anywhere in the app and no way for corpus text to inject markup.
 */

export type InlineNode =
  | { kind: "text"; value: string }
  | { kind: "strong"; children: InlineNode[] }
  | { kind: "emphasis"; children: InlineNode[] }
  | { kind: "link"; href: string; children: InlineNode[] };

export type BlockNode =
  | { kind: "heading"; depth: number; children: InlineNode[] }
  | { kind: "paragraph"; children: InlineNode[] }
  | { kind: "list"; ordered: boolean; items: InlineNode[][] }
  | { kind: "quote"; children: BlockNode[] }
  | { kind: "rule" }
  | { kind: "table"; header: InlineNode[][]; rows: InlineNode[][][] };

const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^(?:_{3,}|-{3,}|\*{3,})$/;
const BULLET = /^[-*+]\s+(.*)$/;
const ORDERED = /^\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const TABLE_ROW = /^\|(.*)\|$/;
const TABLE_DIVIDER = /^\|[\s:|-]+\|$/;

/** Splits a pipe-table row into its cells. */
function tableCells(line: string): string[] {
  const inner = line.replace(/^\||\|$/g, "");
  return inner.split("|").map((cell) => cell.trim());
}

export function parseMarkdown(source: string): BlockNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: BlockNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed === "") {
      index += 1;
      continue;
    }

    if (RULE.test(trimmed)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading) {
      blocks.push({
        kind: "heading",
        depth: heading[1].length,
        children: parseInline(heading[2]),
      });
      index += 1;
      continue;
    }

    if (TABLE_ROW.test(trimmed) && TABLE_DIVIDER.test(lines[index + 1]?.trim() ?? "")) {
      const header = tableCells(trimmed).map(parseInline);
      index += 2;
      const rows: InlineNode[][][] = [];
      while (index < lines.length && TABLE_ROW.test(lines[index].trim())) {
        rows.push(tableCells(lines[index].trim()).map(parseInline));
        index += 1;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    if (QUOTE.test(trimmed)) {
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index].trim())) {
        quoted.push(QUOTE.exec(lines[index].trim())![1]);
        index += 1;
      }
      blocks.push({ kind: "quote", children: parseMarkdown(quoted.join("\n")) });
      continue;
    }

    const isBullet = BULLET.test(trimmed);
    const isOrdered = !isBullet && ORDERED.test(trimmed);
    if (isBullet || isOrdered) {
      const pattern = isBullet ? BULLET : ORDERED;
      const items: InlineNode[][] = [];
      while (index < lines.length) {
        const candidate = lines[index].trim();
        const match = pattern.exec(candidate);
        if (!match) break;
        items.push(parseInline(match[1]));
        index += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }

    // A paragraph runs until a blank line or the start of another block.
    //
    // The first line is always consumed, whatever it looks like. Without that
    // the loop can stall: a line that opens a block but fails that block's
    // full test — a pipe-table row with no divider under it, which the corpus
    // does contain — would be rejected by the table branch and then rejected
    // again by the paragraph guard, leaving `index` where it started and
    // pushing empty paragraphs until the process runs out of memory.
    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const candidate = lines[index].trim();
      if (
        candidate === "" ||
        RULE.test(candidate) ||
        HEADING.test(candidate) ||
        BULLET.test(candidate) ||
        ORDERED.test(candidate) ||
        QUOTE.test(candidate) ||
        TABLE_ROW.test(candidate)
      ) {
        break;
      }
      paragraph.push(candidate);
      index += 1;
    }
    blocks.push({ kind: "paragraph", children: parseInline(paragraph.join(" ")) });
  }

  return blocks;
}

/**
 * Inline spans, longest delimiter first so `***both***` is not mistaken for
 * `**bold**` followed by a stray asterisk.
 */
const INLINE_PATTERNS: {
  pattern: RegExp;
  build: (match: RegExpExecArray) => InlineNode;
}[] = [
  {
    pattern: /\*\*\*([^*]+)\*\*\*/,
    build: (match) => ({
      kind: "strong",
      children: [{ kind: "emphasis", children: parseInline(match[1]) }],
    }),
  },
  {
    pattern: /\*\*([^*]+)\*\*/,
    build: (match) => ({ kind: "strong", children: parseInline(match[1]) }),
  },
  {
    pattern: /(?<!\*)\*([^*\n]+)\*(?!\*)/,
    build: (match) => ({ kind: "emphasis", children: parseInline(match[1]) }),
  },
  {
    pattern: /(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/,
    build: (match) => ({ kind: "emphasis", children: parseInline(match[1]) }),
  },
  {
    pattern: /\[([^\]]+)\]\(([^)\s]+)\)/,
    build: (match) => ({
      kind: "link",
      href: match[2],
      children: parseInline(match[1]),
    }),
  },
];

export function parseInline(source: string): InlineNode[] {
  if (source === "") return [];

  let earliest: { index: number; length: number; node: InlineNode } | null = null;
  for (const { pattern, build } of INLINE_PATTERNS) {
    const match = pattern.exec(source);
    if (!match) continue;
    if (earliest === null || match.index < earliest.index) {
      earliest = { index: match.index, length: match[0].length, node: build(match) };
    }
  }

  if (!earliest) return [{ kind: "text", value: source }];

  const before = source.slice(0, earliest.index);
  const after = source.slice(earliest.index + earliest.length);
  return [
    ...(before ? [{ kind: "text" as const, value: before }] : []),
    earliest.node,
    ...parseInline(after),
  ];
}
