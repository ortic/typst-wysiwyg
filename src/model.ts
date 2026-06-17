// The LOGIC layer the editor owns. The CONTENT layer now lives in a ProseMirror
// document (via TipTap) — see editor.ts / serialize.ts — which gives us robust
// selection, clipboard, undo/redo and inline marks for free.
//
// A document = this logic layer + a ProseMirror content doc. We serialize both
// one-way to .typ (see generate.ts). There is still no Typst parser.

export type PageSize = 'a4' | 'us-letter' | 'a5';

export interface DocStyle {
  page: { paper: PageSize; marginCm: number };
  text: { font: string; sizePt: number }; // empty font => Typst default
  par: { leadingEm: number; justify: boolean };
}

/**
 * A #let binding.
 *  - 'value':     `#let name = <expr>`
 *  - 'component': `#let name(body) = { ... }`
 */
export interface LetBinding {
  id: string;
  name: string;
  kind: 'value' | 'component';
  code: string;
}

/**
 * A structured #show rule: "when <target> [matches], set these text props".
 * Emits e.g. `#show heading.where(level: 1): set text(fill: rgb("#1c7ed6"))`.
 */
export type ShowTarget = 'heading' | 'strong' | 'emph' | 'link' | 'raw';

export interface ShowRule {
  id: string;
  target: ShowTarget;
  level: number | null; // only meaningful for heading; null = all levels
  props: {
    fill: string;       // '' or hex like #1c7ed6
    sizePt: number | null;
    weight: 'inherit' | 'regular' | 'bold';
    style: 'inherit' | 'normal' | 'italic';
  };
}

/** The non-content part of a document (content is the ProseMirror doc). */
export interface DocLogic {
  style: DocStyle;
  lets: LetBinding[];
  shows: ShowRule[];
}

let counter = 0;
export function uid(prefix = 'n'): string {
  counter += 1;
  return `${prefix}${counter}`;
}
