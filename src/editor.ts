// TipTap (ProseMirror) editor: schema, custom nodes, and a factory.
//
// StarterKit gives us paragraph/heading/lists/bold/italic/strike/code/codeBlock
// /blockquote/history/hardBreak/horizontalRule plus markdown-style input rules.
// We add:
//   - Link (inline mark)
//   - Placeholder (empty-state hints)
//   - Callout (custom block node -> Typst `#callout[...]`)
// The codeBlock node doubles as the raw-Typst escape hatch.

import { Editor, Node, mergeAttributes, type Content } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'doc-callout' }), 0];
  },
});

export interface EditorHooks {
  onUpdate: () => void;
  onSelection: () => void;
}

export function createEditor(element: HTMLElement, content: Content, hooks: EditorHooks): Editor {
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // codeBlock is kept and reused as the raw-Typst block.
      }),
      Link.configure({ openOnClick: false, autolink: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({
        // Only the top-level empty block gets a hint — not every empty cell.
        includeChildren: false,
        placeholder: ({ node }) => {
          if (node.type.name === 'heading') return `Heading ${node.attrs.level}`;
          if (node.type.name === 'codeBlock') return 'Raw Typst…';
          return 'Type here, or use the ribbon…';
        },
      }),
      Callout,
    ],
    content,
    autofocus: true,
    onUpdate: hooks.onUpdate,
    onSelectionUpdate: hooks.onSelection,
  });
}
