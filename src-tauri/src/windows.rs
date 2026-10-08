//! Window choreography: toolbar (bottom centre), overlay (region / countdown),
//! preview card (bottom right) and the library window.

use serde_json::{json, Value};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

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

/// Bounds of the monitor a window sits on (falls back to the primary display).
fn monitor_of(app: &AppHandle, w: &WebviewWindow) -> (f64, f64, f64, f64) {
    match w.current_monitor() {
        Ok(Some(m)) => {
            let sf = m.scale_factor();
            let pos = m.position().to_logical::<f64>(sf);
            let size = m.size().to_logical::<f64>(sf);
            (pos.x, pos.y, size.width, size.height)
        }
        _ => primary(app),
    }
}

/// Library and Camera are regular windows. While one of them is open Camly behaves like a
/// normal app (Dock icon, ⌘-Tab) so macOS reliably brings it to the front; otherwise it
/// lives only in the menu bar.
const APP_WINDOWS: [&str; 2] = ["library", "camera"];

fn any_app_window_visible(app: &AppHandle) -> bool {
    APP_WINDOWS.iter().any(|l| {
        app.get_webview_window(l)
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false)
    })
}

/// Back to menu-bar-only once no regular window is showing.
pub fn sync_activation_policy(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let policy = if any_app_window_visible(app) {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        };
        let _ = app.set_activation_policy(policy);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Shows a regular window on the current Space and makes it key, even when Camly is
/// not the active app.
fn present(app: &AppHandle, label: &str) -> bool {
    let Some(w) = app.get_webview_window(label) else { return false };
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        // Joining all Spaces for a moment pulls the window onto the Space the user is on,
        // instead of macOS jumping to wherever it was last shown.
        let _ = w.set_visible_on_all_workspaces(true);
    }
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
    #[cfg(target_os = "macos")]
    let _ = w.set_visible_on_all_workspaces(false);
    true
}

pub fn hide(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.hide();
    }
    if APP_WINDOWS.contains(&label) {
        sync_activation_policy(app);
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
    // Tell the page first so it drops any open panel before the window appears.
    let _ = app.emit_to("toolbar", "toolbar://opened", ());
    let _ = w.set_size(LogicalSize::new(TOOLBAR_WIDTH, TOOLBAR_HEIGHT));
    let _ = w.set_position(LogicalPosition::new(
        x + (width - TOOLBAR_WIDTH) / 2.0,
        y + height - TOOLBAR_HEIGHT - 72.0,
    ));
    let _ = w.show();
    let _ = w.set_focus();
}

/// Resizes the toolbar to fit its content, growing upwards so the bar never moves.
/// Runs on the main thread, so overlapping requests can't interleave and drift the
/// window off screen. Returns the height actually applied (clamped to the screen).
#[tauri::command]
pub fn fit_toolbar(app: AppHandle, height: f64) -> f64 {
    let Some(w) = app.get_webview_window("toolbar") else { return height };
    let (Ok(sf), Ok(pos), Ok(size)) = (w.scale_factor(), w.outer_position(), w.inner_size()) else {
        return height;
    };
    let pos = pos.to_logical::<f64>(sf);
    let size = size.to_logical::<f64>(sf);
    let (_, my, _, mh) = monitor_of(&app, &w);
    let bottom = pos.y + size.height;
    // Leave room for the menu bar above the panel.
    let max = (bottom - my - 40.0).max(TOOLBAR_HEIGHT).min(mh);
    let next = height.clamp(TOOLBAR_HEIGHT, max).round();
    if (next - size.height).abs() >= 1.0 {
        let _ = w.set_position(LogicalPosition::new(pos.x, bottom - next));
        let _ = w.set_size(LogicalSize::new(TOOLBAR_WIDTH, next));
    }
    next
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
    let _ = app.emit_to("library", "library://tab", tab);
    // Show the library before hiding the toolbar: hiding the key window first lets macOS
    // deactivate Camly, and the library then opens behind other apps (or not at all).
    if present(app, "library") {
        hide(app, "toolbar");
        hide(app, "overlay");
    }
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
    show_toolbar(&app);
    hide(&app, "library");
    if let Some(t) = app.get_webview_window("toolbar") {
        let _ = t.set_focus();
    }
}

/// Hides a window from the page side and keeps the Dock icon in sync.
#[tauri::command]
pub fn hide_window(app: AppHandle, label: String) {
    hide(&app, &label);
}

#[tauri::command]
pub fn show_library(app: AppHandle, tab: String) {
    open_library(&app, &tab);
}

/// Photo Booth–style camera window for photos and webcam videos.
#[tauri::command]
pub fn show_camera(app: AppHandle) {
    if present(&app, "camera") {
        let _ = app.emit_to("camera", "camera://opened", ());
        hide(&app, "toolbar");
        hide(&app, "overlay");
        hide(&app, "bubble");
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
