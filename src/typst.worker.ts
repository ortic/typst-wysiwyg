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

// The main file is mapped at the VFS root rather than passed as `mainContent`,
// which would park it in /tmp/<random>.typ. Typst resolves a relative
// `image("assets/x.png")` against the main file's own directory, so from /tmp
// it would look outside the project root and fail; from the root it lands on
// /assets/x.png — exactly the key the asset store uses (see assets.ts). That
// matters for zip bundles, which routinely carry relative image paths.
const MAIN_PATH = '/main.typ';
const FRAGMENT_PATH = '/fragment.typ';

async function handle(req: TypstRequest): Promise<TypstResponse> {
  return enqueue(async () => {
    try {
      init();
      for (const [path, bytes] of req.assets) await $typst.mapShadow(path, bytes);
      const mainFilePath = req.kind === 'fragment' ? FRAGMENT_PATH : MAIN_PATH;
      await $typst.addSource(mainFilePath, req.source);
      if (req.kind === 'pdf') {
        const pdf = await $typst.pdf({ mainFilePath });
        if (!pdf) throw new Error('PDF generation returned no data');
        return { id: req.id, ok: true, pdf } as TypstResponse;
      }
      const svg = await $typst.svg({ mainFilePath });
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
