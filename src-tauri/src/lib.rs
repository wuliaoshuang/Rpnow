// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // The HTTP plugin issues requests from Rust, so provider endpoints that
        // send no CORS headers (OpenAI, NovelAI, Volcengine Ark, Groq) work
        // natively here and on Android. This is the main reason the native
        // targets exist; the web build needs a proxy for those providers.
        .plugin(tauri_plugin_http::init())
        .setup(|_app| {
            #[cfg(debug_assertions)]
            _app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running RPNow");
}
