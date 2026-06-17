// In-memory image assets for the current session.
//
// Images live here as raw bytes keyed by a virtual path (e.g. "assets/img1.png").
// The editor shows them via a data URL stored on the node; the Typst compiler
// loads them from these bytes, which we register into its virtual filesystem
// before each compile (see typst.ts). Not persisted yet — see the roadmap.

export const assets = new Map<string, Uint8Array>();

let counter = 0;

export function addAsset(bytes: Uint8Array, ext: string): string {
  counter += 1;
  const safeExt = /^[a-z0-9]+$/i.test(ext) ? ext.toLowerCase() : 'png';
  // Absolute path: the compiler's main file is /main.typ (root is "/"), so the
  // shadow file and the `image("/assets/..")` reference both live under root.
  const path = `/assets/img${counter}.${safeExt}`;
  assets.set(path, bytes);
  return path;
}
