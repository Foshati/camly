//! Menu bar item: shows "● 01:23" while recording, like the system stop button.
//! The menu offers one-click captures that use the toolbar's saved settings.

use std::sync::Mutex;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::{recorder, windows};

pub struct TrayState {
    new: MenuItem<Wry>,
    stop: MenuItem<Wry>,
    pause: MenuItem<Wry>,
    /// Items that start a capture; disabled while a recording runs.
    starters: Vec<MenuItem<Wry>>,
    paused: Mutex<bool>,
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let item = |id: &str, text: &str, accel: Option<&str>| MenuItem::with_id(app, id, text, true, accel);
    let sep = || PredefinedMenuItem::separator(app);

    let new = item("new", "New Capture…", Some(crate::shortcut::DEFAULT))?;
    let shot_screen = item("shot-screen", "Capture Entire Screen", None)?;
    let shot_region = item("shot-region", "Capture Selected Portion…", None)?;
    let rec_screen = item("rec-screen", "Record Entire Screen", None)?;
    let rec_region = item("rec-region", "Record Selected Portion…", None)?;
    let stop = MenuItem::with_id(app, "stop", "Stop Recording", false, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause Recording", false, None::<&str>)?;
    let camera = item("camera", "Camera…", None)?;

    let library = item("library", "Open Library…", None)?;
    let folder = item("folder", "Show Captures in Finder", None)?;
    let compress = item("compress", "Compress a Video…", None)?;
    let settings = item("settings", "Settings…", Some("CmdOrCtrl+,"))?;
    let about = MenuItem::with_id(
        app,
        "about",
        format!("Camly {}", app.package_info().version),
        false,
        None::<&str>,
    )?;
    let quit = item("quit", "Quit Camly", Some("CmdOrCtrl+Q"))?;

    let screenshot = Submenu::with_items(app, "Screenshot", true, &[&shot_screen, &shot_region])?;
    let record = Submenu::with_items(app, "Record", true, &[&rec_screen, &rec_region])?;

    let menu = Menu::with_items(
        app,
        &[
            &new, &screenshot, &record, &camera, &sep()?,
            &stop, &pause, &sep()?,
            &library, &folder, &compress, &sep()?,
            &settings, &about, &quit,
        ],
    )?;

    TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("Camly")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| on_menu(app, event.id.as_ref()))
        .build(app)?;

    let starters = vec![shot_screen, shot_region, rec_screen, rec_region, camera];
    app.manage(TrayState { new, stop, pause, starters, paused: Mutex::new(false) });
    Ok(())
}

/// Quick captures run in the toolbar page, which owns the user's saved settings.
fn quick(app: &AppHandle, action: &str, mode: &str) {
    let _ = app.emit_to("toolbar", "toolbar://quick", serde_json::json!({ "action": action, "mode": mode }));
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "new" => windows::show_toolbar(app),
        "shot-screen" => quick(app, "screenshot", "display"),
        "shot-region" => quick(app, "screenshot", "region"),
        "rec-screen" => quick(app, "record", "display"),
        "rec-region" => quick(app, "record", "region"),
        "folder" => {
            let _ = app.emit_to("toolbar", "toolbar://reveal-folder", ());
        }
        "stop" => {
            let _ = recorder::send(app, "stop");
        }
        "pause" => {
            let paused = app
                .try_state::<TrayState>()
                .and_then(|s| s.paused.lock().ok().map(|p| *p))
                .unwrap_or(false);
            let _ = recorder::send(app, if paused { "resume" } else { "pause" });
        }
        "camera" => windows::show_camera(app.clone()),
        "library" => windows::open_library(app, "recordings"),
        "compress" => windows::open_library(app, "compress"),
        "settings" => windows::open_library(app, "settings"),
        "quit" => {
            // The helper finalizes its file when our stdin pipe closes, so quitting is safe.
            let _ = recorder::send(app, "stop");
            app.exit(0);
        }
        _ => {}
    }
}

pub fn set_recording(app: &AppHandle, recording: bool) {
    if let Some(state) = app.try_state::<TrayState>() {
        let _ = state.new.set_enabled(!recording);
        let _ = state.stop.set_enabled(recording);
        // Pause needs the native engine (macOS).
        let _ = state.pause.set_enabled(recording && crate::recorder::NATIVE);
        for item in &state.starters {
            let _ = item.set_enabled(!recording);
        }
        let _ = state.pause.set_text("Pause Recording");
        if let Ok(mut p) = state.paused.lock() {
            *p = false;
        }
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_title(if recording { Some("● 00:00") } else { None });
        let _ = tray.set_tooltip(Some(if recording { "Camly — recording" } else { "Camly" }));
    }
}

pub fn set_paused(app: &AppHandle, paused: bool) {
    if let Some(state) = app.try_state::<TrayState>() {
        let _ = state.pause.set_text(if paused { "Resume Recording" } else { "Pause Recording" });
        if let Ok(mut p) = state.paused.lock() {
            *p = paused;
        }
    }
}

pub fn set_elapsed(app: &AppHandle, seconds: f64, paused: bool) {
    let total = seconds.max(0.0) as u64;
    let clock = if total >= 3600 {
        format!("{}:{:02}:{:02}", total / 3600, (total % 3600) / 60, total % 60)
    } else {
        format!("{:02}:{:02}", total / 60, total % 60)
    };
    let mark = if paused { "❚❚" } else { "●" };
    if let Some(tray) = app.tray_by_id("main") {
        // Title shows in the macOS menu bar; Windows/Linux trays only have a tooltip.
        let _ = tray.set_title(Some(format!("{mark} {clock}")));
        let _ = tray.set_tooltip(Some(format!("Camly — recording {clock}")));
    }
}

pub fn set_shortcut_label(app: &AppHandle, accelerator: &str) {
    if let Some(state) = app.try_state::<TrayState>() {
        let _ = state.new.set_accelerator(Some(accelerator));
    }
}
