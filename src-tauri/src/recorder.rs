//! Capture engines behind one interface:
//! - macOS: the native `camly-capture` sidecar (ScreenCaptureKit + VideoToolbox), JSON over stdout.
//! - Windows/Linux: `portable` (FFmpeg + xcap), emitting the same JSON events.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::{portable, tray, windows};

/// ScreenCaptureKit engine on macOS, portable FFmpeg engine elsewhere.
pub const NATIVE: bool = cfg!(target_os = "macos");

#[derive(Default)]
pub struct RecorderState {
    running: Mutex<Option<Running>>,
}

struct Running {
    child: Child,
    stdin: ChildStdin,
    native: bool,
}

fn sidecar() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let path = exe
        .parent()
        .ok_or("cannot locate app directory")?
        .join("camly-capture");
    if path.exists() {
        Ok(path)
    } else {
        Err(format!(
            "Recorder helper missing at {} — run `pnpm recorder`.",
            path.display()
        ))
    }
}

pub fn is_recording(app: &AppHandle) -> bool {
    app.state::<RecorderState>()
        .running
        .lock()
        .map(|r| r.is_some())
        .unwrap_or(false)
}

/// Sends `stop`, `pause` or `resume` to the running recorder.
pub fn send(app: &AppHandle, command: &str) -> Result<(), String> {
    let state = app.state::<RecorderState>();
    let mut guard = state.running.lock().map_err(|e| e.to_string())?;
    let running = guard.as_mut().ok_or("Not recording")?;
    if running.native {
        writeln!(running.stdin, "{command}").map_err(|e| e.to_string())?;
    } else {
        match command {
            // "q" makes ffmpeg finish the file and exit cleanly.
            "stop" => write!(running.stdin, "q").map_err(|e| e.to_string())?,
            _ => return Err("Pause isn't available on this platform yet.".into()),
        }
    }
    running.stdin.flush().map_err(|e| e.to_string())
}

/// "<prefix> 2026-10-07 at 14.30.12.<ext>", never overwriting an existing file.
fn media_path(save_dir: &str, prefix: &str, ext: &str) -> Result<PathBuf, String> {
    let dir = PathBuf::from(save_dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create {save_dir}: {e}"))?;
    let stamp = chrono::Local::now().format("%Y-%m-%d at %H.%M.%S");
    let mut path = dir.join(format!("{prefix} {stamp}.{ext}"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{prefix} {stamp} ({n}).{ext}"));
        n += 1;
    }
    Ok(path)
}

fn output_path(save_dir: &str, container: &str) -> Result<PathBuf, String> {
    media_path(save_dir, "Camly", if container == "mov" { "mov" } else { "mp4" })
}

fn start(app: &AppHandle, mut options: Value, save_dir: &str, container: &str) -> Result<String, String> {
    let state = app.state::<RecorderState>();
    let mut guard = state.running.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Err("Already recording".into());
    }

    let path = output_path(save_dir, container)?;
    let path_str = path.to_string_lossy().to_string();
    options["output"] = json!(path_str);
    options["excludePid"] = json!(std::process::id());

    if !NATIVE {
        let handle = app.clone();
        // `guard` stays locked until the state is stored, so `finished` can't race ahead of us.
        let mut child = portable::start_recording(&options, &path, move |event| {
            if event["event"] == "__stop" {
                let _ = send(&handle, "stop");
                return;
            }
            on_event(&handle, &event);
            let terminal = matches!(event["event"].as_str(), Some("stopped") | Some("error"));
            let _ = handle.emit("recorder", event);
            if terminal {
                finished(&handle);
            }
        })?;
        let stdin = child.stdin.take().ok_or("ffmpeg stdin unavailable")?;
        *guard = Some(Running { child, stdin, native: false });
        drop(guard);
        tray::set_recording(app, true);
        return Ok(path_str);
    }

    let mut child = Command::new(sidecar()?)
        .arg("record")
        .arg(options.to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Cannot start recorder: {e}"))?;

    let stdin = child.stdin.take().ok_or("recorder stdin unavailable")?;
    let stdout = child.stdout.take().ok_or("recorder stdout unavailable")?;
    let stderr = child.stderr.take();
    *guard = Some(Running { child, stdin, native: true });
    drop(guard);

    tray::set_recording(app, true);

    let handle = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(event) = serde_json::from_str::<Value>(&line) else { continue };
            on_event(&handle, &event);
            let _ = handle.emit("recorder", event);
        }
        finished(&handle);
    });

    if let Some(stderr) = stderr {
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                eprintln!("[recorder] {line}");
            }
        });
    }

    Ok(path_str)
}

fn on_event(app: &AppHandle, event: &Value) {
    match event["event"].as_str() {
        Some("progress") => {
            let secs = event["seconds"].as_f64().unwrap_or(0.0);
            let paused = event["paused"].as_bool().unwrap_or(false);
            tray::set_elapsed(app, secs, paused);
        }
        Some("paused") => tray::set_paused(app, true),
        Some("resumed") => tray::set_paused(app, false),
        Some("stopped") => windows::show_preview(app, event.clone()),
        Some("error") => windows::show_preview(app, event.clone()),

        _ => {}
    }
}

fn finished(app: &AppHandle) {
    let state = app.state::<RecorderState>();
    let taken = state.running.lock().ok().and_then(|mut r| r.take());
    if let Some(mut running) = taken {
        let _ = running.child.wait();
    }
    tray::set_recording(app, false);
    windows::hide(app, "bubble");
    let _ = app.emit("recorder", json!({ "event": "idle" }));
}

// ---------------------------------------------------------------- commands

/// Hides the toolbar, runs the optional countdown on the overlay, then starts capturing.
#[tauri::command]
pub fn begin_recording(
    app: AppHandle,
    options: Value,
    save_dir: String,
    container: String,
    countdown: u32,
) -> Result<(), String> {
    if is_recording(&app) {
        return Err("Already recording".into());
    }
    windows::hide(&app, "toolbar");

    thread::spawn(move || {
        if countdown > 0 {
            windows::show_countdown(&app, countdown, options.get("rect").cloned());
            thread::sleep(Duration::from_secs(countdown as u64));
        }
        windows::hide(&app, "overlay");
        // Give the window server a beat so our UI is gone before the first frame.
        thread::sleep(Duration::from_millis(180));
        if let Err(message) = start(&app, options, &save_dir, &container) {
            let event = json!({ "event": "error", "message": message });
            windows::show_preview(&app, event.clone());
            let _ = app.emit("recorder", event);
        }
    });
    Ok(())
}

#[tauri::command]
pub fn stop_recording(app: AppHandle) -> Result<(), String> {
    send(&app, "stop")
}

#[tauri::command]
pub fn pause_recording(app: AppHandle) -> Result<(), String> {
    send(&app, "pause")
}

#[tauri::command]
pub fn resume_recording(app: AppHandle) -> Result<(), String> {
    send(&app, "resume")
}

#[tauri::command]
pub fn recorder_status(app: AppHandle) -> bool {
    is_recording(&app)
}

#[tauri::command]
pub async fn list_sources(save_dir: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        if !NATIVE {
            return Ok(portable::list_sources(&save_dir));
        }
        let args = json!({ "excludePid": std::process::id(), "path": save_dir });
        let output = Command::new(sidecar()?)
            .arg("list")
            .arg(args.to_string())
            .output()
            .map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let line = stdout
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .ok_or("Recorder returned nothing")?;
        serde_json::from_str::<Value>(line).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Re-encodes a video next to the original as "<name> (compact).mp4".
/// Progress arrives as `compress` events carrying the same `id`.
#[tauri::command]
pub fn compress_video(
    app: AppHandle,
    id: String,
    input: String,
    options: Value,
    output: Option<String>,
) -> Result<String, String> {
    let src = PathBuf::from(&input);
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "video".into());
    let dir = src.parent().map(Path::to_path_buf).unwrap_or_default();
    let output = match output {
        Some(explicit) => PathBuf::from(explicit),
        None => {
            let mut candidate = dir.join(format!("{stem} (compact).mp4"));
            let mut n = 2;
            while candidate.exists() {
                candidate = dir.join(format!("{stem} (compact {n}).mp4"));
                n += 1;
            }
            candidate
        }
    };

    if !NATIVE {
        let tag = id.clone();
        let handle = app.clone();
        let mut child = portable::compress(&input, &output, &options, move |mut event| {
            event["id"] = json!(tag);
            let _ = handle.emit("compress", event);
        })?;
        thread::spawn(move || {
            let _ = child.wait();
        });
        return Ok(output.to_string_lossy().to_string());
    }

    let mut options = options;
    options["input"] = json!(input);
    options["output"] = json!(output.to_string_lossy());

    let mut child = Command::new(sidecar()?)
        .arg("compress")
        .arg(options.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("compressor stdout unavailable")?;

    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(mut event) = serde_json::from_str::<Value>(&line) {
                event["id"] = json!(id);
                let _ = app.emit("compress", event);
            }
        }
        let _ = child.wait();
    });

    Ok(output.to_string_lossy().to_string())
}

// ---------------------------------------------------------------- files

#[derive(Serialize)]
pub struct Recording {
    path: String,
    name: String,
    bytes: u64,
    modified: u64,
}

#[tauri::command]
pub fn list_recordings(dir: String) -> Vec<Recording> {
    let Ok(entries) = std::fs::read_dir(&dir) else { return vec![] };
    let mut items: Vec<Recording> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let ext = path.extension()?.to_string_lossy().to_lowercase();
            if !matches!(ext.as_str(), "mp4" | "mov" | "m4v" | "png" | "jpg" | "jpeg" | "heic") {
                return None;
            }
            if path.file_name()?.to_string_lossy().starts_with('.') {
                return None;
            }
            let meta = entry.metadata().ok()?;
            let modified = meta
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_millis() as u64;
            Some(Recording {
                name: path.file_name()?.to_string_lossy().to_string(),
                path: path.to_string_lossy().to_string(),
                bytes: meta.len(),
                modified,
            })
        })
        .collect();
    items.sort_by(|a, b| b.modified.cmp(&a.modified));
    items
}

#[tauri::command]
pub fn default_save_dir() -> String {
    dirs::video_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Movies")))
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("Camly")
        .to_string_lossy()
        .to_string()
}

/// Moves a file to the Trash (recoverable), never a hard delete.
#[tauri::command]
pub fn trash_file(path: String) -> Result<(), String> {
    if !NATIVE {
        return trash::delete(&path).map_err(|e| format!("Could not move to the Recycle Bin: {e}"));
    }
    let src = PathBuf::from(&path);
    let trash = dirs::home_dir().ok_or("no home directory")?.join(".Trash");
    let name = src.file_name().ok_or("bad path")?.to_string_lossy().to_string();
    let mut dest = trash.join(&name);
    let mut n = 2;
    while dest.exists() {
        dest = trash.join(format!("{n} {name}"));
        n += 1;
    }
    std::fs::rename(&src, &dest).map_err(|e| format!("Could not move to Trash: {e}"))
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    let result = if cfg!(target_os = "macos") {
        Command::new("open").arg("-R").arg(&path).spawn()
    } else if cfg!(windows) {
        Command::new("explorer").arg(format!("/select,{path}")).spawn()
    } else {
        let dir = Path::new(&path).parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from(&path));
        Command::new("xdg-open").arg(dir).spawn()
    };
    result.map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(windows) {
        "explorer"
    } else {
        "xdg-open"
    };
    Command::new(opener).arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_privacy_settings(kind: String) -> Result<(), String> {
    if cfg!(windows) {
        let page = match kind.as_str() {
            "microphone" => "ms-settings:privacy-microphone",
            "camera" => "ms-settings:privacy-webcam",
            _ => "ms-settings:privacy",
        };
        return Command::new("explorer").arg(page).spawn().map(|_| ()).map_err(|e| e.to_string());
    }
    if !cfg!(target_os = "macos") {
        return Ok(());
    }
    let pane = match kind.as_str() {
        "microphone" => "Privacy_Microphone",
        "camera" => "Privacy_Camera",
        _ => "Privacy_ScreenCapture",
    };
    Command::new("open")
        .arg(format!("x-apple.systempreferences:com.apple.preference.security?{pane}"))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- permissions & quit

/// Status of Screen Recording / Microphone / Camera access, optionally requesting one first.
#[tauri::command]
pub async fn permissions(request: Option<String>) -> Result<Value, String> {
    if !NATIVE {
        return Ok(json!({ "event": "permissions", "screen": "granted", "microphone": "granted", "camera": "granted" }));
    }
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let out = Command::new(sidecar()?)
            .arg("permissions")
            .arg(json!({ "request": request }).to_string())
            .output()
            .map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&out.stdout);
        let line = stdout.lines().rev().find(|l| !l.trim().is_empty()).ok_or("no answer")?;
        serde_json::from_str::<Value>(line).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Quits Camly completely (tray, shortcut, helpers). A running recording is finalized first.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    if is_recording(&app) {
        let _ = send(&app, "stop");
        let handle = app.clone();
        thread::spawn(move || {
            for _ in 0..50 {
                if !is_recording(&handle) {
                    break;
                }
                thread::sleep(Duration::from_millis(100));
            }
            handle.exit(0);
        });
    } else {
        app.exit(0);
    }
}

// ---------------------------------------------------------------- screenshots

/// Like ⌘⇧3/⌘⇧4: hides our UI, optional countdown, then a full-resolution still.
#[tauri::command]
pub fn begin_screenshot(
    app: AppHandle,
    options: Value,
    save_dir: String,
    format: String,
    countdown: u32,
) -> Result<(), String> {
    windows::hide(&app, "toolbar");
    windows::hide(&app, "bubble");

    thread::spawn(move || {
        if countdown > 0 {
            windows::show_countdown(&app, countdown, options.get("rect").cloned());
            thread::sleep(Duration::from_secs(countdown as u64));
        }
        windows::hide(&app, "overlay");
        thread::sleep(Duration::from_millis(220));

        let result = (|| -> Result<Value, String> {
            let ext = match format.as_str() {
                "jpg" => "jpg",
                "heic" => "heic",
                _ => "png",
            };
            if !NATIVE {
                let ext = if ext == "heic" { "png" } else { ext };
                let path = media_path(&save_dir, "Camly Screenshot", ext)?;
                return portable::screenshot(&options, &path, ext);
            }
            let path = media_path(&save_dir, "Camly Screenshot", ext)?;
            let mut opts = options.clone();
            opts["output"] = json!(path.to_string_lossy());
            opts["format"] = json!(ext);
            opts["excludePid"] = json!(std::process::id());
            let out = Command::new(sidecar()?)
                .arg("screenshot")
                .arg(opts.to_string())
                .output()
                .map_err(|e| e.to_string())?;
            let stdout = String::from_utf8_lossy(&out.stdout);
            let line = stdout.lines().rev().find(|l| !l.trim().is_empty()).ok_or("No screenshot was taken")?;
            serde_json::from_str::<Value>(line).map_err(|e| e.to_string())
        })();

        let event = result.unwrap_or_else(|message| json!({ "event": "error", "message": message }));
        windows::show_preview(&app, event.clone());
        let _ = app.emit("capture", event);
    });
    Ok(())
}

// ---------------------------------------------------------------- camera

#[derive(Serialize)]
pub struct CameraPaths {
    temp: String,
    target: String,
}

/// Camera video is streamed to a hidden temp file, then finalized (optionally re-encoded to HEVC).
#[tauri::command]
pub fn camera_paths(save_dir: String, kind: String, ext: String) -> Result<CameraPaths, String> {
    let prefix = if kind == "photo" { "Camly Photo" } else { "Camly Camera" };
    let target = media_path(&save_dir, prefix, &ext)?;
    let stem = target.file_stem().ok_or("bad path")?.to_string_lossy().to_string();
    // Keep the real extension last so AVFoundation can still open the temp file.
    let temp = target.with_file_name(format!(".{stem}.part.{ext}"));
    Ok(CameraPaths {
        temp: temp.to_string_lossy().to_string(),
        target: target.to_string_lossy().to_string(),
    })
}

/// Raw-body write: header `x-path` (URI-encoded), `x-append: 1` to append.
#[tauri::command]
pub fn write_chunk(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(decode_uri)
    };
    let path = header("x-path").ok_or("missing x-path")?;
    if !is_camly_media(&path) {
        return Err("refusing to write outside Camly media files".into());
    }
    let append = header("x-append").as_deref() == Some("1");
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn finalize_media(temp: String, target: String) -> Result<String, String> {
    if !is_camly_media(&temp) || !is_camly_media(&target) {
        return Err("not a Camly file".into());
    }
    std::fs::rename(&temp, &target).map_err(|e| e.to_string())?;
    Ok(target)
}

/// Deletes only our own hidden `.part.<ext>` temp files.
#[tauri::command]
pub fn discard_temp(path: String) -> Result<(), String> {
    let name = Path::new(&path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if name.starts_with(".Camly ") && name.contains(".part.") {
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}

#[tauri::command]
pub fn file_size(path: String) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

#[tauri::command]
pub fn show_media_preview(app: AppHandle, payload: Value) {
    windows::show_preview(&app, payload.clone());
    let _ = app.emit("capture", payload);
}

fn is_camly_media(path: &str) -> bool {
    Path::new(path)
        .file_name()
        .map(|n| {
            let n = n.to_string_lossy();
            n.starts_with("Camly ") || n.starts_with(".Camly ")
        })
        .unwrap_or(false)
}

fn decode_uri(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}
