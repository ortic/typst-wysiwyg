// NodeView for inline math: shows the compiled Typst math at text size, and a
// popover to edit the source. Serializes to `$…$` (inline math).

import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { renderFragmentSvg } from './typst';

interface NodeViewProps {
  node: PMNode;
  editor: Editor;
  getPos: () => number | undefined;
}

export function createMathInlineView({ node, editor, getPos }: NodeViewProps) {
  const dom = document.createElement('span');
  dom.className = 'math-inline';

  let content: string = node.attrs.src;
  let timer: number | undefined;

  const draw = async (src: string) => {
    if (!src.trim()) { dom.innerHTML = '<span class="math-empty">f(x)</span>'; return; }
    try { dom.innerHTML = await renderFragmentSvg(`$${src}$`); }
    catch { dom.textContent = '⚠'; }
  };
  void draw(content);

  let pop: HTMLDivElement | null = null;
  const commit = () => {
    const pos = getPos();
    if (typeof pos === 'number') {
      editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { src: content }));
    }
  };
  const onDocDown = (e: MouseEvent) => {
    if (pop && !pop.contains(e.target as Node) && e.target !== dom && !dom.contains(e.target as Node)) close();
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
    label.textContent = 'Inline math';
    const ta = document.createElement('textarea');
    ta.value = content;
    ta.rows = 2;
    ta.spellcheck = false;
    ta.placeholder = 'Typst math, e.g. x^2';
    ta.addEventListener('input', () => {
      content = ta.value;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => draw(content), 200);
    });
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
      if (updated.type.name !== 'mathInline') return false;
      if (!pop && updated.attrs.src !== content) { content = updated.attrs.src; void draw(content); }
      return true;
    },
    selectNode() { dom.classList.add('sel'); },
    deselectNode() { dom.classList.remove('sel'); },
    stopEvent() { return true; },
    ignoreMutation() { return true; },
    destroy() { if (pop) close(); },
  };
}
