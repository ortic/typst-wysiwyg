import { defineConfig } from 'vite';

export default defineConfig(({ command, mode }) => ({
  // - GitHub Pages project site lives under /typst-wysiwyg/
  // - Tauri loads from the bundled files, so use relative paths
  // - dev serves from the root
  base: mode === 'tauri' ? './' : command === 'build' ? '/typst-wysiwyg/' : '/',
  // Fixed port (Tauri's default) so its devUrl matches; don't clear Tauri output.
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // The compiler runs in a Web Worker that code-splits the WASM loaders, which
  // requires the ES module worker format (the default IIFE can't code-split).
  worker: { format: 'es' },
  // The typst.ts WASM modules are large; let esbuild leave them as assets.
  optimizeDeps: {
    exclude: [
      '@myriaddreamin/typst-ts-renderer',
      '@myriaddreamin/typst-ts-web-compiler',
    ],
  },
}));
