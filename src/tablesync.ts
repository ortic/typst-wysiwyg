// Sync resized table column widths into the doc so the Typst preview matches.
//
// prosemirror-tables only writes a `colwidth` attr to the *one* column whose
// handle you drag; every other column keeps `colwidth: null`. The serializer
// treats widths as all-or-nothing (serialize.ts `tableColumns`): if any column
// is unset it falls back to equal `1fr` columns, so dragging a single handle
// produced identical Typst and the preview never moved.
//
// After a resize leaves a table partially sized, we measure the rendered width
// of each still-unset column and write it in (history-free), so the doc fully
// describes the column proportions and serialize() emits matching `fr` widths.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export const tableColumnSyncKey = new PluginKey('tableColumnSync');

function colWidth(cell: PMNode): number | null {
  const cw = cell.attrs.colwidth as number[] | null;
  return cw && cw[0] ? cw[0] : null;
}

// True when the first row mixes explicit and unset column widths — the state a
// single dragged handle leaves behind. Spanning cells are skipped: their
// cell↔column mapping isn't 1:1, so we can't safely match DOM cells to columns.
function isPartiallyResized(row: PMNode): boolean {
  let hasWidth = false, hasNull = false, hasSpan = false;
  row.forEach((cell) => {
    if (((cell.attrs.colspan as number) ?? 1) > 1) hasSpan = true;
    if (colWidth(cell) != null) hasWidth = true; else hasNull = true;
  });
  return hasWidth && hasNull && !hasSpan;
}

function tableElement(dom: Node | null): HTMLElement | null {
  if (!(dom instanceof HTMLElement)) return null;
  return dom.tagName === 'TABLE' ? dom : dom.querySelector('table');
}

function syncWidths(view: EditorView): void {
  const tr = view.state.tr;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return undefined; // keep descending into containers
    const row = node.childCount ? node.child(0) : null;
    if (!row || !isPartiallyResized(row)) return false;

    const rowEl = tableElement(view.nodeDOM(pos))?.querySelector('tr');
    if (!rowEl) return false;
    const cellEls = rowEl.children;

    // Row content starts two tokens past the table position (table + row open).
    const rowStart = pos + 2;
    let i = 0;
    row.forEach((cell, offset) => {
      const cellEl = cellEls[i++] as HTMLElement | undefined;
      if (colWidth(cell) != null || !cellEl) return;
      const w = Math.round(cellEl.getBoundingClientRect().width);
      if (w > 0) tr.setNodeMarkup(rowStart + offset, undefined, { ...cell.attrs, colwidth: [w] });
    });
    return false;
  });

  if (tr.docChanged) {
    tr.setMeta('addToHistory', false);
    view.dispatch(tr);
  }
}

const tableColumnSyncPlugin = new Plugin({
  key: tableColumnSyncKey,
  view(view) {
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => { raf = 0; syncWidths(view); });
    };
    return {
      update: schedule,
      destroy() { if (raf) window.cancelAnimationFrame(raf); },
    };
  },
});

export const TableColumnSync = Extension.create({
  name: 'tableColumnSync',
  addProseMirrorPlugins() { return [tableColumnSyncPlugin]; },
});
