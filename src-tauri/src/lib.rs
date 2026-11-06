mod portable;
mod recorder;
mod shortcut;
mod tray;
mod windows;

use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::ShortcutState;

/// Panics are logged instead of silently killing Camly; release builds unwind, so a panic
/// in a helper thread never takes the whole app down.
fn install_panic_log() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let line = format!("{} Camly panic: {info}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
        eprint!("{line}");
        // Best effort: the disk may be full, which is exactly when this matters least.
        if let Some(dir) = dirs::home_dir().map(|h| h.join("Library/Logs/Camly")) {
            if std::fs::create_dir_all(&dir).is_ok() {
                use std::io::Write;
                if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("camly.log")) {
                    let _ = f.write_all(line.as_bytes());
                }
            }
        }
        default(info);
    }));
}

pub fn run() {
    install_panic_log();
    let app = tauri::Builder::default()
        // Must be first: launching Camly again brings the running one forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows::open_library(app, "recordings");
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                // Only one shortcut is ever registered: open the toolbar / stop recording.
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        windows::toggle_capture(app);
                    }
                })
                .build(),
        )
        .manage(recorder::RecorderState::default())
        .manage(shortcut::ShortcutState::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            // Nothing here may stop Camly from opening: each part fails on its own (a full
            // disk, a busy menu bar, a taken shortcut) and the app still comes up.
            if let Err(e) = tray::setup(&handle) {
                eprintln!("Menu bar item unavailable: {e}");
            }
            if let Err(e) = windows::create_overlay(&handle) {
                eprintln!("Region overlay unavailable: {e}");
            }
            // The toolbar re-applies the user's saved shortcut when it loads.
            if let Err(e) = shortcut::register(&handle, shortcut::DEFAULT) {
                eprintln!("{e}");
            }
            // Opening Camly shows Camly: the Library window (or first-run setup), with a
            // Dock icon. Captures start from there, the menu bar or the shortcut.
            windows::open_library(&handle, "recordings");
            Ok(())
        })
        .on_window_event(|window, event| {
            // Windows are reused; closing just hides them.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit_to(window.label(), "window://hidden", ());
                windows::hide(window.app_handle(), window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            recorder::begin_recording,
            recorder::stop_recording,
            recorder::pause_recording,
            recorder::resume_recording,
            recorder::recorder_status,
            recorder::list_sources,
            recorder::compress_video,
            recorder::list_recordings,
            recorder::default_save_dir,
            recorder::trash_file,
            recorder::reveal_in_finder,
            recorder::open_path,
            recorder::open_privacy_settings,
            recorder::begin_screenshot,
            recorder::camera_paths,
            recorder::write_chunk,
            recorder::finalize_media,
            recorder::discard_temp,
            recorder::file_size,
            recorder::show_media_preview,
            recorder::permissions,
            recorder::quit_app,
            windows::show_region_overlay,
            windows::hide_overlay,
            windows::close_capture_ui,
            windows::open_toolbar,
            windows::show_library,
            tray::set_update_available,
            windows::fit_toolbar,
            windows::hide_window,
            windows::show_camera,
            windows::set_bubble,
            shortcut::set_shortcut,
            shortcut::default_shortcut,
        ])
        .build(tauri::generate_context!());

    let app = match app {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Camly could not start: {e}");
            std::process::exit(1);
        }
    };
    app.run(|app, event| {
        // Clicking the Dock or Finder icon with every window hidden opens the Library.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { has_visible_windows: false, .. } = event {
            windows::open_library(app, "recordings");
        }
        let _ = (app, event);
    });
}
