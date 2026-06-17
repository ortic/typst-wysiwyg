import { defineConfig } from 'vite';

export default defineConfig(({ command, mode }) => ({
  // - GitHub Pages project site lives under /typst-wysiwyg/
  // - Tauri loads from the bundled files, so use relative paths
  // - dev serves from the root
  base: mode === 'tauri' ? './' : command === 'build' ? '/typst-wysiwyg/' : '/',
  // A fixed port so Tauri's devUrl matches; don't clear Tauri's terminal output.
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  // The typst.ts WASM modules are large; let esbuild leave them as assets.
  optimizeDeps: {
    exclude: [
      '@myriaddreamin/typst-ts-renderer',
      '@myriaddreamin/typst-ts-web-compiler',
    ],
  },
}));
