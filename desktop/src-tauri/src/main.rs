use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use image::{DynamicImage, ImageFormat, RgbaImage};
use paddleocr_rs_onnx::{OcrBlock, OcrEngine, OrderBy};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{self, Cursor, Read},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, Size, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, ShortcutState};
use xcap::Window;

const OCR_DET_URL: &str = "https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/main/inference.onnx?download=true";
const OCR_REC_URL: &str = "https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec_onnx/resolve/main/inference.onnx?download=true";
const OCR_KEYS_URL: &str = "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/a38c087bcb2579f9ccc2068aea02ec893b1c2311/ppocr/utils/dict/ppocrv5_dict.txt";
const OCR_DET_SHA256: &str = "a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d";
const OCR_REC_SHA256: &str = "da72dc72ca4dc220df0dfde68c1dedc31c58d3e76a25871122e5056227d50092";

static OCR_ENGINE: OnceLock<Mutex<Option<Arc<OcrEngine>>>> = OnceLock::new();

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

#[derive(Serialize)]
struct OcrModelStatus {
    ready: bool,
    model_dir: String,
    detection_ready: bool,
    recognition_ready: bool,
    dictionary_ready: bool,
    detection_bytes: u64,
    recognition_bytes: u64,
    dictionary_bytes: u64,
}

#[derive(Serialize)]
struct OcrFrame {
    window_id: String,
    title: String,
    source_width: u32,
    source_height: u32,
    width: u32,
    height: u32,
    captured_at_ms: u128,
    elapsed_ms: u128,
    blocks: Vec<OcrBlock>,
}

struct OcrPaths {
    dir: PathBuf,
    det: PathBuf,
    rec: PathBuf,
    keys: PathBuf,
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

fn now_ms() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())
        .map(|duration| duration.as_millis())
}

fn find_capture_window(window_id: &str) -> Result<Window, String> {
    Window::all()
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|candidate| candidate.id().map(|id| id.to_string() == window_id).unwrap_or(false))
        .ok_or_else(|| "capture_window_not_found".to_string())
}

fn capture_dynamic_image(window_id: &str, max_width: u32) -> Result<(String, u32, u32, DynamicImage), String> {
    let window = find_capture_window(window_id)?;
    if window.is_minimized().unwrap_or(false) {
        return Err("capture_window_minimized".to_string());
    }

    let title = window.title().unwrap_or_default();
    let captured = window.capture_image().map_err(|error| error.to_string())?;
    let original_width = captured.width();
    let original_height = captured.height();
    let raw = captured.into_raw();
    let rgba = RgbaImage::from_raw(original_width, original_height, raw)
        .ok_or_else(|| "capture_image_invalid_rgba".to_string())?;
    let dynamic = DynamicImage::ImageRgba8(rgba);
    let bounded_width = max_width.clamp(480, 1920);
    let resized = if original_width > bounded_width {
        let target_height = ((original_height as f64 * bounded_width as f64 / original_width as f64).round() as u32).max(1);
        dynamic.thumbnail(bounded_width, target_height)
    } else {
        dynamic
    };

    Ok((title, original_width, original_height, resized))
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
    let (title, original_width, original_height, preview) =
        capture_dynamic_image(&window_id, preview_width.unwrap_or(960))?;

    let mut png = Vec::new();
    preview
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|error| error.to_string())?;

    Ok(CaptureFrame {
        window_id,
        title,
        width: original_width,
        height: original_height,
        captured_at_ms: now_ms()?,
        data_url: format!("data:image/png;base64,{}", BASE64_STANDARD.encode(png)),
    })
}

fn ocr_paths(app: &AppHandle) -> Result<OcrPaths, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("ocr")
        .join("ppocrv5-mobile");
    Ok(OcrPaths {
        det: dir.join("PP-OCRv5_mobile_det.onnx"),
        rec: dir.join("PP-OCRv5_mobile_rec.onnx"),
        keys: dir.join("ppocrv5_dict.txt"),
        dir,
    })
}

fn file_size(path: &Path) -> u64 {
    fs::metadata(path).map(|metadata| metadata.len()).unwrap_or(0)
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn is_verified(path: &Path, expected_sha256: &str) -> bool {
    path.is_file()
        && file_sha256(path)
            .map(|actual| actual.eq_ignore_ascii_case(expected_sha256))
            .unwrap_or(false)
}

fn download_file(url: &str, path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temp = path.with_extension("download");
    let client = reqwest::blocking::Client::builder()
        .user_agent("TFTGOLDENCHANCHAN/0.6.1")
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(240))
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client
        .get(url)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| error.to_string())?;
    let mut file = File::create(&temp).map_err(|error| error.to_string())?;
    io::copy(&mut response, &mut file).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    fs::rename(&temp, path).map_err(|error| error.to_string())?;
    Ok(())
}

fn ensure_verified_model(url: &str, path: &Path, expected_sha256: &str) -> Result<(), String> {
    if is_verified(path, expected_sha256) {
        return Ok(());
    }
    let _ = fs::remove_file(path);
    download_file(url, path)?;
    if !is_verified(path, expected_sha256) {
        let _ = fs::remove_file(path);
        return Err(format!("ocr_model_sha256_mismatch:{}", path.display()));
    }
    Ok(())
}

fn ensure_dictionary(path: &Path) -> Result<(), String> {
    if file_size(path) > 10_000 {
        return Ok(());
    }
    let _ = fs::remove_file(path);
    download_file(OCR_KEYS_URL, path)?;
    if file_size(path) <= 10_000 {
        let _ = fs::remove_file(path);
        return Err("ocr_dictionary_invalid".to_string());
    }
    Ok(())
}

fn model_status(app: &AppHandle) -> Result<OcrModelStatus, String> {
    let paths = ocr_paths(app)?;
    let detection_ready = is_verified(&paths.det, OCR_DET_SHA256);
    let recognition_ready = is_verified(&paths.rec, OCR_REC_SHA256);
    let dictionary_ready = file_size(&paths.keys) > 10_000;
    Ok(OcrModelStatus {
        ready: detection_ready && recognition_ready && dictionary_ready,
        model_dir: paths.dir.to_string_lossy().to_string(),
        detection_ready,
        recognition_ready,
        dictionary_ready,
        detection_bytes: file_size(&paths.det),
        recognition_bytes: file_size(&paths.rec),
        dictionary_bytes: file_size(&paths.keys),
    })
}

fn prepare_ocr_models_blocking(app: &AppHandle) -> Result<OcrModelStatus, String> {
    let paths = ocr_paths(app)?;
    fs::create_dir_all(&paths.dir).map_err(|error| error.to_string())?;
    ensure_verified_model(OCR_DET_URL, &paths.det, OCR_DET_SHA256)?;
    ensure_verified_model(OCR_REC_URL, &paths.rec, OCR_REC_SHA256)?;
    ensure_dictionary(&paths.keys)?;
    model_status(app)
}

#[tauri::command]
fn ocr_model_status(app: AppHandle) -> Result<OcrModelStatus, String> {
    model_status(&app)
}

#[tauri::command]
async fn prepare_ocr_models(app: AppHandle) -> Result<OcrModelStatus, String> {
    tauri::async_runtime::spawn_blocking(move || prepare_ocr_models_blocking(&app))
        .await
        .map_err(|error| error.to_string())?
}

fn load_ocr_engine(app: &AppHandle) -> Result<Arc<OcrEngine>, String> {
    let cache = OCR_ENGINE.get_or_init(|| Mutex::new(None));
    let mut guard = cache.lock().map_err(|_| "ocr_engine_lock_poisoned".to_string())?;
    if let Some(engine) = guard.as_ref() {
        return Ok(Arc::clone(engine));
    }

    let status = prepare_ocr_models_blocking(app)?;
    if !status.ready {
        return Err("ocr_models_not_ready".to_string());
    }
    let paths = ocr_paths(app)?;
    let det = fs::read(&paths.det).map_err(|error| error.to_string())?;
    let rec = fs::read(&paths.rec).map_err(|error| error.to_string())?;
    let keys = fs::read(&paths.keys).map_err(|error| error.to_string())?;
    let engine = Arc::new(OcrEngine::new(&det, &rec, &keys).map_err(|error| error.to_string())?);
    *guard = Some(Arc::clone(&engine));
    Ok(engine)
}

fn ocr_window_frame_blocking(app: &AppHandle, window_id: String, max_width: u32) -> Result<OcrFrame, String> {
    let started = Instant::now();
    let (title, source_width, source_height, image) = capture_dynamic_image(&window_id, max_width)?;
    let captured_at_ms = now_ms()?;
    let width = image.width();
    let height = image.height();
    let engine = load_ocr_engine(app)?;
    let blocks = engine
        .recognize_all(&image, OrderBy::Horizontal)
        .map_err(|error| error.to_string())?;

    Ok(OcrFrame {
        window_id,
        title,
        source_width,
        source_height,
        width,
        height,
        captured_at_ms,
        elapsed_ms: started.elapsed().as_millis(),
        blocks,
    })
}

#[tauri::command]
async fn ocr_window_frame(app: AppHandle, window_id: String, max_width: Option<u32>) -> Result<OcrFrame, String> {
    let width = max_width.unwrap_or(1280).clamp(720, 1600);
    tauri::async_runtime::spawn_blocking(move || ocr_window_frame_blocking(&app, window_id, width))
        .await
        .map_err(|error| error.to_string())?
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let click_through = Arc::new(AtomicBool::new(false));
            let click_through_handler = Arc::clone(&click_through);

            // Install the global-shortcut plugin first, without mandatory startup
            // registrations. A conflicting system/application hotkey must not prevent
            // the overlay window from starting.
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
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

            // Best-effort registration: if another app owns one shortcut, keep the
            // overlay running and leave only that shortcut unavailable.
            for shortcut in ["alt+q", "alt+w", "alt+e"] {
                if let Err(error) = app.global_shortcut().register(shortcut) {
                    eprintln!("TFTGOLDENCHANCHAN: global shortcut {shortcut} unavailable: {error}");
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hide_overlay,
            set_click_through,
            set_overlay_size,
            start_drag,
            list_capture_windows,
            capture_window_frame,
            ocr_model_status,
            prepare_ocr_models,
            ocr_window_frame
        ])
        .run(tauri::generate_context!())
        .expect("error while running TFTGOLDENCHANCHAN overlay");
}
