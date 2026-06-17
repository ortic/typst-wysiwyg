// Native desktop integration (Tauri). On the web these are never called —
// isDesktop() is false and the browser download/upload paths are used instead.
// Tauri modules are imported dynamically so they stay out of the web bundle.

export interface FileFilter {
  name: string;
  extensions: string[];
}

/** True when running inside the Tauri webview. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Native "Save As" for text. Returns true if saved, false if cancelled. */
export async function saveTextDialog(defaultName: string, filters: FileFilter[], contents: string): Promise<boolean> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { invoke } = await import('@tauri-apps/api/core');
  const path = await save({ defaultPath: defaultName, filters });
  if (!path) return false;
  await invoke('save_text', { path, contents });
  return true;
}

/** Native "Save As" for binary data (e.g. a PDF). */
export async function saveBytesDialog(defaultName: string, filters: FileFilter[], bytes: Uint8Array): Promise<boolean> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { invoke } = await import('@tauri-apps/api/core');
  const path = await save({ defaultPath: defaultName, filters });
  if (!path) return false;
  await invoke('save_binary', { path, contents: Array.from(bytes) });
  return true;
}

/** Native "Open" for a text file. Returns its contents, or null if cancelled. */
export async function openTextDialog(filters: FileFilter[]): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { invoke } = await import('@tauri-apps/api/core');
  const path = await open({ multiple: false, directory: false, filters });
  if (!path || typeof path !== 'string') return null;
  return await invoke<string>('read_text', { path });
}
