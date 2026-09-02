/**
 * A markdown field: a toolbar, the text, and the site's own renderer showing
 * what a reader will get.
 *
 * ## Why this is not a WYSIWYG editor
 *
 * The obvious answer to "authors should not have to remember markdown" is a
 * contenteditable surface, and it is the wrong one here, for three reasons
 * that are not matters of taste.
 *
 * The stored value is markdown in the dialect `app/content/markdown.ts`
 * parses, and that parser has no images, no code, no raw HTML, no nesting and
 * no escape character. Every general-purpose rich text editor emits at least
 * one of those the first time somebody pastes from a browser, and there is no
 * renderer on this site that could draw the result. The corruption would be
 * silent and it would be stored.
 *
 * The site's Content-Security-Policy names no external host, so a CDN-hosted
 * editor cannot load at all; anything used here has to be bundled. That rules
 * out reaching for one casually, and paying the bundle cost of a real one
 * buys a feature set the renderer would then have to refuse most of.
 *
 * And a WYSIWYG surface owns the document. What it does not understand it
 * either drops or mangles on the way in — which for a corpus written by hand
 * over years, with pipe tables and cross-reference links in it, means every
 * document that is merely *opened* comes back different. The editor here
 * cannot do that: it only ever splices strings into text the author can see.
 *
 * So: a toolbar that writes the markdown, and a preview that proves it. The
 * preview is `app/components/prose.tsx`, the same component the reference
 * pages use, so it renders through `parseMarkdown` and there is no second
 * implementation to drift from the first. That has bitten this project before
 * — two implementations agreeing with each other and not with reality — and a
 * preview is exactly the place it would happen again.
 *
 * ## The preview is off until it is asked for
 *
 * A class document has six markdown fields and a forty-row progression. Six
 * always-open previews double the height of the form and push the fields that
 * are actually being edited off the screen. It is per-field, one keystroke
 * away, and remembers nothing — which is right, because the question it
 * answers ("did that table come out as a table?") is asked at a moment, not
 * for a session.
 */

import { useLayoutEffect, useRef, useState } from "react";

import { Prose } from "~/components/prose";
import {
  insertLink,
  insertRule,
  insertTable,
  setHeading,
  toggleEmphasis,
  toggleLineStyle,
  type EditorSelection,
} from "./markdown-editing";

/** A formatting action, as the toolbar needs to draw and run it. */
interface ToolbarAction {
  /** The visible text, and the start of the accessible name. */
  label: string;
  /** Spelt out for a pointer, where the shortcut is worth advertising. */
  hint?: string;
  run: (state: EditorSelection) => EditorSelection;
}

/**
 * What the toolbar offers, in order.
 *
 * Everything the dialect has and nothing it does not. There is no image
 * button, no code button and no strike-through button, because there is no
 * renderer for any of them — see the header of `markdown-editing.ts`.
 *
 * Three heading levels rather than six. The corpus writes its sections at one
 * or two depths and `Prose` re-maps whatever it finds onto the page's outline,
 * so the deeper three would be levels nobody uses, occupying a third of the
 * toolbar.
 */
const ACTIONS: readonly ToolbarAction[] = [
  { label: "Bold", hint: "Bold (Ctrl+B)", run: (state) => toggleEmphasis(state, 2) },
  { label: "Italic", hint: "Italic (Ctrl+I)", run: (state) => toggleEmphasis(state, 1) },
  { label: "Heading 1", run: (state) => setHeading(state, 1) },
  { label: "Heading 2", run: (state) => setHeading(state, 2) },
  { label: "Heading 3", run: (state) => setHeading(state, 3) },
  { label: "Bullets", run: (state) => toggleLineStyle(state, "bullet") },
  { label: "Numbers", run: (state) => toggleLineStyle(state, "ordered") },
  { label: "Quote", run: (state) => toggleLineStyle(state, "quote") },
  { label: "Rule", run: insertRule },
  { label: "Table", run: (state) => insertTable(state) },
];

export interface MarkdownEditorProps {
  /** The id of the text area, so the field's own `<label>` reaches it. */
  id: string;
  /**
   * What this field is called.
   *
   * Not decoration: it is appended to every control's accessible name. A class
   * document draws six of these, and without it a screen reader listing the
   * page's controls reads "Bold, Italic, Link, Bold, Italic, Link, …" sixty
   * times over with no way to tell which field any of them belongs to. The
   * list controls in `app/authoring/form.tsx` name themselves the same way for
   * the same reason.
   */
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  describedBy: string | undefined;
  invalid: boolean;
}

export function MarkdownEditor({
  id,
  label,
  value,
  onChange,
  disabled,
  describedBy,
  invalid,
}: MarkdownEditorProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  /**
   * Where the caret goes once the new text has been rendered.
   *
   * The text area is controlled, so an action cannot move the caret itself:
   * the new value has to travel up to the document and back down before the
   * DOM holds the text the caret is being positioned within. Setting the
   * selection before that lands puts it at an offset into the *old* string,
   * which is how a bold button ends up dropping the caret three characters
   * short every time.
   */
  const pendingSelection = useRef<EditorSelection | null>(null);

  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");

  const [previewOpen, setPreviewOpen] = useState(false);
  const previewId = `${id}-preview`;

  /** Which toolbar button holds the single tab stop. See `onToolbarKeyDown`. */
  const [rover, setRover] = useState(0);

  useLayoutEffect(() => {
    const next = pendingSelection.current;
    // Cleared unconditionally. A pending selection that no longer matches the
    // text belongs to an edit that never arrived — the document rejected it,
    // or something else wrote over it — and holding on to it would move
    // somebody's caret at an unrelated moment later on.
    pendingSelection.current = null;
    if (!next) return;

    const area = areaRef.current;
    if (!area || area.value !== next.text) return;
    area.focus();
    area.setSelectionRange(next.start, next.end);
  });

  function apply(action: (state: EditorSelection) => EditorSelection) {
    const area = areaRef.current;
    if (!area || disabled) return;

    const next = action({
      text: area.value,
      start: area.selectionStart,
      end: area.selectionEnd,
    });

    // A toggle that changed nothing but the selection — pressing Bold with an
    // empty document, say — produces no re-render to wait for, so the caret is
    // placed here. Left to the effect it would sit until some unrelated render
    // came along.
    if (next.text === area.value) {
      area.focus();
      area.setSelectionRange(next.start, next.end);
      return;
    }

    pendingSelection.current = next;
    onChange(next.text);
  }

  function openLink() {
    if (disabled) return;
    setHref("");
    setLinkOpen(true);
  }

  function commitLink() {
    const target = href.trim();
    if (target === "") return;
    apply((state) => insertLink(state, target));
    setLinkOpen(false);
    setHref("");
  }

  /**
   * One tab stop for the whole strip, arrows to move within it.
   *
   * This is the toolbar pattern rather than eleven plain buttons because of
   * arithmetic: a class document draws six markdown fields, and eleven buttons
   * each in the tab order would put sixty-six presses of Tab between the first
   * field and the second. Somebody navigating by keyboard would be right to
   * call that unusable. `role="toolbar"` is what promises a screen reader
   * user the arrow keys will work, so the role and this handler have to ship
   * together — the role without the behaviour is a lie told in ARIA.
   *
   * The buttons are found in the DOM rather than collected into an array of
   * refs as they render. One ref for the strip is less to keep in step than
   * twelve for its contents, and document order is the order the arrows should
   * follow by definition — so there is no second list that can disagree with
   * what is on the screen.
   */
  function onToolbarKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const buttons = Array.from(toolbar.querySelectorAll("button"));
    if (buttons.length === 0) return;

    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    let next: number | null = null;

    if (step !== 0) next = (rover + step + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;

    if (next === null) return;
    event.preventDefault();
    setRover(next);
    buttons[next].focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl on Windows and Linux, Cmd on macOS. Testing both rather than
    // sniffing the platform: a Mac keyboard on a Linux desktop maps the key it
    // is under, and either modifier means the same thing here.
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

    const key = event.key.toLowerCase();
    if (key === "b") {
      event.preventDefault();
      apply((state) => toggleEmphasis(state, 2));
    } else if (key === "i") {
      event.preventDefault();
      apply((state) => toggleEmphasis(state, 1));
    } else if (key === "k") {
      event.preventDefault();
      openLink();
    }
  }

  const buttonProps = (index: number) => ({
    type: "button" as const,
    className: "authoring-tool",
    disabled,
    tabIndex: index === rover ? 0 : -1,
    // Focus arriving by any other route — a click, a Tab from the field above
    // — moves the tab stop with it, so the next Tab leaves the toolbar rather
    // than jumping back to a button nobody is looking at.
    onFocus: () => setRover(index),
  });

  const linkIndex = ACTIONS.length;
  const previewIndex = ACTIONS.length + 1;

  return (
    <div className="authoring-editor">
      <div
        ref={toolbarRef}
        role="toolbar"
        className="authoring-toolbar"
        aria-label={`Formatting — ${label}`}
        onKeyDown={onToolbarKeyDown}
      >
        {ACTIONS.map((action, index) => (
          <button
            key={action.label}
            {...buttonProps(index)}
            // The visible word opens the accessible name, so somebody driving
            // this by voice can say what they can read.
            aria-label={`${action.label} — ${label}`}
            title={action.hint}
            onClick={() => apply(action.run)}
          >
            {action.label}
          </button>
        ))}

        <button
          {...buttonProps(linkIndex)}
          aria-label={`Link — ${label}`}
          aria-expanded={linkOpen}
          title="Link (Ctrl+K)"
          onClick={() => (linkOpen ? setLinkOpen(false) : openLink())}
        >
          Link
        </button>

        <button
          {...buttonProps(previewIndex)}
          className="authoring-tool authoring-tool-preview"
          aria-label={`Preview — ${label}`}
          aria-pressed={previewOpen}
          aria-controls={previewId}
          onClick={() => setPreviewOpen((open) => !open)}
        >
          Preview
        </button>
      </div>

      {linkOpen ? (
        /*
          A panel rather than `window.prompt`, which cannot be styled, cannot be
          read by assistive technology as part of this field, and cannot be
          driven by a test. Not a nested `<form>` either: the whole document is
          already inside one — see `DocumentForm` — and nesting forms is invalid
          markup that browsers repair by discarding the inner one.
        */
        <div className="authoring-link-panel">
          <label htmlFor={`${id}-href`}>Address</label>
          <input
            id={`${id}-href`}
            className="authoring-input"
            type="text"
            inputMode="url"
            autoFocus
            value={href}
            placeholder="/rules/combat"
            aria-describedby={`${id}-href-hint`}
            onChange={(event) => setHref(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitLink();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setLinkOpen(false);
                areaRef.current?.focus();
              }
            }}
          />
          <button type="button" className="button" onClick={commitLink}>
            Insert link
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setLinkOpen(false);
              areaRef.current?.focus();
            }}
          >
            Cancel
          </button>
          {/*
            Said here because the renderer's rule is invisible from inside the
            text area. `app/components/prose.tsx` follows site-relative links
            and renders anything else as bare words, so a pasted external
            address does not fail loudly — it just stops being a link. Better
            to say so before it is typed than to let the preview be the first
            anyone hears of it.
          */}
          <p className="auth-field-hint" id={`${id}-href-hint`}>
            A path within this site, such as <code>/rules/combat</code>. Links
            to other sites are not followed, so they are shown as plain text.
          </p>
        </div>
      ) : null}

      <textarea
        id={id}
        ref={areaRef}
        className="authoring-prose"
        value={value}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        rows={Math.min(24, Math.max(4, value.split("\n").length + 1))}
        onKeyDown={onKeyDown}
        onChange={(event) => onChange(event.target.value)}
      />

      {previewOpen ? (
        <div className="authoring-preview" id={previewId}>
          <p className="authoring-preview-label">Preview</p>
          {value.trim() === "" ? (
            <p className="auth-note">Nothing to show yet.</p>
          ) : (
            /*
              `startLevel` is 3 because this sits below the field's own label
              inside a page whose title is the `h1` and whose section headings
              are `h2`. It is not what a published page will use — the page
              decides that — and a preview cannot know, which is also why no
              heading ids are passed: an anchor here would be an address for
              something that does not exist yet.
            */
            <Prose markdown={value} startLevel={3} />
          )}
        </div>
      ) : null}
    </div>
  );
}
