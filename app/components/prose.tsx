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
   * Names the headings so they can be linked to.
   *
   * Passed in rather than made here, because uniqueness has to hold across the
   * whole page and a page can contain several of these — an item renders one
   * per section and one per entry. A slugger of its own per instance would
   * hand out `resting` three times over, every link to any of them would land
   * on the first, and the duplicate `id`s would break `aria-labelledby` on the
   * rest.
   *
   * Omitting it is the right thing for a preview or a diff, where the markdown
   * is not part of a published page and an address for it would be a promise
   * nothing keeps.
   */
  slugger?: (label: string) => string;
}

export function Prose({ markdown, startLevel = 2, className, slugger }: ProseProps) {
  const blocks = parseMarkdown(markdown);
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
          slugger={slugger}
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
  slugger,
}: {
  node: BlockNode;
  startLevel: number;
  shallowest: number;
  slugger?: (label: string) => string;
}) {
  switch (node.kind) {
    case "heading": {
      const level = Math.min(6, startLevel + (node.depth - shallowest));
      const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6";
      const text = plainText(node.children);
      const id = slugger?.(text);

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
              slugger={slugger}
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
