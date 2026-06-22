// Open a .typ file. Two paths:
//  1. Files saved by this editor carry the full editable state in a trailing
//     comment (STATE_MARKER) — we restore that for a perfect round-trip.
//  2. Any other .typ is imported best-effort: prose, lists, callouts and tables
//     become structured blocks; #let / #show populate the logic layer; inline
//     marks (bold/italic/code/link/strike/colour/highlight/footnote/math) are
//     parsed. Anything unrecognized is preserved verbatim as a raw-Typst block.

import type { DocLogic, LetBinding, PageSize, ShowRule, ShowTarget } from './model';
import { uid, CALLOUT_LET_ID, calloutLet } from './model';

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

/** Unescape a Typst string literal's contents (\n, \t, \", \\, …). */
function unescapeTypstString(s: string): string {
  return s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c));
}

/** Strip the common leading indentation from every line. */
function dedent(s: string): string {
  const lines = s.split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join('\n');
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
    case 'ref': case 'cite': {
      const key = args?.match(/<([\w-]+)>/)?.[1] ?? args?.match(/"([\w-]+)"/)?.[1] ?? '';
      return key ? [{ type: 'reference', attrs: { target: key } }] : null;
    }
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
    if (c === '@') { const m = s.slice(i).match(/^@([\w-]+)/); if (m) { flush(); out.push({ type: 'reference', attrs: { target: m[1] } }); i += m[0].length; continue; } }
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

// A plain .typ carries no image bytes, so imported images get a placeholder
// preview (showing the file name) while keeping the real path for re-export.
function imagePlaceholder(path: string): string {
  const name = path.split('/').pop() || path;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">`
    + `<rect width="100%" height="100%" fill="#eef0f4" stroke="#c9ced8"/>`
    + `<text x="50%" y="50%" font-family="sans-serif" font-size="13" fill="#8a93a0" text-anchor="middle">⊞ ${name}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

/** Parse an #image / #figure / bordered-box block into an image node. */
function parseImageBlock(text: string): object | null {
  const path = text.match(/image\(\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  if (!path) return null;
  const width = text.match(/width:\s*([\d.]+)%/);
  const border = /box\(\s*stroke/.test(text);
  const cap = text.match(/caption:\s*\[([\s\S]*)\]\s*\)\s*$/);
  const alt = cap ? unescapeMarkup(cap[1].trim()) : '';
  return {
    type: 'image',
    attrs: { src: imagePlaceholder(path), path, width: width ? parseFloat(width[1]) : 80, border, alt },
  };
}

function parseContent(text: string): { type: 'doc'; content: object[] } {
  const lines = text.split('\n');
  const blocks: object[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === '') { i++; continue; }
    const t = lines[i].trim();

    const h = t.match(/^(={1,6})\s+(.*)$/);
    if (h) {
      let text = h[2];
      let label: string | null = null;
      const lm = text.match(/\s*<([\w-]+)>\s*$/);
      if (lm) { label = lm[1]; text = text.slice(0, lm.index); }
      blocks.push({ type: 'heading', attrs: { level: Math.min(h[1].length, 3), label }, content: parseInline(text) });
      i++;
      continue;
    }

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

    // The bibliography file lives in the VFS, not the source — drop the call
    // on import (it's restored from embedded state / re-added in the modal).
    if (t.startsWith('#bibliography(')) { i++; continue; }

    // #raw("…", block: true, lang: "…") — our own code-listing form.
    if (t.startsWith('#raw(') && /block:\s*true/.test(lines.slice(i, i + 20).join('\n'))) {
      const { inner, next } = readBalancedLines(lines, i, '(', ')');
      // The code is the positional string argument; skip named args (e.g. lang:).
      const codeArg = splitTopLevel(inner, ',').map((a) => a.trim()).find((a) => a.startsWith('"'));
      const strM = codeArg?.match(/^"((?:[^"\\]|\\.)*)"/);
      if (strM) {
        let code = unescapeTypstString(strM[1]);
        const lang = inner.match(/lang:\s*"([^"]+)"/)?.[1] || 'text';
        i = next;
        // Recover code that spilled outside the call: an empty raw string
        // followed by an indented block is really this listing's body.
        if (!code) {
          let j = i;
          while (j < lines.length && lines[j].trim() === '') j++;
          if (j < lines.length && /^\s+\S/.test(lines[j])) {
            const body: string[] = [];
            while (j < lines.length && (lines[j].trim() === '' || /^\s/.test(lines[j]))) body.push(lines[j++]);
            while (body.length && body[body.length - 1].trim() === '') body.pop();
            code = dedent(body.join('\n'));
            i = j;
          }
        }
        blocks.push({
          type: 'codeListing',
          attrs: { language: lang },
          content: code ? [{ type: 'text', text: code }] : [],
        });
        continue;
      }
    }

    // Fenced code listing: ```lang … ``` (3+ backticks, matching close).
    const fence = lines[i].match(/^(`{3,})([A-Za-z0-9_-]*)\s*$/);
    if (fence) {
      const ticks = fence[1];
      const lang = fence[2] || 'text';
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== ticks) { body.push(lines[j]); j++; }
      const code = body.join('\n');
      blocks.push({
        type: 'codeListing',
        attrs: { language: lang },
        content: code ? [{ type: 'text', text: code }] : [],
      });
      i = j < lines.length ? j + 1 : j;
      continue;
    }

    if (t.startsWith('#callout[')) {
      const { inner, next } = readBalancedLines(lines, i, '[', ']');
      const dedented = inner.split('\n').map((l) => l.replace(/^ {2}/, '')).join('\n');
      blocks.push({ type: 'callout', content: parseContent(dedented).content });
      i = next;
      continue;
    }

    const colsM = t.match(/^#columns\((\d+)\)\[/);
    if (colsM) {
      const { inner, next } = readBalancedLines(lines, i, '[', ']');
      const dedented = inner.split('\n').map((l) => l.replace(/^ {2}/, '')).join('\n');
      blocks.push({ type: 'columns', attrs: { count: parseInt(colsM[1], 10) }, content: parseContent(dedented).content });
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

    // #image / #figure / bordered #box[#image …] — structure into image nodes.
    if (/^#(?:image|figure|box)\b/.test(t) && t.includes('image(')) {
      let j = i, combined = '', depthP = 0, depthB = 0;
      do {
        combined += (combined ? '\n' : '') + lines[j];
        for (const ch of lines[j]) {
          if (ch === '(') depthP++; else if (ch === ')') depthP--;
          else if (ch === '[') depthB++; else if (ch === ']') depthB--;
        }
        j++;
      } while (j < lines.length && (depthP > 0 || depthB > 0));
      const node = parseImageBlock(combined);
      if (node) { blocks.push(node); i = j; continue; }
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
/** The top-level argument fragments of a `#set <name>(…)` rule, or null. */
function setArgFragments(text: string, name: string): string[] | null {
  const idx = text.indexOf(`#set ${name}(`);
  if (idx < 0) return null;
  const open = text.indexOf('(', idx);
  const content = readBalancedFrom(text, open, '(', ')').content;
  return splitTopLevel(content, ',').map((s) => s.trim()).filter(Boolean);
}

const argKey = (f: string): string => { const i = f.indexOf(':'); return i < 0 ? '' : f.slice(0, i).trim(); };
const argVal = (f: string): string => { const i = f.indexOf(':'); return i < 0 ? '' : f.slice(i + 1).trim(); };

/**
 * Parse the #set page/text/par rules into the style model. Arguments we model
 * are pulled out; anything else is kept verbatim in `extra` so re-saving never
 * drops it (e.g. text `lang`/`fill`, par `first-line-indent`, page `flipped`).
 */
function parseStyle(text: string): DocLogic['style'] {
  const style = defaultStyle();

  const pageFrags = setArgFragments(text, 'page');
  if (pageFrags) {
    const extra: string[] = [];
    for (const f of pageFrags) {
      const k = argKey(f), v = argVal(f);
      // paper & margin are always re-emitted, so never also keep them in extra.
      if (k === 'paper') { const m = v.match(/^"([^"]+)"$/); if (m) style.page.paper = m[1] as PageSize; }
      else if (k === 'margin') { const m = v.match(/^([\d.]+)cm$/); if (m) style.page.marginCm = parseFloat(m[1]); }
      else if (k === 'columns') { const m = v.match(/^(\d+)$/); if (m) style.page.columns = parseInt(m[1]); else extra.push(f); }
      else if (k === 'numbering') { style.page.numbering = true; style.page.numberingFormat = v; }
      else if (k === 'header') { const m = v.match(/^\[([\s\S]*)\]$/); if (m) style.page.header = unescapeMarkup(m[1]); else extra.push(f); }
      else if (k === 'footer') { const m = v.match(/^\[([\s\S]*)\]$/); if (m) style.page.footer = unescapeMarkup(m[1]); else extra.push(f); }
      else extra.push(f);
    }
    if (extra.length) style.page.extra = extra;
  }

  const txtFrags = setArgFragments(text, 'text');
  if (txtFrags) {
    const extra: string[] = [];
    for (const f of txtFrags) {
      const k = argKey(f), v = argVal(f);
      if (k === 'font') { const m = v.match(/^"([^"]+)"$/); if (m) style.text.font = m[1]; else extra.push(f); }
      else if (k === 'size') { const m = v.match(/^([\d.]+)pt$/); if (m) style.text.sizePt = parseFloat(m[1]); }
      else extra.push(f);
    }
    if (extra.length) style.text.extra = extra;
  }

  const parFrags = setArgFragments(text, 'par');
  if (parFrags) {
    style.par.justify = false; // a present #set par without justify means not justified
    const extra: string[] = [];
    for (const f of parFrags) {
      const k = argKey(f), v = argVal(f);
      if (k === 'leading') { const m = v.match(/^([\d.]+)em$/); if (m) style.par.leadingEm = parseFloat(m[1]); }
      else if (k === 'justify') { style.par.justify = /^true$/.test(v); }
      else extra.push(f);
    }
    if (extra.length) style.par.extra = extra;
  }

  if (/#set heading\([^\n]*numbering:/.test(text)) style.page.headingNumbering = true;
  return style;
}

function parseLets(text: string): LetBinding[] {
  const lets: LetBinding[] = [];
  const re = /^#let\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\([^)]*\))?\s*=\s*(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [, name, params, rhs] = m;
    const rhsStart = m.index + m[0].length - rhs.length;
    if (params) {
      const body = rhs.trim();
      if (body.startsWith('{')) {
        // component with a `{ … }` body — keep the structured form.
        const open = text.indexOf('{', rhsStart);
        const inner = readBalancedFrom(text, open, '{', '}').content.trim();
        lets.push({ id: uid('let'), name, kind: 'component', code: inner });
      } else {
        // Any other shape (e.g. callout's `block(…)[#body]`) is kept verbatim so
        // it round-trips exactly, including custom edits.
        const id = name === 'callout' ? CALLOUT_LET_ID : uid('let');
        lets.push({ id, name, kind: 'raw', code: readLetStatement(text, m.index, rhsStart) });
      }
    } else {
      lets.push({ id: uid('let'), name, kind: 'value', code: rhs.trim() });
    }
  }
  return lets;
}

/** Capture a whole `#let … = <expr>` statement, following the expression across
 *  lines until a newline at bracket/paren depth 0 (handles block(...)[...]). */
function readLetStatement(text: string, letStart: number, rhsStart: number): string {
  let i = rhsStart;
  while (i < text.length && /[ \t]/.test(text[i])) i++;
  let depth = 0;
  let inStr = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === '\n' && depth <= 0) break;
  }
  return text.slice(letStart, i).trim();
}

function parseSelector(sel: string): { target: ShowTarget; level: number | null; customSelector?: string } {
  const s = sel.trim();
  const hw = s.match(/^heading\.where\(level:\s*(\d+)\)$/);
  if (hw) return { target: 'heading', level: parseInt(hw[1]) };
  if (['heading', 'strong', 'emph', 'link', 'raw'].includes(s)) return { target: s as ShowTarget, level: null };
  return { target: 'custom', level: null, customSelector: s };
}

/** Split `#show <selector>: <rule>` at the colon that separates selector from
 *  rule — i.e. the one at bracket depth 0, not a `:` inside `where(level: 1)`. */
function splitShowRule(line: string): { selector: string; rhs: string } | null {
  const m = line.match(/^#show(\s+)/);
  if (!m) return null; // not a "#show <sel>: …" rule (e.g. the "#show: f" form)
  let depth = 0;
  let inStr = false;
  for (let k = m[0].length; k < line.length; k++) {
    const c = line[k];
    if (inStr) { if (c === '\\') k++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ':' && depth === 0) return { selector: line.slice(m[0].length, k).trim(), rhs: line.slice(k + 1).trim() };
  }
  return null;
}

function parseShows(text: string): ShowRule[] {
  const shows: ShowRule[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const split = splitShowRule(lines[i]);
    if (!split) continue;
    const sel = parseSelector(split.selector);
    const base: ShowRule = {
      id: uid('show'), target: sel.target, customSelector: sel.customSelector, level: sel.level, kind: 'style',
      props: { fill: '', sizePt: null, weight: 'inherit', style: 'inherit' },
    };
    const rhs = split.rhs;
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

/** True when every bracket/paren/brace in `s` is balanced (strings ignored). */
function isBalanced(s: string): boolean {
  let depth = 0;
  let inStr = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (inStr) { if (c === '\\') k++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
  }
  return depth <= 0;
}

/** Split a preamble into logical statements, joining lines that leave a
 *  bracket/paren/brace open (so multi-line #set/#let calls stay together). */
function splitStatements(text: string): string[] {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === '') { i++; continue; }
    let buf = lines[i];
    while (!isBalanced(buf) && i + 1 < lines.length) buf += '\n' + lines[++i];
    out.push(buf);
    i++;
  }
  return out;
}

/** Collect preamble statements we don't otherwise model (imports, custom #set,
 *  arbitrary top-level code) so they survive a load → save round-trip. */
function parseExtra(text: string): string[] {
  const extra: string[] = [];
  for (const stmt of splitStatements(text)) {
    const t = stmt.trim();
    if (t.startsWith('//')) continue;                       // comments
    if (/^#set (page|text|par|heading)\b/.test(t)) continue; // -> style
    if (t.startsWith('#let ')) continue;                    // -> lets
    if (t.startsWith('#show ')) continue;                   // -> shows
    if (t.startsWith('#bibliography(')) continue;           // -> bibliography
    extra.push(t);
  }
  return extra;
}

/** Block-level code statements that belong to the logic layer wherever they
 *  appear (Typst lets code and markup interleave; we route code to logic). */
const CODE_STMT = /^\s*#(let|set|show|import|include|bibliography)\b/;

/**
 * Walk a .typ document once and separate top-level code statements from markup,
 * without relying on any marker comment. Multi-line statements are kept whole
 * via balanced scanning; standalone comments (our scaffolding or stray ones)
 * are dropped; inline `#…` inside paragraphs stays with the markup.
 */
function scanTopLevel(src: string): { code: string; markup: string } {
  const lines = src.split('\n');
  const code: string[] = [];
  const markup: string[] = [];
  let inBlockComment = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (inBlockComment) { if (line.includes('*/')) inBlockComment = false; i++; continue; }
    if (/^\s*\/\//.test(line)) { i++; continue; }                 // standalone line comment
    if (/^\s*\/\*/.test(line)) { if (!line.includes('*/')) inBlockComment = true; i++; continue; }
    if (CODE_STMT.test(line)) {
      let buf = line;
      let j = i;
      while (!isBalanced(buf) && j + 1 < lines.length) buf += '\n' + lines[++j];
      if (isBalanced(buf)) { code.push(buf); i = j + 1; continue; }
      // Malformed statement that never balances: keep just this line as code so a
      // broken line can't swallow the rest of the document.
      code.push(line);
      i++;
      continue;
    }
    markup.push(line);
    i++;
  }
  return { code: code.join('\n'), markup: markup.join('\n') };
}

/** Best-effort import of a plain .typ document. */
export function importTypst(text: string): { logic: DocLogic; content: object } {
  const { code, markup } = scanTopLevel(text);
  const content = parseContent(markup);
  const lets = parseLets(code);
  // Seed the built-in callout when the body uses it but no definition was found,
  // so it stays visible/editable and survives the next save.
  if (usesCallout(content) && !lets.some((l) => l.name === 'callout')) lets.unshift(calloutLet());
  const extra = parseExtra(code);
  const logic: DocLogic = { style: parseStyle(code), lets, shows: parseShows(code) };
  if (extra.length) logic.extra = extra;
  return { logic, content };
}

/** Whether a parsed content tree contains a callout node. */
function usesCallout(node: { type?: string; content?: unknown[] }): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'callout') return true;
  return Array.isArray(node.content) && node.content.some((c) => usesCallout(c as typeof node));
}
