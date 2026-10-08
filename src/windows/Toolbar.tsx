import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "motion/react";
import { desktopDir, documentDir, videoDir } from "@tauri-apps/api/path";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, beginRecording, beginScreenshot, saveDirOf, type Sources, type Target, type WindowInfo } from "../lib/api";
import {
  BUBBLE_PX, ceilingMBPerMinute, loadRegion, loadSettings, PRESETS, useSettings,
  type Action, type Mode, type Quality, type Rect, type Settings,
} from "../lib/settings";
import { useMediaDevices } from "../lib/camera";
import { formatShortcut, useApplySavedShortcut } from "../lib/shortcut";
import { isMac, isWindows } from "../lib/platform";
import { formatBytes, shortenHome } from "../lib/format";
import {
  IconCamera, IconCheck, IconChevron, IconClose, IconFace, IconRegion, IconScreen, IconTimer, IconWarning, IconWindow,
} from "../components/Icons";

/** Transparent margin above and below the visible stack (room for shadows). */
const WINDOW_PADDING = 16;
type Panel = "options" | "windows";
type Quick = { action: Action; mode: Mode };

const MODE_TITLES: Record<Action, Record<Mode, string>> = {
  screenshot: { display: "Capture Entire Screen", window: "Capture Selected Window", region: "Capture Selected Portion" },
  record: { display: "Record Entire Screen", window: "Record Selected Window", region: "Record Selected Portion" },
};

export default function Toolbar() {
  const [settings, update] = useSettings();
  const [sources, setSources] = useState<Sources | null>(null);
  const [panel, setPanelState] = useState<Panel | null>(null);
  const [selectedWindow, setSelectedWindow] = useState<WindowInfo | null>(null);
  const [region, setRegion] = useState<Rect | null>(loadRegion());
  const [error, setError] = useState<string | null>(null);
  const [saveDir, setSaveDir] = useState("");
  const [openCount, setOpenCount] = useState(0);
  const actRef = useRef<() => void>(() => {});
  const quickRef = useRef<(q: Quick) => void>(() => {});
  const stackRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<(force?: boolean) => void>(() => {});
  const shortcutError = useApplySavedShortcut();

  const refresh = useCallback(async () => {
    const dir = await saveDirOf(settings);
    setSaveDir(dir);
    try {
      setSources(await api.listSources(dir));
    } catch (e) {
      setError(String(e));
    }
  }, [settings.saveDir]); // eslint-disable-line react-hooks/exhaustive-deps

  // The window always matches its content (panel, alerts, hint, bar): nothing is clipped
  // and no invisible area is left blocking clicks. Rust applies the size atomically.
  useEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    let last = 0;
    const fit = (force = false) => {
      const height = Math.ceil(el.getBoundingClientRect().height) + WINDOW_PADDING;
      if (!force && Math.abs(height - last) < 1) return;
      last = height;
      void api.fitToolbar(height);
    };
    fitRef.current = fit;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, []);

  const setPanel = setPanelState;

  /** Esc just hides the toolbar. */
  const close = useCallback(() => {
    setPanel(null);
    void api.closeCaptureUi();
  }, [setPanel]);

  /** ✕ quits Camly completely, unless the user chose to keep it in the menu bar. */
  const quit = useCallback(() => {
    if (loadSettings().keepRunning) close();
    else void api.quit();
  }, [close]);

  /** The face-cam bubble only belongs to screen recordings. */
  const syncBubble = useCallback((s: Settings) => {
    void api.setBubble(s.bubble && s.action === "record", BUBBLE_PX[s.bubbleSize]);
  }, []);

  const choose = (action: Action, mode: Mode) => {
    const next = { ...loadSettings(), action, mode };
    update({ action, mode });
    syncBubble(next);
    setError(null);
    if (mode === "region") {
      setPanel(null);
      void api.showRegion(region);
    } else {
      void api.hideOverlay();
      setPanel(mode === "window" ? "windows" : null);
    }
  };

  const toggleBubble = () => {
    const next = { ...loadSettings(), bubble: !settings.bubble, action: "record" as const };
    update({ bubble: next.bubble, action: "record" });
    syncBubble(next);
  };

  const act = useCallback(async () => {
    setError(null);
    let target: Target;
    if (settings.mode === "window") {
      if (!selectedWindow) {
        setPanel("windows");
        return;
      }
      target = { kind: "window", windowId: selectedWindow.id };
    } else if (settings.mode === "region") {
      const rect = region ?? loadRegion();
      if (!rect) {
        void api.showRegion(null);
        return;
      }
      target = { kind: "region", rect };
    } else {
      const main = sources?.displays.find((d) => d.isMain);
      target = { kind: "display", displayId: settings.displayId ?? main?.id ?? null };
    }
    if (sources && !sources.screenPermission) {
      setError("Screen Recording permission is off for Camly.");
      return;
    }
    setPanelState(null);
    try {
      if (settings.action === "screenshot") await beginScreenshot(settings, target);
      else await beginRecording(settings, target);
    } catch (e) {
      setError(String(e));
    }
  }, [settings, selectedWindow, region, sources, setPanel]);
  actRef.current = () => void act();

  /** One-click captures from the menu bar, using the saved settings. */
  quickRef.current = async ({ action, mode }: Quick) => {
    update({ action, mode });
    const s = { ...loadSettings(), action, mode };
    syncBubble(s);
    setError(null);
    // A region has to be drawn first: open the toolbar in region mode.
    if (mode !== "display") return void api.openToolbar();
    try {
      const dir = await saveDirOf(s);
      const src = await api.listSources(dir);
      setSources(src);
      if (!src.screenPermission) return void api.openToolbar();
      const main = src.displays.find((d) => d.isMain);
      const target: Target = { kind: "display", displayId: s.displayId ?? main?.id ?? null };
      if (action === "screenshot") await beginScreenshot(s, target);
      else await beginRecording(s, target);
    } catch (e) {
      await api.openToolbar();
      setError(String(e));
    }
  };

  useEffect(() => {
    // First launch: the permissions screen (Library window) comes first.
    if (isMac && !loadSettings().onboarded) void api.closeCaptureUi();
  }, []);

  useEffect(() => {
    void refresh();
    const offs = [
      listen("toolbar://opened", () => {
        setOpenCount((n) => n + 1);
        setPanelState(null);
        setError(null);
        // Rust reset the window to its default size; re-fit after React re-renders.
        requestAnimationFrame(() => fitRef.current(true));
        void refresh();
        const s = loadSettings();
        syncBubble(s);
        if (s.mode === "region") void api.showRegion(loadRegion());
      }),
      listen<Rect>("region://changed", (e) => setRegion(e.payload)),
      listen("region://record", () => actRef.current()),
      listen("region://cancel", () => close()),
      listen<Quick>("toolbar://quick", (e) => quickRef.current(e.payload)),
      listen("toolbar://reveal-folder", async () => {
        try {
          await api.open(await saveDirOf(loadSettings()));
        } catch (e) {
          await api.openToolbar();
          setError(String(e));
        }
      }),
    ];
    return () => offs.forEach((p) => p.then((off) => off()));
  }, [refresh, close, syncBubble]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (panel) setPanel(null);
        else close();
      } else if (e.key === "Enter" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        actRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, setPanel, close]);

  const free = sources?.freeBytes;
  const lowDisk = free != null && free >= 0 && free < 5 * 1024 ** 3;
  const shooting = settings.action === "screenshot";
  const hint = hintFor(settings, selectedWindow, region);
  const modeButton = (action: Action, mode: Mode, icon: ReactNode) => (
    <ModeButton
      active={settings.action === action && settings.mode === mode}
      record={action === "record"}
      title={MODE_TITLES[action][mode]}
      onClick={() => choose(action, mode)}
    >
      {icon}
    </ModeButton>
  );

  return (
    <div className="toolbar-root">
      <div className="toolbar-stack" ref={stackRef}>
      {panel === "options" && (
        <OptionsPanel
          sources={sources}
          saveDir={saveDir}
          onSaveDir={(dir) => update({ saveDir: dir })}
          onBubbleChange={() => syncBubble(loadSettings())}
          onLibrary={() => {
            setPanel(null);
            void api.showLibrary("settings");
          }}
        />
      )}
      {panel === "windows" && (
        <WindowsPanel
          windows={sources?.windows ?? []}
          selected={selectedWindow}
          verb={shooting ? "capture" : "record"}
          onSelect={setSelectedWindow}
          onAct={(w) => {
            setSelectedWindow(w);
            setTimeout(() => actRef.current(), 0);
          }}
          onRefresh={() => void refresh()}
        />
      )}

      <AnimatePresence>
      {shortcutError && !error && (
        <motion.div key="shortcut" className="toolbar-alert" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
          <IconWarning width={15} height={15} />
          <span>{shortcutError}</span>
          <button onClick={() => void api.showLibrary("settings")}>Change</button>
        </motion.div>
      )}
      {(error || (sources && !sources.screenPermission)) && (
        <motion.div key="error" className="toolbar-alert" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
          <IconWarning width={15} height={15} />
          <span>{error ?? "Allow Screen Recording for Camly, then reopen the toolbar."}</span>
          {sources && !sources.screenPermission && (
            <button onClick={() => void api.privacy("screen")}>Open Settings</button>
          )}
        </motion.div>
      )}
      </AnimatePresence>

      {!panel && hint && <div className="bar-hint">{hint}</div>}

      <motion.div
        key={openCount}
        className="bar"
        data-tauri-drag-region
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
      >
        <button className="bar-close" title={settings.keepRunning ? "Close (Esc)" : "Quit Camly"} onClick={quit}>
          <IconClose width={14} height={14} />
        </button>
        <span className="bar-divider" />
        {modeButton("screenshot", "display", <IconScreen />)}
        {modeButton("screenshot", "window", <IconWindow />)}
        {modeButton("screenshot", "region", <IconRegion />)}
        <span className="bar-divider" />
        {modeButton("record", "display", <IconScreen />)}
        {modeButton("record", "window", <IconWindow />)}
        {modeButton("record", "region", <IconRegion />)}
        <span className="bar-divider" />
        <motion.button whileTap={{ scale: 0.9 }} className="bar-mode" title="Camera — photo or webcam video" onClick={() => void api.showCamera()}>
          <span className="mode-icon"><IconCamera /></span>
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.9 }}
          className={`bar-mode ${settings.bubble ? "active face" : ""}`}
          title={settings.bubble ? "Hide face-cam bubble" : "Show face-cam bubble in screen recordings"}
          onClick={toggleBubble}
        >
          <span className="mode-icon"><IconFace /></span>
        </motion.button>
        <span className="bar-divider" />

        <button className={`bar-options ${panel === "options" ? "open" : ""}`} onClick={() => setPanel(panel === "options" ? null : "options")}>
          Options <IconChevron />
        </button>

        <div className="bar-meta" data-tauri-drag-region>
          <span className="bar-quality">
            {shooting ? settings.shotFormat.toUpperCase() + " · Retina" : `${qualityLabel(settings.quality)} · ${settings.codec === "hevc" ? "HEVC" : "H.264"}`}
          </span>
          {free != null && free >= 0 && (
            <span className={`bar-free ${lowDisk ? "low" : ""}`}>{formatBytes(free)} free</span>
          )}
        </div>

        <motion.button
          className={`bar-record ${shooting ? "shoot" : ""}`}
          onClick={() => actRef.current()}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.95 }}
          layout
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={shooting ? "capture" : "record"}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.14 }}
            >
              {shooting ? "Capture" : "Record"}
            </motion.span>
          </AnimatePresence>
          {settings.timer > 0 && (
            <span className="bar-timer">
              <IconTimer /> {settings.timer}s
            </span>
          )}
        </motion.button>
      </motion.div>
      </div>
    </div>
  );
}

/** Panels never grow past the top of the screen; beyond that they scroll. */
function panelMaxHeight() {
  return Math.max(240, window.screen.availHeight - 240);
}

function qualityLabel(q: Quality) {
  return q === "custom" ? "Custom" : PRESETS[q].label;
}

function hintFor(s: Settings, w: WindowInfo | null, r: Rect | null) {
  const verb = s.action === "screenshot" ? "capture" : "record";
  if (s.mode === "window") return w ? `${w.app} — ${w.title || "Window"}` : `Choose a window to ${verb}`;
  if (s.mode === "region") return r ? `${Math.round(r.width)} × ${Math.round(r.height)} · drag to adjust · ⏎ to ${verb}` : "Drag to select an area";
  return null;
}

function ModeButton(props: { active: boolean; record?: boolean; title: string; onClick: () => void; children: ReactNode }) {
  return (
    <motion.button
      className={`bar-mode ${props.active ? "active" : ""}`}
      title={props.title}
      onClick={props.onClick}
      whileTap={{ scale: 0.9 }}
    >
      {props.active && (
        <motion.span layoutId="mode-pill" className="mode-pill" transition={{ type: "spring", stiffness: 520, damping: 38 }} />
      )}
      <span className="mode-icon">{props.children}</span>
      {props.record && <span className="rec-badge" />}
    </motion.button>
  );
}

// ----------------------------------------------------------------- Options

function OptionsPanel(props: {
  sources: Sources | null;
  saveDir: string;
  onSaveDir: (dir: string) => void;
  onBubbleChange: () => void;
  onLibrary: () => void;
}) {
  const [settings, update] = useSettings();
  const { cameras } = useMediaDevices();
  const setBubble = (patch: Partial<Settings>) => {
    update(patch);
    props.onBubbleChange();
  };
  const [dirs, setDirs] = useState<{ label: string; path: string }[]>([]);

  useEffect(() => {
    void (async () => {
      const [desktop, documents, movies] = await Promise.all([desktopDir(), documentDir(), videoDir()]);
      const strip = (p: string) => p.replace(/\/$/, "");
      setDirs([
        { label: "Desktop", path: strip(desktop) },
        { label: "Documents", path: strip(documents) },
        { label: "Movies › Camly", path: `${strip(movies)}/Camly` },
      ]);
    })();
  }, []);

  const chooseOther = async () => {
    const dir = await openDialog({ directory: true, multiple: false, title: "Save recordings to" });
    if (typeof dir === "string") props.onSaveDir(dir);
  };

  const custom = !dirs.some((d) => d.path === props.saveDir);
  const displays = props.sources?.displays ?? [];
  const mics = props.sources?.microphones ?? [];

  return (
    <motion.div
      className="panel options"
      style={{ maxHeight: panelMaxHeight() }}
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
    >
      <div className="panel-fit">
        <div className="panel-grid three">
          <section>
            <h4>Save to</h4>
            {dirs.map((d) => (
              <MenuRow key={d.path} checked={props.saveDir === d.path} onClick={() => props.onSaveDir(d.path)}>
                {d.label}
              </MenuRow>
            ))}
            {custom && props.saveDir && (
              <MenuRow checked onClick={chooseOther}>{shortenHome(props.saveDir)}</MenuRow>
            )}
            <MenuRow onClick={chooseOther}>Other Location…</MenuRow>

            <h4>Timer</h4>
            <div className="seg-row">
              <Seg value={String(settings.timer) as "0" | "5" | "10"} options={[["0", "None"], ["5", "5 s"], ["10", "10 s"]]} onChange={(t) => update({ timer: Number(t) as 0 | 5 | 10 })} />
            </div>

            <h4>Options</h4>
            <MenuRow checked={settings.showCursor} onClick={() => update({ showCursor: !settings.showCursor })}>Show Mouse Pointer</MenuRow>
            <MenuRow checked={settings.showClicks} onClick={() => update({ showClicks: !settings.showClicks })}>Show Mouse Clicks</MenuRow>
            <MenuRow checked={settings.showPreview} onClick={() => update({ showPreview: !settings.showPreview })}>Floating Thumbnail</MenuRow>
          </section>

          <section>
            <h4>Microphone</h4>
            <MenuRow checked={settings.microphoneId === null} onClick={() => update({ microphoneId: null })}>None</MenuRow>
            <MenuRow checked={settings.microphoneId === ""} onClick={() => update({ microphoneId: "" })}>Default Microphone</MenuRow>
            {mics.map((m) => (
              <MenuRow key={m.id} checked={settings.microphoneId === m.id} onClick={() => update({ microphoneId: m.id })}>
                {m.name}
              </MenuRow>
            ))}
            <MenuRow checked={settings.noiseReduction} onClick={() => update({ noiseReduction: !settings.noiseReduction })}>
              Noise Reduction <span className="row-sub">softens background noise</span>
            </MenuRow>
            <MenuRow checked={settings.systemAudio} onClick={() => update({ systemAudio: !settings.systemAudio })}>
              System Audio{isWindows && <span className="row-sub">needs a loopback device</span>}
            </MenuRow>

            <h4>Face-cam Bubble</h4>
            <MenuRow checked={!settings.bubble} onClick={() => setBubble({ bubble: false })}>None</MenuRow>
            {(cameras.length ? cameras : [{ id: "", label: "Default Camera" }]).map((c) => (
              <MenuRow
                key={c.id || "default"}
                checked={settings.bubble && (settings.bubbleCameraId ?? "") === c.id}
                onClick={() => setBubble({ bubble: true, action: "record", bubbleCameraId: c.id || null })}
              >
                {c.label}
              </MenuRow>
            ))}
            <div className="seg-row">
              <Seg value={settings.bubbleSize} options={[["s", "S"], ["m", "M"], ["l", "L"]]} onChange={(bubbleSize) => setBubble({ bubbleSize })} />
              <Seg value={settings.bubbleShape} options={[["circle", "Circle"], ["rounded", "Rounded"]]} onChange={(bubbleShape) => setBubble({ bubbleShape })} />
            </div>
          </section>

          <section>
            <h4>Quality</h4>
            {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((q) => (
              <MenuRow key={q} checked={settings.quality === q} onClick={() => update({ quality: q })}>
                <span className="row-main">{PRESETS[q].label}</span>
                <span className="row-sub">
                  {PRESETS[q].detail} · ≤{Math.round(ceilingMBPerMinute({ ...settings, quality: q }))} MB/min
                </span>
              </MenuRow>
            ))}

            <h4>Format</h4>
            <div className="seg-row">
              <Seg value={settings.codec} options={[["hevc", "HEVC"], ["h264", "H.264"]]} onChange={(codec) => update({ codec })} />
              <Seg value={settings.container} options={[["mp4", "MP4"], ["mov", "MOV"]]} onChange={(container) => update({ container })} />
              <Seg value={String(settings.fps)} options={[["30", "30 fps"], ["60", "60 fps"]]} onChange={(fps) => update({ fps: fps === "60" ? 60 : 30 })} />
            </div>

            {displays.length > 1 && (
              <>
                <h4>Display</h4>
                {displays.map((d) => (
                  <MenuRow
                    key={d.id}
                    checked={(settings.displayId ?? displays.find((x) => x.isMain)?.id) === d.id}
                    onClick={() => update({ displayId: d.id })}
                  >
                    {d.name} <span className="row-sub">{d.pixelWidth}×{d.pixelHeight}</span>
                  </MenuRow>
                ))}
              </>
            )}

            <h4>Screenshot</h4>
            <div className="seg-row">
              <Seg
                value={settings.shotFormat}
                options={isMac ? [["png", "PNG"], ["jpg", "JPEG"], ["heic", "HEIC"]] : [["png", "PNG"], ["jpg", "JPEG"]]}
                onChange={(shotFormat) => update({ shotFormat })}
              />
            </div>
            <MenuRow checked={settings.copyShots} onClick={() => update({ copyShots: !settings.copyShots })}>Copy to Clipboard</MenuRow>
          </section>
        </div>
      </div>
      <div className="panel-footer split">
        <button onClick={props.onLibrary}>Library & Settings…</button>
        <span>{formatShortcut(settings.shortcut)} opens Camly · Esc closes</span>
      </div>
    </motion.div>
  );
}

function MenuRow(props: { checked?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className="menu-row" onClick={props.onClick}>
      <span className="menu-check">
        <AnimatePresence initial={false}>
          {props.checked && (
            <motion.span initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}>
              <IconCheck />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="menu-label">{props.children}</span>
    </button>
  );
}

function Seg<T extends string>(props: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {props.options.map(([v, label]) => (
        <button key={v} className={props.value === v ? "on" : ""} onClick={() => props.onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- Windows

function WindowsPanel(props: {
  windows: WindowInfo[];
  selected: WindowInfo | null;
  verb: string;
  onSelect: (w: WindowInfo) => void;
  onAct: (w: WindowInfo) => void;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, WindowInfo[]>();
    for (const w of props.windows) {
      if (q && !`${w.app} ${w.title}`.toLowerCase().includes(q)) continue;
      map.set(w.app, [...(map.get(w.app) ?? []), w]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [props.windows, query]);

  return (
    <motion.div
      className="panel windows"
      style={{ maxHeight: panelMaxHeight() }}
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
    >
      <div className="panel-head">
        <input autoFocus placeholder="Search windows" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button onClick={props.onRefresh}>Refresh</button>
      </div>
      <div className="panel-scroll">
        {groups.length === 0 && <p className="empty">No windows found.</p>}
        {groups.map(([app, list]) => (
          <section key={app} className="win-group">
            <h4>{app}</h4>
            {list.map((w) => (
              <button
                key={w.id}
                className={`win-row ${props.selected?.id === w.id ? "on" : ""}`}
                onClick={() => props.onSelect(w)}
                onDoubleClick={() => props.onAct(w)}
              >
                <span className="win-title">{w.title || "Untitled window"}</span>
                <span className="row-sub">{w.width}×{w.height}</span>
              </button>
            ))}
          </section>
        ))}
      </div>
      <div className="panel-footer static">Click to select · double-click to {props.verb}</div>
    </motion.div>
  );
}
