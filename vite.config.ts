import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
  // The typst.ts WASM modules are large; let esbuild leave them as assets.
  optimizeDeps: {
    exclude: [
      '@myriaddreamin/typst-ts-renderer',
      '@myriaddreamin/typst-ts-web-compiler',
    ],
  },
});
