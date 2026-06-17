// Main-thread client for the Typst compiler, which actually runs in a Web
// Worker (typst.worker.ts) so large compiles never block the UI. The exported
// API is unchanged — every call posts a request and awaits the worker's reply.

import type { TypstRequest, TypstResponse } from './typst.worker';
import { assets } from './assets';

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, { resolve: (v: never) => void; reject: (e: unknown) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./typst.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<TypstResponse>) => {
    const res = ev.data;
    const slot = pending.get(res.id);
    if (!slot) return;
    pending.delete(res.id);
    if (res.ok) slot.resolve((('svg' in res ? res.svg : res.pdf) as unknown) as never);
    else slot.reject(res.error);
  };
  worker.onerror = (e) => {
    // A worker-level failure rejects everything in flight.
    for (const [, slot] of pending) slot.reject(e.message || 'Typst worker error');
    pending.clear();
  };
  return worker;
}

/** Snapshot the current VFS assets to ship alongside the compile request. */
function assetSnapshot(): [string, Uint8Array][] {
  return [...assets.entries()];
}

function request<T>(kind: TypstRequest['kind'], source: string): Promise<T> {
  const id = nextId++;
  const req: TypstRequest = { id, kind, source, assets: assetSnapshot() };
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: never) => void, reject });
    getWorker().postMessage(req);
  });
}

export function renderSvg(source: string): Promise<string> {
  return request<string>('svg', source);
}

export function renderPdf(source: string): Promise<Uint8Array> {
  return request<Uint8Array>('pdf', source);
}

/** Render a tightly-cropped fragment (e.g. a single equation) to SVG. */
export function renderFragmentSvg(body: string): Promise<string> {
  const src = `#set page(width: auto, height: auto, margin: 3pt)\n#set text(size: 13pt)\n${body}`;
  return request<string>('fragment', src);
}
