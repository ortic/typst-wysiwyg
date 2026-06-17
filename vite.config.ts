import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Project site lives at https://ortic.github.io/typst-wysiwyg/ in production;
  // dev keeps serving from the root.
  base: command === 'build' ? '/typst-wysiwyg/' : '/',
  server: { port: 5173 },
  // The typst.ts WASM modules are large; let esbuild leave them as assets.
  optimizeDeps: {
    exclude: [
      '@myriaddreamin/typst-ts-renderer',
      '@myriaddreamin/typst-ts-web-compiler',
    ],
  },
}));
