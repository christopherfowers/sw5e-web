/**
 * The formatting actions, as arithmetic on a string and a selection.
 *
 * Everything the toolbar does is here, and nothing here knows what a textarea
 * is. That split is the whole design. A formatting action is a pure function
 * from `{ text, start, end }` to `{ text, start, end }`, so the interesting
 * behaviour — that bold toggles back off, that turning a bullet list into a
 * numbered one does not stack the markers, that the table skeleton is a table
 * the parser recognises — is testable without a DOM, without React, and
 * without a fake caret.
 *
 * ## Everything below stays inside the dialect
 *
 * `app/content/markdown.ts` is a hand-written parser for the subset the corpus
 * uses, and it is the only thing that will ever read what an author writes
 * here. So this file may only emit constructs that file can parse: headings,
 * paragraphs, flat ordered and unordered lists, block quotes, horizontal
 * rules, pipe tables, and the inline runs `**bold**`, `*italic*`,
 * `***both***` and `[label](/href)`.
 *
 * There is no images action, no code action, no strike-through and no nesting,
 * because there is no renderer for any of them. A toolbar button that produced
 * markdown the site cannot draw would be worse than no button: the author
 * would see their intent accepted and the reader would see the raw asterisks.
 *
 * ## Asterisk runs, not string matching
 *
 * Emphasis is counted rather than matched. `**bold**` and `***both***` and
 * `*italic*` differ only in how many asterisks sit against each edge of the
 * selection, so both toggles work by measuring that run and adding to or
 * subtracting from it. Matching on the literal `**` instead is the version
 * that turns `***both***` into `****both****` the first time somebody presses
 * the italic button on text that was already bold — which is the bug this
 * shape exists to make unrepresentable.
 *
 * ## The dialect has no escape character
 *
 * Which means some text simply cannot be expressed, and this file has to
 * decide what to do about that rather than pretend otherwise. It draws the
 * line in one place: a link's href is rewritten so it always parses (see
 * `insertLink`), because a pasted URL containing a space is common and its
 * failure is silent. A link's *label* is left exactly as the author wrote it,
 * even when it contains a bracket that will stop the link parsing, because
 * quietly deleting characters out of somebody's prose is a worse failure than
 * a preview that visibly shows the link did not take. The preview is the
 * backstop, and it cannot lie, because it is the site's own parser.
 */

/** A text field's contents and its selection: everything an action needs. */
export interface EditorSelection {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** Which emphasis a button asks for, counted in asterisks. */
export type EmphasisLevel = 1 | 2;

/** The line-level markers that can be toggled over a run of lines. */
export type LineStyle = "bullet" | "ordered" | "quote";

/** Heading depth, where 0 means "not a heading". */
export type HeadingDepth = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Clamps a selection to the text and puts its ends the right way round. */
function normalise(state: EditorSelection): { start: number; end: number } {
  const limit = state.text.length;
  const a = Math.max(0, Math.min(limit, state.start));
  const b = Math.max(0, Math.min(limit, state.end));
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/** How many asterisks run backwards from `index`. */
function asterisksBefore(text: string, index: number): number {
  let count = 0;
  while (index - count - 1 >= 0 && text[index - count - 1] === "*") count += 1;
  return count;
}

/** How many asterisks run forwards from `index`. */
function asterisksAfter(text: string, index: number): number {
  let count = 0;
  while (index + count < text.length && text[index + count] === "*") count += 1;
  return count;
}

/**
 * Bold and italic, as one operation over the asterisk runs at the selection's
 * edges.
 *
 * The selection is first pulled *inside* any asterisks it happens to contain,
 * so selecting `bold` and selecting `**bold**` do the same thing. Authors do
 * both — double-clicking a word gets you the first, dragging across it gets
 * you the second — and a toolbar where the result depends on which one you did
 * is a toolbar people stop trusting.
 *
 * After that there is one rule. Let `applied` be the shorter of the two runs
 * against the edges: 1 is italic, 2 is bold, 3 is both. Bold removes two
 * asterisks a side when `applied` is at least 2 and adds two otherwise; italic
 * removes one when `applied` is odd and adds one otherwise. `***both***` is
 * therefore reachable and, more importantly, leavable in either direction.
 *
 * The returned selection covers the text without its markers, so pressing the
 * same button twice returns the document to exactly where it started.
 */
export function toggleEmphasis(
  state: EditorSelection,
  level: EmphasisLevel,
): EditorSelection {
  const { text } = state;
  let { start, end } = normalise(state);

  // Pull the selection inside asterisks it already contains, but never so far
  // that the selection is *only* asterisks — `**` selected on its own has no
  // inside, and shrinking it would invent one.
  const selected = text.slice(start, end);
  const lead = /^\**/.exec(selected)![0].length;
  const trail = /\**$/.exec(selected)![0].length;
  const absorb = Math.min(lead, trail);
  if (absorb > 0 && lead + trail < selected.length) {
    start += absorb;
    end -= absorb;
  }

  const applied = Math.min(asterisksBefore(text, start), asterisksAfter(text, end));
  const remove = level === 2 ? applied >= 2 : applied % 2 === 1;

  if (remove) {
    return {
      text: text.slice(0, start - level) + text.slice(start, end) + text.slice(end + level),
      start: start - level,
      end: end - level,
    };
  }

  const marker = "*".repeat(level);
  return {
    text: text.slice(0, start) + marker + text.slice(start, end) + marker + text.slice(end),
    start: start + level,
    end: end + level,
  };
}

/**
 * Makes an href that the parser's link pattern will actually match.
 *
 * That pattern is `\[([^\]]+)\]\(([^)\s]+)\)`: an href stops at the first
 * space or closing parenthesis. So a URL carrying either — which is most of
 * what gets pasted out of a wiki — would produce a link whose target is the
 * first half of the address and whose second half is loose prose, and the
 * author would have no way to tell from the source that anything was wrong.
 * Percent-encoding the three offending characters is the smallest change that
 * makes the result parse as the one link that was meant.
 *
 * Nothing here is a security control. The renderer follows only site-relative
 * hrefs — `app/components/prose.tsx` turns anything not starting with `/` into
 * plain text rather than a link — so a `javascript:` href is already inert, and
 * pretending this function is what stops it would put the guarantee in the
 * wrong place.
 */
export function safeHref(href: string): string {
  return href
    .trim()
    .replace(/ /g, "%20")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

/** What the link action writes when there is nothing selected to label. */
export const LINK_PLACEHOLDER = "link text";

/**
 * Wraps the selection in a link, or writes a labelled one where the caret is.
 *
 * The returned selection covers the label rather than the whole construct, so
 * the placeholder can be typed straight over and a real label is left
 * highlighted for a second thought. Nothing here toggles a link back off:
 * unlinking is one keystroke of undo away, and a "remove this link" action
 * would have to guess which of the brackets around the caret the author meant.
 */
export function insertLink(state: EditorSelection, href: string): EditorSelection {
  const { text } = state;
  const { start, end } = normalise(state);
  const selected = text.slice(start, end);
  const label = selected === "" ? LINK_PLACEHOLDER : selected;
  const target = safeHref(href);

  return {
    text: `${text.slice(0, start)}[${label}](${target})${text.slice(end)}`,
    start: start + 1,
    end: start + 1 + label.length,
  };
}

/** The block markers on one line, taken apart so they can be put back. */
interface LineParts {
  quoted: boolean;
  marker: "bullet" | "ordered" | null;
  heading: number;
  content: string;
}

function readLine(line: string): LineParts {
  let rest = line;

  const quote = /^>\s?/.exec(rest);
  const quoted = quote !== null;
  if (quote) rest = rest.slice(quote[0].length);

  const headingMatch = /^(#{1,6})\s+/.exec(rest);
  const heading = headingMatch ? headingMatch[1].length : 0;
  if (headingMatch) rest = rest.slice(headingMatch[0].length);

  let marker: "bullet" | "ordered" | null = null;
  const bullet = /^[-*+]\s+/.exec(rest);
  const ordered = bullet ? null : /^\d+[.)]\s+/.exec(rest);
  if (bullet) {
    marker = "bullet";
    rest = rest.slice(bullet[0].length);
  } else if (ordered) {
    marker = "ordered";
    rest = rest.slice(ordered[0].length);
  }

  return { quoted, marker, heading, content: rest };
}

function writeLine(parts: LineParts, ordinal: number): string {
  const prefix =
    (parts.quoted ? "> " : "") +
    (parts.heading > 0 ? `${"#".repeat(parts.heading)} ` : "") +
    (parts.marker === "bullet" ? "- " : parts.marker === "ordered" ? `${ordinal}. ` : "");

  // A prefix with nothing after it is still a real line — an empty list item
  // the author is about to type into — but it must not carry a trailing space,
  // because the parser trims and a line of pure whitespace reads as a blank.
  return parts.content === "" ? prefix.trimEnd() : prefix + parts.content;
}

/** Grows a selection to cover every line it touches, and reports the bounds. */
function lineSpan(text: string, start: number, end: number) {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = text.indexOf("\n", end);
  const to = lineEnd === -1 ? text.length : lineEnd;
  return { from, to, lines: text.slice(from, to).split("\n") };
}

/**
 * Rewrites the touched lines and keeps the selection over them.
 *
 * Every line-level action ends the same way — replace a run of lines, then put
 * the selection back around the run — and getting that ending subtly wrong is
 * how a toolbar loses somebody's place mid-paragraph.
 */
function replaceLines(
  text: string,
  from: number,
  to: number,
  lines: string[],
): EditorSelection {
  const written = lines.join("\n");
  return {
    text: text.slice(0, from) + written + text.slice(to),
    start: from,
    end: from + written.length,
  };
}

/**
 * Lists and block quotes, over every line the selection touches.
 *
 * Two rules, and both come from what the parser does rather than from taste.
 *
 * The list markers *replace* each other. `- a` and `1. a` are alternative
 * spellings of the same block and `- 1. a` is neither, so asking for a numbered
 * list while sitting on a bullet must swap the marker, not prepend one.
 *
 * Quoting is independent of them, because the parser strips `>` and re-parses
 * the remainder as blocks — so `> - a` really is a quoted list and really does
 * render as one. That is the only nesting this dialect has, and it is worth
 * keeping.
 *
 * Toggling off happens only when every line the selection touches already
 * carries the marker. Half a paragraph in a list is far more likely to be
 * somebody finishing the job than somebody undoing it.
 */
export function toggleLineStyle(
  state: EditorSelection,
  style: LineStyle,
): EditorSelection {
  const { text } = state;
  const { start, end } = normalise(state);
  const { from, to, lines } = lineSpan(text, start, end);
  const parsed = lines.map(readLine);

  // Blank lines are carried along but never consulted. A selection dragged one
  // line too far picks up the empty line after a paragraph, and letting that
  // line vote would flip "these are all already bullets" to false for a reason
  // the author cannot see.
  const meaningful = parsed.filter((parts) => parts.content !== "");
  const already =
    meaningful.length > 0 &&
    meaningful.every((parts) => (style === "quote" ? parts.quoted : parts.marker === style));

  let ordinal = 0;
  const written = parsed.map((parts) => {
    if (parts.content === "") return writeLine(parts, 0);

    const next: LineParts =
      style === "quote"
        ? { ...parts, quoted: !already }
        : { ...parts, marker: already ? null : style };

    if (next.marker === "ordered") ordinal += 1;
    return writeLine(next, ordinal);
  });

  return replaceLines(text, from, to, written);
}

/**
 * Sets — or, asked for the depth a line already has, clears — the heading on
 * every line the selection touches.
 *
 * A heading is a whole block, so any list marker on the line goes with it.
 * There is nothing to preserve: `# - a` is a heading whose text begins with a
 * hyphen, which is not what anybody pressing this button wants.
 */
export function setHeading(
  state: EditorSelection,
  depth: HeadingDepth,
): EditorSelection {
  const { text } = state;
  const { start, end } = normalise(state);
  const { from, to, lines } = lineSpan(text, start, end);
  const parsed = lines.map(readLine);

  const meaningful = parsed.filter((parts) => parts.content !== "");
  const already =
    depth > 0 &&
    meaningful.length > 0 &&
    meaningful.every((parts) => parts.heading === depth);
  const target = already ? 0 : depth;

  const written = parsed.map((parts) =>
    parts.content === ""
      ? writeLine(parts, 0)
      : writeLine(
          { ...parts, heading: target, marker: target > 0 ? null : parts.marker },
          1,
        ),
  );

  return replaceLines(text, from, to, written);
}

/**
 * Drops a block in at the caret with the blank lines it needs around it.
 *
 * The parser ends a paragraph at a blank line or at the start of another
 * block, and a table's header row is only a header when a divider follows it —
 * so a skeleton pasted onto the end of a sentence has to be separated from it
 * or the whole thing is one paragraph. Counting the newlines already there
 * rather than always adding two keeps repeated insertions from marching the
 * document down the page.
 */
function insertBlock(
  state: EditorSelection,
  block: string,
  /** Where the caret should land, as an offset into `block`. */
  select: { start: number; end: number },
): EditorSelection {
  const { text } = state;
  const { start, end } = normalise(state);

  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before === "" ? "" : "\n\n".slice(0, Math.max(0, 2 - trailingNewlines(before)));
  const tail = after === "" ? "\n" : "\n\n".slice(0, Math.max(0, 2 - leadingNewlines(after)));

  const at = before.length + lead.length;
  return {
    text: before + lead + block + tail + after,
    start: at + select.start,
    end: at + select.end,
  };
}

function trailingNewlines(text: string): number {
  return /\n*$/.exec(text)![0].length;
}

function leadingNewlines(text: string): number {
  return /^\n*/.exec(text)![0].length;
}

/** A horizontal rule, on a line of its own. */
export function insertRule(state: EditorSelection): EditorSelection {
  return insertBlock(state, "---", { start: 3, end: 3 });
}

/** The first header cell's placeholder, so the caret can land on it. */
const FIRST_HEADER = "Column 1";

/**
 * A table skeleton: a header row, the divider that makes it one, and empty
 * body rows.
 *
 * The most-requested thing in this dialect and the worst to type, because a
 * pipe table is the one construct where getting a single character wrong turns
 * the whole block into a paragraph of punctuation. Laying down a correct one is
 * where the value is; editing it afterwards is ordinary text editing and does
 * not need a grid widget with a column-resize handle.
 *
 * Body cells are left empty rather than filled with `Cell 1`. An author
 * deleting placeholder text out of twelve cells is worse off than one typing
 * into twelve empty ones, and the preview shows an empty row honestly.
 *
 * The selection lands on the first header's placeholder, so the first thing
 * typed replaces it and the tab-less rhythm of filling a table starts
 * immediately.
 */
export function insertTable(
  state: EditorSelection,
  columns = 3,
  rows = 2,
): EditorSelection {
  const columnCount = Math.max(1, Math.floor(columns));
  const rowCount = Math.max(1, Math.floor(rows));

  const headers = Array.from({ length: columnCount }, (_, index) =>
    index === 0 ? FIRST_HEADER : `Column ${index + 1}`,
  );
  const header = `| ${headers.join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = Array.from(
    { length: rowCount },
    () => `|${headers.map(() => "   ").join("|")}|`,
  );

  const block = [header, divider, ...body].join("\n");
  const at = header.indexOf(FIRST_HEADER);
  return insertBlock(state, block, { start: at, end: at + FIRST_HEADER.length });
}
