//! Menu bar item: shows "● 01:23" while recording, like the system stop button.

use std::sync::Mutex;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};

use crate::{recorder, windows};

pub struct TrayState {
    new: MenuItem<Wry>,
    stop: MenuItem<Wry>,
    pause: MenuItem<Wry>,
    paused: Mutex<bool>,
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let new = MenuItem::with_id(app, "new", "New Capture…", true, Some(crate::shortcut::DEFAULT))?;
    let stop = MenuItem::with_id(app, "stop", "Stop Recording", false, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause", false, None::<&str>)?;
    let camera = MenuItem::with_id(app, "camera", "Camera…", true, None::<&str>)?;
    let library = MenuItem::with_id(app, "library", "Library…", true, None::<&str>)?;
    let compress = MenuItem::with_id(app, "compress", "Compress a Video…", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Camly", true, None::<&str>)?;
    let sep_a = PredefinedMenuItem::separator(app)?;
    let sep_b = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[&new, &stop, &pause, &sep_a, &camera, &library, &compress, &settings, &sep_b, &quit],
    )?;

    TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("Camly")
        .menu(&menu)
        .on_menu_event(|app, event| on_menu(app, event.id.as_ref()))
        .build(app)?;

    app.manage(TrayState { new, stop, pause, paused: Mutex::new(false) });
    Ok(())
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "new" => windows::show_toolbar(app),
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
        let _ = state.pause.set_text("Pause");
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
        let _ = state.pause.set_text(if paused { "Resume" } else { "Pause" });
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

