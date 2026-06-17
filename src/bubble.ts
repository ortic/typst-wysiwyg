// A floating formatting toolbar that appears above a non-empty text selection
// (bold / italic / strike / code / link). Built as a plain DOM overlay driven
// by the editor's selection — no extra dependencies.

import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

export function installBubbleMenu(editor: Editor, onLink: () => void): void {
  const bar = document.createElement('div');
  bar.className = 'bubble-menu';
  bar.style.display = 'none';
  document.body.appendChild(bar);

  interface Item { html: string; cls?: string; title: string; run: () => void; active: () => boolean }
  const items: Item[] = [
    { html: 'B', cls: 'b', title: 'Bold', run: () => editor.chain().focus().toggleBold().run(), active: () => editor.isActive('bold') },
    { html: 'I', cls: 'i', title: 'Italic', run: () => editor.chain().focus().toggleItalic().run(), active: () => editor.isActive('italic') },
    { html: 'S', cls: 's', title: 'Strikethrough', run: () => editor.chain().focus().toggleStrike().run(), active: () => editor.isActive('strike') },
    { html: '&lt;/&gt;', title: 'Inline code', run: () => editor.chain().focus().toggleCode().run(), active: () => editor.isActive('code') },
    { html: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>', title: 'Link', run: onLink, active: () => editor.isActive('link') },
  ];

  function build(): void {
    bar.replaceChildren();
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'bubble-btn' + (it.cls ? ' ' + it.cls : '') + (it.active() ? ' active' : '');
      b.innerHTML = it.html;
      b.title = it.title;
      b.addEventListener('mousedown', (e) => { e.preventDefault(); it.run(); update(); });
      bar.appendChild(b);
    }
  }

  function hide(): void { bar.style.display = 'none'; }

  function update(): void {
    const { state } = editor;
    const sel = state.selection;
    const linkPopOpen = document.querySelector('.footnote-pop'); // reuse popover guard
    if (!editor.isEditable || sel.empty || !(sel instanceof TextSelection) || linkPopOpen) { hide(); return; }
    if (!editor.view.hasFocus() && !bar.contains(document.activeElement)) { hide(); return; }

    build();
    bar.style.display = 'flex';
    const start = editor.view.coordsAtPos(sel.from);
    const end = editor.view.coordsAtPos(sel.to);
    const mid = (start.left + end.left) / 2;
    const rect = bar.getBoundingClientRect();
    let left = mid - rect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
    let top = start.top - rect.height - 8;
    if (top < 8) top = end.bottom + 8; // flip below if no room above
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
  }

  editor.on('selectionUpdate', update);
  editor.on('transaction', update);
  editor.on('focus', update);
  editor.on('blur', () => window.setTimeout(() => { if (!bar.matches(':hover')) hide(); }, 120));
  window.addEventListener('scroll', hide, true);
}
