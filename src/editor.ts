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
import Image from '@tiptap/extension-image';
import { createMathNodeView } from './mathview';

// Image node carries an extra `path` attribute: the Typst VFS path whose bytes
// live in assets.ts. The `src` (a data URL) is only for display in the editor.
const TypstImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      path: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-path'),
        renderHTML: (attrs) => (attrs.path ? { 'data-path': attrs.path } : {}),
      },
      width: {
        default: 80, // percent of the text width
        parseHTML: (el) => {
          const m = (el.style.width || '').match(/([\d.]+)%/);
          return m ? parseFloat(m[1]) : 80;
        },
        renderHTML: (attrs) => ({ style: `width: ${attrs.width}%` }),
      },
      border: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-border') === 'true',
        renderHTML: (attrs) => (attrs.border ? { 'data-border': 'true' } : {}),
      },
    };
  },
});

// Table carries style attributes the contextual "Table" tab edits.
const StyledTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      striped: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-striped') === 'true',
        renderHTML: (attrs) => (attrs.striped ? { 'data-striped': 'true' } : {}),
      },
      borders: {
        default: 'all', // 'all' | 'horizontal' | 'none'
        parseHTML: (el) => el.getAttribute('data-borders') || 'all',
        renderHTML: (attrs) => ({ 'data-borders': attrs.borders }),
      },
    };
  },
});

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      src: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-src') ?? '',
        renderHTML: (attrs) => ({ 'data-src': attrs.src }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-math]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-math': '' })];
  },
  addNodeView() {
    return (props) => createMathNodeView(props as never);
  },
});

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-pagebreak]' }];
  },
  renderHTML() {
    return ['div', { 'data-pagebreak': '', class: 'doc-pagebreak' }];
  },
});

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
      StyledTable.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TypstImage.configure({ allowBase64: true }),
      MathBlock,
      PageBreak,
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
