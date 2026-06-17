// Open a .typ file. Two paths:
//  1. Files saved by this editor carry the full editable state in a trailing
//     comment (STATE_MARKER) — we restore that for a perfect round-trip.
//  2. Any other .typ is imported best-effort: prose (headings/lists/paragraphs/
//     callouts) becomes structured blocks; everything else is preserved as a
//     raw-Typst block so it still renders and nothing is lost.

import type { DocLogic, PageSize } from './model';

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

// --- inline parsing: *bold* _italic_ `code` $math$ -------------------------
interface PMText { type: 'text'; text: string; marks?: { type: string }[] }
type PMInline = PMText | { type: 'mathInline'; attrs: { src: string } };

function parseInline(s: string): PMInline[] {
  const out: PMInline[] = [];
  const active = new Set<string>();
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const marks = [...active].map((m) => ({ type: m }));
    out.push(marks.length ? { type: 'text', text: buf, marks } : { type: 'text', text: buf });
    buf = '';
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { buf += s[i + 1]; i++; continue; }
    if (c === '*') { flush(); active.has('bold') ? active.delete('bold') : active.add('bold'); continue; }
    if (c === '_') { flush(); active.has('italic') ? active.delete('italic') : active.add('italic'); continue; }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i) { flush(); out.push({ type: 'text', text: s.slice(i + 1, j), marks: [{ type: 'code' }] }); i = j; continue; }
    }
    if (c === '$') {
      const j = s.indexOf('$', i + 1);
      if (j > i) { flush(); out.push({ type: 'mathInline', attrs: { src: s.slice(i + 1, j).trim() } }); i = j; continue; }
    }
    buf += c;
  }
  flush();
  return out;
}

// --- block parsing ----------------------------------------------------------
const BLOCK_START = /^(={1,6}\s|[-+]\s|#|\$)/;

/** Read a bracket-balanced span (e.g. #callout[ … ]) starting at line `from`. */
function readBalanced(lines: string[], from: number, open: string, close: string): { inner: string; next: number } {
  const text = lines.slice(from).join('\n');
  const start = text.indexOf(open);
  let depth = 0;
  let end = text.length;
  for (let k = start; k < text.length; k++) {
    if (text[k] === open) depth++;
    else if (text[k] === close) { depth--; if (depth === 0) { end = k; break; } }
  }
  const inner = text.slice(start + 1, end);
  const consumed = text.slice(0, end + 1).split('\n').length;
  return { inner, next: from + consumed };
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
      const { inner, next } = readBalanced(lines, i, '[', ']');
      const dedented = inner.split('\n').map((l) => l.replace(/^ {2}/, '')).join('\n');
      blocks.push({ type: 'callout', content: parseContent(dedented).content });
      i = next;
      continue;
    }

    // block math: $ … $ possibly across lines
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

    // any other #…/$… construct -> preserve verbatim as a raw block
    if (t.startsWith('#') || t.startsWith('$')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim() !== '') { buf.push(lines[i]); i++; }
      blocks.push({ type: 'codeBlock', content: [{ type: 'text', text: buf.join('\n') }] });
      continue;
    }

    // paragraph
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !BLOCK_START.test(lines[i].trim())) { buf.push(lines[i]); i++; }
    blocks.push({ type: 'paragraph', content: parseInline(buf.join(' ')) });
  }
  if (!blocks.length) blocks.push({ type: 'paragraph' });
  return { type: 'doc', content: blocks };
}

function parseStyle(text: string): DocLogic['style'] {
  const style = defaultStyle();
  const page = text.match(/#set page\(([^\n]*)\)/);
  if (page) {
    const args = page[1];
    const paper = args.match(/paper:\s*"([^"]+)"/);
    if (paper) style.page.paper = paper[1] as PageSize;
    const margin = args.match(/margin:\s*([\d.]+)cm/);
    if (margin) style.page.marginCm = parseFloat(margin[1]);
    if (/numbering:/.test(args)) style.page.numbering = true;
    const header = args.match(/header:\s*\[([^\]]*)\]/);
    if (header) style.page.header = unescapeMarkup(header[1]);
    const footer = args.match(/footer:\s*\[([^\]]*)\]/);
    if (footer) style.page.footer = unescapeMarkup(footer[1]);
  }
  const txt = text.match(/#set text\(([^\n]*)\)/);
  if (txt) {
    const font = txt[1].match(/font:\s*"([^"]+)"/);
    if (font) style.text.font = font[1];
    const size = txt[1].match(/size:\s*([\d.]+)pt/);
    if (size) style.text.sizePt = parseFloat(size[1]);
  }
  const par = text.match(/#set par\(([^\n]*)\)/);
  if (par) {
    const leading = par[1].match(/leading:\s*([\d.]+)em/);
    if (leading) style.par.leadingEm = parseFloat(leading[1]);
    style.par.justify = /justify:\s*true/.test(par[1]);
  }
  return style;
}

/** Best-effort import of a plain .typ document. */
export function importTypst(text: string): { logic: DocLogic; content: object } {
  const marker = '// --- content ---';
  const ci = text.lastIndexOf(marker);
  let contentText: string;
  if (ci >= 0) {
    contentText = text.slice(ci + marker.length);
  } else {
    // Strip a leading run of comments / #set / #import / #show lines.
    const lines = text.split('\n');
    let i = 0;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (t === '' || t.startsWith('//') || t.startsWith('#set ') || t.startsWith('#import ') || t.startsWith('#show ')) i++;
      else break;
    }
    contentText = lines.slice(i).join('\n');
  }
  return { logic: { style: parseStyle(text), lets: [], shows: [] }, content: parseContent(contentText) };
}
