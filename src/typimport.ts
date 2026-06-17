// Open a .typ file. Two paths:
//  1. Files saved by this editor carry the full editable state in a trailing
//     comment (STATE_MARKER) — we restore that for a perfect round-trip.
//  2. Any other .typ is imported best-effort: prose, lists, callouts and tables
//     become structured blocks; #let / #show populate the logic layer; inline
//     marks (bold/italic/code/link/strike/colour/highlight/footnote/math) are
//     parsed. Anything unrecognized is preserved verbatim as a raw-Typst block.

import type { DocLogic, LetBinding, PageSize, ShowRule, ShowTarget } from './model';
import { uid } from './model';

export const STATE_MARKER = '// typst-wysiwyg-state (base64, do not edit): ';

/** Return the base64 state appended by Save, or null for a plain .typ file. */
export function extractEmbeddedState(text: string): string | null {
  const i = text.lastIndexOf(STATE_MARKER);
  if (i === -1) return null;
  return text.slice(i + STATE_MARKER.length).trim();
}

function defaultStyle(): DocLogic['style'] {
  return {
    page: { paper: 'a4', marginCm: 2.5 },
    text: { font: '', sizePt: 11 },
    par: { leadingEm: 0.65, justify: true },
  };
}

function unescapeMarkup(s: string): string {
  return s.replace(/\\([\\#$*_`<>@~[\]])/g, '$1');
}

// --- low-level helpers ------------------------------------------------------
/** Read a balanced span within a string, given the index of the opening char. */
function readBalancedFrom(s: string, start: number, open: string, close: string): { content: string; end: number } {
  let depth = 0;
  let inStr = false;
  for (let k = start; k < s.length; k++) {
    const c = s[k];
    if (inStr) { if (c === '\\') k++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return { content: s.slice(start + 1, k), end: k + 1 }; }
  }
  return { content: s.slice(start + 1), end: s.length };
}

/** Split a string by `sep` at top nesting level only (respects ()[]{} and ""). */
function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr = false;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === sep && depth === 0) { parts.push(s.slice(last, i)); last = i + 1; }
  }
  parts.push(s.slice(last));
  return parts;
}

function typToHexColor(expr: string): string {
  const hex = expr.match(/rgb\("(#[0-9a-fA-F]{3,8})"\)/);
  return hex ? hex[1] : '';
}

// --- inline parsing ---------------------------------------------------------
interface PMText { type: 'text'; text: string; marks?: { type: string; attrs?: Record<string, unknown> }[] }
type PMInline = PMText | { type: string; attrs?: Record<string, unknown> };

function textNode(text: string, active: Set<string>): PMText {
  const marks = [...active].map((m) => ({ type: m }));
  return marks.length ? { type: 'text', text, marks } : { type: 'text', text };
}

function withMark(nodes: PMInline[], type: string, attrs?: Record<string, unknown>): PMInline[] {
  return nodes.map((n) => {
    if (n.type !== 'text') return n;
    const t = n as PMText;
    const marks = (t.marks ?? []).slice();
    if (!marks.some((m) => m.type === type)) marks.push(attrs ? { type, attrs } : { type });
    return { ...t, marks };
  });
}

function buildInlineFn(name: string, args: string | null, content: string | null): PMInline[] | null {
  switch (name) {
    case 'link': {
      const url = args?.match(/"((?:[^"\\]|\\.)*)"/)?.[1] ?? '';
      return withMark(content != null ? parseInline(content) : [{ type: 'text', text: url }], 'link', { href: url });
    }
    case 'strike': return withMark(parseInline(content ?? ''), 'strike');
    case 'highlight': return withMark(parseInline(content ?? ''), 'highlight');
    case 'strong': return withMark(parseInline(content ?? ''), 'bold');
    case 'emph': return withMark(parseInline(content ?? ''), 'italic');
    case 'underline': return parseInline(content ?? '');
    case 'footnote': return [{ type: 'footnote', attrs: { content: unescapeMarkup(content ?? '').trim() } }];
    case 'raw': {
      const code = args?.match(/"((?:[^"\\]|\\.)*)"/)?.[1] ?? '';
      return [{ type: 'text', text: code, marks: [{ type: 'code' }] }];
    }
    case 'text': {
      const fill = args?.match(/fill:\s*([^,]+?)\s*$/)?.[1] ?? args?.match(/fill:\s*([^,]+),/)?.[1] ?? '';
      const hex = typToHexColor(fill);
      const nodes = parseInline(content ?? '');
      return hex ? withMark(nodes, 'textStyle', { color: hex }) : nodes;
    }
    default: return null;
  }
}

function parseInline(s: string): PMInline[] {
  const out: PMInline[] = [];
  const active = new Set<string>();
  let buf = '';
  const flush = () => { if (buf) { out.push(textNode(buf, active)); buf = ''; } };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { buf += s[i + 1]; i += 2; continue; }
    if (c === '*') { flush(); active.has('bold') ? active.delete('bold') : active.add('bold'); i++; continue; }
    if (c === '_') { flush(); active.has('italic') ? active.delete('italic') : active.add('italic'); i++; continue; }
    if (c === '`') { const j = s.indexOf('`', i + 1); if (j > i) { flush(); out.push({ type: 'text', text: s.slice(i + 1, j), marks: [{ type: 'code' }] } as PMText); i = j + 1; continue; } }
    if (c === '$') { const j = s.indexOf('$', i + 1); if (j > i) { flush(); out.push({ type: 'mathInline', attrs: { src: s.slice(i + 1, j).trim() } }); i = j + 1; continue; } }
    if (c === '#') {
      const m = s.slice(i).match(/^#([a-zA-Z][a-zA-Z0-9_.]*)/);
      if (m) {
        let k = i + m[0].length;
        let args: string | null = null;
        let content: string | null = null;
        if (s[k] === '(') { const r = readBalancedFrom(s, k, '(', ')'); args = r.content; k = r.end; }
        if (s[k] === '[') { const r = readBalancedFrom(s, k, '[', ']'); content = r.content; k = r.end; }
        let nodes = buildInlineFn(m[1], args, content);
        if (nodes) {
          for (const mk of active) nodes = withMark(nodes, mk);
          flush();
          out.push(...nodes);
          i = k;
          continue;
        }
      }
    }
    buf += c; i++;
  }
  flush();
  return out;
}

// --- table parsing ----------------------------------------------------------
function parseTableInner(inner: string): object | null {
  const args = splitTopLevel(inner, ',').map((a) => a.trim()).filter(Boolean);
  let columns = 0;
  const cells: { content: string; header: boolean }[] = [];
  for (const arg of args) {
    if (arg.startsWith('columns:')) {
      const spec = arg.slice(8).trim();
      if (/^\d+$/.test(spec)) columns = parseInt(spec);
      else if (spec.startsWith('(')) columns = splitTopLevel(readBalancedFrom(spec, 0, '(', ')').content, ',').filter((s) => s.trim()).length;
    } else if (/^(stroke|inset|fill|align|gutter):/.test(arg)) {
      // styling — ignored on import
    } else if (arg.startsWith('table.header(')) {
      const inner2 = readBalancedFrom(arg, arg.indexOf('('), '(', ')').content;
      for (const cell of splitTopLevel(inner2, ',')) {
        const c = cell.trim();
        if (c.startsWith('[')) cells.push({ content: readBalancedFrom(c, 0, '[', ']').content, header: true });
      }
    } else if (arg.startsWith('[')) {
      cells.push({ content: readBalancedFrom(arg, 0, '[', ']').content, header: false });
    } else if (arg.startsWith('table.cell')) {
      const br = arg.indexOf('[');
      if (br >= 0) cells.push({ content: readBalancedFrom(arg, br, '[', ']').content, header: false });
    }
  }
  if (!columns || !cells.length) return null;
  const rows: object[] = [];
  for (let r = 0; r < cells.length; r += columns) {
    const rowCells = cells.slice(r, r + columns).map((c) => ({
      type: c.header ? 'tableHeader' : 'tableCell',
      content: [{ type: 'paragraph', content: parseInline(c.content.trim()) }],
    }));
    if (rowCells.length) rows.push({ type: 'tableRow', content: rowCells });
  }
  return { type: 'table', content: rows };
}

// --- block parsing ----------------------------------------------------------
const BLOCK_START = /^(={1,6}\s|[-+]\s|#|\$)/;

function readBalancedLines(lines: string[], from: number, open: string, close: string): { inner: string; next: number } {
  const text = lines.slice(from).join('\n');
  const start = text.indexOf(open);
  const { content, end } = readBalancedFrom(text, start, open, close);
  const consumed = text.slice(0, end).split('\n').length;
  return { inner: content, next: from + consumed };
}

function rawBlock(text: string): object {
  return { type: 'codeBlock', content: text ? [{ type: 'text', text }] : [] };
}

function parseContent(text: string): { type: 'doc'; content: object[] } {
  const lines = text.split('\n');
  const blocks: object[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === '') { i++; continue; }
    const t = lines[i].trim();

    const h = t.match(/^(={1,6})\s+(.*)$/);
    if (h) { blocks.push({ type: 'heading', attrs: { level: Math.min(h[1].length, 3) }, content: parseInline(h[2]) }); i++; continue; }

    if (/^[-+]\s+/.test(t)) {
      const ordered = t[0] === '+';
      const items: object[] = [];
      while (i < lines.length && /^\s*[-+]\s+/.test(lines[i])) {
        const m = lines[i].match(/^\s*[-+]\s+(.*)$/)!;
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: parseInline(m[1]) }] });
        i++;
      }
      blocks.push(ordered ? { type: 'orderedList', attrs: { start: 1 }, content: items } : { type: 'bulletList', content: items });
      continue;
    }

    if (t === '#pagebreak()') { blocks.push({ type: 'pageBreak' }); i++; continue; }

    if (t.startsWith('#callout[')) {
      const { inner, next } = readBalancedLines(lines, i, '[', ']');
      const dedented = inner.split('\n').map((l) => l.replace(/^ {2}/, '')).join('\n');
      blocks.push({ type: 'callout', content: parseContent(dedented).content });
      i = next;
      continue;
    }

    if (t.startsWith('#table(')) {
      const { inner, next } = readBalancedLines(lines, i, '(', ')');
      const tbl = parseTableInner(inner);
      blocks.push(tbl ?? rawBlock(lines.slice(i, next).join('\n')));
      i = next;
      continue;
    }

    if (t.startsWith('$')) {
      const collected: string[] = [];
      let j = i;
      let closed = false;
      while (j < lines.length) {
        collected.push(lines[j]);
        if ((collected.join('\n').match(/\$/g) || []).length >= 2) { closed = true; break; }
        j++;
      }
      if (closed) {
        const inner = collected.join('\n').replace(/^\s*\$/, '').replace(/\$\s*$/, '').trim();
        blocks.push({ type: 'mathBlock', attrs: { src: inner } });
        i = j + 1;
        continue;
      }
    }

    if (t.startsWith('#') || t.startsWith('$')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim() !== '') { buf.push(lines[i]); i++; }
      blocks.push(rawBlock(buf.join('\n')));
      continue;
    }

    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !BLOCK_START.test(lines[i].trim())) { buf.push(lines[i]); i++; }
    blocks.push({ type: 'paragraph', content: parseInline(buf.join(' ')) });
  }
  if (!blocks.length) blocks.push({ type: 'paragraph' });
  return { type: 'doc', content: blocks };
}

// --- preamble (#set / #let / #show) -----------------------------------------
function parseStyle(text: string): DocLogic['style'] {
  const style = defaultStyle();
  const page = text.match(/#set page\(([^\n]*)\)/);
  if (page) {
    const a = page[1];
    const paper = a.match(/paper:\s*"([^"]+)"/); if (paper) style.page.paper = paper[1] as PageSize;
    const margin = a.match(/margin:\s*([\d.]+)cm/); if (margin) style.page.marginCm = parseFloat(margin[1]);
    const cols = a.match(/columns:\s*(\d+)/); if (cols) style.page.columns = parseInt(cols[1]);
    if (/numbering:/.test(a)) style.page.numbering = true;
    const header = a.match(/header:\s*\[([^\]]*)\]/); if (header) style.page.header = unescapeMarkup(header[1]);
    const footer = a.match(/footer:\s*\[([^\]]*)\]/); if (footer) style.page.footer = unescapeMarkup(footer[1]);
  }
  const txt = text.match(/#set text\(([^\n]*)\)/);
  if (txt) {
    const font = txt[1].match(/font:\s*"([^"]+)"/); if (font) style.text.font = font[1];
    const size = txt[1].match(/size:\s*([\d.]+)pt/); if (size) style.text.sizePt = parseFloat(size[1]);
  }
  const par = text.match(/#set par\(([^\n]*)\)/);
  if (par) {
    const leading = par[1].match(/leading:\s*([\d.]+)em/); if (leading) style.par.leadingEm = parseFloat(leading[1]);
    style.par.justify = /justify:\s*true/.test(par[1]);
  }
  return style;
}

function parseLets(text: string): LetBinding[] {
  const lets: LetBinding[] = [];
  const re = /^#let\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\([^)]*\))?\s*=\s*(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [, name, params, rhs] = m;
    if (name === 'callout') continue; // the built-in component
    if (params) {
      // component: grab the (possibly multi-line) body
      let body = rhs.trim();
      if (body.startsWith('{') || body.startsWith('block(')) {
        const open = text.indexOf(body[0], m.index + m[0].length - rhs.length);
        const r = readBalancedFrom(text, open, body[0], body[0] === '{' ? '}' : ')');
        body = r.content.trim();
      }
      lets.push({ id: uid('let'), name, kind: 'component', code: body });
    } else {
      lets.push({ id: uid('let'), name, kind: 'value', code: rhs.trim() });
    }
  }
  return lets;
}

function parseSelector(sel: string): { target: ShowTarget; level: number | null; customSelector?: string } {
  const s = sel.trim();
  const hw = s.match(/^heading\.where\(level:\s*(\d+)\)$/);
  if (hw) return { target: 'heading', level: parseInt(hw[1]) };
  if (['heading', 'strong', 'emph', 'link', 'raw'].includes(s)) return { target: s as ShowTarget, level: null };
  return { target: 'custom', level: null, customSelector: s };
}

function parseShows(text: string): ShowRule[] {
  const shows: ShowRule[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#show\s+(.*?):\s*(.*)$/);
    if (!m) continue;
    const sel = parseSelector(m[1]);
    const base: ShowRule = {
      id: uid('show'), target: sel.target, customSelector: sel.customSelector, level: sel.level, kind: 'style',
      props: { fill: '', sizePt: null, weight: 'inherit', style: 'inherit' },
    };
    const rhs = m[2].trim();
    if (rhs.startsWith('it =>') || rhs.startsWith('it=>')) {
      base.kind = 'function';
      const braceIdx = lines.slice(i).join('\n').indexOf('{', lines[i].indexOf(rhs));
      if (braceIdx >= 0) {
        const r = readBalancedFrom(lines.slice(i).join('\n'), braceIdx, '{', '}');
        base.body = r.content.split('\n').map((l) => l.replace(/^ {2}/, '')).join('\n').trim();
        i += lines.slice(i).join('\n').slice(0, r.end).split('\n').length - 1;
      } else {
        base.body = rhs.replace(/^it\s*=>\s*/, '');
      }
    } else if (rhs.startsWith('set text(')) {
      const props = readBalancedFrom(rhs, rhs.indexOf('('), '(', ')').content;
      const fill = props.match(/fill:\s*([^,]+)/); if (fill) base.props.fill = typToHexColor(fill[1]);
      const size = props.match(/size:\s*([\d.]+)pt/); if (size) base.props.sizePt = parseFloat(size[1]);
      const weight = props.match(/weight:\s*"(\w+)"/); if (weight) base.props.weight = weight[1] as ShowRule['props']['weight'];
      const style = props.match(/style:\s*"(\w+)"/); if (style) base.props.style = style[1] as ShowRule['props']['style'];
    }
    shows.push(base);
  }
  return shows;
}

/** Best-effort import of a plain .typ document. */
export function importTypst(text: string): { logic: DocLogic; content: object } {
  const marker = '// --- content ---';
  const ci = text.lastIndexOf(marker);
  let preamble: string;
  let contentText: string;
  if (ci >= 0) {
    preamble = text.slice(0, ci);
    contentText = text.slice(ci + marker.length);
  } else {
    const lines = text.split('\n');
    let i = 0;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (t === '' || t.startsWith('//') || t.startsWith('#set ') || t.startsWith('#import ') || t.startsWith('#show ') || t.startsWith('#let ')) i++;
      else break;
    }
    preamble = lines.slice(0, i).join('\n');
    contentText = lines.slice(i).join('\n');
  }
  const logic: DocLogic = { style: parseStyle(preamble), lets: parseLets(preamble), shows: parseShows(preamble) };
  return { logic, content: parseContent(contentText) };
}
