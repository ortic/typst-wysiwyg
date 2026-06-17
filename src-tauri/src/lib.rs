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

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_text, save_binary, read_text])
        .run(tauri::generate_context!())
        .expect("error while running the Typst WYSIWYG application");
}
