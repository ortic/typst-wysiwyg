// Fidelity tests against real-world .typ files pulled from typst/templates.
//
// The guarantee we care about: loading a document and saving it again must not
// disturb anything except what the user actually changed. For each fixture we
// import → generate a baseline, then make one tiny content edit and assert the
// regenerated .typ differs from the baseline on exactly the edited line.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { buildExtensions } from './editor';
import { generate } from './generate';
import { importTypst } from './typimport';

const schema = getSchema(buildExtensions([]));
const FIXTURES = ['appreciated-letter', 'wonderous-book', 'unequivocal-ams', 'charged-ieee'];

function readFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}.typ`, import.meta.url), 'utf8');
}

type JNode = { type?: string; text?: string; content?: JNode[] };

/** First text run inside a paragraph that has no line break — safe to edit
 *  knowing the paragraph serializes to a single line. */
function findEditableTextNode(content: JNode): JNode | null {
  let found: JNode | null = null;
  const walk = (n: JNode): void => {
    if (found || !n) return;
    if (n.type === 'paragraph') {
      const inl = n.content ?? [];
      if (!inl.some((c) => c.type === 'hardBreak')) {
        const tn = inl.find((c) => c.type === 'text' && (c.text ?? '').trim().length >= 8);
        if (tn) { found = tn; return; }
      }
    }
    (n.content ?? []).forEach(walk);
  };
  walk(content);
  return found;
}

const SENTINEL = 'SENTINELxEDITxMARKERx42';

describe('fidelity (real templates)', () => {
  for (const name of FIXTURES) {
    describe(name, () => {
      const src = readFixture(name);
      const model = importTypst(src);
      const baseline = generate(model.logic, PMNode.fromJSON(schema, model.content));

      it('imports without throwing and produces non-empty Typst', () => {
        expect(baseline.length).toBeGreaterThan(0);
      });

      it('re-saving our own output is a fixed point', () => {
        const reModel = importTypst(baseline);
        const reTyp = generate(reModel.logic, PMNode.fromJSON(schema, reModel.content));
        expect(reTyp).toBe(baseline);
      });

      it('editing one paragraph changes only that line', () => {
        const content = JSON.parse(JSON.stringify(model.content)) as JNode;
        const node = findEditableTextNode(content);
        expect(node, `no editable paragraph found in ${name}`).toBeTruthy();
        expect(baseline).not.toContain(SENTINEL);

        node!.text = SENTINEL;
        const modified = generate(model.logic, PMNode.fromJSON(schema, content));

        const a = baseline.split('\n');
        const b = modified.split('\n');
        expect(b.length).toBe(a.length);
        const changed = a.map((l, i) => (l === b[i] ? -1 : i)).filter((i) => i >= 0);
        expect(changed).toHaveLength(1);
        expect(b[changed[0]]).toContain(SENTINEL);
      });
    });
  }
});
