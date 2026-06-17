// Find & replace: a ProseMirror plugin that highlights matches, plus helpers
// the find bar calls to navigate and replace.

import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export const searchKey = new PluginKey('search');

interface Match { from: number; to: number }
interface SearchState { query: string; matches: Match[]; current: number; deco: DecorationSet }

function buildMatches(doc: PMNode, query: string): Match[] {
  const out: Match[] = [];
  if (!query) return out;
  const needle = query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const hay = node.text.toLowerCase();
    let i = 0;
    while ((i = hay.indexOf(needle, i)) !== -1) {
      out.push({ from: pos + i, to: pos + i + query.length });
      i += query.length;
    }
  });
  return out;
}

function compute(doc: PMNode, query: string, current: number): SearchState {
  const matches = buildMatches(doc, query);
  const cur = matches.length ? ((current % matches.length) + matches.length) % matches.length : 0;
  const deco = DecorationSet.create(doc, matches.map((m, i) =>
    Decoration.inline(m.from, m.to, { class: i === cur ? 'search-current' : 'search-match' }),
  ));
  return { query, matches, current: cur, deco };
}

const searchPlugin = new Plugin<SearchState>({
  key: searchKey,
  state: {
    init: () => ({ query: '', matches: [], current: 0, deco: DecorationSet.empty }),
    apply(tr, value) {
      const meta = tr.getMeta(searchKey) as { query?: string; current?: number } | undefined;
      if (meta) {
        return compute(tr.doc, meta.query ?? value.query, meta.current ?? value.current);
      }
      if (tr.docChanged && value.query) return compute(tr.doc, value.query, value.current);
      return value;
    },
  },
  props: {
    decorations(state) { return searchKey.getState(state)?.deco; },
  },
});

export const Search = Extension.create({
  name: 'search',
  addProseMirrorPlugins() { return [searchPlugin]; },
});

function state(editor: Editor): SearchState { return searchKey.getState(editor.state) as SearchState; }

function scrollToCurrent(editor: Editor): void {
  const s = state(editor);
  const m = s.matches[s.current];
  if (!m) return;
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, m.from)).scrollIntoView();
  editor.view.dispatch(tr);
}

export function setSearch(editor: Editor, query: string): void {
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query, current: 0 }));
  scrollToCurrent(editor);
}
export function searchNav(editor: Editor, dir: 1 | -1): void {
  const s = state(editor);
  if (!s.matches.length) return;
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { current: s.current + dir }));
  scrollToCurrent(editor);
}
export function searchStatus(editor: Editor): { count: number; index: number } {
  const s = state(editor);
  return { count: s.matches.length, index: s.matches.length ? s.current + 1 : 0 };
}
export function replaceCurrent(editor: Editor, replacement: string): void {
  const s = state(editor);
  const m = s.matches[s.current];
  if (!m) return;
  editor.view.dispatch(editor.state.tr.insertText(replacement, m.from, m.to));
  scrollToCurrent(editor);
}
export function replaceAll(editor: Editor, replacement: string): void {
  const s = state(editor);
  if (!s.matches.length) return;
  const tr = editor.state.tr;
  for (let i = s.matches.length - 1; i >= 0; i--) {
    tr.insertText(replacement, s.matches[i].from, s.matches[i].to);
  }
  editor.view.dispatch(tr);
}
export function clearSearch(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query: '' }));
}
