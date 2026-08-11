// In-memory image assets for the current session.
//
// Images live here as raw bytes keyed by a virtual path (e.g. "/assets/img1.png").
// The editor shows them via a data URL stored on the node; the Typst compiler
// loads them from these bytes, which we register into its virtual filesystem
// before each compile (see typst.ts). Saving writes them out either as real
// files inside a zip bundle (bundle.ts) or base64 in the .typ state trailer.

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

/** Normalize a zip entry name or Typst path reference to a VFS key. */
export function vfsPath(p: string): string {
  let s = p.trim();
  while (s.startsWith('./')) s = s.slice(2);
  return '/' + s.replace(/^\/+/, '');
}

/** Look up an asset by whatever form the path took in the source. */
export function findAsset(ref: string): Uint8Array | undefined {
  return assets.get(ref) ?? assets.get(vfsPath(ref));
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
};

/** A data URL for an asset, for display in the editor. Null if we don't have it. */
export function assetDataUrl(ref: string): string | null {
  const bytes = findAsset(ref);
  if (!bytes) return null;
  const ext = ref.split('.').pop()?.toLowerCase() ?? '';
  return `data:${MIME[ext] ?? 'application/octet-stream'};base64,${bytesToB64(bytes)}`;
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
