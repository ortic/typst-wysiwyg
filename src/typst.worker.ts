// Web Worker that owns the Typst WASM compiler so compiles run off the main
// thread and never jank typing or scrolling. The main thread talks to it via
// the typed request/response messages below (see typst.ts).

import { $typst } from '@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs';
import compilerWasm from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url';
import rendererWasm from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url';

export type TypstRequest = {
  id: number;
  kind: 'svg' | 'pdf' | 'fragment';
  source: string;
  assets: [string, Uint8Array][];
};
export type TypstResponse =
  | { id: number; ok: true; svg: string }
  | { id: number; ok: true; pdf: Uint8Array }
  | { id: number; ok: false; error: string };

let initialized = false;
function init(): void {
  if (initialized) return;
  $typst.setCompilerInitOptions({ getModule: () => compilerWasm });
  $typst.setRendererInitOptions({ getModule: () => rendererWasm });
  initialized = true;
}

// One WASM instance, so serialize every compile to avoid interleaving them.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

async function handle(req: TypstRequest): Promise<TypstResponse> {
  return enqueue(async () => {
    try {
      init();
      for (const [path, bytes] of req.assets) await $typst.mapShadow(path, bytes);
      if (req.kind === 'pdf') {
        const pdf = await $typst.pdf({ mainContent: req.source });
        if (!pdf) throw new Error('PDF generation returned no data');
        return { id: req.id, ok: true, pdf } as TypstResponse;
      }
      const svg = await $typst.svg({ mainContent: req.source });
      return { id: req.id, ok: true, svg } as TypstResponse;
    } catch (e) {
      return { id: req.id, ok: false, error: String(e) } as TypstResponse;
    }
  });
}

self.onmessage = async (ev: MessageEvent<TypstRequest>) => {
  const res = await handle(ev.data);
  // Transfer the PDF bytes back to avoid a copy.
  if ('pdf' in res) (self as unknown as Worker).postMessage(res, [res.pdf.buffer]);
  else (self as unknown as Worker).postMessage(res);
};
