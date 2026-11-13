import { useMemo, type ReactNode } from 'react';

import { parseFormatting, type FormatNode } from '@/lib/inbox/format-text';

function renderNodes(nodes: FormatNode[]): ReactNode[] {
  return nodes.map((node, i) => {
    if (typeof node === 'string') return node;
    switch (node.type) {
      case 'quote':
        return (
          <span
            key={i}
            className="text-muted-foreground my-1 block border-l-2 border-current/30 pl-3"
          >
            {renderNodes(node.children)}
          </span>
        );
      case 'bullet':
      case 'numbered':
        return (
          <span key={i} className="flex gap-2">
            <span className="shrink-0 tabular-nums">
              {node.type === 'bullet' ? '•' : `${node.number}.`}
            </span>
            <span>{renderNodes(node.children)}</span>
          </span>
        );
      case 'bold':
        return <strong key={i}>{renderNodes(node.children)}</strong>;
      case 'italic':
        return <em key={i}>{renderNodes(node.children)}</em>;
      case 'strike':
        return <s key={i}>{renderNodes(node.children)}</s>;
      case 'code':
        return (
          <code
            key={i}
            className="rounded bg-black/10 px-1 font-mono text-[0.9em] dark:bg-white/10"
          >
            {renderNodes(node.children)}
          </code>
        );
      case 'codeblock':
        return (
          <code
            key={i}
            className="my-1 block rounded bg-black/10 px-2 py-1 font-mono text-[0.9em] dark:bg-white/10"
          >
            {node.text}
          </code>
        );
      case 'link':
        return (
          <a
            key={i}
            href={node.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:opacity-80"
          >
            {node.url}
          </a>
        );
    }
  });
}

/** Message text with WhatsApp formatting and clickable links. */
export function FormattedText({ text }: { text: string }) {
  const nodes = useMemo(() => parseFormatting(text), [text]);
  return <>{renderNodes(nodes)}</>;
}
