import { describe, it, expect } from 'vitest';
import { showRulesToCss } from './showcss';
import type { ShowRule } from './model';

const PX_PER_PT = 96 / 72; // identity scale for readable assertions

function rule(partial: Partial<ShowRule>): ShowRule {
  return {
    id: 'r',
    target: 'heading',
    level: null,
    props: { fill: '', sizePt: null, weight: 'inherit', style: 'inherit' },
    ...partial,
  } as ShowRule;
}

describe('showRulesToCss', () => {
  it('translates a heading fill rule (issue #1: blue level-1 heading)', () => {
    const css = showRulesToCss([rule({ target: 'heading', level: 1, props: { fill: '#1c7ed6', sizePt: null, weight: 'bold', style: 'inherit' } })], PX_PER_PT);
    expect(css).toBe('.page h1 { color: #1c7ed6; font-weight: 700; }');
  });

  it('expands an all-levels heading rule to h1..h6', () => {
    const css = showRulesToCss([rule({ target: 'heading', level: null, props: { fill: '#222222', sizePt: null, weight: 'inherit', style: 'inherit' } })], PX_PER_PT);
    expect(css).toContain('.page h1, .page h2, .page h3, .page h4, .page h5, .page h6 {');
    expect(css).toContain('color: #222222');
  });

  it('scales sizePt into px', () => {
    const css = showRulesToCss([rule({ target: 'heading', level: 2, props: { fill: '', sizePt: 18, weight: 'inherit', style: 'inherit' } })], 2);
    expect(css).toBe('.page h2 { font-size: 36.00px; }');
  });

  it('maps strong / emph / link / raw targets', () => {
    const mk = (target: ShowRule['target']) => rule({ target, props: { fill: '#ff0000', sizePt: null, weight: 'inherit', style: 'inherit' } });
    expect(showRulesToCss([mk('strong')], PX_PER_PT)).toContain('.page strong {');
    expect(showRulesToCss([mk('emph')], PX_PER_PT)).toContain('.page em {');
    expect(showRulesToCss([mk('link')], PX_PER_PT)).toContain('.page a {');
    expect(showRulesToCss([mk('raw')], PX_PER_PT)).toContain('.page code {');
  });

  it('skips custom selectors (no faithful CSS mapping)', () => {
    const css = showRulesToCss([rule({ target: 'custom', customSelector: 'figure.where(kind: image)', props: { fill: '#000000', sizePt: null, weight: 'inherit', style: 'inherit' } })], PX_PER_PT);
    expect(css).toBe('');
  });

  it('best-effort parses a function-mode link rule (recolour + underline)', () => {
    const css = showRulesToCss([rule({ target: 'link', kind: 'function', body: 'text(fill: rgb("#2f6fed"))[#underline(it)]' })], PX_PER_PT);
    expect(css).toBe('.page a { color: #2f6fed; text-decoration: underline; }');
  });

  it('emits nothing for an unrecognised function body', () => {
    const css = showRulesToCss([rule({ target: 'heading', kind: 'function', body: 'block(fill: luma(240), inset: 6pt, it)' })], PX_PER_PT);
    expect(css).toBe('');
  });

  it('preserves document order so later rules can override earlier ones', () => {
    const css = showRulesToCss([
      rule({ target: 'heading', level: 1, props: { fill: '#111111', sizePt: null, weight: 'inherit', style: 'inherit' } }),
      rule({ target: 'heading', level: 1, props: { fill: '#222222', sizePt: null, weight: 'inherit', style: 'inherit' } }),
    ], PX_PER_PT);
    expect(css.indexOf('#111111')).toBeLessThan(css.indexOf('#222222'));
  });
});
