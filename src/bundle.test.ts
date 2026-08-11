import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { buildBundle, readBundle, isZip, MAIN_TYP, STATE_ENTRY } from './bundle';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe('isZip', () => {
  it('recognizes a zip and rejects Typst source', () => {
    expect(isZip(buildBundle('#lorem(5)', '{}', []))).toBe(true);
    expect(isZip(strToU8('= Heading\n\nPKZIP is not this.'))).toBe(false);
  });
});

describe('bundle round-trip', () => {
  it('restores source, state and media', () => {
    const zip = buildBundle('#image("/assets/img1.png")', '{"version":1}', [['/assets/img1.png', png]]);
    const back = readBundle(zip);
    expect(back.typ).toBe('#image("/assets/img1.png")');
    expect(back.state).toBe('{"version":1}');
    expect([...back.assets.keys()]).toEqual(['/assets/img1.png']);
    expect(back.assets.get('/assets/img1.png')).toEqual(png);
  });

  it('writes entries at relative paths, so the zip is a real Typst project', () => {
    const zip = buildBundle('x', '{}', [['/assets/img1.png', png]]);
    // Absolute in the VFS, relative in the archive — the compiler resolves
    // /assets/img1.png against the project root, which is main.typ's folder.
    expect(Object.keys(unzipSync(zip)).sort()).toEqual([STATE_ENTRY, 'assets/img1.png', MAIN_TYP].sort());
  });
});

describe('reading a zip made elsewhere', () => {
  it('imports a plain Typst project with no state sidecar', () => {
    const zip = zipSync({ 'report.typ': strToU8('#image("images/sun.png")'), 'images/sun.png': png });
    const back = readBundle(zip);
    expect(back.typ).toBe('#image("images/sun.png")');
    expect(back.state).toBeNull();
    // Keyed to match how the compiler resolves the relative reference.
    expect(back.assets.get('/images/sun.png')).toEqual(png);
  });

  it('strips the wrapper folder that zipping a directory adds', () => {
    const zip = zipSync({
      'my-paper/main.typ': strToU8('#image("assets/a.png")'),
      'my-paper/assets/a.png': png,
      'my-paper/.typwys/state.json': strToU8('{"version":1}'),
    });
    const back = readBundle(zip);
    expect(back.state).toBe('{"version":1}');
    expect(back.assets.get('/assets/a.png')).toEqual(png);
  });

  it('keeps included .typ files as assets so the compiler can read them', () => {
    const zip = zipSync({ [MAIN_TYP]: strToU8('#include "chapter.typ"'), 'chapter.typ': strToU8('= Ch') });
    const back = readBundle(zip);
    expect(back.typ).toBe('#include "chapter.typ"');
    expect(back.assets.has('/chapter.typ')).toBe(true);
  });

  it('prefers main.typ over a deeper or later-named .typ', () => {
    const zip = zipSync({
      [MAIN_TYP]: strToU8('main'),
      'appendix.typ': strToU8('appendix'),
      'parts/deep.typ': strToU8('deep'),
    });
    expect(readBundle(zip).typ).toBe('main');
  });

  it('ignores archiver metadata', () => {
    const zip = zipSync({
      [MAIN_TYP]: strToU8('x'),
      '__MACOSX/._main.typ': png,
      '.DS_Store': png,
    });
    expect([...readBundle(zip).assets.keys()]).toEqual([]);
  });

  it('reports a zip that holds no document', () => {
    expect(() => readBundle(zipSync({ 'notes.txt': strToU8('hi') }))).toThrow(/no \.typ/);
  });

  it('round-trips a bundle it just read', () => {
    const first = buildBundle('#image("/assets/img1.png")', '{"version":1}', [['/assets/img1.png', png]]);
    const back = readBundle(first);
    const again = readBundle(buildBundle(back.typ, back.state ?? '', back.assets));
    expect(again.typ).toBe(back.typ);
    expect(again.state).toBe('{"version":1}');
    expect(again.assets.get('/assets/img1.png')).toEqual(png);
  });
});
