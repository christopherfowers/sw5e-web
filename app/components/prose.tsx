/**
 * Renders corpus markdown as React elements.
 *
 * Two rules shape this component:
 *
 * - No HTML strings. The parser produces a node tree and this walks it, so
 *   `dangerouslySetInnerHTML` appears nowhere in the app and corpus text
 *   cannot inject markup.
 * - Heading depth is caller-controlled. The corpus starts its own headings at
 *   `###`, which would skip from an `<h1>` page title straight to `<h3>`.
 *   `startLevel` maps the corpus's first heading level onto the right element
 *   so the document outline stays contiguous.
 */

import { Link } from "react-router";

import { parseMarkdown, type BlockNode, type InlineNode } from "~/content/markdown";
import { SourceText } from "./source-text";

interface ProseProps {
  markdown: string;
  /** Element level for the shallowest heading in the markdown. */
  startLevel?: 2 | 3 | 4;
  className?: string;
  /**
   * The id for each heading in this markdown, in document order.
   *
   * Worked out before anything renders — see `app/content/headings.ts` — and
   * read here rather than generated here. Generating was the obvious design
   * and was wrong: uniqueness has to hold across a whole page, a page contains
   * several of these, and a shared name-generator makes rendering a mutation.
   * React renders a component more than once for the same state whenever it
   * likes, and when it did, every id on the page came out with `-2` on the end.
   *
   * Omitting it is right for a preview or a diff, where the markdown is not
   * part of a published page and an address for it would be a promise nothing
   * keeps.
   */
  headingIds?: readonly string[];
}

export function Prose({ markdown, startLevel = 2, className, headingIds }: ProseProps) {
  const blocks = parseMarkdown(markdown);

  // Headings are numbered as they are drawn, so the nth heading takes the nth
  // id. A counter rather than an index into `blocks`, because only headings
  // consume one.
  let headingsSeen = 0;
  const shallowest = blocks.reduce(
    (depth, block) => (block.kind === "heading" ? Math.min(depth, block.depth) : depth),
    6,
  );

  return (
    <div className={className ? `prose-body ${className}` : "prose-body"}>
      {blocks.map((block, index) => (
        <Block
          key={index}
          node={block}
          startLevel={startLevel}
          shallowest={shallowest}
          id={block.kind === "heading" ? headingIds?.[headingsSeen++] : undefined}
        />
      ))}
    </div>
  );
}

/** The plain text of an inline tree, for naming a heading. */
function plainText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
          return node.value;
        case "strong":
        case "emphasis":
        case "link":
          return plainText(node.children);
      }
    })
    .join("");
}

function Block({
  node,
  startLevel,
  shallowest,
  id,
}: {
  node: BlockNode;
  startLevel: number;
  shallowest: number;
  /** This heading's id, when it has one. Meaningless for any other block. */
  id?: string;
}) {
  switch (node.kind) {
    case "heading": {
      const level = Math.min(6, startLevel + (node.depth - shallowest));
      const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6";
      const text = plainText(node.children);

      return (
        /*
          The `aria-label` is not decoration. A link nested inside a heading
          contributes its own name to the heading's, so without this every
          heading on the page announced as "Benefits Link to Benefits" — the
          anchor made the outline it was meant to serve worse to listen to.
          Naming the heading explicitly pins it to the words a reader sees,
          and the anchor keeps its own name for when it is tabbed to.
        */
        <Tag id={id} aria-label={id ? text : undefined}>
          <Inline nodes={node.children} />
          {/*
            The reason any of this exists. A rules chapter carries forty-four
            headings and carried no way to address any of them: the only link
            anybody could send was the whole chapter, with "scroll down" after
            it. This is the affordance that turns a heading into something you
            can paste into a conversation.

            It is a real anchor rather than a copy-to-clipboard button, so it
            works without JavaScript, opens in a new tab if that is what
            somebody wants, and shows the address in the status bar on hover.
            The label says which section, because "Link to this section"
            repeated forty-four times is a screen reader reading out a list of
            identical links.
          */}
          {id ? (
            <a
              className="heading-anchor"
              href={`#${id}`}
              aria-label={`Link to ${text}`}
            >
              <span aria-hidden="true">#</span>
            </a>
          ) : null}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p>
          <Inline nodes={node.children} />
        </p>
      );
    case "list":
      return node.ordered ? (
        <ol>
          {node.items.map((item, index) => (
            <li key={index}>
              <Inline nodes={item} />
            </li>
          ))}
        </ol>
      ) : (
        <ul>
          {node.items.map((item, index) => (
            <li key={index}>
              <Inline nodes={item} />
            </li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote>
          {node.children.map((child, index) => (
            <Block
              key={index}
              node={child}
              startLevel={startLevel}
              shallowest={shallowest}
            />
          ))}
        </blockquote>
      );
    case "rule":
      return <hr />;
    case "table":
      return (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {node.header.map((cell, index) => (
                  <th key={index} scope="col">
                    <Inline nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      <Inline nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function Inline({ nodes }: { nodes: InlineNode[] }) {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        return <SourceText key={index} value={node.value} />;
      case "strong":
        return (
          <strong key={index}>
            <Inline nodes={node.children} />
          </strong>
        );
      case "emphasis":
        return (
          <em key={index}>
            <Inline nodes={node.children} />
          </em>
        );
      case "link":
        // Only site-relative links are followed. The corpus's cross-references
        // are rewritten to site routes by the dataset builder; anything else
        // would introduce a third-party origin, which this site does not have.
        return node.href.startsWith("/") ? (
          <Link key={index} to={node.href}>
            <Inline nodes={node.children} />
          </Link>
        ) : (
          <Inline key={index} nodes={node.children} />
        );
    }
  });
}
