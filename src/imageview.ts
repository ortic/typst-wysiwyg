// NodeView for images: renders <figure><img><figcaption> so the caption is
// edited inline (WYSIWYG) and maps to `#figure(image(..), caption: [..])`.
// Width/border attributes (set from the Image ribbon tab) apply to the img.

import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

interface NodeViewProps {
  node: PMNode;
  editor: Editor;
  getPos: () => number | undefined;
}

export function createImageNodeView({ node, editor, getPos }: NodeViewProps) {
  const figure = document.createElement('figure');
  figure.className = 'doc-figure';

  const img = document.createElement('img');
  const caption = document.createElement('figcaption');
  caption.className = 'doc-figcaption';
  caption.contentEditable = 'true';
  caption.setAttribute('data-placeholder', 'Add a caption…');

  figure.append(img, caption);

  let alt: string = node.attrs.alt ?? '';

  const apply = (n: PMNode) => {
    img.src = n.attrs.src ?? '';
    img.style.width = `${n.attrs.width ?? 80}%`;
    if (n.attrs.border) img.setAttribute('data-border', 'true');
    else img.removeAttribute('data-border');
    if (document.activeElement !== caption) {
      alt = n.attrs.alt ?? '';
      caption.textContent = alt;
    }
    figure.classList.toggle('has-caption', !!(n.attrs.alt ?? '').trim());
  };
  apply(node);

  const commit = () => {
    const pos = getPos();
    if (typeof pos === 'number' && caption.textContent !== node.attrs.alt) {
      editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, alt: caption.textContent ?? '' }));
    }
  };
  caption.addEventListener('input', () => { figure.classList.toggle('has-caption', !!(caption.textContent ?? '').trim()); });
  caption.addEventListener('blur', commit);
  caption.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); caption.blur(); } });
  caption.addEventListener('mousedown', (e) => e.stopPropagation());

  return {
    dom: figure,
    update(updated: PMNode) {
      if (updated.type.name !== 'image') return false;
      node = updated;
      apply(updated);
      return true;
    },
    selectNode() { figure.classList.add('selected'); },
    deselectNode() { figure.classList.remove('selected'); },
    stopEvent(e: Event) { return e.target === caption; },
    // The caption is a contentEditable we manage ourselves; ignore its mutations.
    ignoreMutation(m: { target: Node }) { return m.target === caption || caption.contains(m.target); },
  };
}
