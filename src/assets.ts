// In-memory image assets for the current session.
//
// Images live here as raw bytes keyed by a virtual path (e.g. "assets/img1.png").
// The editor shows them via a data URL stored on the node; the Typst compiler
// loads them from these bytes, which we register into its virtual filesystem
// before each compile (see typst.ts). Not persisted yet — see the roadmap.

export const assets = new Map<string, Uint8Array>();

let counter = 0;

export function addAsset(bytes: Uint8Array, ext: string): string {
  const safeExt = /^[a-z0-9]+$/i.test(ext) ? ext.toLowerCase() : 'png';
  // Absolute path: the compiler's main file is /main.typ (root is "/"), so the
  // shadow file and the `image("/assets/..")` reference both live under root.
  // Skip paths already in use (e.g. after restoring a saved document).
  let path: string;
  do {
    counter += 1;
    path = `/assets/img${counter}.${safeExt}`;
  } while (assets.has(path));
  assets.set(path, bytes);
  return path;
}

/** Replace all assets (used when opening / restoring a document). */
export function clearAssets(): void {
  assets.clear();
}
