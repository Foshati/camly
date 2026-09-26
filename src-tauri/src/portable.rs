//! Windows/Linux capture engine: FFmpeg for video, xcap for screenshots, arboard for the clipboard.
//! It speaks the same JSON events as the macOS Swift helper, so the UI does not care which runs.
//!
//! Compiled on every platform (so it is type-checked on macOS too); only used where
//! ScreenCaptureKit is unavailable.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

use serde_json::{json, Value};

#[derive(Clone, Copy, PartialEq)]
pub enum Os {
    Windows,
    Linux,
}

pub fn os() -> Os {
    if cfg!(windows) {
        Os::Windows
    } else {
        Os::Linux
    }
}

/// Bundled ffmpeg next to the executable (Tauri sidecar), else the one on PATH.
pub fn ffmpeg() -> PathBuf {
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join(name);
            if bundled.exists() {
                return bundled;
            }
        }
    }
    PathBuf::from(name)
}

fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub fn free_bytes(dir: &Path) -> i64 {
    fs2::available_space(dir).map(|b| b as i64).unwrap_or(-1)
}

// ------------------------------------------------------------------ sources

pub fn list_sources(save_dir: &str) -> Value {
    let _ = std::fs::create_dir_all(save_dir);
    let mut displays = vec![];
    if let Ok(monitors) = xcap::Monitor::all() {
        for m in monitors {
            let sf = m.scale_factor().unwrap_or(1.0) as f64;
            let (w, h) = (m.width().unwrap_or(0) as f64, m.height().unwrap_or(0) as f64);
            displays.push(json!({
                "id": m.id().unwrap_or(0),
                "name": m.friendly_name().or_else(|_| m.name()).unwrap_or_else(|_| "Display".into()),
                "width": (w / sf).round(),
                "height": (h / sf).round(),
                "pixelWidth": w,
                "pixelHeight": h,
                "isMain": m.is_primary().unwrap_or(false),
            }));
        }
    }

    let own_pid = std::process::id();
    let mut windows = vec![];
    if let Ok(list) = xcap::Window::all() {
        for w in list {
            if w.is_minimized().unwrap_or(false) || w.pid().ok() == Some(own_pid) {
                continue;
            }
            let title = w.title().unwrap_or_default();
            let (width, height) = (w.width().unwrap_or(0), w.height().unwrap_or(0));
            if title.trim().is_empty() || width < 120 || height < 80 {
                continue;
            }
            windows.push(json!({
                "id": w.id().unwrap_or(0),
                "title": title,
                "app": w.app_name().unwrap_or_default(),
                "bundleId": "",
                "width": width,
                "height": height,
            }));
        }
    }

    let wayland = os() == Os::Linux
        && std::env::var("XDG_SESSION_TYPE").map(|s| s == "wayland").unwrap_or(false);

    json!({
        "event": "sources",
        "screenPermission": true,
        "microphonePermission": "granted",
        "displays": displays,
        "windows": windows,
        "microphones": microphones(),
        "freeBytes": free_bytes(Path::new(save_dir)),
        "error": if wayland {
            Value::from("Wayland session: screen recording needs an X11 session (screenshots still work).")
        } else {
            Value::Null
        },
    })
}

fn microphones() -> Vec<Value> {
    match os() {
        Os::Windows => {
            // ffmpeg prints DirectShow devices on stderr:  "Microphone (Realtek Audio)" (audio)
            let out = command(ffmpeg())
                .args(["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"])
                .output();
            let text = out.map(|o| String::from_utf8_lossy(&o.stderr).to_string()).unwrap_or_default();
            text.lines()
                .filter(|l| l.contains("(audio)"))
                .filter_map(|l| {
                    let start = l.find('"')? + 1;
                    let end = start + l[start..].find('"')?;
                    let name = &l[start..end];
                    Some(json!({ "id": name, "name": name, "isDefault": false }))
                })
                .collect()
        }
        Os::Linux => {
            let out = command("pactl").args(["list", "short", "sources"]).output();
            let mut mics: Vec<Value> = out
                .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                .unwrap_or_default()
                .lines()
                .filter_map(|l| l.split('\t').nth(1))
                .filter(|name| !name.ends_with(".monitor"))
                .map(|name| json!({ "id": name, "name": name, "isDefault": false }))
                .collect();
            mics.insert(0, json!({ "id": "default", "name": "Default", "isDefault": true }));
            mics
        }
    }
}

// ------------------------------------------------------------------ geometry

/// Logical (point) rectangle from the overlay → physical pixels on the monitor under it.
fn region_pixels(rect: &Value) -> Result<(i32, i32, u32, u32), String> {
    let get = |k: &str| rect[k].as_f64().ok_or_else(|| format!("bad rect {k}"));
    let (x, y, w, h) = (get("x")?, get("y")?, get("width")?, get("height")?);
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors
        .iter()
        .find(|m| {
            let sf = m.scale_factor().unwrap_or(1.0) as f64;
            let mx = m.x().unwrap_or(0) as f64 / sf;
            let my = m.y().unwrap_or(0) as f64 / sf;
            let mw = m.width().unwrap_or(0) as f64 / sf;
            let mh = m.height().unwrap_or(0) as f64 / sf;
            let (cx, cy) = (x + w / 2.0, y + h / 2.0);
            cx >= mx && cx < mx + mw && cy >= my && cy < my + mh
        })
        .or_else(|| monitors.iter().find(|m| m.is_primary().unwrap_or(false)))
        .or(monitors.first())
        .ok_or("No display found")?;
    let sf = monitor.scale_factor().unwrap_or(1.0) as f64;
    let px = (x * sf).round() as i32;
    let py = (y * sf).round() as i32;
    let pw = ((w * sf).round() as u32).max(2) & !1;
    let ph = ((h * sf).round() as u32).max(2) & !1;
    Ok((px, py, pw, ph))
}

fn monitor_for(opts: &Value) -> Result<xcap::Monitor, String> {
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let wanted = opts["displayId"].as_u64().map(|v| v as u32);
    monitors
        .iter()
        .find(|m| wanted.is_some() && m.id().ok() == wanted)
        .or_else(|| monitors.iter().find(|m| m.is_primary().unwrap_or(false)))
        .or(monitors.first())
        .cloned()
        .ok_or_else(|| "No display found".into())
}

fn window_for(opts: &Value) -> Result<xcap::Window, String> {
    let wanted = opts["windowId"].as_u64().ok_or("No window selected")? as u32;
    xcap::Window::all()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|w| w.id().ok() == Some(wanted))
        .ok_or_else(|| "That window is no longer available.".into())
}

// ------------------------------------------------------------------ screenshots

pub fn screenshot(opts: &Value, output: &Path, format: &str) -> Result<Value, String> {
    let image = match opts["target"].as_str() {
        Some("window") => window_for(opts)?.capture_image().map_err(|e| e.to_string())?,
        Some("region") => {
            let (x, y, w, h) = region_pixels(&opts["rect"])?;
            let monitor = xcap::Monitor::from_point(x, y)
                .or_else(|_| monitor_for(opts))
                .map_err(|e| e.to_string())?;
            let (mx, my) = (monitor.x().unwrap_or(0), monitor.y().unwrap_or(0));
            let full = monitor.capture_image().map_err(|e| e.to_string())?;
            let lx = (x - mx).max(0) as u32;
            let ly = (y - my).max(0) as u32;
            let w = w.min(full.width().saturating_sub(lx));
            let h = h.min(full.height().saturating_sub(ly));
            image::imageops::crop_imm(&full, lx, ly, w, h).to_image()
        }
        _ => monitor_for(opts)?.capture_image().map_err(|e| e.to_string())?,
    };

    if let Some(dir) = output.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    if format == "jpg" {
        let rgb = image::DynamicImage::ImageRgba8(image.clone()).to_rgb8();
        let file = std::fs::File::create(output).map_err(|e| e.to_string())?;
        let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(std::io::BufWriter::new(file), 90);
        enc.encode_image(&rgb).map_err(|e| e.to_string())?;
    } else {
        image.save_with_format(output, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    }

    let copied = opts["clipboard"].as_bool().unwrap_or(false);
    if copied {
        if let Ok(mut cb) = arboard::Clipboard::new() {
            let _ = cb.set_image(arboard::ImageData {
                width: image.width() as usize,
                height: image.height() as usize,
                bytes: std::borrow::Cow::Borrowed(image.as_raw()),
            });
        }
    }

    Ok(json!({
        "event": "shot",
        "path": output.to_string_lossy(),
        "width": image.width(),
        "height": image.height(),
        "bytes": std::fs::metadata(output).map(|m| m.len()).unwrap_or(0),
        "copied": copied,
    }))
}

// ------------------------------------------------------------------ encoding

/// CRF per quality preset; screen content compresses extremely well at these values.
fn video_codec_args(opts: &Value, realtime: bool) -> Vec<String> {
    let hevc = opts["codec"].as_str() == Some("hevc");
    let mut args: Vec<String> = vec![];
    if hevc {
        args.extend(["-c:v", "libx265", "-preset", if realtime { "ultrafast" } else { "fast" }, "-tag:v", "hvc1"].map(String::from));
    } else {
        args.extend(["-c:v", "libx264", "-preset", if realtime { "veryfast" } else { "medium" }].map(String::from));
    }
    match opts["bitrateMbps"].as_f64() {
        Some(mbps) if mbps > 0.0 => {
            let k = (mbps * 1000.0) as u64;
            args.extend(["-b:v".into(), format!("{k}k"), "-maxrate".into(), format!("{}k", k * 3 / 2), "-bufsize".into(), format!("{}k", k * 2)]);
        }
        _ => {
            let bpp = opts["bitsPerPixel"].as_f64().unwrap_or(0.045);
            // 0.045 (Compact) → 28, 0.06 → 26, 0.08 (Retina) → 23
            let crf = (34.0 - bpp * 135.0).clamp(18.0, 32.0).round() as i64 + if hevc { 2 } else { 0 };
            args.extend(["-crf".into(), crf.to_string()]);
        }
    }
    args.extend(["-pix_fmt", "yuv420p"].map(String::from));
    args
}

fn scale_filter(opts: &Value) -> Option<String> {
    let (w, h) = (opts["maxWidth"].as_u64()?, opts["maxHeight"].as_u64()?);
    Some(format!(
        "scale='min({w},iw)':'min({h},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2"
    ))
}

fn container_args(output: &Path) -> Vec<String> {
    // Fragmented MP4/MOV: playable even if the app crashes or the disk fills mid-recording.
    vec!["-movflags".into(), "+frag_keyframe+empty_moov+default_base_moof".into(), output.to_string_lossy().to_string()]
}

/// Builds the full ffmpeg argument list for a live recording, plus the captured size in pixels.
fn record_args(opts: &Value, output: &Path) -> Result<(Vec<String>, u32, u32), String> {
    let fps = opts["fps"].as_u64().unwrap_or(30).to_string();
    let cursor = if opts["showCursor"].as_bool().unwrap_or(true) { "1" } else { "0" };
    let mut args: Vec<String> = vec!["-hide_banner".into(), "-loglevel".into(), "error".into(), "-y".into()];
    let (w, h);

    match os() {
        Os::Windows => {
            args.extend(["-f", "gdigrab", "-framerate", &fps, "-draw_mouse", cursor].map(String::from));
            match opts["target"].as_str() {
                Some("window") => {
                    let win = window_for(opts)?;
                    w = win.width().unwrap_or(0);
                    h = win.height().unwrap_or(0);
                    args.extend(["-i".into(), format!("title={}", win.title().unwrap_or_default())]);
                }
                Some("region") => {
                    let (x, y, rw, rh) = region_pixels(&opts["rect"])?;
                    (w, h) = (rw, rh);
                    args.extend([
                        "-offset_x".into(), x.to_string(), "-offset_y".into(), y.to_string(),
                        "-video_size".into(), format!("{rw}x{rh}"), "-i".into(), "desktop".into(),
                    ]);
                }
                _ => {
                    let m = monitor_for(opts)?;
                    w = m.width().unwrap_or(0) & !1;
                    h = m.height().unwrap_or(0) & !1;
                    args.extend([
                        "-offset_x".into(), m.x().unwrap_or(0).to_string(), "-offset_y".into(), m.y().unwrap_or(0).to_string(),
                        "-video_size".into(), format!("{w}x{h}"), "-i".into(), "desktop".into(),
                    ]);
                }
            }
        }
        Os::Linux => {
            if std::env::var("XDG_SESSION_TYPE").map(|s| s == "wayland").unwrap_or(false) {
                return Err("Screen recording on Wayland isn't supported yet — log in with an X11 session (screenshots still work).".into());
            }
            let display = std::env::var("DISPLAY").unwrap_or_else(|_| ":0".into());
            let (x, y, rw, rh) = match opts["target"].as_str() {
                Some("window") => {
                    let win = window_for(opts)?;
                    (win.x().unwrap_or(0), win.y().unwrap_or(0), win.width().unwrap_or(0) & !1, win.height().unwrap_or(0) & !1)
                }
                Some("region") => region_pixels(&opts["rect"])?,
                _ => {
                    let m = monitor_for(opts)?;
                    (m.x().unwrap_or(0), m.y().unwrap_or(0), m.width().unwrap_or(0) & !1, m.height().unwrap_or(0) & !1)
                }
            };
            (w, h) = (rw, rh);
            args.extend(["-f", "x11grab", "-framerate", &fps, "-draw_mouse", cursor].map(String::from));
            args.extend(["-video_size".into(), format!("{rw}x{rh}"), "-i".into(), format!("{display}+{x},{y}")]);
        }
    }

    // Audio inputs → one track each.
    let mut audio_inputs = 0;
    if let Some(mic) = opts["microphoneId"].as_str() {
        // "" = the system default microphone.
        let first = || microphones().first().and_then(|m| m["id"].as_str().map(String::from));
        let mic = if mic.is_empty() {
            match os() {
                Os::Windows => first().ok_or("No microphone found.")?,
                Os::Linux => "default".to_string(),
            }
        } else {
            mic.to_string()
        };
        let mic = mic.as_str();
        match os() {
            Os::Windows => args.extend(["-f".into(), "dshow".into(), "-i".into(), format!("audio={mic}")]),
            Os::Linux => args.extend(["-f".into(), "pulse".into(), "-i".into(), mic.to_string()]),
        }
        audio_inputs += 1;
    }
    if opts["systemAudio"].as_bool().unwrap_or(false) && os() == Os::Linux {
        if let Some(sink) = default_sink() {
            args.extend(["-f".into(), "pulse".into(), "-i".into(), format!("{sink}.monitor")]);
            audio_inputs += 1;
        }
    }

    args.extend(["-map".into(), "0:v".into()]);
    for i in 1..=audio_inputs {
        args.extend(["-map".into(), format!("{i}:a")]);
    }
    if let Some(vf) = scale_filter(opts) {
        args.extend(["-vf".into(), vf]);
    }
    args.extend(video_codec_args(opts, true));
    if opts["microphoneId"].is_string() && opts["noiseReduction"].as_bool().unwrap_or(false) {
        // Microphone is the first audio track: cut rumble, then FFT denoise.
        args.extend(["-filter:a:0".into(), "highpass=f=80,afftdn=nf=-25:tn=1,lowpass=f=12000".into()]);
    }
    if audio_inputs > 0 {
        args.extend(["-c:a", "aac", "-b:a", "160k"].map(String::from));
    }
    args.extend(["-progress".into(), "pipe:1".into(), "-nostats".into()]);
    args.extend(container_args(output));
    Ok((args, w, h))
}

fn default_sink() -> Option<String> {
    let out = command("pactl").arg("get-default-sink").output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

// ------------------------------------------------------------------ recording

/// Starts ffmpeg. `emit` receives the same events as the Swift helper; `child` is returned so
/// the caller can stop it (stdin "q" makes ffmpeg finalize the file cleanly).
pub fn start_recording(
    opts: &Value,
    output: &Path,
    emit: impl Fn(Value) + Send + Sync + 'static,
) -> Result<Child, String> {
    let (args, width, height) = record_args(opts, output)?;
    let mut child = command(ffmpeg())
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start ffmpeg ({e}). Install ffmpeg or reinstall Camly."))?;

    let stdout = child.stdout.take().ok_or("ffmpeg stdout unavailable")?;
    let stderr = child.stderr.take();
    let path = output.to_path_buf();
    let min_free = opts["minFreeMB"].as_i64().unwrap_or(1024) * 1_048_576;
    let started = Instant::now();
    let errors = Arc::new(Mutex::new(String::new()));
    let emit = Arc::new(emit);

    emit(json!({ "event": "started", "path": path.to_string_lossy(), "width": width, "height": height,
                 "fps": opts["fps"], "codec": opts["codec"] }));

    if let Some(stderr) = stderr {
        let errors = errors.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Ok(mut e) = errors.lock() {
                    e.push_str(&line);
                    e.push('\n');
                }
            }
        });
    }

    let emit_progress = emit.clone();
    thread::spawn(move || {
        let mut seconds = 0.0;
        let mut low_disk = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(us) = line.strip_prefix("out_time_us=") {
                seconds = us.trim().parse::<f64>().unwrap_or(0.0) / 1_000_000.0;
            } else if line.starts_with("progress=") {
                let free = free_bytes(path.parent().unwrap_or(Path::new(".")));
                emit_progress(json!({
                    "event": "progress",
                    "seconds": seconds.max(started.elapsed().as_secs_f64() - 1.0).max(0.0),
                    "bytes": std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
                    "paused": false,
                    "freeBytes": free,
                }));
                if !low_disk && free >= 0 && free < min_free {
                    low_disk = true;
                    emit_progress(json!({ "event": "warning", "code": "lowDisk", "message": "Disk almost full — recording was stopped and saved." }));
                    emit_progress(json!({ "event": "__stop" }));
                }
                if line.trim() == "progress=end" {
                    break;
                }
            }
        }
        let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if bytes < 1024 {
            let detail = errors.lock().map(|e| e.trim().to_string()).unwrap_or_default();
            emit_progress(json!({ "event": "error", "message": if detail.is_empty() { "Recording failed.".to_string() } else { detail } }));
        } else {
            emit_progress(json!({
                "event": "stopped",
                "path": path.to_string_lossy(),
                "seconds": seconds,
                "bytes": bytes,
                "width": width,
                "height": height,
                "frames": 0,
                "reason": if low_disk { "lowDisk" } else { "user" },
            }));
        }
    });

    Ok(child)
}

// ------------------------------------------------------------------ compress

pub fn compress(input: &str, output: &Path, opts: &Value, emit: impl Fn(Value) + Send + 'static) -> Result<Child, String> {
    let mut args: Vec<String> = vec!["-hide_banner".into(), "-y".into(), "-i".into(), input.into()];
    if let Some(vf) = scale_filter(opts) {
        args.extend(["-vf".into(), vf]);
    }
    args.extend(video_codec_args(opts, false));
    args.extend(["-c:a", "aac", "-b:a", "128k", "-ac", "2", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats"].map(String::from));
    args.push(output.to_string_lossy().to_string());

    let mut child = command(ffmpeg())
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start ffmpeg ({e})."))?;
    let stdout = child.stdout.take().ok_or("ffmpeg stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("ffmpeg stderr unavailable")?;
    let duration = Arc::new(Mutex::new(0.0_f64));
    let log = Arc::new(Mutex::new(String::new()));

    {
        let duration = duration.clone();
        let log = log.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Some(rest) = line.trim().strip_prefix("Duration: ") {
                    if let Some(d) = parse_clock(rest.split(',').next().unwrap_or("")) {
                        *duration.lock().unwrap() = d;
                    }
                }
                if let Ok(mut l) = log.lock() {
                    l.push_str(&line);
                    l.push('\n');
                }
            }
        });
    }

    let input = input.to_string();
    let output = output.to_path_buf();
    thread::spawn(move || {
        emit(json!({ "event": "started", "width": 0, "height": 0, "duration": 0 }));
        let mut last = -1.0;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(us) = line.strip_prefix("out_time_us=") {
                let total = *duration.lock().unwrap();
                let t = us.trim().parse::<f64>().unwrap_or(0.0) / 1_000_000.0;
                if total > 0.0 {
                    let p = (t / total).clamp(0.0, 1.0);
                    if p - last >= 0.01 {
                        last = p;
                        emit(json!({ "event": "progress", "progress": p }));
                    }
                }
            }
        }
        let out_bytes = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
        if out_bytes > 0 {
            emit(json!({
                "event": "done",
                "output": output.to_string_lossy(),
                "inputBytes": std::fs::metadata(&input).map(|m| m.len()).unwrap_or(0),
                "outputBytes": out_bytes,
                "seconds": *duration.lock().unwrap(),
            }));
        } else {
            let tail: String = log.lock().map(|l| l.lines().rev().take(3).collect::<Vec<_>>().join(" · ")).unwrap_or_default();
            emit(json!({ "event": "error", "message": format!("Compression failed. {tail}") }));
        }
    });
    Ok(child)
}

fn parse_clock(s: &str) -> Option<f64> {
    let mut parts = s.trim().split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let sec: f64 = parts.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + sec)
}
