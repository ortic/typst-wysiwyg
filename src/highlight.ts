// A small, dependency-free syntax highlighter for the Typst we generate.
// It is intentionally simple (regex/line based) — enough to make the source
// readable in the viewer, not a full Typst grammar.

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function span(cls: string, escaped: string): string {
  return `<span class="tk-${cls}">${escaped}</span>`;
}

// Inline tokens: comments, strings, #function/#var refs, numbers (with units).
const INLINE =
  /(\/\/[^\n]*$)|("(?:[^"\\]|\\.)*")|(#[A-Za-z_][A-Za-z0-9_]*)|(\b\d+(?:\.\d+)?(?:pt|cm|mm|em|in|fr)?%?)/g;

function inline(s: string): string {
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(s))) {
    out += esc(s.slice(last, m.index));
    if (m[1]) out += span('com', esc(m[1]));
    else if (m[2]) out += span('str', esc(m[2]));
    else if (m[3]) out += span('fn', esc(m[3]));
    else if (m[4]) out += span('num', esc(m[4]));
    last = m.index + m[0].length;
  }
  out += esc(s.slice(last));
  return out;
}

function highlightLine(line: string): string {
  if (line.trimStart().startsWith('//')) return span('com', esc(line));

  const head = line.match(/^(\s*)(=+)(\s.*)$/);
  if (head) return esc(head[1]) + span('head', esc(head[2] + head[3]));

  const list = line.match(/^(\s*)([-+])(\s.*)$/);
  if (list) return esc(list[1]) + span('punc', esc(list[2])) + inline(list[3]);

  return inline(line);
}

/** Returns highlighted HTML (one <span>-decorated line per source line). */
export function highlightTypst(src: string): string {
  return src.split('\n').map(highlightLine).join('\n');
}
