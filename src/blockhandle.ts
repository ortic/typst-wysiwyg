// The six-dot block handle (⠿) for the ProseMirror editor.
//
// It follows the cursor's top-level block, and clicking it opens a menu to
// change the block's style (heading / text / list / callout / raw) or move /
// insert / delete it — the same affordance the old per-block canvas had.

import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';

interface BlockInfo { pos: number; index: number; node: PMNode; dom: HTMLElement }

export function installBlockHandle(editor: Editor, pageEl: HTMLElement): void {
  const handle = document.createElement('div');
  handle.className = 'pm-handle';
  handle.textContent = '⠿';
  handle.title = 'Block options';
  handle.style.display = 'none';
  pageEl.appendChild(handle);

  let menu: HTMLElement | null = null;
  const closeMenu = () => { menu?.remove(); menu = null; };

  function currentBlock(): BlockInfo | null {
    const { selection, doc } = editor.state;
    const $from = selection.$from;
    if ($from.depth < 1) return null;
    const index = $from.index(0);
    const pos = $from.before(1);
    const node = doc.child(index);
    const dom = editor.view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return null;
    return { pos, index, node, dom };
  }

  function reposition(): void {
    if (menu) return; // don't move while the menu is open
    const info = currentBlock();
    if (!info || !editor.isEditable) { handle.style.display = 'none'; return; }
    const pmRect = pageEl.getBoundingClientRect();
    const r = info.dom.getBoundingClientRect();
    handle.style.display = 'flex';
    handle.style.top = `${r.top - pmRect.top + 2}px`;
    handle.style.left = '36px';
  }

  editor.on('selectionUpdate', reposition);
  editor.on('transaction', reposition);
  editor.on('focus', reposition);
  editor.on('create', reposition);

  // --- drag-to-reorder -----------------------------------------------------
  const indicator = document.createElement('div');
  indicator.className = 'drop-indicator';
  indicator.style.display = 'none';
  pageEl.appendChild(indicator);

  let dropIndex = 0;
  const topBlocks = (): HTMLElement[] => Array.from(editor.view.dom.children) as HTMLElement[];

  // Pointer-based drag (more robust than native HTML5 DnD, and testable). A
  // press that moves past a threshold is a drag; a plain click opens the menu.
  function computeDrop(clientY: number): void {
    const blocks = topBlocks();
    const pmRect = pageEl.getBoundingClientRect();
    dropIndex = blocks.length;
    for (let i = 0; i < blocks.length; i++) {
      const r = blocks[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) { dropIndex = i; break; }
    }
    const y = dropIndex < blocks.length
      ? blocks[dropIndex].getBoundingClientRect().top - pmRect.top
      : blocks[blocks.length - 1].getBoundingClientRect().bottom - pmRect.top;
    indicator.style.display = 'block';
    indicator.style.top = `${y - 1}px`;
  }

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
    const info = currentBlock();
    if (!info) return;
    const startY = e.clientY;
    let dragging = false;

    const onMove = (ev: MouseEvent) => {
      if (!dragging && Math.abs(ev.clientY - startY) < 4) return;
      dragging = true;
      handle.classList.add('dragging');
      computeDrop(ev.clientY);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      indicator.style.display = 'none';
      handle.classList.remove('dragging');
      if (dragging) moveToIndex(info.index, dropIndex);
      else openMenu(); // a plain click
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function moveToIndex(from: number, to: number): void {
    if (to === from || to === from + 1) return; // dropped in the same place
    editor.commands.command(({ state, tr, dispatch }) => {
      const node = state.doc.child(from);
      const posBefore = (i: number) => { let p = 0; for (let k = 0; k < i; k++) p += state.doc.child(k).nodeSize; return p; };
      const start = posBefore(from);
      const end = start + node.nodeSize;
      const insertAt = posBefore(to);
      if (!dispatch) return true;
      tr.delete(start, end);
      const mapped = tr.mapping.map(insertAt);
      tr.insert(mapped, node);
      tr.setSelection(TextSelection.near(tr.doc.resolve(mapped + 1)));
      tr.scrollIntoView();
      return true;
    });
    editor.commands.focus();
  }

  document.addEventListener('click', (e) => { if (menu && !menu.contains(e.target as Node) && e.target !== handle) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  function setType(run: () => void): void { closeMenu(); run(); editor.commands.focus(); reposition(); }

  function insertBelow(): void {
    const info = currentBlock();
    if (!info) return;
    const at = info.pos + info.node.nodeSize;
    closeMenu();
    editor.chain().insertContentAt(at, { type: 'paragraph' }).setTextSelection(at + 1).focus().run();
  }

  function deleteBlock(): void {
    const info = currentBlock();
    if (!info) return;
    closeMenu();
    if (editor.state.doc.childCount <= 1) {
      editor.chain().clearContent().setContent('<p></p>').focus().run();
      return;
    }
    editor.chain().focus().deleteRange({ from: info.pos, to: info.pos + info.node.nodeSize }).run();
  }

  function moveBlock(dir: -1 | 1): void {
    closeMenu();
    editor.commands.command(({ state, tr, dispatch }) => {
      const $from = state.selection.$from;
      const index = $from.index(0);
      const count = state.doc.childCount;
      const target = index + dir;
      if (target < 0 || target >= count) return false;
      if (!dispatch) return true;
      const node = state.doc.child(index);
      const from = $from.before(1);
      const to = from + node.nodeSize;
      const posBefore = (i: number) => { let p = 0; for (let k = 0; k < i; k++) p += state.doc.child(k).nodeSize; return p; };
      const insertOrig = dir < 0 ? posBefore(index - 1) : posBefore(index + 2);
      tr.delete(from, to);
      const mapped = tr.mapping.map(insertOrig);
      tr.insert(mapped, node);
      tr.setSelection(TextSelection.near(tr.doc.resolve(mapped + 1)));
      tr.scrollIntoView();
      return true;
    });
    editor.commands.focus();
    reposition();
  }

  function openMenu(): void {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'block-menu';
    const item = (key: string, label: string, fn: () => void, danger = false) => {
      const mi = document.createElement('div');
      mi.className = 'mi' + (danger ? ' danger' : '');
      mi.innerHTML = `<span class="k">${key}</span>`;
      mi.appendChild(document.createTextNode(label));
      mi.addEventListener('mousedown', (e) => e.preventDefault());
      mi.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return mi;
    };
    const sep = () => { const s = document.createElement('div'); s.className = 'sep'; return s; };

    m.append(
      item('H1', 'Heading 1', () => setType(() => editor.chain().focus().setHeading({ level: 1 }).run())),
      item('H2', 'Heading 2', () => setType(() => editor.chain().focus().setHeading({ level: 2 }).run())),
      item('H3', 'Heading 3', () => setType(() => editor.chain().focus().setHeading({ level: 3 }).run())),
      item('¶', 'Text', () => setType(() => editor.chain().focus().setParagraph().run())),
      item('•', 'Bullet list', () => setType(() => editor.chain().focus().toggleBulletList().run())),
      item('1.', 'Numbered list', () => setType(() => editor.chain().focus().toggleOrderedList().run())),
      item('❝', 'Callout', () => setType(() => editor.chain().focus().toggleWrap('callout').run())),
      item('</>', 'Raw Typst', () => setType(() => editor.chain().focus().toggleCodeBlock().run())),
      sep(),
      item('+', 'Insert below', insertBelow),
      item('↑', 'Move up', () => moveBlock(-1)),
      item('↓', 'Move down', () => moveBlock(1)),
      sep(),
      item('✕', 'Delete', deleteBlock, true),
    );

    document.body.appendChild(m);
    const r = handle.getBoundingClientRect();
    m.style.left = `${r.right + 6}px`;
    m.style.top = `${r.top}px`;
    const mr = m.getBoundingClientRect();
    if (mr.bottom > window.innerHeight) m.style.top = `${window.innerHeight - mr.height - 8}px`;
    menu = m;
  }
}
