// Translate the document's structured `#show` rules into CSS so the WYSIWYG
// canvas reflects them too — not just the Typst preview. Typst is far more
// expressive than CSS, so this is a deliberate best-effort: it maps the common,
// modelable cases (heading / strong / emph / link / raw recoloured, resized,
// re-weighted or re-styled) and a couple of trivial function-mode idioms
// (recolour + underline/strike). Anything it can't translate faithfully —
// custom selectors, arbitrary function bodies — is skipped, and the Typst
// preview stays the source of truth for those.
//
// This only affects the editor's display; the generated .typ is untouched
// (see generate.ts), so an imperfect translation can never corrupt output.

import type { ShowRule } from './model';

/** CSS selector(s) (scoped to `.page`) for a non-heading show target. */
const TARGET_SELECTORS: Partial<Record<ShowRule['target'], string>> = {
  strong: '.page strong',
  emph: '.page em',
  link: '.page a',
  // Inline raw only — a bare `.page code` would also match code inside `<pre>`,
  // but the more specific `.page pre code` rule in styles.css keeps blocks legible.
  raw: '.page code',
};

function headingSelector(level: number | null): string {
  if (level == null) return [1, 2, 3, 4, 5, 6].map((n) => `.page h${n}`).join(', ');
  return `.page h${level}`;
}

function selectorFor(r: ShowRule): string | null {
  if (r.target === 'heading') return headingSelector(r.level);
  return TARGET_SELECTORS[r.target] ?? null; // 'custom' and unknowns: skip
}

const HEX = /^#[0-9a-fA-F]{3,8}$/;

/** Declarations from a structured `set text(...)` style rule. */
function styleDecls(props: ShowRule['props'], pxPerPt: number): string[] {
  const decls: string[] = [];
  const fill = props.fill.trim();
  if (HEX.test(fill)) decls.push(`color: ${fill}`);
  if (props.sizePt != null) decls.push(`font-size: ${(props.sizePt * pxPerPt).toFixed(2)}px`);
  if (props.weight === 'bold') decls.push('font-weight: 700');
  else if (props.weight === 'regular') decls.push('font-weight: 400');
  if (props.style === 'italic') decls.push('font-style: italic');
  else if (props.style === 'normal') decls.push('font-style: normal');
  return decls;
}

/**
 * Best-effort declarations from a function-mode body (`it => { … }`). We only
 * recognise a few safe, common idioms — recolour via `text(fill: rgb("#…"))`
 * and `underline` / `strike` wrappers — which covers the seeded link rule and
 * simple hand-written recolours. Unrecognised bodies yield nothing.
 */
function functionDecls(body: string): string[] {
  const decls: string[] = [];
  const fill = body.match(/fill:\s*rgb\(\s*"(#[0-9a-fA-F]{3,8})"\s*\)/) ?? body.match(/fill:\s*"(#[0-9a-fA-F]{3,8})"/);
  if (fill) decls.push(`color: ${fill[1]}`);

  const lines: string[] = [];
  if (/\bunderline\b/.test(body)) lines.push('underline');
  if (/\b(strike|strikethrough)\b/.test(body)) lines.push('line-through');
  if (/\boverline\b/.test(body)) lines.push('overline');
  if (lines.length) decls.push(`text-decoration: ${lines.join(' ')}`);

  if (/weight:\s*"(bold|black|extrabold|semibold)"/.test(body) || /#?strong\b/.test(body)) decls.push('font-weight: 700');
  if (/style:\s*"italic"/.test(body) || /#?emph\b/.test(body)) decls.push('font-style: italic');
  return decls;
}

function declsFor(r: ShowRule, pxPerPt: number): string[] {
  if (r.kind === 'function') return functionDecls((r.body ?? '').trim());
  return styleDecls(r.props, pxPerPt);
}

/**
 * Build a CSS stylesheet from the document's show rules. `pxPerPt` converts a
 * Typst point size into editor pixels at the current page scale, matching how
 * the body font size is derived in syncPageMetrics.
 *
 * Later rules win on equal specificity, so we emit in document order — the same
 * order Typst applies them — letting a later rule override an earlier one.
 */
export function showRulesToCss(shows: ShowRule[], pxPerPt: number): string {
  const blocks: string[] = [];
  for (const r of shows) {
    const selector = selectorFor(r);
    if (!selector) continue;
    const decls = declsFor(r, pxPerPt);
    if (!decls.length) continue;
    blocks.push(`${selector} { ${decls.join('; ')}; }`);
  }
  return blocks.join('\n');
}
