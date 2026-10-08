mod portable;
mod recorder;
mod shortcut;
mod tray;
mod windows;

use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::ShortcutState;

pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch just brings the running Camly forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows::show_toolbar(app);
        }))
        .plugin(tauri_plugin_dialog::init())
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
            tray::setup(&handle)?;
            windows::create_overlay(&handle)?;
            // The toolbar re-applies the user's saved shortcut when it loads.
            if let Err(e) = shortcut::register(&handle, shortcut::DEFAULT) {
                eprintln!("{e}");
            }
            windows::show_toolbar(&handle);
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
            windows::fit_toolbar,
            windows::hide_window,
            windows::show_camera,
            windows::set_bubble,
            shortcut::set_shortcut,
            shortcut::default_shortcut,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Camly")
        .run(|app, event| {
            // Clicking the Dock icon (shown while Library/Camera is open) with every
            // window hidden brings the capture toolbar back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows: false, .. } = event {
                windows::show_toolbar(app);
            }
            let _ = (app, event);
        });
}
