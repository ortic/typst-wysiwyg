// The LOGIC layer the editor owns. The CONTENT layer now lives in a ProseMirror
// document (via TipTap) — see editor.ts / serialize.ts — which gives us robust
// selection, clipboard, undo/redo and inline marks for free.
//
// A document = this logic layer + a ProseMirror content doc. We serialize both
// one-way to .typ (see generate.ts). There is still no Typst parser.

export type PageSize = 'a4' | 'us-letter' | 'a5';

export interface DocStyle {
  page: {
    paper: PageSize;
    marginCm: number;
    columns?: number;        // 1 = single column (default)
    headingNumbering?: boolean; // number headings (1, 1.1, …) — needed for @refs
    numbering?: boolean;     // page numbers in the footer
    numberingFormat?: string; // raw numbering value (e.g. `"1 / 1"`), preserved from import
    header?: string;     // header text (markup)
    footer?: string;     // footer text (markup)
    extra?: string[];    // unmodeled #set page args, kept verbatim for round-trip
  };
  text: { font: string; sizePt: number; extra?: string[] }; // empty font => Typst default
  par: { leadingEm: number; justify: boolean; extra?: string[] };
}

/**
 * A #let binding.
 *  - 'value':     `#let name = <expr>`
 *  - 'component': `#let name(body) = { ... }`
 *  - 'raw':       the whole `#let …` statement, kept verbatim. Used for
 *                 definitions we want to preserve exactly (e.g. the built-in
 *                 `callout`, or anything imported that we can't model cleanly).
 */
export interface LetBinding {
  id: string;
  name: string;
  kind: 'value' | 'component' | 'raw';
  code: string;
}

/** Stable id for the built-in callout so it round-trips without churn. */
export const CALLOUT_LET_ID = 'let-callout';

/** The built-in `callout(body)` component, seeded into every document. */
export const CALLOUT_SRC = `#let callout(body) = block(
  fill: rgb("#eef2ff"),
  stroke: 0.5pt + rgb("#6366f1"),
  inset: 10pt,
  radius: 4pt,
  width: 100%,
)[#body]`;

export function calloutLet(): LetBinding {
  return { id: CALLOUT_LET_ID, name: 'callout', kind: 'raw', code: CALLOUT_SRC };
}

/**
 * A structured #show rule: "when <target> [matches], set these text props".
 * Emits e.g. `#show heading.where(level: 1): set text(fill: rgb("#1c7ed6"))`.
 */
export type ShowTarget = 'heading' | 'strong' | 'emph' | 'link' | 'raw' | 'custom';

export interface ShowRule {
  id: string;
  target: ShowTarget;
  customSelector?: string; // raw Typst selector when target === 'custom'
  level: number | null; // only meaningful for heading; null = all levels
  kind?: 'style' | 'function'; // default 'style'
  body?: string; // Typst function body (receives `it`) when kind === 'function'
  props: {
    fill: string;       // '' or hex like #1c7ed6
    sizePt: number | null;
    weight: 'inherit' | 'regular' | 'bold';
    style: 'inherit' | 'normal' | 'italic';
  };
}

/** A bibliography source: raw BibTeX or Hayagriva YAML, mapped into the VFS. */
export interface Bibliography {
  format: 'bibtex' | 'yaml';
  content: string;
}

/** The non-content part of a document (content is the ProseMirror doc). */
export interface DocLogic {
  style: DocStyle;
  lets: LetBinding[];
  shows: ShowRule[];
  bibliography?: Bibliography;
  /**
   * Top-level preamble statements we don't model (e.g. `#import`,
   * `#set document(...)`), kept verbatim so loading and re-saving a .typ
   * doesn't drop them.
   */
  extra?: string[];
}

let counter = 0;
export function uid(prefix = 'n'): string {
  counter += 1;
  return `${prefix}${counter}`;
}
