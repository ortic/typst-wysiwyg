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
    case 'table':
      return serializeTable(node);
    default:
      return inline(node);
  }
}

/** A table cell's content as a Typst `[...]` (or `table.cell(..)[...]`) argument. */
function serializeCell(cell: PMNode, bold = false): string {
  const blocks = childrenBlocks(cell);
  let content = blocks.length === 1 ? blocks[0] : blocks.join('\n\n');
  if (bold && content.trim()) content = `*${content}*`; // match the editor's bold header
  const colspan = (cell.attrs.colspan as number) ?? 1;
  const rowspan = (cell.attrs.rowspan as number) ?? 1;
  if (colspan > 1 || rowspan > 1) {
    const spans: string[] = [];
    if (colspan > 1) spans.push(`colspan: ${colspan}`);
    if (rowspan > 1) spans.push(`rowspan: ${rowspan}`);
    return `table.cell(${spans.join(', ')})[${content}]`;
  }
  return `[${content}]`;
}

/**
 * Build the Typst `columns:` spec. We use fractional (`fr`) widths so the table
 * fills the page width like it does in the editor. Resized columns keep their
 * proportions; otherwise columns are equal (`1fr`).
 */
function tableColumns(firstRow: PMNode): string {
  const widths: (number | null)[] = [];
  firstRow.forEach((cell) => {
    const cw = cell.attrs.colwidth as number[] | null;
    const span = (cell.attrs.colspan as number) ?? 1;
    for (let i = 0; i < span; i++) widths.push(cw && cw[i] ? cw[i] : null);
  });
  const spec = widths.some((w) => w == null)
    ? widths.map(() => '1fr')
    : widths.map((w) => `${w}fr`);
  return `(${spec.join(', ')})`;
}

function isHeaderRow(row: PMNode): boolean {
  if (row.childCount === 0) return false;
  let all = true;
  row.forEach((cell) => { if (cell.type.name !== 'tableHeader') all = false; });
  return all;
}

function serializeTable(node: PMNode): string {
  const rows: PMNode[] = [];
  node.forEach((r) => rows.push(r));
  if (!rows.length) return '#table()';

  const headerFirst = isHeaderRow(rows[0]);

  // Styling chosen to match the editor: light-gray borders, the same cell
  // padding, and a gray fill behind a bold header row.
  const lines: string[] = [
    `#table(`,
    `  columns: ${tableColumns(rows[0])},`,
    `  stroke: 0.5pt + rgb("#cdd2dc"),`,
    `  inset: (x: 8pt, y: 5pt),`,
  ];
  if (headerFirst) lines.push(`  fill: (col, row) => if row == 0 { rgb("#f3f4f7") },`);

  rows.forEach((row, ri) => {
    const header = isHeaderRow(row);
    const cells: string[] = [];
    row.forEach((cell) => cells.push(serializeCell(cell, header)));
    // The first header row uses Typst's `table.header(...)` for proper semantics.
    if (header && ri === 0) lines.push(`  table.header(${cells.join(', ')}),`);
    else lines.push(`  ${cells.join(', ')},`);
  });
  lines.push(`)`);
  return lines.join('\n');
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
