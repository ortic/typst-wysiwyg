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

- **Content layer** — a true WYSIWYG canvas. Headings look like headings, lists like
  lists, the callout like a box. Type directly; **Enter** makes a new block,
  **Backspace** on an empty block removes it. Each block has a Notion-style handle to
  change its type, move, or delete it. A raw-Typst block is the power-user escape hatch.
- **Logic / style layer** — `#set` and `#let`, managed through the ribbon (Layout tab
  for page/text/paragraph settings, Insert → Definitions for `#let` bindings). Normal
  users never touch code.

### Templates

Because a document is just data, a **template is a saved document**. The picker is a
searchable modal of templates (Blank, Letter, Report, Invoice, Meeting Notes), each with
an icon.

## Features in this prototype

- Word-style **ribbon**: Home / Layout / Insert / View tabs.
- Inline **WYSIWYG editing** on a page-styled canvas, per-block conversion via a handle.
- **Live Typst preview** (compiled in the browser via WASM), hidden by default and
  toggled from the View tab.
- **Template gallery** with search and icons.
- **Export** to `.typ` and PDF.
- Built-in `callout` component and a **raw Typst** escape hatch.

## Tech

- [Vite](https://vitejs.dev/) + TypeScript, no UI framework (plain DOM) to keep the
  prototype small.
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
| `src/model.ts` | The document AST the editor owns (source of truth) |
| `src/generate.ts` | One-way AST → `.typ` compiler + markup escaping |
| `src/typst.ts` | typst.ts (WASM) wrapper: `renderSvg` / `renderPdf` |
| `src/templates.ts` | Templates as saved documents, plus picker icons |
| `src/main.ts` | Ribbon, canvas, modals, preview, export — the whole UI |

## Known limitations / next steps

- The canvas uses per-block `contentEditable`. It's the right choice for a prototype but
  fragile for production (cross-block selection, clipboard, undo/redo). The natural next
  step is a **ProseMirror/Lexical**-backed canvas.
- No inline formatting yet (bold / italic / links inside a paragraph).
- No structured editor for `#show` rules.
- No import of existing `.typ`.
- No desktop packaging (a Tauri shell is the intended path).

## License

[MIT](LICENSE) © Ortic

---

🤖 Built with [Claude Code](https://claude.com/claude-code).
