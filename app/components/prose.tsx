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
}

export function Prose({ markdown, startLevel = 2, className }: ProseProps) {
  const blocks = parseMarkdown(markdown);
  const shallowest = blocks.reduce(
    (depth, block) => (block.kind === "heading" ? Math.min(depth, block.depth) : depth),
    6,
  );

  return (
    <div className={className ? `prose-body ${className}` : "prose-body"}>
      {blocks.map((block, index) => (
        <Block key={index} node={block} startLevel={startLevel} shallowest={shallowest} />
      ))}
    </div>
  );
}

function Block({
  node,
  startLevel,
  shallowest,
}: {
  node: BlockNode;
  startLevel: number;
  shallowest: number;
}) {
  switch (node.kind) {
    case "heading": {
      const level = Math.min(6, startLevel + (node.depth - shallowest));
      const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <Tag>
          <Inline nodes={node.children} />
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
