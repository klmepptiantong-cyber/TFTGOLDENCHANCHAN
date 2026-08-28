use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::Serialize;
use std::{
    io::Cursor,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, LogicalSize, Manager, Size, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};
use xcap::{
    image::{DynamicImage, ImageFormat},
    Window,
};

#[derive(Serialize)]
struct CaptureWindowInfo {
    id: String,
    title: String,
    app_name: String,
    width: u32,
    height: u32,
    focused: bool,
}

#[derive(Serialize)]
struct CaptureFrame {
    window_id: String,
    title: String,
    width: u32,
    height: u32,
    captured_at_ms: u128,
    data_url: String,
}

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

#[tauri::command]
fn list_capture_windows() -> Result<Vec<CaptureWindowInfo>, String> {
    let mut result = Vec::new();
    for window in Window::all().map_err(|error| error.to_string())? {
        if window.is_minimized().unwrap_or(false) {
            continue;
        }
        let title = window.title().unwrap_or_default().trim().to_string();
        if title.is_empty() {
            continue;
        }
        let width = window.width().unwrap_or(0);
        let height = window.height().unwrap_or(0);
        if width < 320 || height < 240 {
            continue;
        }
        result.push(CaptureWindowInfo {
            id: window.id().map_err(|error| error.to_string())?.to_string(),
            title,
            app_name: window.app_name().unwrap_or_default(),
            width,
            height,
            focused: window.is_focused().unwrap_or(false),
        });
    }
    result.sort_by(|a, b| b.focused.cmp(&a.focused).then_with(|| a.title.cmp(&b.title)));
    Ok(result)
}

#[tauri::command]
fn capture_window_frame(window_id: String, preview_width: Option<u32>) -> Result<CaptureFrame, String> {
    let windows = Window::all().map_err(|error| error.to_string())?;
    let window = windows
        .into_iter()
        .find(|candidate| candidate.id().map(|id| id.to_string() == window_id).unwrap_or(false))
        .ok_or_else(|| "capture_window_not_found".to_string())?;

    if window.is_minimized().unwrap_or(false) {
        return Err("capture_window_minimized".to_string());
    }

    let title = window.title().unwrap_or_default();
    let image = window.capture_image().map_err(|error| error.to_string())?;
    let original_width = image.width();
    let original_height = image.height();
    let dynamic = DynamicImage::ImageRgba8(image);
    let max_width = preview_width.unwrap_or(960).clamp(480, 1600);
    let preview = if original_width > max_width {
        let target_height = ((original_height as f64 * max_width as f64 / original_width as f64).round() as u32).max(1);
        dynamic.thumbnail(max_width, target_height)
    } else {
        dynamic
    };

    let mut png = Vec::new();
    preview
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    let captured_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();

    Ok(CaptureFrame {
        window_id,
        title,
        width: original_width,
        height: original_height,
        captured_at_ms,
        data_url: format!("data:image/png;base64,{}", BASE64_STANDARD.encode(png)),
    })
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
            start_drag,
            list_capture_windows,
            capture_window_frame
        ])
        .run(tauri::generate_context!())
        .expect("error while running TFTGOLDENCHANCHAN overlay");
}
