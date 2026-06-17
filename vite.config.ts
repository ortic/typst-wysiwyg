import { defineConfig } from 'vite';

export default defineConfig(({ command, mode }) => ({
  // - GitHub Pages project site lives under /typst-wysiwyg/
  // - Tauri loads from the bundled files, so use relative paths
  // - dev serves from the root
  base: mode === 'tauri' ? './' : command === 'build' ? '/typst-wysiwyg/' : '/',
  // Fixed port (Tauri's default) so its devUrl matches; don't clear Tauri output.
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // The typst.ts WASM modules are large; let esbuild leave them as assets.
  optimizeDeps: {
    exclude: [
      '@myriaddreamin/typst-ts-renderer',
      '@myriaddreamin/typst-ts-web-compiler',
    ],
  },
}));
