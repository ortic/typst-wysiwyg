// NodeView for an inline footnote: a superscript number that opens a small
// popover to edit the footnote text. Serializes to `#footnote[...]`.

import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

interface NodeViewProps {
  node: PMNode;
  editor: Editor;
  getPos: () => number | undefined;
}

export function createFootnoteView({ node, editor, getPos }: NodeViewProps) {
  const dom = document.createElement('sup');
  dom.className = 'footnote-marker';

  let content: string = node.attrs.content;

  const number = (): number => {
    const pos = getPos();
    if (typeof pos !== 'number') return 1;
    let n = 0;
    editor.state.doc.descendants((nd, p) => {
      if (p < pos && nd.type.name === 'footnote') n += 1;
      return true;
    });
    return n + 1;
  };
  const refresh = () => { dom.textContent = String(number()); };
  refresh();

  let pop: HTMLDivElement | null = null;
  const commit = () => {
    const pos = getPos();
    if (typeof pos === 'number') {
      editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { content }));
    }
  };
  const onDocDown = (e: MouseEvent) => {
    if (pop && !pop.contains(e.target as Node) && e.target !== dom) close();
  };
  const close = () => {
    if (!pop) return;
    commit();
    pop.remove();
    pop = null;
    document.removeEventListener('mousedown', onDocDown, true);
  };
  const open = () => {
    if (pop) return;
    pop = document.createElement('div');
    pop.className = 'footnote-pop';
    const label = document.createElement('div');
    label.className = 'footnote-pop-label';
    label.textContent = `Footnote ${number()}`;
    const ta = document.createElement('textarea');
    ta.value = content;
    ta.rows = 3;
    ta.placeholder = 'Footnote text…';
    ta.addEventListener('input', () => { content = ta.value; });
    ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    pop.append(label, ta);
    document.body.appendChild(pop);
    const r = dom.getBoundingClientRect();
    pop.style.left = `${Math.min(r.left, window.innerWidth - 300)}px`;
    pop.style.top = `${r.bottom + 5}px`;
    window.setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
    ta.focus();
  };
  dom.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); open(); });

  return {
    dom,
    update(updated: PMNode) {
      if (updated.type.name !== 'footnote') return false;
      if (!pop) content = updated.attrs.content;
      refresh();
      return true;
    },
    selectNode() { dom.classList.add('sel'); },
    deselectNode() { dom.classList.remove('sel'); },
    stopEvent() { return true; },
    ignoreMutation() { return true; },
    destroy() { if (pop) close(); },
  };
}
