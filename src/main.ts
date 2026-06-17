import './styles.css';
import type { Editor } from '@tiptap/core';
import type { DocLogic, LetBinding, ShowRule, ShowTarget } from './model';
import { uid } from './model';
import { generate, bibPath, extractCitationKeys } from './generate';
import { renderSvg, renderPdf } from './typst';
import { TEMPLATES, TEMPLATE_ICONS } from './templates';
import { highlightTypst } from './highlight';
import { createEditor } from './editor';
import { installBlockHandle } from './blockhandle';
import { installBubbleMenu } from './bubble';
import { addAsset, assets, clearAssets } from './assets';
import type { SlashItem } from './slash';
import { isDesktop, saveTextDialog, saveBytesDialog, openTextDialog } from './desktop';
import { setSearch, searchNav, searchStatus, replaceCurrent, replaceAll, clearSearch } from './search';
import { STATE_MARKER, extractEmbeddedState, importTypst } from './typimport';
import { pageConfig, relayoutPages } from './pagination';

// The "/" command menu — insert any block by typing. `pickImage` is referenced
// before its declaration but only called at runtime, so the hoist is fine.
const SLASH_ITEMS: SlashItem[] = [
  { title: 'Heading 1', hint: '#', keywords: 'h1 title', run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { title: 'Heading 2', hint: '##', keywords: 'h2', run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { title: 'Heading 3', hint: '###', keywords: 'h3 subhead', run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { title: 'Text', keywords: 'paragraph body', run: (e) => e.chain().focus().setParagraph().run() },
  { title: 'Bullet list', hint: '-', keywords: 'unordered', run: (e) => e.chain().focus().toggleBulletList().run() },
  { title: 'Numbered list', hint: '1.', keywords: 'ordered', run: (e) => e.chain().focus().toggleOrderedList().run() },
  { title: 'Callout', keywords: 'note admonition', run: (e) => e.chain().focus().toggleWrap('callout').run() },
  { title: 'Table', keywords: 'grid', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: 'Image', keywords: 'picture photo', run: () => pickImage() },
  { title: 'Equation', keywords: 'math block', run: (e) => e.chain().focus().insertContent({ type: 'mathBlock', attrs: { src: 'x^2 + y^2 = z^2' } }).run() },
  { title: 'Inline math', keywords: 'math', run: (e) => e.chain().focus().insertContent({ type: 'mathInline', attrs: { src: 'x^2' } }).run() },
  { title: 'Footnote', keywords: 'reference note', run: (e) => e.chain().focus().insertContent({ type: 'footnote', attrs: { content: '' } }).run() },
  { title: 'Columns', keywords: 'multi-column section', run: (e) => e.chain().focus().insertContent({ type: 'columns', attrs: { count: 2 }, content: [{ type: 'paragraph' }] }).run() },
  { title: 'Page break', keywords: 'pagebreak', run: (e) => e.chain().focus().insertContent({ type: 'pageBreak' }).run() },
  { title: 'Code listing', keywords: 'source code snippet program syntax', run: () => insertCodeListing() },
  { title: 'Raw Typst', hint: '</>', keywords: 'code escape', run: (e) => e.chain().focus().toggleCodeBlock().run() },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const initial = TEMPLATES.find((t) => t.id === 'report')!.make();
let logic: DocLogic = initial.logic;
let previewVisible = false;
type TabId = 'home' | 'layout' | 'insert' | 'view' | 'image' | 'table' | 'columns';
let activeTab: TabId = 'home';
let editor!: Editor;

const app = document.querySelector<HTMLDivElement>('#app')!;

// Font suggestions for the Layout font field (free text still allowed).
const FONT_SUGGESTIONS = [
  'Linux Libertine', 'New Computer Modern', 'Libertinus Serif', 'DejaVu Sans', 'DejaVu Serif',
  'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New', 'Fira Sans', 'Source Sans Pro',
  'Noto Sans', 'Noto Serif',
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

// ---------------------------------------------------------------------------
// Typst preview (debounced)
// ---------------------------------------------------------------------------
const previewPane = el('div', { class: 'preview hidden' });
let previewTimer: number | undefined;

function schedulePreview(): void {
  scheduleAutosave(); // every change path runs through here
  if (!previewVisible) return;
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(refreshPreview, 300);
}
async function refreshPreview(): Promise<void> {
  if (!previewVisible) return;
  const source = generate(logic, editor.state.doc);
  try {
    const svg = await renderSvg(source);
    const holder = el('div', { class: 'pg' });
    holder.innerHTML = svg;
    previewPane.replaceChildren(holder);
  } catch (e) {
    previewPane.replaceChildren(formatCompileError(e));
  }
}

/** Pull the human-readable message(s) and hints out of a Typst diagnostic. */
function formatCompileError(e: unknown): HTMLElement {
  const raw = String(e);
  const messages = [...raw.matchAll(/message:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\"/g, '"'));
  const hints = [...raw.matchAll(/hints:\s*\[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((h) => h[1]));
  const box = el('div', { class: 'err' });
  box.append(el('div', { class: 'err-title' }, 'Typst compile error'));
  if (messages.length) {
    for (const m of messages) box.append(el('div', { class: 'err-msg' }, m));
  } else {
    box.append(el('div', { class: 'err-msg' }, raw.slice(0, 400)));
  }
  for (const h of hints) box.append(el('div', { class: 'err-hint' }, `hint: ${h}`));

  // The compiler only gives opaque span IDs, not source ranges, so we can't map
  // an error to a block precisely. Heuristic: if the message names an identifier
  // that appears in exactly one raw/math block, offer to jump there.
  const loc = locateError(messages);
  if (loc) {
    const jump = el('button', { class: 'err-jump' }, `Jump to ${loc.label}`);
    jump.onclick = () => editor.chain().focus().setTextSelection(loc.pos).scrollIntoView().run();
    box.append(jump);
  }
  return box;
}

/** Try to pin a compile error to a raw/math block by the identifier it names. */
function locateError(messages: string[]): { pos: number; label: string } | null {
  // Identifiers Typst tends to quote: `unknown variable: foo`, `unknown function: bar`.
  const tokens = new Set<string>();
  for (const m of messages) {
    for (const t of m.matchAll(/(?:variable|function|name|label|key|field)[:\s]+`?([A-Za-z_][\w-]*)`?/g)) tokens.add(t[1]);
    for (const t of m.matchAll(/`([A-Za-z_][\w.-]*)`/g)) tokens.add(t[1]);
  }
  if (!tokens.size) return null;
  const CODE = new Set(['codeBlock', 'codeListing', 'mathBlock', 'mathInline']);
  let hit: { pos: number; label: string } | null = null;
  let count = 0;
  editor.state.doc.descendants((node, pos) => {
    if (!CODE.has(node.type.name)) return;
    const text = node.type.name === 'mathBlock' || node.type.name === 'mathInline'
      ? String(node.attrs.src ?? '') : node.textContent;
    if ([...tokens].some((t) => text.includes(t))) {
      count++;
      const labelName = node.type.name === 'codeListing' ? 'code listing'
        : node.type.name === 'codeBlock' ? 'raw Typst block' : 'equation';
      hit = { pos: pos + 1, label: labelName };
    }
  });
  // Only offer the jump when the match is unambiguous.
  return count === 1 ? hit : null;
}

// ---------------------------------------------------------------------------
// Editor (TipTap / ProseMirror)
// ---------------------------------------------------------------------------
const canvasWrap = el('div', { class: 'canvas-wrap' });
const pageEl = el('div', { class: 'page' });
canvasWrap.append(pageEl);

// Outline / table-of-contents panel (left of the canvas).
const outlinePanel = el('aside', { class: 'outline hidden' });
let outlineVisible = false;

function rebuildOutline(): void {
  if (!outlineVisible) return;
  const items: HTMLElement[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return;
    const level = node.attrs.level as number;
    const row = el('div', { class: `outline-item lvl${level}` }, node.textContent || '(empty heading)');
    row.onclick = () => editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
    items.push(row);
  });
  outlinePanel.replaceChildren(
    el('div', { class: 'outline-title' }, 'Outline'),
    ...(items.length ? items : [el('div', { class: 'muted', style: 'padding:6px 4px' }, 'No headings yet.')]),
  );
}

function toggleOutline(): void {
  outlineVisible = !outlineVisible;
  outlinePanel.classList.toggle('hidden', !outlineVisible);
  renderRibbon();
  rebuildOutline();
}

function mountEditor(content: object): void {
  editor = createEditor(pageEl, content as never, {
    onUpdate: () => { schedulePreview(); syncContextualTabs(); rebuildOutline(); },
    onSelection: syncContextualTabs,
  }, SLASH_ITEMS);
  installBlockHandle(editor, pageEl);
  installBubbleMenu(editor, setLink);
  installImageDropPaste(pageEl);
  syncJustify(); syncColumns(); syncNumbering(); syncBibliography(); syncPageMetrics();
}

function syncJustify(): void {
  pageEl.classList.toggle('justify', logic.style.par.justify);
}

function syncColumns(): void {
  const n = logic.style.page.columns ?? 1;
  pageEl.classList.remove('cols-2', 'cols-3');
  if (n === 2) pageEl.classList.add('cols-2');
  else if (n >= 3) pageEl.classList.add('cols-3');
}

function syncNumbering(): void {
  pageEl.classList.toggle('numbered', !!logic.style.page.headingNumbering);
}

// Mirror logic.bibliography into the compiler's VFS so #bibliography("/refs.…")
// resolves. The bytes also ride along in the saved document's `assets` map.
function syncBibliography(): void {
  for (const p of [...assets.keys()]) if (/^\/refs\.(bib|yml)$/.test(p)) assets.delete(p);
  const bib = logic.bibliography;
  if (bib && bib.content.trim()) {
    assets.set(bibPath(bib.format), new TextEncoder().encode(bib.content));
  }
}

// Render the editor sheet as a faithful scaled copy of the Typst page so line
// breaks match: the A4/Letter/A5 sheet is shown at SHEET_W px wide and the font
// size, margins and leading are scaled to that, derived from the document.
const SHEET_W = 660;
const MM_PX = 96 / 25.4; // CSS px per mm at 96dpi
const PAPER_MM: Record<string, { w: number; h: number }> = {
  a4: { w: 210, h: 297 },
  'us-letter': { w: 215.9, h: 279.4 },
  a5: { w: 148, h: 210 },
};
function syncPageMetrics(): void {
  const dims = PAPER_MM[logic.style.page.paper] ?? PAPER_MM.a4;
  const scale = SHEET_W / (dims.w * MM_PX);
  const fontPx = logic.style.text.sizePt * (96 / 72) * scale;
  const marginPx = logic.style.page.marginCm * 10 * MM_PX * scale;
  const pageHpx = Math.round(SHEET_W * dims.h / dims.w);
  pageEl.style.fontSize = `${fontPx.toFixed(2)}px`;
  pageEl.style.padding = `${marginPx.toFixed(1)}px`;
  pageEl.style.lineHeight = String(1 + logic.style.par.leadingEm);
  pageEl.style.setProperty('--page-h', `${pageHpx}px`);
  pageEl.style.setProperty('--page-gutter', `${pageConfig.gutter}px`);
  pageConfig.pageH = pageHpx;
  pageConfig.margin = marginPx;
  if (editor) relayoutPages(editor.view);
}

function cmd(run: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>): void {
  run(editor.chain().focus()).run();
}

function setLink(): void {
  const prev = (editor.getAttributes('link').href as string) || 'https://';
  const url = window.prompt('Link URL (empty to remove)', prev);
  if (url === null) return;
  if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
  else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
}

// Hidden file input reused for every image insert.
const imageInput = el('input', { type: 'file', accept: 'image/*' }) as HTMLInputElement;
imageInput.style.display = 'none';
document.body.appendChild(imageInput);

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function insertImageFile(file: File, pos?: number): Promise<void> {
  if (!file.type.startsWith('image/')) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = file.name.split('.').pop() || 'png';
  const path = addAsset(bytes, ext); // bytes go to the Typst VFS; path is referenced
  const src = await readDataUrl(file); // data URL only for editor display
  const content = { type: 'image', attrs: { src, path, alt: '' } };
  if (pos != null) editor.chain().focus().insertContentAt(pos, content).run();
  else editor.chain().focus().insertContent(content).run();
  schedulePreview();
}

function pickImage(): void {
  imageInput.value = '';
  imageInput.onchange = async () => {
    const file = imageInput.files?.[0];
    if (file) await insertImageFile(file);
  };
  imageInput.click();
}

/** Drag image files onto the page, or paste them from the clipboard. */
function installImageDropPaste(page: HTMLElement): void {
  page.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); page.classList.add('drag-over'); }
  });
  page.addEventListener('dragleave', (e) => { if (e.target === page) page.classList.remove('drag-over'); });
  page.addEventListener('drop', async (e) => {
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
    page.classList.remove('drag-over');
    if (!files.length) return;
    e.preventDefault();
    const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos;
    for (const file of files) await insertImageFile(file, pos);
  });
  page.addEventListener('paste', async (e) => {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    for (const file of files) await insertImageFile(file);
  });
}

// ---------------------------------------------------------------------------
// Ribbon
// ---------------------------------------------------------------------------
const ribbonBody = el('div', { class: 'ribbon-body' });
const tabStrip = el('div', { class: 'tabstrip' });

function ribbon(): HTMLElement {
  const bar = el('div', { class: 'ribbon' });
  bar.append(tabStrip, ribbonBody);
  return bar;
}

/** The tabs to show — base tabs plus contextual ones for the current selection. */
function visibleTabs(): { id: TabId; label: string; ctx?: boolean }[] {
  const tabs: { id: TabId; label: string; ctx?: boolean }[] = [
    { id: 'home', label: 'Home' }, { id: 'layout', label: 'Layout' },
    { id: 'insert', label: 'Insert' }, { id: 'view', label: 'View' },
  ];
  if (editor?.isActive('image')) tabs.push({ id: 'image', label: 'Image', ctx: true });
  if (editor?.isActive('table')) tabs.push({ id: 'table', label: 'Table', ctx: true });
  if (editor?.isActive('columns')) tabs.push({ id: 'columns', label: 'Columns', ctx: true });
  return tabs;
}

/** Show/auto-activate contextual tabs as the selection changes. */
function syncContextualTabs(): void {
  const onImage = editor.isActive('image');
  const inTable = editor.isActive('table');
  if (onImage && activeTab !== 'image') activeTab = 'image'; // selecting an image jumps to its tab
  else if (!onImage && activeTab === 'image') activeTab = 'home';
  if (!inTable && activeTab === 'table') activeTab = 'home';
  if (!editor.isActive('columns') && activeTab === 'columns') activeTab = 'home';
  renderRibbon();
}

function renderRibbon(): void {
  const tabs = visibleTabs();
  if (!tabs.some((t) => t.id === activeTab)) activeTab = 'home';
  tabStrip.replaceChildren();
  for (const t of tabs) {
    const btn = el('button', { class: 'tab' + (activeTab === t.id ? ' active' : '') + (t.ctx ? ' tab-ctx' : '') }, t.label);
    btn.onclick = () => { activeTab = t.id; renderRibbon(); };
    tabStrip.append(btn);
  }
  tabStrip.append(el('span', { class: 'tab-spacer' }), el('span', { class: 'save-status' }, ''));
  // The desktop window already shows the app name in its native title bar.
  if (!isDesktop()) {
    tabStrip.append(
      el('span', { class: 'brand' }, el('span', { class: 'app' }, 'Typst WYSIWYG'), el('span', { class: 'muted' }, 'spike')),
    );
  }
  ribbonBody.replaceChildren(...ribbonGroups());
}

function group(label: string, ...controls: Node[]): HTMLElement {
  return el('div', { class: 'rgroup' }, el('div', { class: 'rcontrols' }, ...controls), el('div', { class: 'glabel' }, label));
}
function rbtn(icon: string, label: string, onClick: () => void, active = false): HTMLElement {
  const ico = el('span', { class: 'ico' });
  if (icon.startsWith('<svg')) ico.innerHTML = icon;
  else ico.textContent = icon;
  const b = el('button', { class: 'rbtn' + (active ? ' active' : '') }, ico, el('span', {}, label));
  // Don't steal focus from the editor, so commands apply to the current selection.
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.onclick = onClick;
  return b;
}

const LINK_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>';
const TABLE_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/></svg>';
const IMAGE_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg>';
const PAGEBREAK_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h7l5 5v3"/><path d="M13 3v5h5"/><path d="M6 21h7l5-5"/><path d="M3 14h18" stroke-dasharray="2 2"/></svg>';
const OPEN_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const SAVE_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h12l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v6h8V3M8 14h8"/></svg>';
const SEARCH_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
const COLUMNS_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/></svg>';
const LABEL_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v5l9 9 7-7-9-9H3z"/><circle cx="7" cy="11" r="1.3" fill="currentColor" stroke="none"/></svg>';

/** Attach a Typst label to the current heading (referenced by @label). */
/** Insert a syntax-highlighted code listing, prompting for the language. */
function insertCodeListing(): void {
  const lang = (window.prompt('Language for the code listing (e.g. python, rust, js):', 'python') ?? '').trim().toLowerCase() || 'text';
  editor.chain().focus().insertContent({
    type: 'codeListing',
    attrs: { language: lang },
    content: [{ type: 'text', text: 'code here' }],
  }).run();
  schedulePreview();
}

function setHeadingLabel(): void {
  if (!editor.isActive('heading')) { alert('Place the cursor in a heading first, then add a label.'); return; }
  const current = (editor.getAttributes('heading').label as string) || '';
  const input = window.prompt('Label for this heading (letters, digits, - and _):', current);
  if (input === null) return;
  const label = input.trim().replace(/[^\w-]/g, '-').replace(/^-+|-+$/g, '');
  editor.chain().focus().updateAttributes('heading', { label: label || null }).run();
  schedulePreview();
}

interface LabelInfo { label: string; text: string }
function collectLabels(): LabelInfo[] {
  const out: LabelInfo[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'heading' && node.attrs.label) out.push({ label: node.attrs.label as string, text: node.textContent });
  });
  return out;
}

/** Insert an @reference, picking from labelled headings or bibliography keys. */
function insertReference(): void {
  const labels = collectLabels();
  const bibKeys = logic.bibliography ? extractCitationKeys(logic.bibliography) : [];
  if (!labels.length && !bibKeys.length) {
    alert('Nothing to reference yet. Add a heading label (Insert › Label) or a bibliography (Insert › Bibliography).');
    return;
  }
  const modal = el('div', { class: 'modal' });
  const list = el('div', { class: 'def-list' });
  const pick = (target: string, isCitation: boolean) => {
    editor.chain().focus().insertContent({ type: 'reference', attrs: { target } }).run();
    // Heading references need numbering; citations resolve via #bibliography.
    if (!isCitation && !logic.style.page.headingNumbering) {
      logic.style.page.headingNumbering = true; syncNumbering(); renderRibbon();
    }
    closeModal();
    schedulePreview();
  };
  for (const l of labels) {
    const row = el('div', { class: 'ref-pick' }, el('span', { class: 'ref-tag' }, `@${l.label}`), el('span', { class: 'ref-text' }, l.text || '(untitled)'));
    row.onclick = () => pick(l.label, false);
    list.append(row);
  }
  for (const k of bibKeys) {
    const row = el('div', { class: 'ref-pick' }, el('span', { class: 'ref-tag cite' }, `@${k}`), el('span', { class: 'ref-text' }, 'citation'));
    row.onclick = () => pick(k, true);
    list.append(row);
  }
  modal.append(el('div', { class: 'modal-head' }, el('h3', {}, 'Insert reference'), el('div', { class: 'muted' }, 'Cross-reference a heading or cite a bibliography entry (@key).')), list);
  openModal(modal);
}

/** Edit the document bibliography (BibTeX or Hayagriva YAML). */
function openBibliographyModal(): void {
  const bib = logic.bibliography ?? { format: 'bibtex' as const, content: '' };
  const modal = el('div', { class: 'modal modal-wide' });
  const fmt = el('select', {}) as HTMLSelectElement;
  for (const [v, label] of [['bibtex', 'BibTeX (.bib)'], ['yaml', 'Hayagriva (.yml)']] as const) {
    const o = el('option', { value: v }, label);
    if (bib.format === v) o.selected = true;
    fmt.append(o);
  }
  const ta = el('textarea', { class: 'bib-area', rows: '14', spellcheck: 'false',
    placeholder: '@article{smith2020,\n  title = {A Study},\n  author = {Smith, Jane},\n  year = {2020},\n}' }) as HTMLTextAreaElement;
  ta.value = bib.content;
  const save = el('button', { class: 'btn primary' }, 'Save bibliography');
  save.onclick = () => {
    const content = ta.value.trim();
    logic.bibliography = content ? { format: fmt.value as 'bibtex' | 'yaml', content } : undefined;
    syncBibliography();
    closeModal();
    schedulePreview();
  };
  const clear = el('button', { class: 'btn' }, 'Remove');
  clear.onclick = () => { logic.bibliography = undefined; syncBibliography(); closeModal(); schedulePreview(); };
  modal.append(
    el('div', { class: 'modal-head' }, el('h3', {}, 'Bibliography'),
      el('div', { class: 'muted' }, 'Paste references, then cite them with Insert › Reference. Saved with the document.')),
    el('label', { class: 'rfield' }, el('span', {}, 'Format'), fmt),
    ta,
    el('div', { class: 'modal-foot' }, clear, save),
  );
  openModal(modal);
}
function rfield(label: string, control: Node): HTMLElement {
  return el('label', { class: 'rfield' }, el('span', {}, label), control);
}

const HIGHLIGHT_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14l-3 3v3h3l3-3"/><path d="M13 10l4-4a2 2 0 0 1 3 3l-4 4z"/><path d="M9 14l5-5 1 1-5 5z" fill="currentColor"/></svg>';

/** Text-colour control: an "A" whose underline shows the colour; opens a picker. */
function colorControl(): HTMLElement {
  const current = (editor.getAttributes('textStyle').color as string) || '#1e2330';
  const wrap = el('label', { class: 'rbtn color-btn', title: 'Text color' });
  const ico = el('span', { class: 'ico' }, 'A');
  ico.style.borderBottom = `3px solid ${current}`;
  ico.style.lineHeight = '15px';
  const input = el('input', { type: 'color', class: 'color-hidden' }) as HTMLInputElement;
  input.value = current;
  input.oninput = () => { editor.chain().focus().setColor(input.value).run(); renderRibbon(); schedulePreview(); };
  wrap.append(ico, el('span', {}, 'Color'), input);
  return wrap;
}

function ribbonGroups(): Node[] {
  const a = editor; // active-state helper
  switch (activeTab) {
    case 'home':
      return [
        group('File',
          rbtn('✚', 'New', openTemplateModal),
          rbtn(OPEN_ICON, 'Open', openFromFile),
          rbtn(SAVE_ICON, 'Save', saveToFile),
        ),
        group('Export', rbtn('⤓', '.typ', exportTyp), rbtn('⬇', 'PDF', exportPdf)),
        group('History',
          rbtn('↶', 'Undo', () => cmd((c) => c.undo())),
          rbtn('↷', 'Redo', () => cmd((c) => c.redo())),
        ),
        group('Paragraph styles',
          rbtn('H1', 'Title', () => cmd((c) => c.toggleHeading({ level: 1 })), a.isActive('heading', { level: 1 })),
          rbtn('H2', 'Heading', () => cmd((c) => c.toggleHeading({ level: 2 })), a.isActive('heading', { level: 2 })),
          rbtn('H3', 'Subhead', () => cmd((c) => c.toggleHeading({ level: 3 })), a.isActive('heading', { level: 3 })),
          rbtn('¶', 'Text', () => cmd((c) => c.setParagraph()), a.isActive('paragraph')),
        ),
        group('Format',
          rbtn('B', 'Bold', () => cmd((c) => c.toggleBold()), a.isActive('bold')),
          rbtn('I', 'Italic', () => cmd((c) => c.toggleItalic()), a.isActive('italic')),
          rbtn('S', 'Strike', () => cmd((c) => c.toggleStrike()), a.isActive('strike')),
          rbtn(LINK_ICON, 'Link', setLink, a.isActive('link')),
          colorControl(),
          rbtn(HIGHLIGHT_ICON, 'Highlight', () => cmd((c) => c.toggleHighlight()), a.isActive('highlight')),
        ),
        group('Lists',
          rbtn('•', 'Bullets', () => cmd((c) => c.toggleBulletList()), a.isActive('bulletList')),
          rbtn('1.', 'Numbered', () => cmd((c) => c.toggleOrderedList()), a.isActive('orderedList')),
        ),
        group('Blocks',
          rbtn('❝', 'Callout', () => cmd((c) => c.toggleWrap('callout')), a.isActive('callout')),
          rbtn('</>', 'Raw', () => cmd((c) => c.toggleCodeBlock()), a.isActive('codeBlock')),
        ),
      ];
    case 'layout': {
      const s = logic.style;
      const paper = el('select', {}) as HTMLSelectElement;
      for (const p of ['a4', 'us-letter', 'a5'] as const) {
        const o = el('option', { value: p }, p);
        if (s.page.paper === p) o.selected = true;
        paper.append(o);
      }
      paper.onchange = () => { s.page.paper = paper.value as DocLogic['style']['page']['paper']; syncPageMetrics(); schedulePreview(); };
      const just = rbtn(s.par.justify ? '☰' : '≡', 'Justify', () => {
        s.par.justify = !s.par.justify; syncJustify(); renderRibbon(); schedulePreview();
      }, s.par.justify);
      const pageNums = rbtn('#', 'Page #', () => {
        s.page.numbering = !s.page.numbering; renderRibbon(); schedulePreview();
      }, !!s.page.numbering);
      const headNums = rbtn('1.1', 'Number headings', () => {
        s.page.headingNumbering = !s.page.headingNumbering; syncNumbering(); renderRibbon(); schedulePreview();
      }, !!s.page.headingNumbering);
      return [
        group('Page',
          rfield('Paper', paper),
          rfield('Margin cm', num(s.page.marginCm, (v) => { s.page.marginCm = v; syncPageMetrics(); })),
          rfield('Columns', num(s.page.columns ?? 1, (v) => { s.page.columns = Math.max(1, Math.round(v)); syncColumns(); }, 1)),
        ),
        group('Text', rfield('Font', fontInput(s.text.font, (v) => (s.text.font = v))), rfield('Size pt', num(s.text.sizePt, (v) => { s.text.sizePt = v; syncPageMetrics(); }))),
        group('Paragraph', rfield('Leading em', num(s.par.leadingEm, (v) => { s.par.leadingEm = v; syncPageMetrics(); }, 0.05)), just),
        group('Headings', headNums),
        group('Header & footer',
          rfield('Header', txtInput(s.page.header ?? '', (v) => (s.page.header = v), 'optional', 130)),
          rfield('Footer', txtInput(s.page.footer ?? '', (v) => (s.page.footer = v), 'optional', 130)),
          pageNums,
        ),
      ];
    }
    case 'insert':
      return [
        group('Blocks',
          rbtn('H', 'Heading', () => cmd((c) => c.insertContent({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] }))),
          rbtn('¶', 'Text', () => cmd((c) => c.insertContent('<p></p>'))),
          rbtn('•', 'Bullets', () => cmd((c) => c.toggleBulletList())),
          rbtn('1.', 'Numbered', () => cmd((c) => c.toggleOrderedList())),
          rbtn('❝', 'Callout', () => cmd((c) => c.insertContent({ type: 'callout', content: [{ type: 'paragraph' }] }))),
          rbtn('{ }', 'Code listing', insertCodeListing),
          rbtn('</>', 'Raw Typst', () => cmd((c) => c.insertContent({ type: 'codeBlock', content: [{ type: 'text', text: '#lorem(20)' }] }))),
        ),
        group('Insert',
          rbtn(TABLE_ICON, 'Table', () => cmd((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))),
          rbtn(IMAGE_ICON, 'Image', pickImage),
          rbtn('√x', 'Equation', () => cmd((c) => c.insertContent({ type: 'mathBlock', attrs: { src: 'x^2 + y^2 = z^2' } }))),
          rbtn('x²', 'Inline math', () => cmd((c) => c.insertContent({ type: 'mathInline', attrs: { src: 'x^2' } }))),
          rbtn(PAGEBREAK_ICON, 'Page break', () => cmd((c) => c.insertContent({ type: 'pageBreak' }))),
          rbtn(COLUMNS_ICON, 'Columns', () => cmd((c) => c.insertContent({ type: 'columns', attrs: { count: 2 }, content: [{ type: 'paragraph' }] }))),
        ),
        group('References',
          rbtn('†', 'Footnote', () => cmd((c) => c.insertContent({ type: 'footnote', attrs: { content: '' } }))),
          rbtn(LABEL_ICON, 'Label', setHeadingLabel),
          rbtn('@', 'Reference', insertReference),
          rbtn('“”', 'Bibliography', openBibliographyModal, !!logic.bibliography),
        ),
        group('Logic',
          rbtn('ƒ', 'Definitions', openDefinitionsModal),
          rbtn('✦', 'Show rules', openShowModal),
        ),
      ];
    case 'view':
      return [
        group('Show',
          rbtn('▦', previewVisible ? 'Hide preview' : 'Show preview', togglePreview, previewVisible),
          rbtn('☰', 'Outline', toggleOutline, outlineVisible),
        ),
        group('Find', rbtn(SEARCH_ICON, 'Find & replace', openFindBar)),
        group('Source', rbtn('</>', 'Typst source', openSourceModal)),
      ];
    case 'image': {
      const at = editor.getAttributes('image');
      const width = (at.width as number) ?? 80;
      const widthBtn = (w: number, label: string) =>
        rbtn(label, `${w}%`, () => updateImage({ width: w }), width === w);
      return [
        group('Width',
          widthBtn(25, 'S'), widthBtn(50, 'M'), widthBtn(75, 'L'), widthBtn(100, 'Full'),
          rbtn('−', 'Smaller', () => updateImage({ width: Math.max(10, Math.round(width) - 10) })),
          rbtn('+', 'Larger', () => updateImage({ width: Math.min(100, Math.round(width) + 10) })),
        ),
        group('Style',
          rbtn('▢', 'Border', () => updateImage({ border: !at.border }), !!at.border),
        ),
        group('Arrange',
          rbtn('✕', 'Delete', () => cmd((c) => c.deleteSelection())),
        ),
      ];
    }
    case 'table': {
      const at = editor.getAttributes('table');
      const borders = (at.borders as string) || 'all';
      const borderBtn = (val: string, icon: string, label: string) =>
        rbtn(icon, label, () => updateTable({ borders: val }), borders === val);
      return [
        group('Rows & columns',
          rbtn('▤+', 'Row', () => cmd((c) => c.addRowAfter())),
          rbtn('▤−', 'Del row', () => cmd((c) => c.deleteRow())),
          rbtn('▥+', 'Column', () => cmd((c) => c.addColumnAfter())),
          rbtn('▥−', 'Del col', () => cmd((c) => c.deleteColumn())),
        ),
        group('Style',
          rbtn('⊤', 'Header', () => cmd((c) => c.toggleHeaderRow()), editor.isActive('tableHeader')),
          rbtn('☰', 'Striped', () => updateTable({ striped: !at.striped }), !!at.striped),
        ),
        group('Borders',
          borderBtn('all', '⊞', 'All'),
          borderBtn('horizontal', '☰', 'Rows'),
          borderBtn('none', '▢', 'None'),
        ),
        group('Table',
          rbtn('✕', 'Delete', () => cmd((c) => c.deleteTable())),
        ),
      ];
    }
    case 'columns': {
      const count = (editor.getAttributes('columns').count as number) ?? 2;
      const countBtn = (n: number) => rbtn(String(n), `${n} cols`, () => updateColumns(n), count === n);
      return [
        group('Columns', countBtn(2), countBtn(3), countBtn(4)),
        group('Section', rbtn('✕', 'Remove', removeColumns)),
      ];
    }
  }
}

/** Set the column count of the current columns section. */
function updateColumns(n: number): void {
  editor.chain().focus().updateAttributes('columns', { count: n }).run();
  renderRibbon();
  schedulePreview();
}

/** Unwrap the current columns section, keeping its content in the document. */
function removeColumns(): void {
  editor.commands.command(({ state, tr, dispatch }) => {
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'columns') {
        const node = $from.node(d);
        const start = $from.before(d);
        if (dispatch) tr.replaceWith(start, start + node.nodeSize, node.content);
        return true;
      }
    }
    return false;
  });
  editor.commands.focus();
  renderRibbon();
  schedulePreview();
}

/** Update attributes of the currently selected image, then refresh preview. */
function updateImage(attrs: Record<string, unknown>): void {
  editor.chain().focus().updateAttributes('image', attrs).run();
  renderRibbon();
  schedulePreview();
}

/** Update attributes of the current table, then refresh preview. */
function updateTable(attrs: Record<string, unknown>): void {
  editor.chain().focus().updateAttributes('table', attrs).run();
  renderRibbon();
  schedulePreview();
}

// ---------------------------------------------------------------------------
// Ribbon actions / small inputs
// ---------------------------------------------------------------------------
function togglePreview(): void {
  previewVisible = !previewVisible;
  previewPane.classList.toggle('hidden', !previewVisible);
  renderRibbon();
  if (previewVisible) { previewPane.replaceChildren(el('div', { class: 'loading' }, 'Rendering…')); refreshPreview(); }
}
async function exportTyp(): Promise<void> {
  const source = generate(logic, editor.state.doc);
  if (isDesktop()) {
    await saveTextDialog('document.typ', [{ name: 'Typst', extensions: ['typ'] }], source);
  } else {
    download('document.typ', new Blob([source], { type: 'text/plain' }));
  }
}
async function exportPdf(): Promise<void> {
  try {
    const bytes = await renderPdf(generate(logic, editor.state.doc));
    if (isDesktop()) {
      await saveBytesDialog('document.pdf', [{ name: 'PDF', extensions: ['pdf'] }], bytes);
    } else {
      download('document.pdf', new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    }
  } catch (e) { alert('PDF export failed:\n' + String(e)); }
}
function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const aEl = el('a', { href: url, download: name });
  // The anchor must be in the DOM for the `download` filename to be honored in
  // some browsers (otherwise the file is saved with the blob's nameless URL).
  aEl.style.display = 'none';
  document.body.appendChild(aEl);
  aEl.click();
  document.body.removeChild(aEl);
  // Revoke after the click has been processed so the download isn't cancelled.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------------------------------------------------------------------------
// Persistence: save/open a .typwys file and autosave to localStorage
// ---------------------------------------------------------------------------
const DOC_VERSION = 1;
const LS_KEY = 'typst-wysiwyg:doc';

interface SavedDoc {
  version: number;
  logic: DocLogic;
  content: unknown;
  assets: Record<string, string>; // path -> base64
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function currentDoc(): SavedDoc {
  const assetObj: Record<string, string> = {};
  for (const [path, bytes] of assets) assetObj[path] = bytesToB64(bytes);
  return { version: DOC_VERSION, logic, content: editor.getJSON(), assets: assetObj };
}

function applyDoc(data: SavedDoc): void {
  if (!data || typeof data !== 'object' || !data.content) throw new Error('Not a typst-wysiwyg document');
  logic = data.logic;
  clearAssets();
  if (data.assets) for (const [path, b64] of Object.entries(data.assets)) assets.set(path, b64ToBytes(b64));
  editor.commands.setContent(data.content as never);
  syncJustify(); syncColumns(); syncNumbering(); syncBibliography(); syncPageMetrics();
  renderRibbon();
  schedulePreview();
}

const DOC_FILTERS = [{ name: 'Typst', extensions: ['typ'] }, { name: 'Typst WYSIWYG', extensions: ['typwys', 'json'] }];

/** A .typ file: the real Typst source plus the editable state in a comment. */
function currentTypFile(): string {
  const source = generate(logic, editor.state.doc);
  const state = bytesToB64(new TextEncoder().encode(JSON.stringify(currentDoc())));
  return `${source}\n${STATE_MARKER}${state}\n`;
}

/** Open document text: restore embedded state, else import the Typst markup. */
function openDocText(text: string): void {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) { applyDoc(JSON.parse(text) as SavedDoc); return; } // legacy .typwys/.json
  const state = extractEmbeddedState(text);
  if (state) {
    const json = new TextDecoder().decode(b64ToBytes(state));
    applyDoc(JSON.parse(json) as SavedDoc);
    return;
  }
  const imported = importTypst(text);
  applyDoc({ version: DOC_VERSION, logic: imported.logic, content: imported.content, assets: {} });
}

async function saveToFile(): Promise<void> {
  const content = currentTypFile();
  if (isDesktop()) {
    if (await saveTextDialog('document.typ', DOC_FILTERS, content)) flashSaved();
  } else {
    download('document.typ', new Blob([content], { type: 'text/plain' }));
    flashSaved();
  }
}

const docInput = el('input', { type: 'file', accept: '.typ,.typwys,.json,text/plain' }) as HTMLInputElement;
docInput.style.display = 'none';
document.body.appendChild(docInput);
async function openFromFile(): Promise<void> {
  if (isDesktop()) {
    try {
      const text = await openTextDialog(DOC_FILTERS);
      if (text != null) openDocText(text);
    } catch (e) { alert('Could not open file:\n' + String(e)); }
    return;
  }
  docInput.value = '';
  docInput.onchange = async () => {
    const file = docInput.files?.[0];
    if (!file) return;
    try { openDocText(await file.text()); }
    catch (e) { alert('Could not open file:\n' + String(e)); }
  };
  docInput.click();
}

let autosaveTimer: number | undefined;
function scheduleAutosave(): void {
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    if (!editor) return;
    const doc = currentDoc();
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(doc));
    } catch {
      // Over quota (e.g. large images): keep at least the text content.
      try { localStorage.setItem(LS_KEY, JSON.stringify({ ...doc, assets: {} })); } catch { /* give up */ }
    }
  }, 1200);
}
function loadSaved(): SavedDoc | null {
  try {
    const s = localStorage.getItem(LS_KEY);
    return s ? (JSON.parse(s) as SavedDoc) : null;
  } catch { return null; }
}

let savedFlashTimer: number | undefined;
function flashSaved(): void {
  const status = document.querySelector<HTMLElement>('.save-status');
  if (!status) return;
  status.textContent = 'Saved ✓';
  status.classList.add('show');
  window.clearTimeout(savedFlashTimer);
  savedFlashTimer = window.setTimeout(() => status.classList.remove('show'), 1500);
}
function txtInput(value: string, on: (v: string) => void, placeholder = '', width = 90): HTMLInputElement {
  const i = el('input', { type: 'text', placeholder }) as HTMLInputElement;
  i.value = value; i.style.width = `${width}px`;
  i.oninput = () => { on(i.value); schedulePreview(); };
  return i;
}
let fontDatalist: HTMLDataListElement | null = null;
function fontInput(value: string, on: (v: string) => void): HTMLInputElement {
  if (!fontDatalist) {
    fontDatalist = el('datalist', { id: 'font-suggestions' }) as HTMLDataListElement;
    for (const f of FONT_SUGGESTIONS) fontDatalist.append(el('option', { value: f }));
    document.body.appendChild(fontDatalist);
  }
  const i = txtInput(value, on, 'Typst default', 130);
  i.setAttribute('list', 'font-suggestions');
  return i;
}
function num(value: number, on: (v: number) => void, step = 0.5): HTMLInputElement {
  const i = el('input', { type: 'number', step: String(step) }) as HTMLInputElement;
  i.value = String(value); i.style.width = '64px';
  i.oninput = () => { const v = parseFloat(i.value); if (!Number.isNaN(v)) { on(v); schedulePreview(); } };
  return i;
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
let modalEl: HTMLElement | null = null;
function closeModal(): void { modalEl?.remove(); modalEl = null; }
function openModal(node: HTMLElement): void {
  closeModal();
  const overlay = el('div', { class: 'modal-overlay' }, node);
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
  document.body.append(overlay);
  modalEl = overlay;
}

interface UserTemplate { id: string; name: string; doc: SavedDoc }
const USER_TPL_KEY = 'typst-wysiwyg:templates';
function loadUserTemplates(): UserTemplate[] {
  try { return JSON.parse(localStorage.getItem(USER_TPL_KEY) || '[]') as UserTemplate[]; }
  catch { return []; }
}
function saveUserTemplates(list: UserTemplate[]): void {
  try { localStorage.setItem(USER_TPL_KEY, JSON.stringify(list)); } catch { /* quota */ }
}

const FILE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';

function openTemplateModal(): void {
  const modal = el('div', { class: 'modal' });
  const search = el('input', { type: 'text', class: 'modal-search', placeholder: 'Search templates…' }) as HTMLInputElement;
  const grid = el('div', { class: 'tmpl-grid' });

  const applyAndClose = (apply: () => void) => {
    apply();
    syncJustify(); syncColumns(); syncNumbering(); syncBibliography(); syncPageMetrics();
    closeModal();
    renderRibbon();
    schedulePreview();
    editor.commands.focus('start');
  };

  const draw = (q: string) => {
    const needle = q.trim().toLowerCase();
    grid.replaceChildren();
    const builtin = TEMPLATES.filter((t) => !needle || (t.label + ' ' + t.description + ' ' + t.keywords).toLowerCase().includes(needle));
    for (const t of builtin) {
      const ico = el('div', { class: 'ico' });
      ico.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${TEMPLATE_ICONS[t.icon]}</svg>`;
      const card = el('div', { class: 'tmpl-card' }, ico, el('div', { class: 'name' }, t.label), el('div', { class: 'desc' }, t.description));
      card.onclick = () => applyAndClose(() => {
        const made = t.make();
        logic = made.logic;
        clearAssets();
        editor.commands.setContent(made.content as never);
      });
      grid.append(card);
    }
    const user = loadUserTemplates().filter((t) => !needle || t.name.toLowerCase().includes(needle));
    for (const t of user) {
      const ico = el('div', { class: 'ico' });
      ico.innerHTML = FILE_ICON_SVG;
      const del = el('button', { class: 'tmpl-del', title: 'Delete template' }, '✕');
      del.onclick = (e) => { e.stopPropagation(); saveUserTemplates(loadUserTemplates().filter((x) => x.id !== t.id)); draw(search.value); };
      const card = el('div', { class: 'tmpl-card user' }, del, ico, el('div', { class: 'name' }, t.name), el('div', { class: 'desc' }, 'Your template'));
      card.onclick = () => applyAndClose(() => applyDoc(t.doc));
      grid.append(card);
    }
    if (!builtin.length && !user.length) grid.append(el('div', { class: 'muted' }, 'No templates match.'));
  };

  const saveBtn = el('button', { class: 'primary' }, '+ Save current as template');
  saveBtn.onclick = () => {
    const name = window.prompt('Template name', 'My template');
    if (!name) return;
    const list = loadUserTemplates();
    list.push({ id: uid('tpl'), name, doc: currentDoc() });
    saveUserTemplates(list);
    draw(search.value);
  };

  search.oninput = () => draw(search.value);
  const closeX = el('button', { class: 'modal-x', 'aria-label': 'Close', title: 'Close' }, '✕');
  closeX.onclick = closeModal;
  const cancelBtn = el('button', {}, 'Cancel');
  cancelBtn.onclick = closeModal;
  modal.append(
    el('div', { class: 'modal-head' },
      el('div', { class: 'modal-head-row' }, el('h3', {}, 'New from template'), closeX),
      search),
    grid,
    el('div', { class: 'modal-foot' }, cancelBtn, saveBtn),
  );
  openModal(modal);
  draw('');
  search.focus();
}

function openDefinitionsModal(): void {
  const modal = el('div', { class: 'modal' });
  const list = el('div', { class: 'def-list' });
  const draw = () => {
    list.replaceChildren();
    if (!logic.lets.length) list.append(el('div', { class: 'muted' }, 'No definitions yet. These become #let bindings.'));
    for (const b of logic.lets) list.append(letRow(b, draw));
  };
  const add = el('button', { class: 'primary' }, '+ Add definition');
  add.onclick = () => { logic.lets.push({ id: uid('let'), name: `var${logic.lets.length + 1}`, kind: 'value', code: '""' }); draw(); schedulePreview(); };
  modal.append(
    el('div', { class: 'modal-head' }, el('h3', {}, 'Definitions · #let'), el('div', { class: 'muted' }, 'Reusable values and components for power users.')),
    list,
    el('div', { class: 'modal-foot' }, add, doneBtn()),
  );
  openModal(modal);
  draw();
}

function letRow(b: LetBinding, redraw: () => void): HTMLElement {
  const box = el('div', { class: 'def' });
  const head = el('div', { class: 'bhead' });
  const name = txtInput(b.name, (v) => (b.name = v)); name.style.width = '120px';
  const kind = el('select', {}) as HTMLSelectElement;
  for (const k of ['value', 'component'] as const) {
    const o = el('option', { value: k }, k);
    if (b.kind === k) o.selected = true;
    kind.append(o);
  }
  kind.onchange = () => { b.kind = kind.value as LetBinding['kind']; schedulePreview(); };
  const del = el('button', { title: 'Delete' }, '✕');
  del.onclick = () => { logic.lets = logic.lets.filter((x) => x !== b); redraw(); schedulePreview(); };
  head.append(name, kind, el('span', { class: 'spacer' }), del);
  box.append(head);
  const code = el('textarea', { rows: '2' }) as HTMLTextAreaElement;
  code.value = b.code;
  code.oninput = () => { b.code = code.value; schedulePreview(); };
  box.append(code);
  return box;
}

// --- Structured #show editor ---
function openShowModal(): void {
  const modal = el('div', { class: 'modal' });
  const list = el('div', { class: 'def-list' });
  const draw = () => {
    list.replaceChildren();
    if (!logic.shows.length) list.append(el('div', { class: 'muted' }, 'No show rules yet. They restyle elements document-wide.'));
    for (const r of logic.shows) list.append(showRow(r, draw));
  };
  const add = el('button', { class: 'primary' }, '+ Add show rule');
  add.onclick = () => {
    logic.shows.push({ id: uid('show'), target: 'heading', level: null, props: { fill: '#1c7ed6', sizePt: null, weight: 'inherit', style: 'inherit' } });
    draw(); schedulePreview();
  };
  modal.append(
    el('div', { class: 'modal-head' }, el('h3', {}, 'Show rules · #show'), el('div', { class: 'muted' }, 'Restyle every heading, emphasis, link, etc.')),
    list,
    el('div', { class: 'modal-foot' }, add, doneBtn()),
  );
  openModal(modal);
  draw();
}

function showRow(r: ShowRule, redraw: () => void): HTMLElement {
  const box = el('div', { class: 'def' });

  const target = el('select', {}) as HTMLSelectElement;
  for (const t of ['heading', 'strong', 'emph', 'link', 'raw', 'custom'] as ShowTarget[]) {
    const o = el('option', { value: t }, t === 'custom' ? 'custom…' : t);
    if (r.target === t) o.selected = true;
    target.append(o);
  }
  target.onchange = () => { r.target = target.value as ShowTarget; redraw(); schedulePreview(); };

  const del = el('button', { title: 'Delete' }, '✕');
  del.onclick = () => { logic.shows = logic.shows.filter((x) => x !== r); redraw(); schedulePreview(); };

  const kind = el('select', { title: 'How to restyle' }) as HTMLSelectElement;
  for (const [v, lab] of [['style', 'set style'], ['function', 'function']] as const) {
    const o = el('option', { value: v }, lab);
    if ((r.kind ?? 'style') === v) o.selected = true;
    kind.append(o);
  }
  kind.onchange = () => { r.kind = kind.value as ShowRule['kind']; redraw(); schedulePreview(); };

  const head = el('div', { class: 'bhead' },
    el('span', { class: 'when' }, 'When'),
    target,
  );
  if (r.target === 'custom') {
    const sel = el('input', { type: 'text', placeholder: 'selector, e.g. heading.where(level: 2)' }) as HTMLInputElement;
    sel.value = r.customSelector ?? ''; sel.style.width = '230px';
    sel.oninput = () => { r.customSelector = sel.value; schedulePreview(); };
    head.append(sel);
  } else if (r.target === 'heading') {
    const level = el('select', {}) as HTMLSelectElement;
    for (const [v, lab] of [['', 'any level'], ['1', 'level 1'], ['2', 'level 2'], ['3', 'level 3']] as const) {
      const o = el('option', { value: v }, lab);
      if (String(r.level ?? '') === v) o.selected = true;
      level.append(o);
    }
    level.onchange = () => { r.level = level.value ? Number(level.value) : null; schedulePreview(); };
    head.append(level);
  }
  head.append(el('span', { class: 'spacer' }), kind, del);
  box.append(head);

  // Function-style: a raw Typst body that receives `it`.
  if (r.kind === 'function') {
    const body = el('textarea', { rows: '3' }) as HTMLTextAreaElement;
    body.placeholder = 'Typst, receives `it`. e.g. block(fill: luma(240), inset: 6pt, it)';
    body.value = r.body ?? '';
    body.oninput = () => { r.body = body.value; schedulePreview(); };
    box.append(body);
    return box;
  }

  // properties
  const props = el('div', { class: 'show-props' });
  const fill = el('input', { type: 'text', placeholder: 'no color' }) as HTMLInputElement;
  fill.value = r.props.fill; fill.style.width = '92px';
  fill.oninput = () => { r.props.fill = fill.value; schedulePreview(); };
  const swatch = el('input', { type: 'color' }) as HTMLInputElement;
  swatch.value = /^#[0-9a-fA-F]{6}$/.test(r.props.fill) ? r.props.fill : '#1c7ed6';
  swatch.oninput = () => { r.props.fill = swatch.value; fill.value = swatch.value; schedulePreview(); };

  const size = el('input', { type: 'number', step: '0.5', placeholder: 'inherit' }) as HTMLInputElement;
  size.value = r.props.sizePt == null ? '' : String(r.props.sizePt); size.style.width = '70px';
  size.oninput = () => { r.props.sizePt = size.value ? parseFloat(size.value) : null; schedulePreview(); };

  const weight = el('select', {}) as HTMLSelectElement;
  for (const w of ['inherit', 'regular', 'bold'] as const) { const o = el('option', { value: w }, w); if (r.props.weight === w) o.selected = true; weight.append(o); }
  weight.onchange = () => { r.props.weight = weight.value as ShowRule['props']['weight']; schedulePreview(); };

  const style = el('select', {}) as HTMLSelectElement;
  for (const st of ['inherit', 'normal', 'italic'] as const) { const o = el('option', { value: st }, st); if (r.props.style === st) o.selected = true; style.append(o); }
  style.onchange = () => { r.props.style = style.value as ShowRule['props']['style']; schedulePreview(); };

  props.append(
    el('label', { class: 'rfield' }, el('span', {}, 'Color'), el('span', { class: 'color-pair' }, swatch, fill)),
    el('label', { class: 'rfield' }, el('span', {}, 'Size pt'), size),
    el('label', { class: 'rfield' }, el('span', {}, 'Weight'), weight),
    el('label', { class: 'rfield' }, el('span', {}, 'Style'), style),
  );
  box.append(props);
  return box;
}

function doneBtn(): HTMLElement {
  const b = el('button', {}, 'Done');
  b.onclick = () => { closeModal(); schedulePreview(); };
  return b;
}

function openSourceModal(): void {
  const source = generate(logic, editor.state.doc);
  const modal = el('div', { class: 'modal modal-wide' });
  const copy = el('button', {}, 'Copy');
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(source); copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy'), 1200); }
    catch { copy.textContent = 'Copy failed'; }
  };
  const dl = el('button', {}, 'Download .typ');
  dl.onclick = exportTyp;
  const pre = el('pre', { class: 'source-code' });
  pre.innerHTML = highlightTypst(source);
  modal.append(
    el('div', { class: 'modal-head modal-head-row' },
      el('div', {}, el('h3', {}, 'Typst source'), el('div', { class: 'muted' }, 'Generated from the document — read-only.')),
      el('div', { class: 'modal-actions' }, copy, dl),
    ),
    el('div', { class: 'source-wrap' }, pre),
  );
  openModal(modal);
}

// ---------------------------------------------------------------------------
// Find & replace bar
// ---------------------------------------------------------------------------
const findBar = el('div', { class: 'find-bar' });
let findInput!: HTMLInputElement;
let findCount!: HTMLElement;
let findReplace!: HTMLInputElement;

function buildFindBar(): void {
  findInput = el('input', { type: 'text', placeholder: 'Find', class: 'find-q' }) as HTMLInputElement;
  findReplace = el('input', { type: 'text', placeholder: 'Replace', class: 'find-r' }) as HTMLInputElement;
  findCount = el('span', { class: 'find-count' }, '');
  const refresh = () => { const s = searchStatus(editor); findCount.textContent = s.count ? `${s.index}/${s.count}` : 'None'; };
  findInput.oninput = () => { setSearch(editor, findInput.value); refresh(); };
  findInput.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); searchNav(editor, e.shiftKey ? -1 : 1); refresh(); }
    if (e.key === 'Escape') closeFindBar();
  };
  findReplace.onkeydown = (e) => { if (e.key === 'Escape') closeFindBar(); };
  const btn = (label: string, title: string, fn: () => void) => {
    const b = el('button', { class: 'find-btn', title }, label);
    b.onclick = fn;
    return b;
  };
  findBar.replaceChildren(
    findInput, findCount,
    btn('‹', 'Previous (Shift+Enter)', () => { searchNav(editor, -1); refresh(); }),
    btn('›', 'Next (Enter)', () => { searchNav(editor, 1); refresh(); }),
    findReplace,
    btn('Replace', 'Replace current', () => { replaceCurrent(editor, findReplace.value); refresh(); }),
    btn('All', 'Replace all', () => { replaceAll(editor, findReplace.value); refresh(); }),
    btn('✕', 'Close (Esc)', closeFindBar),
  );
}

function openFindBar(): void {
  if (!findBar.isConnected) main.appendChild(findBar);
  buildFindBar();
  findBar.classList.add('open');
  const sel = editor.state.selection;
  const seed = sel.empty ? '' : editor.state.doc.textBetween(sel.from, sel.to);
  findInput.value = seed;
  if (seed) { setSearch(editor, seed); }
  findInput.focus();
  findInput.select();
  const s = searchStatus(editor);
  findCount.textContent = s.count ? `${s.index}/${s.count}` : 'None';
}
function closeFindBar(): void {
  findBar.classList.remove('open');
  clearSearch(editor);
  editor.commands.focus();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); }
  // Ctrl/Cmd+S saves to a file instead of the browser's page save.
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveToFile(); }
  // Ctrl/Cmd+F opens find & replace.
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openFindBar(); }
});

// ---------------------------------------------------------------------------
// Boot — restore the last session if one was autosaved, else the default doc.
// ---------------------------------------------------------------------------
const main = el('div', { class: 'main' }, outlinePanel, canvasWrap, previewPane);
app.replaceChildren(ribbon(), main);

const restored = loadSaved();
if (restored) {
  logic = restored.logic ?? initial.logic;
  clearAssets();
  if (restored.assets) for (const [path, b64] of Object.entries(restored.assets)) assets.set(path, b64ToBytes(b64));
}
mountEditor((restored?.content ?? initial.content) as object);
renderRibbon();
