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
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Heading from '@tiptap/extension-heading';
import { TableColumnSync } from './tablesync';

// Headings can carry a Typst label (`= Title <label>`) referenced by @label.
const LabeledHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-label'),
        renderHTML: (attrs) => (attrs.label ? { 'data-label': attrs.label } : {}),
      },
    };
  },
});

// Inline cross-reference: @label.
const Reference = Node.create({
  name: 'reference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-ref') ?? '',
        renderHTML: (attrs) => ({ 'data-ref': attrs.target }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-ref]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'doc-ref' }), `@${node.attrs.target}`];
  },
});
import { createMathNodeView } from './mathview';
import { createMathInlineView } from './mathinlineview';
import { createFootnoteView } from './footnoteview';
import { createImageNodeView } from './imageview';
import { SlashMenu, type SlashItem } from './slash';
import { Search } from './search';
import { Pagination } from './pagination';

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
      // Figure label (e.g. <fig:sun>) so cross-references survive round-trip.
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-label') || null,
        renderHTML: (attrs) => (attrs.label ? { 'data-label': attrs.label } : {}),
      },
    };
  },
  addNodeView() {
    return (props) => createImageNodeView(props as never);
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
      // Original #table(...) styling args (columns/align/stroke/…), kept verbatim
      // for imported tables so re-saving doesn't reset them to the editor's style.
      rawArgs: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-raw-args') || null,
        renderHTML: (attrs) => (attrs.rawArgs ? { 'data-raw-args': attrs.rawArgs } : {}),
      },
      // Caption + label when the table was written as
      // #figure(table(...), caption: […]) <label>.
      caption: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-caption') || null,
        renderHTML: (attrs) => (attrs.caption ? { 'data-caption': attrs.caption } : {}),
      },
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-label') || null,
        renderHTML: (attrs) => (attrs.label ? { 'data-label': attrs.label } : {}),
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

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
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
    return [{ tag: 'span[data-math-inline]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-math-inline': '', class: 'math-inline' })];
  },
  addNodeView() {
    return (props) => createMathInlineView(props as never);
  },
});

export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      content: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-content') ?? '',
        renderHTML: (attrs) => ({ 'data-content': attrs.content }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'sup[data-footnote]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { 'data-footnote': '', class: 'footnote-marker' }), '*'];
  },
  addNodeView() {
    return (props) => createFootnoteView(props as never);
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

export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      count: {
        default: 2,
        parseHTML: (el) => parseInt(el.getAttribute('data-columns') || '2', 10),
        renderHTML: (attrs) => ({ 'data-columns': String(attrs.count) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-columns]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'doc-columns' }), 0];
  },
});

// Source code shown verbatim as a Typst raw listing (```lang … ```), distinct
// from the raw-Typst escape hatch (codeBlock). Editable plain text with a
// language tag that drives Typst's syntax highlighting in the output.
export const CodeListing = Node.create({
  name: 'codeListing',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      language: {
        default: 'text',
        parseHTML: (el) => el.getAttribute('data-lang') || 'text',
        renderHTML: (attrs) => ({ 'data-lang': attrs.language }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'pre[data-listing]', preserveWhitespace: 'full' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['pre', mergeAttributes(HTMLAttributes, { 'data-listing': '', class: 'doc-listing' }), ['code', {}, 0]];
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

/**
 * The full extension list. Pulled out of createEditor so the same schema can be
 * built headless (via getSchema) for round-trip serializer tests.
 */
export function buildExtensions(slashItems: SlashItem[]) {
  return [
    Search,
    Pagination,
    SlashMenu.configure({ items: slashItems }),
    StarterKit.configure({
      heading: false, // replaced by LabeledHeading
      // codeBlock is kept and reused as the raw-Typst block.
    }),
    LabeledHeading.configure({ levels: [1, 2, 3] }),
    Reference,
    Link.configure({ openOnClick: false, autolink: true }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    StyledTable.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TableColumnSync,
    TypstImage.configure({ allowBase64: true }),
    MathBlock,
    MathInline,
    PageBreak,
    Footnote,
    Columns,
    CodeListing,
    Placeholder.configure({
      // Only the top-level empty block gets a hint — not every empty cell.
      includeChildren: false,
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return `Heading ${node.attrs.level}`;
        if (node.type.name === 'codeBlock') return 'Raw Typst…';
        if (node.type.name === 'codeListing') return 'Code listing…';
        return 'Type here, or use the ribbon…';
      },
    }),
    Callout,
  ];
}

export function createEditor(element: HTMLElement, content: Content, hooks: EditorHooks, slashItems: SlashItem[]): Editor {
  return new Editor({
    element,
    extensions: buildExtensions(slashItems),
    content,
    autofocus: true,
    onUpdate: hooks.onUpdate,
    onSelectionUpdate: hooks.onSelection,
  });
}
