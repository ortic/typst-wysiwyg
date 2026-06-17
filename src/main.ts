import './styles.css';
import type { Block, Doc, LetBinding } from './model';
import { uid } from './model';
import { generate } from './generate';
import { renderSvg, renderPdf } from './typst';
import { TEMPLATES, TEMPLATE_ICONS } from './templates';
import { highlightTypst } from './highlight';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let doc: Doc = TEMPLATES.find((t) => t.id === 'report')!.make();
let previewVisible = false;
let activeTab: 'home' | 'layout' | 'insert' | 'view' = 'home';
let activeBlockId: string | null = doc.content[0]?.id ?? null;
let focusAfterRender: { id: string; caret: 'end' | 'start' } | null = null;

const app = document.querySelector<HTMLDivElement>('#app')!;

// small DOM helper
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
// Typst preview (debounced) — only touches the preview pane
// ---------------------------------------------------------------------------
const previewPane = el('div', { class: 'preview' });
let previewTimer: number | undefined;

function schedulePreview(): void {
  if (!previewVisible) return;
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(refreshPreview, 300);
}

async function refreshPreview(): Promise<void> {
  if (!previewVisible) return;
  const source = generate(doc);
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
// The WYSIWYG canvas
// ---------------------------------------------------------------------------
const canvasWrap = el('div', { class: 'canvas-wrap' });

function rebuildCanvas(): void {
  const page = el('div', { class: 'page' + (doc.style.par.justify ? ' justify' : '') });
  doc.content.forEach((b, i) => page.append(blockEl(b, i)));

  const add = el('div', { class: 'add-block' }, '+  Add a block, or just start typing…');
  add.onclick = () => insertBlock(doc.content.length - 1, { id: uid(), type: 'paragraph', text: '' });
  page.append(add);

  canvasWrap.replaceChildren(page);
  applyFocus();
}

function blockEl(b: Block, index: number): HTMLElement {
  const wrap = el('div', { class: 'doc-block' });
  wrap.dataset.id = b.id;
  wrap.addEventListener('focusin', () => { activeBlockId = b.id; });

  const handle = el('div', { class: 'handle', title: 'Block options' }, '⠿');
  handle.onclick = (e) => { e.stopPropagation(); openMenu(b, index, wrap, handle); };
  wrap.append(handle);

  let body: HTMLElement;
  switch (b.type) {
    case 'heading':
      body = editable(`doc-h${b.level}`, b.text, `Heading ${b.level}`, (t) => (b.text = t));
      attachTextKeys(body, index);
      break;
    case 'paragraph':
      body = editable('doc-p', b.text, 'Type here…', (t) => (b.text = t));
      attachTextKeys(body, index);
      break;
    case 'callout':
      body = editable('doc-callout', b.text, 'Callout…', (t) => (b.text = t));
      attachTextKeys(body, index);
      break;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      body = el(tag, { class: 'doc-list', contenteditable: 'true' });
      for (const it of b.items.length ? b.items : ['']) body.append(el('li', {}, it));
      body.addEventListener('input', () => {
        b.items = Array.from(body.querySelectorAll('li')).map((li) => li.textContent ?? '');
        schedulePreview();
      });
      break;
    }
    case 'raw': {
      body = el('div', {});
      body.append(el('div', { class: 'doc-raw-label' }, 'raw typst'));
      const code = el('div', { class: 'doc-raw', contenteditable: 'true', 'data-ph': '#…' });
      code.textContent = b.code;
      code.addEventListener('input', () => { b.code = code.innerText; schedulePreview(); });
      body.append(code);
      break;
    }
  }
  body.dataset.blockBody = '1';
  wrap.append(body);
  return wrap;
}

function editable(cls: string, text: string, placeholder: string, set: (t: string) => void): HTMLElement {
  const n = el('div', { class: cls, contenteditable: 'true', 'data-ph': placeholder });
  n.textContent = text;
  n.addEventListener('input', () => { set(n.textContent ?? ''); schedulePreview(); });
  return n;
}

function attachTextKeys(node: HTMLElement, index: number): void {
  node.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      insertBlock(index, { id: uid(), type: 'paragraph', text: '' });
    } else if (e.key === 'Backspace' && isCaretAtStart(node) && (node.textContent ?? '') === '') {
      e.preventDefault();
      if (doc.content.length === 1) return;
      doc.content.splice(index, 1);
      const prev = doc.content[Math.max(0, index - 1)];
      focusAfterRender = { id: prev.id, caret: 'end' };
      structuralChange();
    }
  });
}

// ---------------------------------------------------------------------------
// Block operations (shared by menu, ribbon, keyboard)
// ---------------------------------------------------------------------------
function insertBlock(afterIndex: number, nb: Block): void {
  doc.content.splice(afterIndex + 1, 0, nb);
  activeBlockId = nb.id;
  focusAfterRender = { id: nb.id, caret: 'end' };
  structuralChange();
}

function convertBlock(index: number, nb: Block): void {
  doc.content[index] = nb;
  activeBlockId = nb.id;
  focusAfterRender = { id: nb.id, caret: 'end' };
  structuralChange();
}

function move(index: number, dir: number): void {
  const j = index + dir;
  if (j < 0 || j >= doc.content.length) return;
  const [item] = doc.content.splice(index, 1);
  doc.content.splice(j, 0, item);
  focusAfterRender = { id: item.id, caret: 'end' };
  structuralChange();
}

function activeIndex(): number {
  const i = doc.content.findIndex((b) => b.id === activeBlockId);
  return i >= 0 ? i : doc.content.length - 1;
}

function currentText(b: Block): string {
  if (b.type === 'list') return b.items.join('\n');
  if (b.type === 'raw') return b.code;
  return b.text;
}
function splitItems(text: string): string[] {
  const items = text.split('\n').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : [''];
}

/** Block factory by kind, carrying over text from an existing block where useful. */
function makeBlock(kind: string, text = ''): Block {
  switch (kind) {
    case 'h1': return { id: uid(), type: 'heading', level: 1, text };
    case 'h2': return { id: uid(), type: 'heading', level: 2, text };
    case 'h3': return { id: uid(), type: 'heading', level: 3, text };
    case 'bullet': return { id: uid(), type: 'list', ordered: false, items: splitItems(text) };
    case 'numbered': return { id: uid(), type: 'list', ordered: true, items: splitItems(text) };
    case 'callout': return { id: uid(), type: 'callout', text };
    case 'raw': return { id: uid(), type: 'raw', code: text || '#lorem(20)' };
    default: return { id: uid(), type: 'paragraph', text };
  }
}

/** Convert the currently focused block (Word-style "paragraph styles"). */
function applyStyle(kind: string): void {
  const i = activeIndex();
  if (i < 0) { insertBlock(doc.content.length - 1, makeBlock(kind)); return; }
  convertBlock(i, makeBlock(kind, currentText(doc.content[i])));
}

/** Insert a fresh block of a kind after the focused block. */
function insertKind(kind: string): void {
  insertBlock(activeIndex(), makeBlock(kind));
}

// ---------------------------------------------------------------------------
// Block options menu (Notion-style, on the canvas handle)
// ---------------------------------------------------------------------------
let openMenuEl: HTMLElement | null = null;
function closeMenu(): void {
  openMenuEl?.remove();
  openMenuEl = null;
  document.querySelectorAll('.menu-open').forEach((n) => n.classList.remove('menu-open'));
}

function openMenu(b: Block, index: number, wrap: HTMLElement, anchor: HTMLElement): void {
  closeMenu();
  wrap.classList.add('menu-open');
  const menu = el('div', { class: 'block-menu' });
  const item = (key: string, label: string, fn: () => void, danger = false) => {
    const mi = el('div', { class: 'mi' + (danger ? ' danger' : '') }, el('span', { class: 'k' }, key), label);
    mi.onclick = (e) => { e.stopPropagation(); closeMenu(); fn(); };
    return mi;
  };
  const text = currentText(b);
  menu.append(
    item('H1', 'Heading 1', () => convertBlock(index, makeBlock('h1', text))),
    item('H2', 'Heading 2', () => convertBlock(index, makeBlock('h2', text))),
    item('H3', 'Heading 3', () => convertBlock(index, makeBlock('h3', text))),
    item('¶', 'Text', () => convertBlock(index, makeBlock('text', text))),
    item('•', 'Bullet list', () => convertBlock(index, makeBlock('bullet', text))),
    item('1.', 'Numbered list', () => convertBlock(index, makeBlock('numbered', text))),
    item('❝', 'Callout', () => convertBlock(index, makeBlock('callout', text))),
    item('</>', 'Raw Typst', () => convertBlock(index, makeBlock('raw', text))),
    el('div', { class: 'sep' }),
    item('+', 'Insert below', () => insertBlock(index, makeBlock('text'))),
    item('↑', 'Move up', () => move(index, -1)),
    item('↓', 'Move down', () => move(index, +1)),
    el('div', { class: 'sep' }),
    item('✕', 'Delete', () => {
      doc.content.splice(index, 1);
      if (!doc.content.length) doc.content.push(makeBlock('text'));
      structuralChange();
    }, true),
  );
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${r.right + 6}px`;
  menu.style.top = `${r.top}px`;
  const mr = menu.getBoundingClientRect();
  if (mr.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - mr.height - 8}px`;
  openMenuEl = menu;
}

// ---------------------------------------------------------------------------
// Caret helpers
// ---------------------------------------------------------------------------
function isCaretAtStart(node: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  return node.contains(r.startContainer) && r.startOffset === 0;
}

function applyFocus(): void {
  if (!focusAfterRender) return;
  const { id, caret } = focusAfterRender;
  focusAfterRender = null;
  const wrap = canvasWrap.querySelector<HTMLElement>(`.doc-block[data-id="${id}"]`);
  const body = wrap?.querySelector<HTMLElement>('[contenteditable]');
  if (!body) return;
  body.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(body);
  range.collapse(caret === 'start');
  sel?.removeAllRanges();
  sel?.addRange(range);
}

// ---------------------------------------------------------------------------
// Ribbon
// ---------------------------------------------------------------------------
const ribbonBody = el('div', { class: 'ribbon-body' });

function ribbon(): HTMLElement {
  const bar = el('div', { class: 'ribbon' });

  const title = el('div', { class: 'titlebar' },
    el('span', { class: 'app' }, 'Typst WYSIWYG'),
    el('span', { class: 'muted' }, 'spike'),
  );

  const tabs = el('div', { class: 'tabstrip' });
  const tabDefs: [typeof activeTab, string][] = [
    ['home', 'Home'], ['layout', 'Layout'], ['insert', 'Insert'], ['view', 'View'],
  ];
  for (const [id, label] of tabDefs) {
    const t = el('button', { class: 'tab' + (activeTab === id ? ' active' : '') }, label);
    t.onclick = () => { activeTab = id; renderRibbon(); };
    tabs.append(t);
  }

  bar.append(title, tabs, ribbonBody);
  return bar;
}

function renderRibbon(): void {
  document.querySelectorAll<HTMLButtonElement>('.tabstrip .tab').forEach((b, i) => {
    const ids: (typeof activeTab)[] = ['home', 'layout', 'insert', 'view'];
    b.classList.toggle('active', ids[i] === activeTab);
  });
  ribbonBody.replaceChildren(...ribbonGroups());
}

// ribbon building blocks ----------------------------------------------------
function group(label: string, ...controls: Node[]): HTMLElement {
  return el('div', { class: 'rgroup' },
    el('div', { class: 'rcontrols' }, ...controls),
    el('div', { class: 'glabel' }, label),
  );
}
function rbtn(icon: string, label: string, onClick: () => void, active = false): HTMLElement {
  const b = el('button', { class: 'rbtn' + (active ? ' active' : '') },
    el('span', { class: 'ico' }, icon), el('span', {}, label));
  b.onclick = onClick;
  return b;
}
function rfield(label: string, control: Node): HTMLElement {
  return el('label', { class: 'rfield' }, el('span', {}, label), control);
}

function ribbonGroups(): Node[] {
  switch (activeTab) {
    case 'home':
      return [
        group('Templates', rbtn('✚', 'New', openTemplateModal)),
        group('Paragraph styles',
          rbtn('H1', 'Title', () => applyStyle('h1')),
          rbtn('H2', 'Heading', () => applyStyle('h2')),
          rbtn('H3', 'Subhead', () => applyStyle('h3')),
          rbtn('¶', 'Text', () => applyStyle('text')),
        ),
        group('Lists',
          rbtn('•', 'Bullets', () => applyStyle('bullet')),
          rbtn('1.', 'Numbered', () => applyStyle('numbered')),
        ),
        group('Blocks',
          rbtn('❝', 'Callout', () => applyStyle('callout')),
          rbtn('</>', 'Raw', () => applyStyle('raw')),
        ),
        group('Export',
          rbtn('⤓', '.typ', exportTyp),
          rbtn('⬇', 'PDF', exportPdf),
        ),
      ];
    case 'layout': {
      const s = doc.style;
      const paper = el('select', {}) as HTMLSelectElement;
      for (const p of ['a4', 'us-letter', 'a5'] as const) {
        const o = el('option', { value: p }, p);
        if (s.page.paper === p) o.selected = true;
        paper.append(o);
      }
      paper.onchange = () => { s.page.paper = paper.value as Doc['style']['page']['paper']; schedulePreview(); };
      const just = rbtn(s.par.justify ? '☰' : '≡', 'Justify', () => {
        s.par.justify = !s.par.justify;
        canvasWrap.querySelector('.page')?.classList.toggle('justify', s.par.justify);
        renderRibbon();
        schedulePreview();
      }, s.par.justify);
      return [
        group('Page',
          rfield('Paper', paper),
          rfield('Margin cm', num(s.page.marginCm, (v) => (s.page.marginCm = v))),
        ),
        group('Text',
          rfield('Font', txt(s.text.font, (v) => (s.text.font = v), 'Typst default', 130)),
          rfield('Size pt', num(s.text.sizePt, (v) => (s.text.sizePt = v))),
        ),
        group('Paragraph',
          rfield('Leading em', num(s.par.leadingEm, (v) => (s.par.leadingEm = v), 0.05)),
          just,
        ),
      ];
    }
    case 'insert':
      return [
        group('Blocks',
          rbtn('H', 'Heading', () => insertKind('h2')),
          rbtn('¶', 'Text', () => insertKind('text')),
          rbtn('•', 'Bullets', () => insertKind('bullet')),
          rbtn('1.', 'Numbered', () => insertKind('numbered')),
          rbtn('❝', 'Callout', () => insertKind('callout')),
          rbtn('</>', 'Raw Typst', () => insertKind('raw')),
        ),
        group('Logic', rbtn('ƒ', 'Definitions', openDefinitionsModal)),
      ];
    case 'view':
      return [
        group('Show',
          rbtn('▦', previewVisible ? 'Hide preview' : 'Show preview', togglePreview, previewVisible),
        ),
        group('Source',
          rbtn('</>', 'Typst source', openSourceModal),
        ),
      ];
  }
}

// ---------------------------------------------------------------------------
// Ribbon actions
// ---------------------------------------------------------------------------
function togglePreview(): void {
  previewVisible = !previewVisible;
  previewPane.classList.toggle('hidden', !previewVisible);
  renderRibbon();
  if (previewVisible) { previewPane.replaceChildren(el('div', { class: 'loading' }, 'Rendering…')); refreshPreview(); }
}

function exportTyp(): void {
  download('document.typ', new Blob([generate(doc)], { type: 'text/plain' }));
}
async function exportPdf(): Promise<void> {
  try {
    const bytes = await renderPdf(generate(doc));
    download('document.pdf', new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  } catch (e) { alert('PDF export failed:\n' + String(e)); }
}
function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

// small inputs (used in ribbon Layout tab)
function txt(value: string, on: (v: string) => void, placeholder = '', width = 90): HTMLInputElement {
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
    const hits = TEMPLATES.filter((t) =>
      !needle || (t.label + ' ' + t.description + ' ' + t.keywords).toLowerCase().includes(needle));
    if (!hits.length) { grid.append(el('div', { class: 'muted' }, 'No templates match.')); return; }
    for (const t of hits) {
      const ico = el('div', { class: 'ico' });
      ico.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${TEMPLATE_ICONS[t.icon]}</svg>`;
      const card = el('div', { class: 'tmpl-card' },
        ico,
        el('div', { class: 'name' }, t.label),
        el('div', { class: 'desc' }, t.description),
      );
      card.onclick = () => {
        doc = t.make();
        activeBlockId = doc.content[0]?.id ?? null;
        closeModal();
        structuralChange();
      };
      grid.append(card);
    }
  };

  search.oninput = () => draw(search.value);
  modal.append(
    el('div', { class: 'modal-head' }, el('h3', {}, 'New from template'), search),
    grid,
  );
  openModal(modal);
  draw('');
  search.focus();
}

function openSourceModal(): void {
  const source = generate(doc);
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
      el('div', {},
        el('h3', {}, 'Typst source'),
        el('div', { class: 'muted' }, 'Generated from the document — read-only.'),
      ),
      el('div', { class: 'modal-actions' }, copy, dl),
    ),
    el('div', { class: 'source-wrap' }, pre),
  );
  openModal(modal);
}

function openDefinitionsModal(): void {
  const modal = el('div', { class: 'modal' });
  const list = el('div', { class: 'def-list' });

  const draw = () => {
    list.replaceChildren();
    if (!doc.lets.length) list.append(el('div', { class: 'muted' }, 'No definitions yet. These become #let bindings.'));
    for (const b of doc.lets) list.append(letRow(b, draw));
  };

  const add = el('button', { class: 'primary' }, '+ Add definition');
  add.onclick = () => {
    doc.lets.push({ id: uid('let'), name: `var${doc.lets.length + 1}`, kind: 'value', code: '""' });
    draw(); schedulePreview();
  };

  modal.append(
    el('div', { class: 'modal-head' },
      el('h3', {}, 'Definitions · #let'),
      el('div', { class: 'muted' }, 'Reusable values and components for power users.'),
    ),
    list,
    el('div', { class: 'modal-foot' }, add, doneBtn()),
  );
  openModal(modal);
  draw();
}

function doneBtn(): HTMLElement {
  const b = el('button', {}, 'Done');
  b.onclick = () => { closeModal(); schedulePreview(); };
  return b;
}

function letRow(b: LetBinding, redraw: () => void): HTMLElement {
  const box = el('div', { class: 'def' });
  const head = el('div', { class: 'bhead' });
  const name = txt(b.name, (v) => (b.name = v)); name.style.width = '120px';
  const kind = el('select', {}) as HTMLSelectElement;
  for (const k of ['value', 'component'] as const) {
    const o = el('option', { value: k }, k);
    if (b.kind === k) o.selected = true;
    kind.append(o);
  }
  kind.onchange = () => { b.kind = kind.value as LetBinding['kind']; schedulePreview(); };
  const del = el('button', { title: 'Delete' }, '✕');
  del.onclick = () => { doc.lets = doc.lets.filter((x) => x !== b); redraw(); schedulePreview(); };
  head.append(name, kind, el('span', { class: 'spacer' }), del);
  box.append(head);
  const code = el('textarea', { rows: '2' }) as HTMLTextAreaElement;
  code.value = b.code;
  code.oninput = () => { b.code = code.value; schedulePreview(); };
  box.append(code);
  return box;
}

// ---------------------------------------------------------------------------
// Change plumbing & global handlers
// ---------------------------------------------------------------------------
function structuralChange(): void {
  rebuildCanvas();
  renderRibbon();
  schedulePreview();
}

document.addEventListener('click', (e) => {
  if (openMenuEl && !openMenuEl.contains(e.target as Node)) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeMenu(); closeModal(); }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const main = el('div', { class: 'main' }, canvasWrap, previewPane);
app.replaceChildren(ribbon(), main);
previewPane.classList.add('hidden');
renderRibbon();
rebuildCanvas();
