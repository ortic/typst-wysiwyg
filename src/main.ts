import './styles.css';
import type { Editor } from '@tiptap/core';
import type { DocLogic, LetBinding, ShowRule, ShowTarget } from './model';
import { uid } from './model';
import { generate } from './generate';
import { renderSvg, renderPdf } from './typst';
import { TEMPLATES, TEMPLATE_ICONS } from './templates';
import { highlightTypst } from './highlight';
import { createEditor } from './editor';
import { installBlockHandle } from './blockhandle';
import { addAsset } from './assets';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const initial = TEMPLATES.find((t) => t.id === 'report')!.make();
let logic: DocLogic = initial.logic;
let previewVisible = false;
type TabId = 'home' | 'layout' | 'insert' | 'view' | 'image' | 'table';
let activeTab: TabId = 'home';
let editor!: Editor;

const app = document.querySelector<HTMLDivElement>('#app')!;

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
    previewPane.replaceChildren(el('div', { class: 'err' }, `Typst compile error:\n${String(e)}`));
  }
}

// ---------------------------------------------------------------------------
// Editor (TipTap / ProseMirror)
// ---------------------------------------------------------------------------
const canvasWrap = el('div', { class: 'canvas-wrap' });
const pageEl = el('div', { class: 'page' });
canvasWrap.append(pageEl);

function mountEditor(content: object): void {
  editor = createEditor(pageEl, content as never, {
    onUpdate: () => { schedulePreview(); syncContextualTabs(); },
    onSelection: syncContextualTabs,
  });
  installBlockHandle(editor, pageEl);
  syncJustify();
}

function syncJustify(): void {
  pageEl.classList.toggle('justify', logic.style.par.justify);
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

function pickImage(): void {
  imageInput.value = '';
  imageInput.onchange = async () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = file.name.split('.').pop() || 'png';
    const path = addAsset(bytes, ext); // bytes go to the Typst VFS; path is referenced
    const src = await readDataUrl(file); // data URL only for editor display
    editor.chain().focus().insertContent({ type: 'image', attrs: { src, path, alt: '' } }).run();
    schedulePreview();
  };
  imageInput.click();
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
  return tabs;
}

/** Show/auto-activate contextual tabs as the selection changes. */
function syncContextualTabs(): void {
  const onImage = editor.isActive('image');
  const inTable = editor.isActive('table');
  if (onImage && activeTab !== 'image') activeTab = 'image'; // selecting an image jumps to its tab
  else if (!onImage && activeTab === 'image') activeTab = 'home';
  if (!inTable && activeTab === 'table') activeTab = 'home';
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
  tabStrip.append(
    el('span', { class: 'tab-spacer' }),
    el('span', { class: 'brand' }, el('span', { class: 'app' }, 'Typst WYSIWYG'), el('span', { class: 'muted' }, 'spike')),
  );
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
  b.onclick = onClick;
  return b;
}

const LINK_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>';
const TABLE_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/></svg>';
const IMAGE_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg>';
function rfield(label: string, control: Node): HTMLElement {
  return el('label', { class: 'rfield' }, el('span', {}, label), control);
}

function ribbonGroups(): Node[] {
  const a = editor; // active-state helper
  switch (activeTab) {
    case 'home':
      return [
        group('Templates', rbtn('✚', 'New', openTemplateModal)),
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
        ),
        group('Lists',
          rbtn('•', 'Bullets', () => cmd((c) => c.toggleBulletList()), a.isActive('bulletList')),
          rbtn('1.', 'Numbered', () => cmd((c) => c.toggleOrderedList()), a.isActive('orderedList')),
        ),
        group('Blocks',
          rbtn('❝', 'Callout', () => cmd((c) => c.toggleWrap('callout')), a.isActive('callout')),
          rbtn('</>', 'Raw', () => cmd((c) => c.toggleCodeBlock()), a.isActive('codeBlock')),
        ),
        group('Export', rbtn('⤓', '.typ', exportTyp), rbtn('⬇', 'PDF', exportPdf)),
      ];
    case 'layout': {
      const s = logic.style;
      const paper = el('select', {}) as HTMLSelectElement;
      for (const p of ['a4', 'us-letter', 'a5'] as const) {
        const o = el('option', { value: p }, p);
        if (s.page.paper === p) o.selected = true;
        paper.append(o);
      }
      paper.onchange = () => { s.page.paper = paper.value as DocLogic['style']['page']['paper']; schedulePreview(); };
      const just = rbtn(s.par.justify ? '☰' : '≡', 'Justify', () => {
        s.par.justify = !s.par.justify; syncJustify(); renderRibbon(); schedulePreview();
      }, s.par.justify);
      return [
        group('Page', rfield('Paper', paper), rfield('Margin cm', num(s.page.marginCm, (v) => (s.page.marginCm = v)))),
        group('Text', rfield('Font', txtInput(s.text.font, (v) => (s.text.font = v), 'Typst default', 130)), rfield('Size pt', num(s.text.sizePt, (v) => (s.text.sizePt = v)))),
        group('Paragraph', rfield('Leading em', num(s.par.leadingEm, (v) => (s.par.leadingEm = v), 0.05)), just),
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
          rbtn('</>', 'Raw Typst', () => cmd((c) => c.insertContent({ type: 'codeBlock', content: [{ type: 'text', text: '#lorem(20)' }] }))),
        ),
        group('Insert',
          rbtn(TABLE_ICON, 'Table', () => cmd((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))),
          rbtn(IMAGE_ICON, 'Image', pickImage),
          rbtn('√x', 'Equation', () => cmd((c) => c.insertContent({ type: 'mathBlock', attrs: { src: 'x^2 + y^2 = z^2' } }))),
        ),
        group('Logic',
          rbtn('ƒ', 'Definitions', openDefinitionsModal),
          rbtn('✦', 'Show rules', openShowModal),
        ),
      ];
    case 'view':
      return [
        group('Show', rbtn('▦', previewVisible ? 'Hide preview' : 'Show preview', togglePreview, previewVisible)),
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
  }
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
function exportTyp(): void { download('document.typ', new Blob([generate(logic, editor.state.doc)], { type: 'text/plain' })); }
async function exportPdf(): Promise<void> {
  try {
    const bytes = await renderPdf(generate(logic, editor.state.doc));
    download('document.pdf', new Blob([bytes as BlobPart], { type: 'application/pdf' }));
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
function txtInput(value: string, on: (v: string) => void, placeholder = '', width = 90): HTMLInputElement {
  const i = el('input', { type: 'text', placeholder }) as HTMLInputElement;
  i.value = value; i.style.width = `${width}px`;
  i.oninput = () => { on(i.value); schedulePreview(); };
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

function openTemplateModal(): void {
  const modal = el('div', { class: 'modal' });
  const search = el('input', { type: 'text', class: 'modal-search', placeholder: 'Search templates…' }) as HTMLInputElement;
  const grid = el('div', { class: 'tmpl-grid' });
  const draw = (q: string) => {
    const needle = q.trim().toLowerCase();
    grid.replaceChildren();
    const hits = TEMPLATES.filter((t) => !needle || (t.label + ' ' + t.description + ' ' + t.keywords).toLowerCase().includes(needle));
    if (!hits.length) { grid.append(el('div', { class: 'muted' }, 'No templates match.')); return; }
    for (const t of hits) {
      const ico = el('div', { class: 'ico' });
      ico.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${TEMPLATE_ICONS[t.icon]}</svg>`;
      const card = el('div', { class: 'tmpl-card' }, ico, el('div', { class: 'name' }, t.label), el('div', { class: 'desc' }, t.description));
      card.onclick = () => {
        const made = t.make();
        logic = made.logic;
        editor.commands.setContent(made.content as never);
        syncJustify();
        closeModal();
        renderRibbon();
        schedulePreview();
        editor.commands.focus('start');
      };
      grid.append(card);
    }
  };
  search.oninput = () => draw(search.value);
  modal.append(el('div', { class: 'modal-head' }, el('h3', {}, 'New from template'), search), grid);
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
  for (const t of ['heading', 'strong', 'emph', 'link', 'raw'] as ShowTarget[]) {
    const o = el('option', { value: t }, t);
    if (r.target === t) o.selected = true;
    target.append(o);
  }
  target.onchange = () => { r.target = target.value as ShowTarget; redraw(); schedulePreview(); };

  const del = el('button', { title: 'Delete' }, '✕');
  del.onclick = () => { logic.shows = logic.shows.filter((x) => x !== r); redraw(); schedulePreview(); };

  const head = el('div', { class: 'bhead' },
    el('span', { class: 'when' }, 'When'),
    target,
  );
  if (r.target === 'heading') {
    const level = el('select', {}) as HTMLSelectElement;
    for (const [v, lab] of [['', 'any level'], ['1', 'level 1'], ['2', 'level 2'], ['3', 'level 3']] as const) {
      const o = el('option', { value: v }, lab);
      if (String(r.level ?? '') === v) o.selected = true;
      level.append(o);
    }
    level.onchange = () => { r.level = level.value ? Number(level.value) : null; schedulePreview(); };
    head.append(level);
  }
  head.append(el('span', { class: 'spacer' }), del);
  box.append(head);

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

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const main = el('div', { class: 'main' }, canvasWrap, previewPane);
app.replaceChildren(ribbon(), main);
mountEditor(initial.content);
renderRibbon();
