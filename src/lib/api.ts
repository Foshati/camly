import { invoke } from "@tauri-apps/api/core";
import { BUBBLE_TITLE, presetFor, type Rect, type Settings } from "./settings";

export type Display = {
  id: number;
  name: string;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  isMain: boolean;
};
export type WindowInfo = { id: number; title: string; app: string; bundleId: string; width: number; height: number };
export type Microphone = { id: string; name: string; isDefault: boolean };
export type Sources = {
  screenPermission: boolean;
  microphonePermission?: "granted" | "denied" | "unknown";
  displays: Display[];
  windows: WindowInfo[];
  microphones: Microphone[];
  freeBytes?: number;
  error?: string;
};

export type RecorderEvent =
  | { event: "started"; path: string; width: number; height: number; fps: number; codec: string }
  | { event: "progress"; seconds: number; bytes: number; paused: boolean; freeBytes: number }
  | { event: "paused" }
  | { event: "resumed" }
  | { event: "warning"; code: string; message: string }
  | { event: "stopped"; path: string; seconds: number; bytes: number; width: number; height: number; reason: string }
  | { event: "error"; message: string; code?: string }
  | { event: "idle" };

export type CompressEvent =
  | { id: string; event: "started"; width: number; height: number; duration: number }
  | { id: string; event: "progress"; progress: number }
  | { id: string; event: "done"; output: string; inputBytes: number; outputBytes: number; seconds: number }
  | { id: string; event: "error"; message: string };

export type Recording = { path: string; name: string; bytes: number; modified: number };

export type PermissionState = "granted" | "denied" | "unknown";
export type Permissions = { screen: PermissionState; microphone: PermissionState; camera: PermissionState };

export type Shot = { event: "shot"; path: string; width: number; height: number; bytes: number; copied: boolean };
export type CameraMedia = {
  event: "camera";
  kind: "photo" | "video";
  path: string;
  width: number;
  height: number;
  bytes: number;
  seconds?: number;
};

export const isImage = (path: string) => /\.(png|jpe?g|heic)$/i.test(path);

export type Target =
  | { kind: "display"; displayId: number | null }
  | { kind: "window"; windowId: number }
  | { kind: "region"; rect: Rect };

export async function saveDirOf(s: Settings): Promise<string> {
  return s.saveDir || (await invoke<string>("default_save_dir"));
}

export function recordOptions(s: Settings, target: Target) {
  const p = presetFor(s);
  return {
    target: target.kind,
    displayId: target.kind === "display" ? target.displayId : null,
    windowId: target.kind === "window" ? target.windowId : null,
    rect: target.kind === "region" ? target.rect : null,
    fps: s.fps,
    codec: s.codec,
    maxWidth: p.maxWidth,
    maxHeight: p.maxHeight,
    bitsPerPixel: p.bitsPerPixel,
    bitrateMbps: p.bitrateMbps,
    systemAudio: s.systemAudio,
    microphoneId: s.microphoneId,
    noiseReduction: s.noiseReduction,
    showCursor: s.showCursor,
    showClicks: s.showClicks,
    minFreeMB: Math.round(s.minFreeGB * 1024),
    includeWindowTitles: s.bubble ? [BUBBLE_TITLE] : [],
  };
}

export async function beginScreenshot(s: Settings, target: Target) {
  await invoke("begin_screenshot", {
    options: {
      target: target.kind,
      displayId: target.kind === "display" ? target.displayId : null,
      windowId: target.kind === "window" ? target.windowId : null,
      rect: target.kind === "region" ? target.rect : null,
      showCursor: false,
      clipboard: s.copyShots,
    },
    saveDir: await saveDirOf(s),
    format: s.shotFormat,
    countdown: s.timer,
  });
}

export async function beginRecording(s: Settings, target: Target) {
  await invoke("begin_recording", {
    options: recordOptions(s, target),
    saveDir: await saveDirOf(s),
    container: s.container,
    countdown: s.timer,
  });
}

export function compressOptions(s: Settings) {
  const p = presetFor(s.quality === "retina" ? { ...s, quality: "compact" as const } : s);
  return {
    codec: s.codec,
    maxWidth: p.maxWidth,
    maxHeight: p.maxHeight,
    bitsPerPixel: p.bitsPerPixel,
    bitrateMbps: p.bitrateMbps,
  };
}

export const api = {
  listSources: (saveDir: string) => invoke<Sources>("list_sources", { saveDir }),
  stop: () => invoke("stop_recording"),
  pause: () => invoke("pause_recording"),
  resume: () => invoke("resume_recording"),
  isRecording: () => invoke<boolean>("recorder_status"),
  listRecordings: (dir: string) => invoke<Recording[]>("list_recordings", { dir }),
  trash: (path: string) => invoke("trash_file", { path }),
  reveal: (path: string) => invoke("reveal_in_finder", { path }),
  open: (path: string) => invoke("open_path", { path }),
  privacy: (kind: "screen" | "microphone" | "camera") => invoke("open_privacy_settings", { kind }),
  compress: (id: string, input: string, options: ReturnType<typeof compressOptions>, output?: string) =>
    invoke<string>("compress_video", { id, input, options, output: output ?? null }),
  showCamera: () => invoke("show_camera"),
  permissions: (request?: "screen" | "microphone" | "camera") => invoke<Permissions>("permissions", { request: request ?? null }),
  quit: () => invoke("quit_app"),
  setBubble: (visible: boolean, size: number) => invoke("set_bubble", { visible, size }),
  cameraPaths: (saveDir: string, kind: "photo" | "video", ext: string) =>
    invoke<{ temp: string; target: string }>("camera_paths", { saveDir, kind, ext }),
  writeChunk: (path: string, bytes: Uint8Array, append: boolean) =>
    invoke("write_chunk", bytes, { headers: { "x-path": encodeURIComponent(path), "x-append": append ? "1" : "0" } }),
  finalize: (temp: string, target: string) => invoke<string>("finalize_media", { temp, target }),
  discardTemp: (path: string) => invoke("discard_temp", { path }),
  fileSize: (path: string) => invoke<number>("file_size", { path }),
  showMediaPreview: (payload: CameraMedia) => invoke("show_media_preview", { payload }),
  showRegion: (rect: Rect | null) => invoke("show_region_overlay", { rect }),
  hideOverlay: () => invoke("hide_overlay"),
  closeCaptureUi: () => invoke("close_capture_ui"),
  openToolbar: () => invoke("open_toolbar"),
  fitToolbar: (height: number) => invoke<number>("fit_toolbar", { height }),
  hideWindow: (label: string) => invoke("hide_window", { label }),
  showLibrary: (tab: "recordings" | "compress" | "settings") => invoke("show_library", { tab }),
};
