import { useEffect, useState } from "react";
import { isMac } from "./platform";

export type Mode = "display" | "window" | "region";
export type Quality = "compact" | "balanced" | "retina" | "custom";
export type Codec = "hevc" | "h264";
export type Container = "mp4" | "mov";
export type Action = "screenshot" | "record";
export type ShotFormat = "png" | "jpg" | "heic";
export type BubbleSize = "s" | "m" | "l";
export type BubbleShape = "circle" | "rounded";

export const BUBBLE_PX: Record<BubbleSize, number> = { s: 160, m: 220, l: 300 };
export const BUBBLE_TITLE = "Camly Bubble";

export type Settings = {
  action: Action;
  mode: Mode;
  saveDir: string;
  timer: 0 | 5 | 10;
  microphoneId: string | null;
  systemAudio: boolean;
  /** Clean voice: noise suppression + echo cancellation on the microphone. */
  noiseReduction: boolean;
  showCursor: boolean;
  showClicks: boolean;
  quality: Quality;
  codec: Codec;
  container: Container;
  fps: 30 | 60;
  customHeight: number;
  customMbps: number;
  minFreeGB: number;
  displayId: number | null;
  showPreview: boolean;
  shotFormat: ShotFormat;
  copyShots: boolean;
  /** Face-cam bubble included in screen recordings. */
  bubble: boolean;
  bubbleCameraId: string | null;
  bubbleSize: BubbleSize;
  bubbleShape: BubbleShape;
  /** Camera window (web device ids, which differ from AVFoundation ids). */
  cameraId: string | null;
  cameraMicId: string | null;
  cameraMirror: boolean;
  cameraRes: 720 | 1080;
  cameraGrid: boolean;
  photoFormat: "jpg" | "png";
  /** Global shortcut accelerator; null = platform default (⌘⇧2 / Ctrl+Shift+2). */
  shortcut: string | null;
  /** First-run permissions screen completed. */
  onboarded: boolean;
  /** ✕ hides Camly to the menu bar instead of quitting (keeps the shortcut alive). */
  keepRunning: boolean;
};

export const DEFAULTS: Settings = {
  action: "record",
  mode: "display",
  saveDir: "",
  timer: 0,
  /** "" = system default microphone, null = no microphone. */
  microphoneId: "",
  systemAudio: false,
  noiseReduction: false,
  showCursor: true,
  showClicks: false,
  quality: "compact",
  // macOS encodes HEVC in hardware; elsewhere H.264 keeps CPU use low while recording.
  codec: isMac ? "hevc" : "h264",
  container: "mp4",
  fps: 30,
  customHeight: 1080,
  customMbps: 4,
  minFreeGB: 1,
  displayId: null,
  showPreview: true,
  shotFormat: "png",
  copyShots: false,
  bubble: false,
  bubbleCameraId: null,
  bubbleSize: "m",
  bubbleShape: "circle",
  cameraId: null,
  cameraMicId: null,
  cameraMirror: true,
  cameraRes: 1080,
  cameraGrid: false,
  photoFormat: "jpg",
  shortcut: null,
  onboarded: false,
  keepRunning: false,
};

/** Webcam video bitrate per quality preset (MediaRecorder, before optional HEVC pass). */
export function cameraBitrate(s: Settings): number {
  if (s.quality === "custom") return s.customMbps * 1_000_000;
  return { compact: 3_000_000, balanced: 5_000_000, retina: 8_000_000 }[s.quality];
}

export type Preset = {
  label: string;
  detail: string;
  maxWidth: number | null;
  maxHeight: number | null;
  bitsPerPixel: number;
};

/**
 * "Compact" mirrors the HandBrake recipe (H.265, ≤1080p, 30 fps, RF≈26) but encodes
 * live in hardware, so there is no second pass.
 */
export const PRESETS: Record<Exclude<Quality, "custom">, Preset> = {
  compact: {
    label: "Compact",
    detail: "1080p · smallest files, sharp text",
    maxWidth: 1920,
    maxHeight: 1080,
    bitsPerPixel: 0.045,
  },
  balanced: {
    label: "Balanced",
    detail: "1440p · extra detail for small UI",
    maxWidth: 2560,
    maxHeight: 1440,
    bitsPerPixel: 0.06,
  },
  retina: {
    label: "Retina",
    detail: "Native pixels · pixel-perfect",
    maxWidth: null,
    maxHeight: null,
    bitsPerPixel: 0.08,
  },
};

export function presetFor(s: Settings): Preset & { bitrateMbps: number | null } {
  if (s.quality === "custom") {
    const h = s.customHeight;
    return {
      label: "Custom",
      detail: `${h}p · ${s.customMbps} Mbps`,
      maxWidth: h ? Math.round((h * 16) / 9) : null,
      maxHeight: h || null,
      bitsPerPixel: 0.05,
      bitrateMbps: s.customMbps,
    };
  }
  return { ...PRESETS[s.quality], bitrateMbps: null };
}

/** Worst-case MB per minute; static screens come in far lower. */
export function ceilingMBPerMinute(s: Settings, nativeW = 3024, nativeH = 1964): number {
  const p = presetFor(s);
  if (p.bitrateMbps) return (p.bitrateMbps * 60) / 8;
  let w = nativeW,
    h = nativeH;
  if (p.maxWidth && p.maxHeight) {
    const f = Math.min(1, Math.max(p.maxWidth, p.maxHeight) / Math.max(w, h), Math.min(p.maxWidth, p.maxHeight) / Math.min(w, h));
    w *= f;
    h *= f;
  }
  const bps = Math.max(600_000, w * h * s.fps * p.bitsPerPixel);
  return (bps * 60) / 8 / 1_000_000;
}

const KEY = "camly.settings.v2";
const EVENT = "camly:settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(next: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — settings stay in memory */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Settings shared by every window (same origin → same localStorage). */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  useEffect(() => {
    const sync = () => setSettings(loadSettings());
    window.addEventListener("storage", sync);
    window.addEventListener(EVENT, sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...loadSettings(), ...patch };
    saveSettings(next);
    setSettings(next);
  };
  return [settings, update];
}

const REGION_KEY = "camly.region.v1";
export type Rect = { x: number; y: number; width: number; height: number };

export function loadRegion(): Rect | null {
  try {
    const raw = localStorage.getItem(REGION_KEY);
    return raw ? (JSON.parse(raw) as Rect) : null;
  } catch {
    return null;
  }
}

export function saveRegion(rect: Rect) {
  try {
    localStorage.setItem(REGION_KEY, JSON.stringify(rect));
  } catch {
    /* ignore */
  }
}
