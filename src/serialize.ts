// Serialize a ProseMirror document (the content layer) to Typst markup.
// One-way only. Unknown nodes fall back to their text content so serialization
// never throws.

import type { Node as PMNode, Mark } from '@tiptap/pm/model';

/** Escape text for Typst MARKUP mode so it renders literally. Brackets are
 *  escaped too so text never closes a surrounding content block ([...]). */
export function escapeMarkup(s: string): string {
  return s.replace(/([\\#$*_`<>@~[\]])/g, '\\$1');
}

function quote(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** A CSS color (hex or rgb()) -> a Typst color expression. */
function typstColor(v: string): string {
  const t = v.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(t)) return `rgb("${t}")`;
  const m = t.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const [r, g, b] = m[1].split(',').map((s) => Math.round(parseFloat(s.trim())));
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgb("${t}")`;
}

/** Apply inline marks to a single text run. */
function applyMarks(text: string, marks: readonly Mark[]): string {
  // `code` is verbatim (raw). Use backtick raw, but fall back to #raw() with a
  // quoted string when the text itself contains a backtick.
  if (marks.some((m) => m.type.name === 'code')) {
    return text.includes('`') ? `#raw(${quote(text)})` : '`' + text + '`';
  }
  let t = escapeMarkup(text);
  let href: string | null = null;
  let color: string | null = null;
  let highlight: string | null = null;
  let highlighted = false;
  for (const m of marks) {
    switch (m.type.name) {
      case 'bold': t = `*${t}*`; break;
      case 'italic': t = `_${t}_`; break;
      case 'strike': t = `#strike[${t}]`; break;
      case 'textStyle': if (m.attrs.color) color = m.attrs.color as string; break;
      case 'highlight': highlighted = true; highlight = (m.attrs.color as string) ?? null; break;
      case 'link': href = (m.attrs.href as string) ?? null; break;
    }
  }
  if (color) t = `#text(fill: ${typstColor(color)})[${t}]`;
  if (highlighted) t = highlight ? `#highlight(fill: ${typstColor(highlight)})[${t}]` : `#highlight[${t}]`;
  if (href) t = `#link(${quote(href)})[${t}]`;
  return t;
}

/** Serialize inline content (text + hardBreaks) of a block node. */
function inline(node: PMNode): string {
  let out = '';
  node.forEach((child) => {
    if (child.isText) out += applyMarks(child.text ?? '', child.marks);
    else if (child.type.name === 'hardBreak') out += ' \\\n';
    else if (child.type.name === 'footnote') out += `#footnote[${escapeMarkup((child.attrs.content as string) || '')}]`;
    else if (child.type.name === 'mathInline') out += `$${(child.attrs.src as string) || ''}$`;
    else if (child.type.name === 'reference') out += `@${(child.attrs.target as string) || ''}`;
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
    case 'heading': {
      const label = (node.attrs.label as string) || '';
      return `${'='.repeat(node.attrs.level as number)} ${inline(node)}${label ? ` <${label}>` : ''}`;
    }
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
    case 'codeListing': {
      const code = node.textContent;
      const lang = ((node.attrs.language as string) || '').trim();
      // Fence with one more backtick than the longest run inside the code.
      const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
      const fence = '`'.repeat(Math.max(3, longest + 1));
      return `${fence}${lang && lang !== 'text' ? lang : ''}\n${code}\n${fence}`;
    }
    case 'horizontalRule':
      return '#line(length: 100%)';
    case 'callout': {
      const inner = childrenBlocks(node).join('\n\n');
      return `#callout[\n${indentLines(inner, '  ')}\n]`;
    }
    case 'columns': {
      const inner = childrenBlocks(node).join('\n\n');
      return `#columns(${(node.attrs.count as number) ?? 2})[\n${indentLines(inner, '  ')}\n]`;
    }
    case 'table':
      return serializeTable(node);
    case 'image': {
      const path = (node.attrs.path as string) || (node.attrs.src as string) || '';
      if (!path || path.startsWith('data:')) return ''; // need a real VFS path
      const alt = (node.attrs.alt as string) || '';
      const width = (node.attrs.width as number) ?? 80;
      const border = node.attrs.border as boolean;
      let core = `image(${quote(path)}, width: ${width}%)`;
      if (border) core = `box(stroke: 0.75pt + rgb("#888888"), inset: 0pt)[#${core}]`;
      return alt ? `#figure(${core}, caption: [${escapeMarkup(alt)}])` : `#${core}`;
    }
    case 'mathBlock':
      return `$ ${(node.attrs.src as string) || ''} $`;
    case 'pageBreak':
      return '#pagebreak()';
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

/** Build the Typst `fill:` closure for the header row and/or zebra striping. */
function tableFill(header: boolean, striped: boolean): string | null {
  const header0 = header ? 'rgb("#f3f4f7")' : null;
  const even = striped ? 'rgb("#f8f9fb")' : null;
  if (!header0 && !even) return null;
  const clauses: string[] = [];
  if (header0) clauses.push(`if row == 0 { ${header0} }`);
  if (even) clauses.push(`${clauses.length ? 'else ' : ''}if calc.even(row) { ${even} }`);
  return `(col, row) => ${clauses.join(' ')}`;
}

function serializeTable(node: PMNode): string {
  const rows: PMNode[] = [];
  node.forEach((r) => rows.push(r));
  if (!rows.length) return '#table()';

  const headerFirst = isHeaderRow(rows[0]);
  const striped = node.attrs.striped as boolean;
  const borders = (node.attrs.borders as string) || 'all';

  const stroke =
    borders === 'none' ? 'none'
    : borders === 'horizontal' ? '(x: none, y: 0.5pt + rgb("#cdd2dc"))'
    : '0.5pt + rgb("#cdd2dc")';

  // Styling chosen to match the editor: borders, the same cell padding, a gray
  // fill behind a bold header row, and optional zebra striping.
  const lines: string[] = [
    `#table(`,
    `  columns: ${tableColumns(rows[0])},`,
    `  stroke: ${stroke},`,
    `  inset: (x: 8pt, y: 5pt),`,
  ];
  const fill = tableFill(headerFirst, striped);
  if (fill) lines.push(`  fill: ${fill},`);

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
