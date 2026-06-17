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

  it('fences code listings with the language tag', () => {
    const { typ } = cycle(SAMPLES.codeListing);
    expect(typ).toMatch(/```python/);
    expect(typ).toContain('def hello():');
  });

  it('preserves callouts and columns as functions', () => {
    expect(cycle(SAMPLES.callout).typ).toContain('#callout[');
    expect(cycle(SAMPLES.columns).typ).toContain('#columns(2)[');
  });
});
