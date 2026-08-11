// Zip bundles: a document plus its media, laid out as a real Typst project.
//
//   main.typ            clean Typst source — `typst compile main.typ` just works
//   assets/img1.png     media, byte-identical to what was imported
//   .typwys/state.json  editor state (logic + ProseMirror JSON), no image bytes
//
// The sidecar is what makes a bundle round-trip losslessly through the editor;
// other Typst tooling ignores it. A zip without one still opens — it goes
// through the normal .typ importer, only now the images resolve for real
// instead of falling back to the placeholder (see typimport.ts).
//
// Absolute paths like `/assets/img1.png` are what the editor writes, and they
// resolve for the real compiler too: Typst reads them relative to the project
// root, which defaults to the main file's directory.

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { vfsPath } from './assets';

export const MAIN_TYP = 'main.typ';
export const STATE_ENTRY = '.typwys/state.json';

export interface Bundle {
  /** Source of the main .typ file. */
  typ: string;
  /** The state sidecar's contents, or null when the zip carries none. */
  state: string | null;
  /** Every other file, keyed by absolute VFS path (`/assets/img1.png`). */
  assets: Map<string, Uint8Array>;
}

/** True when these bytes carry a zip signature ("PK\x03\x04" or an empty zip). */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
    && (bytes[2] === 0x03 || bytes[2] === 0x05) && (bytes[3] === 0x04 || bytes[3] === 0x06);
}

/** Metadata some archivers add; never part of the document. */
function isJunk(name: string): boolean {
  return name.startsWith('__MACOSX/') || name.endsWith('.DS_Store') || name.endsWith('Thumbs.db');
}

/** The main file: shallowest .typ, preferring one actually named main.typ. */
function pickMain(names: string[]): string | undefined {
  const depth = (n: string) => n.split('/').length;
  return names
    .filter((n) => n.toLowerCase().endsWith('.typ'))
    .sort((a, b) => depth(a) - depth(b)
      || Number(b.endsWith(`/${MAIN_TYP}`) || b === MAIN_TYP) - Number(a.endsWith(`/${MAIN_TYP}`) || a === MAIN_TYP)
      || a.localeCompare(b))[0];
}

export function readBundle(bytes: Uint8Array): Bundle {
  const files = unzipSync(bytes);
  const names = Object.keys(files).filter((n) => !n.endsWith('/') && !isJunk(n));
  const mainName = pickMain(names);
  if (!mainName) throw new Error('This zip contains no .typ file.');

  // Zipping a folder nests everything under it, so treat the main file's own
  // directory as the project root — otherwise `image("assets/..")` misses.
  const root = mainName.slice(0, mainName.lastIndexOf('/') + 1);
  const stateName = root + STATE_ENTRY;

  const assets = new Map<string, Uint8Array>();
  for (const name of names) {
    // Included .typ files count as assets too: the compiler needs their bytes.
    if (name === mainName || name === stateName || !name.startsWith(root)) continue;
    assets.set(vfsPath(name.slice(root.length)), files[name]);
  }

  return {
    typ: strFromU8(files[mainName]),
    state: files[stateName] ? strFromU8(files[stateName]) : null,
    assets,
  };
}

export function buildBundle(typ: string, state: string, assets: Iterable<[string, Uint8Array]>): Uint8Array {
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    [MAIN_TYP]: strToU8(typ),
    [STATE_ENTRY]: strToU8(state),
  };
  for (const [path, bytes] of assets) {
    // Media arrives already compressed; storing it keeps zipping instant.
    entries[path.replace(/^\//, '')] = [bytes, { level: 0 }];
  }
  return zipSync(entries, { level: 6 });
}
