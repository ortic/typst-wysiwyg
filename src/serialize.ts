// Serialize a ProseMirror document (the content layer) to Typst markup.
// One-way only. Unknown nodes fall back to their text content so serialization
// never throws.

import type { Node as PMNode, Mark } from '@tiptap/pm/model';

/** Escape text for Typst MARKUP mode so it renders literally. */
export function escapeMarkup(s: string): string {
  return s.replace(/([\\#$*_`<>@~])/g, '\\$1');
}

function quote(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** Apply inline marks to a single text run. */
function applyMarks(text: string, marks: readonly Mark[]): string {
  // `code` is verbatim (raw) — don't escape, don't add other markup.
  if (marks.some((m) => m.type.name === 'code')) {
    return '`' + text + '`';
  }
  let t = escapeMarkup(text);
  let href: string | null = null;
  for (const m of marks) {
    switch (m.type.name) {
      case 'bold': t = `*${t}*`; break;
      case 'italic': t = `_${t}_`; break;
      case 'strike': t = `#strike[${t}]`; break;
      case 'link': href = (m.attrs.href as string) ?? null; break;
    }
  }
  if (href) t = `#link(${quote(href)})[${t}]`;
  return t;
}

/** Serialize inline content (text + hardBreaks) of a block node. */
function inline(node: PMNode): string {
  let out = '';
  node.forEach((child) => {
    if (child.isText) out += applyMarks(child.text ?? '', child.marks);
    else if (child.type.name === 'hardBreak') out += ' \\\n';
    else out += inline(child); // defensive
  });
  return out;
}

function indentLines(s: string, pad: string): string {
  return s
    .split('\n')
    .map((l) => (l.length ? pad + l : l))
    .join('\n');
}

function serializeList(node: PMNode, marker: string, depth: number): string {
  const pad = '  '.repeat(depth);
  const lines: string[] = [];
  node.forEach((item) => {
    // A listItem holds a paragraph (its text) and optionally nested lists.
    let leadDone = false;
    item.forEach((child) => {
      const name = child.type.name;
      if (name === 'bulletList' || name === 'orderedList') {
        lines.push(serializeList(child, name === 'orderedList' ? '+' : '-', depth + 1));
      } else if (!leadDone) {
        lines.push(`${pad}${marker} ${inline(child)}`);
        leadDone = true;
      } else {
        lines.push(`${pad}  ${inline(child)}`);
      }
    });
  });
  return lines.join('\n');
}

function serializeBlock(node: PMNode): string {
  switch (node.type.name) {
    case 'heading':
      return `${'='.repeat(node.attrs.level as number)} ${inline(node)}`;
    case 'paragraph':
      return inline(node);
    case 'bulletList':
      return serializeList(node, '-', 0);
    case 'orderedList':
      return serializeList(node, '+', 0);
    case 'blockquote':
      return `#quote(block: true)[${childrenJoined(node, ' ')}]`;
    case 'codeBlock':
      return node.textContent; // raw Typst escape hatch — verbatim
    case 'horizontalRule':
      return '#line(length: 100%)';
    case 'callout': {
      const inner = childrenBlocks(node).join('\n\n');
      return `#callout[\n${indentLines(inner, '  ')}\n]`;
    }
    default:
      return inline(node);
  }
}

function childrenBlocks(node: PMNode): string[] {
  const out: string[] = [];
  node.forEach((child) => out.push(serializeBlock(child)));
  return out;
}
function childrenJoined(node: PMNode, sep: string): string {
  return childrenBlocks(node).join(sep);
}

/** Serialize the whole document: top-level blocks separated by blank lines. */
export function serializeContent(doc: PMNode): string {
  return childrenBlocks(doc).join('\n\n');
}
