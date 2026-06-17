// Content-aware pagination for the editor canvas.
//
// The document still lives in one continuous ProseMirror doc, but we measure the
// rendered top-level blocks and insert spacer *widget decorations* so that any
// block which would straddle a page boundary is pushed to the top of the next
// sheet. The page sheets + gutters are drawn by a repeating background on .page
// (see styles.css), aligned to the same geometry — so nothing overflows a page.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';

export const paginationKey = new PluginKey('pagination');

// Geometry in CSS px at the 660px sheet width. Updated for the paper size.
export const pageConfig = { pageH: 933, margin: 64, gutter: 28 };

interface Break { pos: number; height: number }
interface PState { breaks: Break[]; deco: DecorationSet }

function spacerDom(height: number): HTMLElement {
  const d = document.createElement('div');
  d.className = 'pm-page-spacer';
  d.style.height = `${height}px`;
  d.setAttribute('contenteditable', 'false');
  return d;
}

function buildDeco(doc: import('@tiptap/pm/model').Node, breaks: Break[]): DecorationSet {
  return DecorationSet.create(doc, breaks.map((b) =>
    Decoration.widget(b.pos, () => spacerDom(b.height), { side: -1, key: `pb-${b.pos}-${Math.round(b.height)}`, ignoreSelection: true }),
  ));
}

function sameBreaks(a: Break[], b: Break[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].pos !== b[i].pos || Math.abs(a[i].height - b[i].height) > 0.5) return false;
  }
  return true;
}

function measure(view: EditorView): void {
  const pageEl = view.dom.closest('.page') as HTMLElement | null;
  // Pagination doesn't apply to the page-wide multi-column mode.
  if (pageEl && (pageEl.classList.contains('cols-2') || pageEl.classList.contains('cols-3'))) {
    const st = paginationKey.getState(view.state) as PState;
    if (st.breaks.length) view.dispatch(view.state.tr.setMeta(paginationKey, { breaks: [] as Break[] }));
    return;
  }

  const { pageH, margin, gutter } = pageConfig;
  const contentH = pageH - 2 * margin;
  const stride = pageH + gutter;
  const pmTop = view.dom.getBoundingClientRect().top;
  const cur = (paginationKey.getState(view.state) as PState).breaks;
  const curByPos = new Map(cur.map((b) => [b.pos, b.height]));

  const newBreaks: Break[] = [];
  let shift = 0;
  let cumSpacer = 0;

  view.state.doc.forEach((_node, offset) => {
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) return;
    cumSpacer += curByPos.get(offset) ?? 0; // spacer currently before this block
    const rect = dom.getBoundingClientRect();
    const naturalTop = rect.top - pmTop - cumSpacer;
    const h = rect.height;

    const top = naturalTop + shift;
    const p = Math.max(0, Math.floor(top / stride));
    const sheetBottom = p * stride + contentH;
    if (h <= contentH && top + h > sheetBottom + 0.5) {
      const extra = (p + 1) * stride - top;
      if (extra > 0.5) {
        shift += extra;
        newBreaks.push({ pos: offset, height: extra });
      }
    }
  });

  if (!sameBreaks(cur, newBreaks)) {
    view.dispatch(view.state.tr.setMeta(paginationKey, { breaks: newBreaks }));
  }
}

const paginationPlugin = new Plugin<PState>({
  key: paginationKey,
  state: {
    init: () => ({ breaks: [], deco: DecorationSet.empty }),
    apply(tr, value) {
      const meta = tr.getMeta(paginationKey) as { breaks: Break[] } | undefined;
      if (meta) return { breaks: meta.breaks, deco: buildDeco(tr.doc, meta.breaks) };
      if (tr.docChanged) {
        const breaks = value.breaks
          .map((b) => ({ pos: tr.mapping.map(b.pos, -1), height: b.height }))
          .filter((b) => b.pos >= 0);
        return { breaks, deco: value.deco.map(tr.mapping, tr.doc) };
      }
      return value;
    },
  },
  props: {
    decorations(state) { return (paginationKey.getState(state) as PState).deco; },
  },
  view(view) {
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => { raf = 0; measure(view); });
    };
    schedule();
    return {
      update: schedule,
      destroy() { if (raf) window.cancelAnimationFrame(raf); },
    };
  },
});

export const Pagination = Extension.create({
  name: 'pagination',
  addProseMirrorPlugins() { return [paginationPlugin]; },
});

/** Force a re-measure (e.g. after the paper size or geometry changes). */
export function relayoutPages(view: EditorView): void {
  window.requestAnimationFrame(() => measure(view));
}
