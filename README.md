# typst-wysiwyg

A **prototype** for a WYSIWYG editor for [Typst](https://typst.app) — created using AI
(Claude Code).

It explores what a block-based, "normal user" friendly editor for Typst could look
like: you edit a real document on a page-styled canvas, while the Typst-specific
machinery (`#set` rules, `#let` definitions, templates) is managed through a familiar
Word-style ribbon instead of raw code.

### ▶ [Try the live demo](https://ortic.github.io/typst-wysiwyg/)

The Typst compiler runs entirely in your browser via WebAssembly — nothing is uploaded.
The first load fetches a ~28 MB compiler, so give it a moment.

> ⚠️ This is an early prototype / spike, not a finished product. It is meant to
> validate the core idea and UX, not to be production-ready.

![The editor (left) with a live Typst preview (right).](docs/screenshot.png)

## The core idea

Typst isn't a document format — it's a programming language. So instead of trying to
round-trip arbitrary `.typ` files, the editor **owns a structured document model** and
compiles it one way to Typst:

```
structured model (JSON AST)  ──▶  generated .typ  ──▶  Typst compiler (WASM)  ──▶  SVG / PDF
```

Save writes a `.typ` that is real Typst source **and** carries the editable state in a
trailing comment, so the editor's own files round-trip exactly; other `.typ` files are
imported best-effort (see `typimport.ts`).

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
- **Tables** — editable (add/remove rows & columns, resizable), full-width, serialized
  to `#table(...)`.
- **Images** — insert, drag-and-drop or paste a picture; it renders in the live preview
  too (the bytes are fed to the Typst compiler's virtual filesystem). Inline editable
  **figure captions** → `#figure(image(..), caption: [..])`.
- **Equations** — a block equation with a live-rendered (Typst-compiled) preview above an
  editable source field; serializes to `$ … $`.
- **Inline math** — render Typst math at text size inside a paragraph; serializes to `$…$`.
- **Page breaks** (`#pagebreak()`) and **footnotes** (inline marker + popover editor →
  `#footnote[…]`).
- **Block handle** (⠿) for changing block type, moving, inserting and deleting.
- **Context-sensitive ribbon tabs** (Word-style): selecting an image shows an **Image**
  tab (width, border); working in a table shows a **Table** tab (rows/columns, header,
  striped, borders).
- **Slash (`/`) menu** to insert any block by typing, with search and keyboard nav.
- **Selection bubble toolbar** (bold / italic / strike / code / link) and **drag-to-reorder**
  blocks from the handle.
- **Inline formatting**: bold, italic, strike, inline code, links, **text colour** and
  **highlight**.
- **Find & replace** (Ctrl/Cmd+F) with highlighted matches, and an **outline / TOC** panel.
- **Page setup**: paper, margins, font (with suggestions), size, leading, justification,
  **page numbers, header and footer**.
- **Save / open `.typ`** by default — the saved file is real Typst source that also
  carries the editable state in a trailing comment, so your own documents round-trip
  exactly; any other `.typ` is imported best-effort (prose structured, the rest kept as
  raw blocks). Plus **autosave** to the browser (Ctrl/Cmd+S), and native file dialogs in
  the desktop build.
- Structured **`#show` rule editor** (restyle headings, emphasis, links, …) and a
  **`#let` definitions** editor.
- **Live Typst preview** (compiled in the browser via WASM) with friendly compile errors,
  hidden by default and toggled from the View tab.
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

## Desktop app (Tauri showcase)

The same frontend is packaged as a native desktop app with [Tauri](https://tauri.app)
(`src-tauri/`). The Typst compiler still runs in the embedded webview's WASM — there is
no separate backend. The desktop build adds a couple of things the browser can't:
**native Open/Save/Export dialogs** writing straight to disk, and it hides the in-app
title since the OS window already shows it.

Prerequisites: the [Rust toolchain](https://www.rust-lang.org/tools/install) and your
platform's Tauri system dependencies (on Linux, WebKitGTK — see the
[Tauri prerequisites](https://tauri.app/start/prerequisites/)).

```bash
npm install
npm run tauri:dev      # run the desktop app against the dev server
npm run tauri:build    # produce a native installer in src-tauri/target/release/bundle
```

The Vite `base` switches automatically: `/typst-wysiwyg/` for the GitHub Pages demo,
relative (`./`) for the Tauri bundle (`--mode tauri`), and `/` for `npm run dev`.

> The repo ships the Tauri scaffold (config, Rust entrypoint, capabilities, icons); a
> binary is produced by `tauri:build` on a machine with the Rust + webview prerequisites.

## Source map

| File | Role |
|------|------|
| `src/model.ts` | The logic layer the editor owns (`#set` / `#let` / `#show`) |
| `src/editor.ts` | TipTap/ProseMirror schema, custom nodes, editor factory |
| `src/serialize.ts` | ProseMirror document → Typst markup (inc. inline marks) |
| `src/generate.ts` | Logic layer + serialized content → full `.typ` |
| `src/blockhandle.ts` | The six-dot block handle: menu + drag-to-reorder |
| `src/bubble.ts` | Selection formatting toolbar |
| `src/slash.ts` | The `/` command menu |
| `src/search.ts` | Find & replace plugin + helpers |
| `src/{math,mathinline,footnote,image}view.ts` | NodeViews (live math, footnote, figure) |
| `src/desktop.ts` | Native file dialogs (Tauri) |
| `src/typst.ts` / `src/assets.ts` | WASM compiler wrapper + image asset store |
| `src/templates.ts` | Templates (logic layer + ProseMirror content), picker icons |
| `src/main.ts` | Ribbon, modals, preview, export — the UI shell |

## Roadmap / next steps

Most of the editor is in place (see Features). What's left:

- **References & citations** — labels + cross-references (`<label>` / `@ref`), and
  `#cite` / `#bibliography`.
- **Multi-column layout** and a dedicated (display) **code listing** block, distinct from
  the raw-Typst escape hatch.
- **Richer `.typ` import** — the importer covers prose, lists and callouts and keeps the
  rest as raw blocks; it could grow to parse tables, figures, `#let`/`#show`, etc.
- **Full function-style `#show` rules** (`#show heading: it => …`); the structured editor
  covers common text restyling, the rest still uses the raw-Typst escape hatch.
- **User templates** (save the current document as a template) and **per-section page
  setups**.
- **Engineering**: golden round-trip serializer tests, map compile errors back to the
  offending block, and compile in a web worker for large documents.
- **Explicitly deferred**: real-time collaboration (single-user, local-first for now).

## License

[MIT](LICENSE) © Ortic

---

🤖 Built with [Claude Code](https://claude.com/claude-code).
