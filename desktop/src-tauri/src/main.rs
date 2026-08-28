use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{Emitter, LogicalSize, Manager, Size, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

#[tauri::command]
fn hide_overlay(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn set_click_through(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(enabled)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_overlay_size(window: WebviewWindow, compact: bool) -> Result<(), String> {
    let (width, height) = if compact { (390.0, 286.0) } else { (430.0, 760.0) };
    window
        .set_size(Size::Logical(LogicalSize::new(width, height)))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn start_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let click_through = Arc::new(AtomicBool::new(false));
            let click_through_handler = Arc::clone(&click_through);

            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_shortcuts(["alt+q", "alt+w", "alt+e"])?
                    .with_handler(move |app, shortcut, event| {
                        if event.state != ShortcutState::Pressed {
                            return;
                        }

                        let Some(window) = app.get_webview_window("main") else {
                            return;
                        };

                        if shortcut.matches(Modifiers::ALT, Code::KeyQ) {
                            if window.is_visible().unwrap_or(true) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                            return;
                        }

                        if shortcut.matches(Modifiers::ALT, Code::KeyW) {
                            let enabled = !click_through_handler.load(Ordering::Relaxed);
                            click_through_handler.store(enabled, Ordering::Relaxed);
                            let _ = window.set_ignore_cursor_events(enabled);
                            let _ = window.emit("overlay-click-through", enabled);
                            return;
                        }

                        if shortcut.matches(Modifiers::ALT, Code::KeyE) {
                            let _ = window.emit("overlay-toggle-compact", ());
                        }
                    })
                    .build(),
            )?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hide_overlay,
            set_click_through,
            set_overlay_size,
            start_drag
        ])
        .run(tauri::generate_context!())
        .expect("error while running TFTGOLDENCHANCHAN overlay");
}
