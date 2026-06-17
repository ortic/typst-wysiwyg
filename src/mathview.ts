// NodeView for the block equation: shows the live-compiled Typst math (SVG)
// with an editable source field beneath it, so editing is WYSIWYG.

import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { renderFragmentSvg } from './typst';

interface NodeViewProps {
  node: PMNode;
  editor: Editor;
  getPos: () => number | undefined;
}

export function createMathNodeView({ node, editor, getPos }: NodeViewProps) {
  const dom = document.createElement('div');
  dom.className = 'math-block';

  const render = document.createElement('div');
  render.className = 'math-render';

  const srcRow = document.createElement('div');
  srcRow.className = 'math-src';
  const ta = document.createElement('textarea');
  ta.rows = 1;
  ta.spellcheck = false;
  ta.placeholder = 'Typst math, e.g. x^2 + y^2 = z^2';
  ta.value = node.attrs.src;
  srcRow.appendChild(ta);

  dom.append(render, srcRow);

  let current: string = node.attrs.src;
  let timer: number | undefined;

  const draw = async (src: string) => {
    try {
      render.innerHTML = await renderFragmentSvg(`$ ${src} $`);
      render.classList.remove('err');
    } catch {
      render.textContent = '⚠ invalid math';
      render.classList.add('err');
    }
  };
  void draw(current);

  ta.addEventListener('input', () => {
    current = ta.value;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => draw(current), 200);
  });
  const commit = () => {
    const pos = getPos();
    if (typeof pos !== 'number') return;
    editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { src: current }));
  };
  ta.addEventListener('blur', commit);
  // Keep ProseMirror from hijacking editing inside the textarea.
  ta.addEventListener('keydown', (e) => e.stopPropagation());
  ta.addEventListener('mousedown', (e) => e.stopPropagation());

  return {
    dom,
    update(updated: PMNode) {
      if (updated.type.name !== 'mathBlock') return false;
      if (document.activeElement !== ta && updated.attrs.src !== current) {
        current = updated.attrs.src;
        ta.value = current;
        void draw(current);
      }
      return true;
    },
    selectNode() { dom.classList.add('selected'); },
    deselectNode() { dom.classList.remove('selected'); },
    stopEvent(e: Event) { return e.target === ta; },
    ignoreMutation() { return true; },
  };
}
