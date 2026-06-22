// Golden round-trip tests for the serializer + importer.
//
// We build the ProseMirror schema headlessly (getSchema, no DOM) so we can turn
// imported content JSON into real nodes, re-serialize, and assert the .typ is
// both correct and idempotent: import → generate → import yields the same model.

import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { buildExtensions } from './editor';
import { generate } from './generate';
import { importTypst } from './typimport';
import type { DocLogic } from './model';

const schema = getSchema(buildExtensions([]));

/** Run a source string through a full import → generate → import cycle. */
function cycle(src: string): { typ: string; logic: DocLogic; content: object } {
  const parsed = importTypst(src);
  const doc = PMNode.fromJSON(schema, parsed.content);
  const typ = generate(parsed.logic, doc);
  return { typ, logic: parsed.logic, content: parsed.content };
}

const SAMPLES: Record<string, string> = {
  headings: `#set page(paper: "a4", margin: 2cm)
= Intro
== Details
Some body text with *bold* and _italic_.`,

  numberedRefs: `#set page(paper: "a4", margin: 2cm)
#set heading(numbering: "1.1")
= Results <results>
See @results for the summary.`,

  lists: `= Tasks
- first
- second
+ ordered one
+ ordered two`,

  callout: `= Note
#callout[
  Watch out for this.
]`,

  columns: `= Layout
#columns(2)[
  Left and right flow here.
]`,

  codeListing: `= Code
\`\`\`python
def hello():
    print("hi")
\`\`\``,

  pagebreak: `= One
#pagebreak()
= Two`,

  figure: `= Pics
#figure(image("/assets/img1.png", width: 60%), caption: [A diagram])`,
};

describe('round-trip', () => {
  for (const [name, src] of Object.entries(SAMPLES)) {
    it(`is idempotent for ${name}`, () => {
      const first = cycle(src);
      const second = cycle(first.typ);
      // The model (logic + content) must be stable across a second cycle.
      expect(second.logic).toEqual(first.logic);
      expect(second.content).toEqual(first.content);
      // And re-serializing the second model yields byte-identical Typst.
      expect(second.typ).toEqual(first.typ);
    });
  }
});

describe('generated Typst', () => {
  it('emits heading numbering when references are present', () => {
    const { typ } = cycle(SAMPLES.numberedRefs);
    expect(typ).toContain('#set heading(numbering: "1.1")');
    expect(typ).toContain('<results>');
    expect(typ).toContain('#ref(<results>)');
  });

  it('serializes code listings as #raw with the language tag', () => {
    const { typ } = cycle(SAMPLES.codeListing);
    expect(typ).toContain('#raw(');
    expect(typ).toContain('block: true');
    expect(typ).toContain('lang: "python"');
    expect(typ).toContain('def hello():');
  });

  it('keeps code listings whose content contains triple backticks intact', () => {
    // A listing whose code literally contains a ``` line would break a fenced
    // block; #raw + a quoted string must survive it and round-trip exactly.
    const code = 'a = 1\n```\nprint(a)';
    const doc = PMNode.fromJSON(schema, {
      type: 'doc',
      content: [{ type: 'codeListing', attrs: { language: 'python' }, content: [{ type: 'text', text: code }] }],
    });
    const typ = generate({ style: importTypst('').logic.style, lets: [], shows: [] }, doc);
    expect(typ).toContain('#raw('); // a fence would break out; #raw can't
    const back = importTypst(typ) as { content: { content: object[] } };
    expect(back.content.content[0]).toMatchObject({
      type: 'codeListing',
      attrs: { language: 'python' },
      content: [{ type: 'text', text: code }],
    });
  });

  it('reads the code from a #raw call regardless of argument order', () => {
    // The code is the positional string; a `lang:` value must not be mistaken for it.
    const typ = '#raw(block: true, lang: "python", "return f\\"Hi {name}\\"")';
    const back = importTypst(typ) as { content: { content: object[] } };
    expect(back.content.content[0]).toMatchObject({
      type: 'codeListing',
      attrs: { language: 'python' },
      content: [{ type: 'text', text: 'return f"Hi {name}"' }],
    });
  });

  it('recovers code that spilled outside an empty #raw call', () => {
    // A broken listing (empty raw string + an indented body) is re-absorbed,
    // dedented, instead of leaving the code stranded in a paragraph.
    const typ = '#raw("", block: true, lang: "python")\n\n    def greet(name):\n        return f"Hi {name}"';
    const back = importTypst(typ) as { content: { content: object[] } };
    expect(back.content.content).toHaveLength(1);
    expect(back.content.content[0]).toMatchObject({
      type: 'codeListing',
      attrs: { language: 'python' },
      content: [{ type: 'text', text: 'def greet(name):\n    return f"Hi {name}"' }],
    });
  });

  it('does not absorb ordinary prose after an empty #raw call', () => {
    const typ = '#raw("", block: true)\n\nThis is normal prose, not indented.';
    const back = importTypst(typ) as { content: { content: { type: string }[] } };
    expect(back.content.content.map((b) => b.type)).toEqual(['codeListing', 'paragraph']);
  });

  it('captures the callout definition so it is visible and editable', () => {
    const back = importTypst(SAMPLES.callout) as { logic: DocLogic };
    expect(back.logic.lets).toEqual([
      expect.objectContaining({ name: 'callout', kind: 'raw' }),
    ]);
  });

  it('preserves a customized callout across a save', () => {
    const custom = `#let callout(body) = block(
  fill: rgb("#ffe3e3"),
  inset: 14pt,
)[#body]

// --- content ---
= Note
#callout[
  Watch out.
]`;
    const first = importTypst(custom) as { logic: DocLogic; content: object };
    const callout = first.logic.lets.find((l) => l.name === 'callout')!;
    expect(callout.code).toContain('#ffe3e3');
    expect(callout.code).toContain('inset: 14pt');
    // It must survive a generate → import round-trip unchanged.
    const typ = generate(first.logic, PMNode.fromJSON(schema, first.content));
    expect(typ).toContain('#ffe3e3');
    const second = importTypst(typ) as { logic: DocLogic };
    expect(second.logic.lets.find((l) => l.name === 'callout')!.code).toContain('#ffe3e3');
  });

  it('preserves imports and unmodeled preamble across a save', () => {
    const src = `#import "@preview/cetz:0.2.0": canvas
#set document(title: "Paper")
#set page(paper: "a4", margin: 2cm)

= Intro
Body text.`;
    const first = importTypst(src) as { logic: DocLogic; content: object };
    expect(first.logic.extra).toEqual([
      '#import "@preview/cetz:0.2.0": canvas',
      '#set document(title: "Paper")',
    ]);
    const typ = generate(first.logic, PMNode.fromJSON(schema, first.content));
    expect(typ).toContain('#import "@preview/cetz:0.2.0": canvas');
    expect(typ).toContain('#set document(title: "Paper")');
    // A second cycle keeps the same preserved preamble (idempotent).
    const second = importTypst(typ) as { logic: DocLogic };
    expect(second.logic.extra).toEqual(first.logic.extra);
  });

  it('round-trips a #show rule whose selector contains a colon', () => {
    const src = `#show heading.where(level: 1): set text(fill: rgb("#1c7ed6"), weight: "bold")

= Title
Body.`;
    const parsed = importTypst(src) as { logic: DocLogic; content: object };
    expect(parsed.logic.shows).toEqual([
      expect.objectContaining({
        target: 'heading', level: 1,
        props: expect.objectContaining({ fill: '#1c7ed6', weight: 'bold' }),
      }),
    ]);
    const typ = generate(parsed.logic, PMNode.fromJSON(schema, parsed.content));
    expect(typ).toContain('#show heading.where(level: 1): set text(fill: rgb("#1c7ed6"), weight: "bold")');
  });

  it('a malformed, never-balancing statement cannot swallow the document', () => {
    const src = `#show heading.where(level: set text(

= Title
Body paragraph here.`;
    const parsed = importTypst(src) as { content: { content: { type: string }[] } };
    const types = parsed.content.content.map((b) => b.type);
    expect(types).toContain('heading');
    expect(types).toContain('paragraph');
  });

  it('preserves unmodeled #set arguments and the numbering format', () => {
    const src = `#set page(paper: "a4", margin: 2cm, numbering: "1 / 1")
#set text(size: 11pt, lang: "en", fill: rgb("#333333"))
#set par(leading: 0.65em, justify: true, first-line-indent: 1em)

= Title
Body.`;
    const first = cycle(src);
    expect(first.typ).toContain('numbering: "1 / 1"');
    expect(first.typ).toContain('lang: "en"');
    expect(first.typ).toContain('fill: rgb("#333333")');
    expect(first.typ).toContain('first-line-indent: 1em');
    // and a second cycle is byte-identical (no drift in the preserved args)
    expect(cycle(first.typ).typ).toBe(first.typ);
  });

  it('preserves a custom #set heading numbering and extra args', () => {
    const src = `#set heading(numbering: "I.", supplement: [Section])

= Title <t>
See @t.`;
    const first = cycle(src);
    expect(first.typ).toContain('numbering: "I."');
    expect(first.typ).toContain('supplement: [Section]');
    expect(cycle(first.typ).typ).toBe(first.typ);
  });

  it('preserves callouts and columns as functions', () => {
    expect(cycle(SAMPLES.callout).typ).toContain('#callout[');
    expect(cycle(SAMPLES.columns).typ).toContain('#columns(2)[');
  });

  it('structures figures (keeps the path and caption)', () => {
    const { typ } = cycle(SAMPLES.figure);
    expect(typ).toContain('#figure(image("/assets/img1.png", width: 60%)');
    expect(typ).toContain('caption: [A diagram]');
  });
});
