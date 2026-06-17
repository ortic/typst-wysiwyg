// Thin wrapper around typst.ts (the Typst compiler+renderer compiled to WASM).
// We hand it generated source and get back an SVG string for the preview.

import { $typst } from '@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs';
// Vite resolves these to asset URLs the WASM loaders can fetch.
import compilerWasm from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url';
import rendererWasm from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url';
import { assets } from './assets';

let initialized = false;

function init(): void {
  if (initialized) return;
  $typst.setCompilerInitOptions({ getModule: () => compilerWasm });
  $typst.setRendererInitOptions({ getModule: () => rendererWasm });
  initialized = true;
}

/** Make the current image assets available to the compiler's virtual FS. */
async function syncAssets(): Promise<void> {
  for (const [path, bytes] of assets) await $typst.mapShadow(path, bytes);
}

export async function renderSvg(source: string): Promise<string> {
  init();
  await syncAssets();
  return await $typst.svg({ mainContent: source });
}

export async function renderPdf(source: string): Promise<Uint8Array> {
  init();
  await syncAssets();
  const bytes = await $typst.pdf({ mainContent: source });
  if (!bytes) throw new Error('PDF generation returned no data');
  return bytes;
}
