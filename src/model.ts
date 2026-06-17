// The document model the editor OWNS. This — not Typst text — is the source of
// truth. We serialize one-way to .typ (see generate.ts). There is no Typst
// parser here on purpose: for now we only create new documents.
//
// The model is split into two layers, matching the product concept:
//   - the LOGIC/STYLE layer (style + lets): #set / #let, managed via inspectors
//   - the CONTENT layer (blocks): the WYSIWYG body
//
// A "normal" user touches the content layer and a few style fields. A power
// user opens the definitions panel and the raw-code escape hatch.

export type PageSize = 'a4' | 'us-letter' | 'a5';

export interface DocStyle {
  page: {
    paper: PageSize;
    marginCm: number;
  };
  text: {
    /** Empty string => Typst default font. */
    font: string;
    sizePt: number;
  };
  par: {
    leadingEm: number;
    justify: boolean;
  };
}

/**
 * A #let binding in the logic layer.
 *  - kind 'value':     `#let name = <expr>`        (e.g. company = "Ortic")
 *  - kind 'component': `#let name(body) = { ... }`  (a reusable block)
 * For the spike, `expr` / `body` hold a raw Typst expression. In the real
 * product these get their own structured editors; the data shape stays.
 */
export interface LetBinding {
  id: string;
  name: string;
  kind: 'value' | 'component';
  /** For 'value': the expression. For 'component': the body (receives `body`). */
  code: string;
}

export type Block =
  | { id: string; type: 'heading'; level: 1 | 2 | 3; text: string }
  | { id: string; type: 'paragraph'; text: string }
  | { id: string; type: 'list'; ordered: boolean; items: string[] }
  | { id: string; type: 'callout'; text: string } // uses a built-in component
  | { id: string; type: 'raw'; code: string };    // power-user escape hatch

export interface Doc {
  style: DocStyle;
  lets: LetBinding[];
  content: Block[];
}

let counter = 0;
export function uid(prefix = 'n'): string {
  counter += 1;
  return `${prefix}${counter}`;
}
