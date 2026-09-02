//! The one global shortcut: opens the capture toolbar, or stops a running recording.
//! Default ⌘⇧2 on macOS, Ctrl+Shift+2 on Windows/Linux; user-configurable.

use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

pub const DEFAULT: &str = if cfg!(target_os = "macos") { "Super+Shift+Digit2" } else { "Control+Shift+Digit2" };

#[derive(Default)]
pub struct ShortcutState(pub Mutex<Option<Shortcut>>);

pub fn register(app: &AppHandle, accelerator: &str) -> Result<String, String> {
    let shortcut: Shortcut = accelerator
        .parse()
        .map_err(|e| format!("Invalid shortcut “{accelerator}”: {e}"))?;
    let gs = app.global_shortcut();
    let state = app.state::<ShortcutState>();
    let mut current = state.0.lock().map_err(|e| e.to_string())?;

    if let Some(old) = current.take() {
        let _ = gs.unregister(old);
    }
    if let Err(e) = gs.register(shortcut) {
        // Keep working with the default rather than ending up with no shortcut at all.
        if accelerator != DEFAULT {
            if let Ok(fallback) = DEFAULT.parse::<Shortcut>() {
                if gs.register(fallback).is_ok() {
                    *current = Some(fallback);
                }
            }
        }
        return Err(format!("“{accelerator}” is already used by another app: {e}"));
    }
    *current = Some(shortcut);
    drop(current);
    crate::tray::set_shortcut_label(app, accelerator);
    Ok(accelerator.to_string())
}

#[tauri::command]
pub fn set_shortcut(app: AppHandle, accelerator: Option<String>) -> Result<String, String> {
    register(&app, accelerator.as_deref().unwrap_or(DEFAULT))
}

#[tauri::command]
pub fn default_shortcut() -> String {
    DEFAULT.to_string()
}
