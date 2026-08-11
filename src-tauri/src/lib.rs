// File I/O for the desktop build. The dialog plugin supplies a native "Open"/
// "Save As" path; these app commands do the actual read/write. App-defined
// commands don't need ACL permissions (only plugin commands do).

#[tauri::command]
fn save_text(path: String, contents: String) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_binary(path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

// Answers with a raw IPC body rather than a JSON array of numbers, so opening
// a large zip bundle doesn't pay for serializing every byte.
#[tauri::command]
fn read_binary(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_text, save_binary, read_binary])
        .run(tauri::generate_context!())
        .expect("error while running the Typst WYSIWYG application");
}
