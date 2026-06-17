# typst-wysiwyg

A **prototype** for a WYSIWYG editor for [Typst](https://typst.app) — created using AI
(Claude Code).

It explores what a block-based, "normal user" friendly editor for Typst could look
like: you edit a real document on a page-styled canvas, while the Typst-specific
machinery (`#set` rules, `#let` definitions, templates) is managed through a familiar
Word-style ribbon instead of raw code.

> ⚠️ This is an early prototype / spike, not a finished product. It is meant to
> validate the core idea and UX, not to be production-ready.

![Word-style ribbon over a live document canvas.](docs/screenshot.png)

## The core idea

Typst isn't a document format — it's a programming language. So instead of trying to
round-trip arbitrary `.typ` files, the editor **owns a structured document model** and
compiles it one way to Typst:

```
structured model (JSON AST)  ──▶  generated .typ  ──▶  Typst compiler (WASM)  ──▶  SVG / PDF
```

There is deliberately **no Typst parser**: the prototype only creates new documents.
Import of existing `.typ` is a future, tightly-scoped concern.

### Two layers

- **Content layer** — a true WYSIWYG canvas backed by **ProseMirror** (via TipTap), so
  selection, clipboard, undo/redo and inline marks all behave like a real editor.
  Headings look like headings, lists like lists, the callout like a box. Type directly,
  use markdown-style shortcuts (`# `, `- `, `**bold**`), apply **bold / italic /
  strike / links** inline, and use the Notion-style six-dot handle (⠿) next to the
  current block to change its type, move, insert or delete it. A raw-Typst block is the
  power-user escape hatch.
- **Logic / style layer** — `#set`, `#let` and `#show`, managed through the ribbon
  (Layout tab for page/text/paragraph settings, Insert → Definitions for `#let`
  bindings, Insert → Show rules for a structured `#show` editor). Normal users never
  touch code.

### Templates

Because a document is just data, a **template is a saved document**. The picker is a
searchable modal of templates (Blank, Letter, Report, Invoice, Meeting Notes), each with
an icon.

## Features in this prototype

- Word-style **ribbon**: Home / Layout / Insert / View tabs.
- **ProseMirror-backed WYSIWYG editing** with real selection, clipboard, undo/redo and
  markdown-style input rules.
- **Inline formatting**: bold, italic, strike, links.
- **Block handle** (⠿) for changing block type, moving, inserting and deleting.
- Structured **`#show` rule editor** (restyle headings, emphasis, links, …) and a
  **`#let` definitions** editor.
- **Live Typst preview** (compiled in the browser via WASM), hidden by default and
  toggled from the View tab.
- **Typst source viewer** with syntax highlighting (View → Typst source).
- **Template gallery** with search and icons.
- **Export** to `.typ` and PDF.
- Built-in `callout` component and a **raw Typst** escape hatch.

## Tech

- [Vite](https://vitejs.dev/) + TypeScript, plain DOM for the chrome (ribbon/modals).
- [TipTap](https://tiptap.dev/) / [ProseMirror](https://prosemirror.net/) for the
  editing canvas.
- [`@myriaddreamin/typst.ts`](https://github.com/Myriad-Dreamin/typst.ts) — the Typst
  compiler + renderer compiled to WebAssembly, for live preview and export.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build
```

The first load fetches a ~28 MB WASM compiler; give it a moment on a cold start.

## Source map

| File | Role |
|------|------|
| `src/model.ts` | The logic layer the editor owns (`#set` / `#let` / `#show`) |
| `src/editor.ts` | TipTap/ProseMirror schema, custom Callout node, editor factory |
| `src/serialize.ts` | ProseMirror document → Typst markup (inc. inline marks) |
| `src/generate.ts` | Logic layer + serialized content → full `.typ` |
| `src/blockhandle.ts` | The six-dot block handle and its block-style menu |
| `src/typst.ts` | typst.ts (WASM) wrapper: `renderSvg` / `renderPdf` |
| `src/highlight.ts` | Lightweight Typst syntax highlighter for the source viewer |
| `src/templates.ts` | Templates (logic layer + ProseMirror content), picker icons |
| `src/main.ts` | Ribbon, modals, preview, export — the UI shell |

## Known limitations / next steps

- No import of existing `.typ` (the model is generated one-way only).
- The `#show` editor covers common text restyling; full function-style show rules
  (`#show heading: it => …`) still need the raw-Typst escape hatch.
- No desktop packaging yet (a Tauri shell is the intended path).
- No image/figure or table block yet (tables can be done via raw Typst).

## License

[MIT](LICENSE) © Ortic

---

🤖 Built with [Claude Code](https://claude.com/claude-code).
