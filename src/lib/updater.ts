import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** Where people can always download Camly by hand. */
export const RELEASES_URL = "https://github.com/Foshati/camly/releases/latest";

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current" }
  | { status: "available"; version: string; notes: string; date?: string }
  | { status: "downloading"; version: string; downloaded: number; total: number | null }
  | { status: "installing"; version: string }
  | { status: "ready"; version: string }
  | { status: "error"; message: string; version?: string };

const CHECKED_KEY = "camly.update.checked";
/** Automatic checks: at launch, then this often while Camly runs. */
const AUTO_INTERVAL_MS = 6 * 60 * 60 * 1000;

// One updater per window, shared by every component that shows it.
let state: UpdateState = { status: "idle" };
let pending: Update | null = null;
const listeners = new Set<() => void>();

function set(next: UpdateState) {
  state = next;
  listeners.forEach((fn) => fn());
  // The menu bar item mirrors "update available" for people who never open the Library.
  const version = next.status === "available" ? next.version : next.status === "ready" ? next.version : null;
  void invoke("set_update_available", { version }).catch(() => {});
}

export function lastChecked(): number | null {
  try {
    const raw = localStorage.getItem(CHECKED_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function friendly(e: unknown): string {
  const raw = String(e instanceof Error ? e.message : e);
  if (/network|connect|dns|timed? ?out|offline|request/i.test(raw)) {
    return "Couldn't reach GitHub. Check your internet connection and try again.";
  }
  if (/signature/i.test(raw)) return "The download failed its security check, so it was not installed.";
  if (/not supported|unsupported|bundle type/i.test(raw)) {
    return "This copy of Camly can't update itself (for example a .deb or .rpm install). Download the new version from GitHub.";
  }
  if (/404|not found|latest\.json/i.test(raw)) return "No update information was found on GitHub yet.";
  return raw;
}

/** `quiet`: automatic checks never surface errors, they just try again later. */
export async function checkForUpdates(quiet = false): Promise<void> {
  if (["checking", "downloading", "installing", "ready"].includes(state.status)) return;
  const before = state;
  set({ status: "checking" });
  try {
    const update = await check({ timeout: 30_000 });
    try {
      localStorage.setItem(CHECKED_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    pending = update;
    if (update) set({ status: "available", version: update.version, notes: update.body?.trim() ?? "", date: update.date });
    else set({ status: "current" });
  } catch (e) {
    if (quiet) set(before.status === "checking" ? { status: "idle" } : before);
    else set({ status: "error", message: friendly(e) });
  }
}

export async function installUpdate(): Promise<void> {
  if (!pending) return;
  const update = pending;
  const version = update.version;
  let downloaded = 0;
  let total: number | null = null;
  let lastPaint = 0;
  set({ status: "downloading", version, downloaded, total });
  try {
    await update.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? null;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        const now = performance.now();
        if (now - lastPaint < 80) return;
        lastPaint = now;
        set({ status: "downloading", version, downloaded, total });
      } else if (event.event === "Finished") {
        set({ status: "installing", version });
      }
    });
    pending = null;
    set({ status: "ready", version });
  } catch (e) {
    set({ status: "error", message: friendly(e), version });
  }
}

/** Restarts into the new version. A running recording is stopped and saved first. */
export async function restartToUpdate(): Promise<void> {
  if (await invoke<boolean>("recorder_status").catch(() => false)) {
    await invoke("stop_recording").catch(() => {});
    // The helper finalizes the file within a moment of being told to stop.
    await new Promise((r) => setTimeout(r, 2500));
  }
  await relaunch();
}

/** Starts automatic checks once per window (call from the always-loaded Library). */
export function useAutoUpdateCheck(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const due = () => {
      const last = lastChecked();
      if (last == null || Date.now() - last > AUTO_INTERVAL_MS) void checkForUpdates(true);
    };
    // Let the app settle after launch before going to the network.
    const first = setTimeout(due, 8_000);
    const timer = setInterval(due, 30 * 60 * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled]);
}

export function useUpdater(): UpdateState {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, []);
  return state;
}

export function useAppVersion(): string {
  const [version, setVersion] = useState("");
  useEffect(() => {
    void getVersion().then(setVersion).catch(() => {});
  }, []);
  return version;
}
