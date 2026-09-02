/**
 * The editor, and the one property that matters most about the preview.
 *
 * A preview with its own parser is the bug this project keeps meeting: two
 * implementations that agree with each other and not with the site. So the
 * first two tests below are structural rather than cosmetic — one proves the
 * blocks on screen came out of `parseMarkdown` and nowhere else, the other
 * proves the preview behaves like the real renderer on the two cases where a
 * general-purpose markdown parser would disagree with this dialect.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Prose } from "~/components/prose";
import { MarkdownEditor } from "./prose-editor";

/**
 * A recording wrapper around the site's parser, not a replacement for it.
 *
 * Every test but one runs the real `parseMarkdown`, so the preview is exercised
 * as it ships. `sentinel`, when a test sets it, makes the parser return blocks
 * that no markdown could have produced — which is what turns "the preview shows
 * the right words" into "the preview shows what this function returned".
 */
const parser = vi.hoisted(() => ({
  calls: [] as string[],
  sentinel: null as unknown,
}));

vi.mock("~/content/markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/content/markdown")>();
  return {
    ...actual,
    parseMarkdown: (source: string) => {
      parser.calls.push(source);
      return parser.sentinel ?? actual.parseMarkdown(source);
    },
  };
});

afterEach(() => {
  parser.calls = [];
  parser.sentinel = null;
});

/**
 * The editor inside a router, held by a parent that owns the value.
 *
 * The router is not ceremony: `Prose` renders site-relative links as
 * `<Link>`, so a preview containing a cross-reference cannot mount without
 * one. The parent state is not ceremony either — the text area is controlled,
 * and a test that let the component keep its own value would be testing a
 * component that does not exist.
 */
function renderEditor(initial = "", options: { disabled?: boolean } = {}) {
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <>
        <label htmlFor="body">Description</label>
        <MarkdownEditor
          id="body"
          label="Description"
          value={value}
          onChange={setValue}
          disabled={options.disabled ?? false}
          describedBy={undefined}
          invalid={false}
        />
      </>
    );
  }

  const Stub = createRoutesStub([{ path: "/", Component: Harness }]);
  const result = render(<Stub initialEntries={["/"]} />);
  return {
    ...result,
    area: screen.getByLabelText("Description") as HTMLTextAreaElement,
    user: userEvent.setup(),
  };
}

/** Selects `needle` in the text area, the way a double-click would. */
function select(area: HTMLTextAreaElement, needle: string) {
  const start = area.value.indexOf(needle);
  area.focus();
  area.setSelectionRange(start, start + needle.length);
}

describe("the preview", () => {
  it("draws whatever the site's parser returns, and nothing of its own", async () => {
    const { user, container } = renderEditor("anything at all");
    parser.sentinel = [
      { kind: "paragraph", children: [{ kind: "text", value: "returned by parseMarkdown" }] },
    ];

    await user.click(screen.getByRole("button", { name: "Preview — Description" }));

    // These words are in no markdown anywhere. Their presence is only possible
    // if the blocks on screen are the ones `parseMarkdown` handed back — and
    // the field's own text being absent from the preview is what rules out a
    // second parser quietly producing the same thing.
    const preview = container.querySelector(".authoring-preview")!;
    expect(within(preview as HTMLElement).getByText("returned by parseMarkdown"))
      .toBeInTheDocument();
    expect(preview.textContent).not.toContain("anything at all");
    expect(parser.calls).toContain("anything at all");
  });

  it("agrees with the published renderer on what this dialect does not have", async () => {
    // Two cases where a general-purpose markdown parser would disagree with
    // this one: there are no nested lists, and a link off this site is not a
    // link. A preview carrying its own parser fails both.
    const markdown = "- outer\n  - not nested\n\n[Reference](https://example.com/x)";
    const { user, container } = renderEditor(markdown);
    await user.click(screen.getByRole("button", { name: "Preview — Description" }));

    const preview = container.querySelector(".authoring-preview .prose-body")!;
    expect(preview.querySelectorAll("ul")).toHaveLength(1);
    expect(preview.querySelectorAll("li")).toHaveLength(2);
    expect(preview.querySelectorAll("a")).toHaveLength(0);
    expect(preview.textContent).toContain("Reference");

    const Stub = createRoutesStub([
      { path: "/", Component: () => <Prose markdown={markdown} startLevel={3} /> },
    ]);
    const published = render(<Stub initialEntries={["/"]} />);
    expect(preview.innerHTML).toBe(
      published.container.querySelector(".prose-body")!.innerHTML,
    );
  });

  it("stays closed until it is asked for", () => {
    const { container } = renderEditor("# Combat");
    expect(container.querySelector(".authoring-preview")).toBeNull();
    expect(screen.getByRole("button", { name: "Preview — Description" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("the toolbar", () => {
  it("names every control after the field it belongs to", () => {
    renderEditor();
    const toolbar = screen.getByRole("toolbar", { name: "Formatting — Description" });
    const names = within(toolbar)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));

    expect(names).toEqual([
      "Bold — Description",
      "Italic — Description",
      "Heading 1 — Description",
      "Heading 2 — Description",
      "Heading 3 — Description",
      "Bullets — Description",
      "Numbers — Description",
      "Quote — Description",
      "Rule — Description",
      "Table — Description",
      "Link — Description",
      "Preview — Description",
    ]);
  });

  it("holds one tab stop and moves between its controls with the arrow keys", async () => {
    const { user } = renderEditor();
    const bold = screen.getByRole("button", { name: "Bold — Description" });
    const italic = screen.getByRole("button", { name: "Italic — Description" });
    const preview = screen.getByRole("button", { name: "Preview — Description" });

    expect(bold).toHaveAttribute("tabindex", "0");
    expect(italic).toHaveAttribute("tabindex", "-1");

    await user.tab();
    expect(bold).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(italic).toHaveFocus();
    expect(italic).toHaveAttribute("tabindex", "0");
    expect(bold).toHaveAttribute("tabindex", "-1");

    await user.keyboard("{End}");
    expect(preview).toHaveFocus();

    await user.keyboard("{Home}");
    expect(bold).toHaveFocus();

    // One more press than there are controls, to prove the ends join up rather
    // than trapping focus on the last one.
    await user.keyboard("{ArrowLeft}");
    expect(preview).toHaveFocus();
  });

  it("wraps the selection in bold and puts the caret back around the words", async () => {
    const { user, area } = renderEditor("the rules text");
    select(area, "rules");

    await user.click(screen.getByRole("button", { name: "Bold — Description" }));

    expect(area.value).toBe("the **rules** text");
    expect(area.value.slice(area.selectionStart, area.selectionEnd)).toBe("rules");
  });

  it("takes bold back off the second time", async () => {
    const { user, area } = renderEditor("the rules text");
    select(area, "rules");
    const bold = screen.getByRole("button", { name: "Bold — Description" });

    await user.click(bold);
    await user.click(bold);

    expect(area.value).toBe("the rules text");
  });

  it("turns the selected lines into a numbered list", async () => {
    const { user, area } = renderEditor("first\nsecond");
    area.focus();
    area.setSelectionRange(0, area.value.length);

    await user.click(screen.getByRole("button", { name: "Numbers — Description" }));

    expect(area.value).toBe("1. first\n2. second");
  });

  it("lays down a table skeleton with its first header selected", async () => {
    const { user, area } = renderEditor("");

    await user.click(screen.getByRole("button", { name: "Table — Description" }));

    expect(area.value).toContain("| Column 1 | Column 2 | Column 3 |");
    expect(area.value).toContain("| --- | --- | --- |");
    expect(area.value.slice(area.selectionStart, area.selectionEnd)).toBe("Column 1");
  });

  it("does nothing at all when the field is disabled", async () => {
    const { user, area } = renderEditor("the rules text", { disabled: true });
    const bold = screen.getByRole("button", { name: "Bold — Description" });

    expect(bold).toBeDisabled();
    await user.click(bold);
    expect(area.value).toBe("the rules text");
  });
});

describe("keyboard shortcuts", () => {
  it("bolds the selection on Ctrl+B", async () => {
    const { user, area } = renderEditor("the rules text");
    select(area, "rules");

    await user.keyboard("{Control>}b{/Control}");

    expect(area.value).toBe("the **rules** text");
  });

  it("italicises the selection on Cmd+I, for a Mac keyboard", async () => {
    const { user, area } = renderEditor("the rules text");
    select(area, "rules");

    await user.keyboard("{Meta>}i{/Meta}");

    expect(area.value).toBe("the *rules* text");
  });

  it("opens the link panel on Ctrl+K", async () => {
    const { user, area } = renderEditor("see the rules");
    select(area, "rules");

    await user.keyboard("{Control>}k{/Control}");

    expect(screen.getByLabelText("Address")).toBeInTheDocument();
  });
});

describe("the link panel", () => {
  it("wraps the selection in a link to the address given", async () => {
    const { user, area } = renderEditor("see the rules");
    select(area, "rules");

    await user.click(screen.getByRole("button", { name: "Link — Description" }));
    await user.type(screen.getByLabelText("Address"), "/rules/combat");
    await user.click(screen.getByRole("button", { name: "Insert link" }));

    expect(area.value).toBe("see the [rules](/rules/combat)");
    expect(screen.queryByLabelText("Address")).not.toBeInTheDocument();
  });

  it("leaves the text alone when it is cancelled", async () => {
    const { user, area } = renderEditor("see the rules");
    select(area, "rules");

    await user.click(screen.getByRole("button", { name: "Link — Description" }));
    await user.type(screen.getByLabelText("Address"), "/rules/combat");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(area.value).toBe("see the rules");
    expect(screen.queryByLabelText("Address")).not.toBeInTheDocument();
  });
});
