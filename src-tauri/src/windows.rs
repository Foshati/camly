//! Window choreography: toolbar (bottom centre), overlay (region / countdown),
//! preview card (bottom right) and the library window.

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::recorder;

pub const TOOLBAR_WIDTH: f64 = 880.0;
pub const TOOLBAR_HEIGHT: f64 = 92.0;
const PREVIEW_WIDTH: f64 = 340.0;
const PREVIEW_HEIGHT: f64 = 320.0;

/// Primary display bounds in logical points: (x, y, width, height).
fn primary(app: &AppHandle) -> (f64, f64, f64, f64) {
    match app.primary_monitor() {
        Ok(Some(m)) => {
            let sf = m.scale_factor();
            let pos = m.position().to_logical::<f64>(sf);
            let size = m.size().to_logical::<f64>(sf);
            (pos.x, pos.y, size.width, size.height)
        }
        _ => (0.0, 0.0, 1440.0, 900.0),
    }
}

pub fn hide(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.hide();
    }
}

pub fn toggle_capture(app: &AppHandle) {
    if recorder::is_recording(app) {
        let _ = recorder::send(app, "stop");
    } else if app
        .get_webview_window("toolbar")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
    {
        hide(app, "toolbar");
        hide(app, "overlay");
    } else {
        show_toolbar(app);
    }
}

pub fn show_toolbar(app: &AppHandle) {
    let Some(w) = app.get_webview_window("toolbar") else { return };
    let (x, y, width, height) = primary(app);
    let _ = w.set_size(LogicalSize::new(TOOLBAR_WIDTH, TOOLBAR_HEIGHT));
    let _ = w.set_position(LogicalPosition::new(
        x + (width - TOOLBAR_WIDTH) / 2.0,
        y + height - TOOLBAR_HEIGHT - 72.0,
    ));
    let _ = w.show();
    let _ = w.set_focus();
    let _ = app.emit_to("toolbar", "toolbar://opened", ());
}

pub fn create_overlay(app: &AppHandle) -> tauri::Result<()> {
    let (x, y, width, height) = primary(app);
    WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("index.html".into()))
        .title("Camly Overlay")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .focused(false)
        .accept_first_mouse(true)
        .visible_on_all_workspaces(true)
        .position(x, y)
        .inner_size(width, height)
        .build()?;
    Ok(())
}

fn fit_overlay(app: &AppHandle) {
    if let Some(o) = app.get_webview_window("overlay") {
        let (x, y, width, height) = primary(app);
        let _ = o.set_position(LogicalPosition::new(x, y));
        let _ = o.set_size(LogicalSize::new(width, height));
    }
}

pub fn show_countdown(app: &AppHandle, seconds: u32, rect: Option<Value>) {
    fit_overlay(app);
    let _ = app.emit_to(
        "overlay",
        "overlay://mode",
        json!({ "mode": "countdown", "seconds": seconds, "rect": rect }),
    );
    if let Some(o) = app.get_webview_window("overlay") {
        let _ = o.set_ignore_cursor_events(true);
        let _ = o.show();
    }
}

pub fn show_preview(app: &AppHandle, payload: Value) {
    let Some(w) = app.get_webview_window("preview") else { return };
    let (x, y, width, height) = primary(app);
    let _ = w.set_size(LogicalSize::new(PREVIEW_WIDTH, PREVIEW_HEIGHT));
    let _ = w.set_position(LogicalPosition::new(
        x + width - PREVIEW_WIDTH - 18.0,
        y + height - PREVIEW_HEIGHT - 18.0,
    ));
    let _ = app.emit_to("preview", "preview://show", payload);
    let _ = w.show();
}

pub fn open_library(app: &AppHandle, tab: &str) {
    hide(app, "toolbar");
    hide(app, "overlay");
    if let Some(w) = app.get_webview_window("library") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    let _ = app.emit_to("library", "library://tab", tab);
}

// ---------------------------------------------------------------- commands

/// Region mode: the overlay dims the screen and lets the user draw a rectangle.
/// The toolbar stays on top of it.
#[tauri::command]
pub fn show_region_overlay(app: AppHandle, rect: Option<Value>) {
    fit_overlay(&app);
    let _ = app.emit_to("overlay", "overlay://mode", json!({ "mode": "select", "rect": rect }));
    if let Some(o) = app.get_webview_window("overlay") {
        let _ = o.set_ignore_cursor_events(false);
        let _ = o.show();
    }
    if let Some(t) = app.get_webview_window("toolbar") {
        let _ = t.set_focus();
    }
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle) {
    hide(&app, "overlay");
}

#[tauri::command]
pub fn close_capture_ui(app: AppHandle) {
    hide(&app, "overlay");
    hide(&app, "toolbar");
    if !recorder::is_recording(&app) {
        hide(&app, "bubble");
    }
}

#[tauri::command]
pub fn open_toolbar(app: AppHandle) {
    hide(&app, "library");
    show_toolbar(&app);
}

#[tauri::command]
pub fn show_library(app: AppHandle, tab: String) {
    open_library(&app, &tab);
}

/// Photo Booth–style camera window for photos and webcam videos.
#[tauri::command]
pub fn show_camera(app: AppHandle) {
    hide(&app, "toolbar");
    hide(&app, "overlay");
    hide(&app, "bubble");
    if let Some(w) = app.get_webview_window("camera") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        let _ = app.emit_to("camera", "camera://opened", ());
    }
}

/// Floating face-cam bubble that is included in screen recordings.
/// First show places it bottom-left; afterwards it stays wherever the user dragged it.
#[tauri::command]
pub fn set_bubble(app: AppHandle, visible: bool, size: f64) {
    let Some(w) = app.get_webview_window("bubble") else { return };
    if !visible {
        let _ = w.hide();
        let _ = app.emit_to("bubble", "bubble://state", false);
        return;
    }
    let was_visible = w.is_visible().unwrap_or(false);
    let _ = w.set_size(LogicalSize::new(size, size));
    if !was_visible && !*BUBBLE_PLACED.lock().unwrap() {
        let (x, y, _, height) = primary(&app);
        let _ = w.set_position(LogicalPosition::new(x + 32.0, y + height - size - 120.0));
        *BUBBLE_PLACED.lock().unwrap() = true;
    }
    let _ = w.show();
    let _ = app.emit_to("bubble", "bubble://state", true);
    if let Some(t) = app.get_webview_window("toolbar") {
        if t.is_visible().unwrap_or(false) {
            let _ = t.set_focus();
        }
    }
}

static BUBBLE_PLACED: std::sync::Mutex<bool> = std::sync::Mutex::new(false);
