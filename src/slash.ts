// A lightweight slash (/) command menu. Typing "/" at the start of a block (or
// after a space) opens a filterable list of blocks to insert. Built as a plain
// ProseMirror plugin (no extra deps) with a floating DOM popup.

import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export interface SlashItem {
  title: string;
  hint?: string;
  keywords?: string;
  run: (editor: Editor) => void;
}

export interface SlashOptions {
  items: SlashItem[];
}

export const SlashMenu = Extension.create<SlashOptions>({
  name: 'slashMenu',
  addOptions() {
    return { items: [] };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const getItems = () => this.options.items;

    let active = false;
    let query = '';
    let range = { from: 0, to: 0 };
    let index = 0;
    let filtered: SlashItem[] = [];
    let popup: HTMLDivElement | null = null;

    const close = () => {
      active = false;
      query = '';
      index = 0;
      popup?.remove();
      popup = null;
    };

    const filterItems = () => {
      const q = query.toLowerCase();
      filtered = getItems().filter(
        (it) => !q || (it.title + ' ' + (it.keywords ?? '')).toLowerCase().includes(q),
      );
      if (index >= filtered.length) index = 0;
    };

    const render = () => {
      if (!active || !filtered.length) { popup?.remove(); popup = null; return; }
      if (!popup) {
        popup = document.createElement('div');
        popup.className = 'slash-menu';
        document.body.appendChild(popup);
      }
      popup.replaceChildren();
      filtered.forEach((it, i) => {
        const row = document.createElement('div');
        row.className = 'slash-item' + (i === index ? ' active' : '');
        const title = document.createElement('span');
        title.className = 'slash-title';
        title.textContent = it.title;
        row.appendChild(title);
        if (it.hint) {
          const hint = document.createElement('span');
          hint.className = 'slash-hint';
          hint.textContent = it.hint;
          row.appendChild(hint);
        }
        row.addEventListener('mousedown', (e) => { e.preventDefault(); select(i); });
        popup!.appendChild(row);
      });
      const coords = editor.view.coordsAtPos(range.from);
      popup.style.left = `${coords.left}px`;
      popup.style.top = `${coords.bottom + 4}px`;
      const r = popup.getBoundingClientRect();
      if (r.bottom > window.innerHeight) popup.style.top = `${coords.top - r.height - 4}px`;
    };

    const select = (i: number) => {
      const it = filtered[i];
      if (!it) { close(); return; }
      editor.chain().focus().deleteRange({ from: range.from, to: range.to }).run();
      close();
      it.run(editor);
    };

    const plugin = new Plugin({
      key: new PluginKey('slashMenu'),
      view() {
        return {
          update(view) {
            const { selection } = view.state;
            if (!selection.empty) { if (active) close(); return; }
            const $from = selection.$from;
            if ($from.parent.type.name === 'codeBlock') { if (active) close(); return; }
            const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
            const m = before.match(/(?:^|\s)\/(\w*)$/);
            if (m) {
              active = true;
              query = m[1];
              range = { from: selection.from - query.length - 1, to: selection.from };
              filterItems();
              render();
            } else if (active) {
              close();
            }
          },
          destroy() { close(); },
        };
      },
      props: {
        handleKeyDown(_view, event) {
          if (!active || !filtered.length) return false;
          if (event.key === 'ArrowDown') { index = (index + 1) % filtered.length; render(); return true; }
          if (event.key === 'ArrowUp') { index = (index - 1 + filtered.length) % filtered.length; render(); return true; }
          if (event.key === 'Enter') { select(index); return true; }
          if (event.key === 'Escape') { close(); return true; }
          return false;
        },
      },
    });
    return [plugin];
  },
});
