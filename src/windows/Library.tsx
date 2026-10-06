import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "motion/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  api, compressOptions, isImage, saveDirOf,
  type CompressEvent, type Permissions, type PermissionState, type Recording, type RecorderEvent, type Sources,
} from "../lib/api";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ceilingMBPerMinute, loadSettings, PRESETS, useSettings, type Quality } from "../lib/settings";
import { fileName, formatBytes, formatClock, formatDate, shortenHome } from "../lib/format";
import { acceleratorFromEvent, formatShortcut, useShortcutLabel } from "../lib/shortcut";
import { fileManager, isMac, isWindows, trashName } from "../lib/platform";
import { Logo } from "../components/Logo";
import {
  IconCamera, IconCompress, IconDisk, IconFilm, IconFolder, IconGear, IconImage, IconKeyboard, IconMic,
  IconCheck, IconPlay, IconRecord, IconShield, IconSliders, IconTrash,
} from "../components/Icons";

type Filter = "all" | "videos" | "screenshots" | "camera";
type Tab = Filter | "compress" | "settings";

const FILTER_TITLES: Record<Filter, string> = { all: "All Captures", videos: "Recordings", screenshots: "Screenshots", camera: "Camera" };

function matches(r: Recording, f: Filter) {
  if (f === "all") return true;
  if (f === "screenshots") return r.name.startsWith("Camly Screenshot");
  if (f === "camera") return r.name.startsWith("Camly Photo") || r.name.startsWith("Camly Camera");
  return !isImage(r.path) && !r.name.startsWith("Camly Camera");
}

export default function Library() {
  const [tab, setTab] = useState<Tab>("all");
  const [settings] = useSettings();
  const [saveDir, setSaveDir] = useState("");
  const [sources, setSources] = useState<Sources | null>(null);
  const [items, setItems] = useState<Recording[]>([]);
  const shortcutLabel = useShortcutLabel();

  const refreshSources = useCallback(async () => {
    const dir = await saveDirOf(settings);
    setSaveDir(dir);
    try {
      setSources(await api.listSources(dir));
    } catch {
      /* helper missing — Settings shows the hint */
    }
  }, [settings.saveDir]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadItems = useCallback(async () => {
    if (saveDir) setItems(await api.listRecordings(saveDir));
  }, [saveDir]);

  useEffect(() => {
    void refreshSources();
    const off = listen<string>("library://tab", (e) => {
      setTab(e.payload === "recordings" ? "all" : (e.payload as Tab));
      void refreshSources();
    });
    return () => void off.then((f) => f());
  }, [refreshSources]);

  useEffect(() => {
    void loadItems();
    const offs = [
      listen<RecorderEvent>("recorder", (e) => {
        if (e.payload.event === "stopped" || e.payload.event === "idle") void loadItems();
      }),
      listen("capture", () => void loadItems()),
    ];
    const onFocus = () => void loadItems();
    window.addEventListener("focus", onFocus);
    return () => {
      offs.forEach((p) => void p.then((f) => f()));
      window.removeEventListener("focus", onFocus);
    };
  }, [loadItems]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, videos: 0, screenshots: 0, camera: 0 };
    for (const r of items) for (const f of Object.keys(c) as Filter[]) if (matches(r, f)) c[f]++;
    return c;
  }, [items]);

  const free = sources?.freeBytes ?? -1;
  const used = items.reduce((s, r) => s + r.bytes, 0);
  const [onboarding, setOnboarding] = useState(() => isMac && !loadSettings().onboarded);

  useEffect(() => {
    if (!onboarding) return;
    const win = getCurrentWindow();
    void win.show().then(() => win.setFocus());
  }, [onboarding]);

  if (onboarding) {
    return <Onboarding onDone={() => setOnboarding(false)} />;
  }

  return (
    <div className="lib">
      <aside className="lib-side">
        <div className="lib-drag" data-tauri-drag-region />
        <div className="lib-brand">
          <Logo size={30} />
          <div>
            <strong>Camly</strong>
            <span>{shortcutLabel} anywhere</span>
          </div>
        </div>

        <div className="side-actions">
          <motion.button whileTap={{ scale: 0.96 }} className="new-rec" onClick={() => void api.openToolbar()}>
            <IconRecord width={16} height={16} /> New Capture
          </motion.button>
          <motion.button whileTap={{ scale: 0.96 }} className="new-cam" title="Camera" onClick={() => void api.showCamera()}>
            <IconCamera width={17} height={17} />
          </motion.button>
        </div>

        <div className="side-label">Library</div>
        <NavItem active={tab === "all"} onClick={() => setTab("all")} icon={<IconFilm width={16} height={16} />} count={counts.all}>All Captures</NavItem>
        <NavItem active={tab === "videos"} onClick={() => setTab("videos")} icon={<IconRecord width={16} height={16} />} count={counts.videos}>Recordings</NavItem>
        <NavItem active={tab === "screenshots"} onClick={() => setTab("screenshots")} icon={<IconImage width={16} height={16} />} count={counts.screenshots}>Screenshots</NavItem>
        <NavItem active={tab === "camera"} onClick={() => setTab("camera")} icon={<IconCamera width={16} height={16} />} count={counts.camera}>Camera</NavItem>

        <div className="side-label">Tools</div>
        <NavItem active={tab === "compress"} onClick={() => setTab("compress")} icon={<IconCompress width={16} height={16} />}>Compress</NavItem>
        <NavItem active={tab === "settings"} onClick={() => setTab("settings")} icon={<IconGear width={16} height={16} />}>Settings</NavItem>

        <div className="lib-side-foot">
          {free >= 0 && (
            <div className="disk">
              <div className="disk-row">
                <IconDisk width={14} height={14} />
                <span>{formatBytes(free)} free</span>
                <em>{formatBytes(used)} used by Camly</em>
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="lib-main">
        <div className="lib-drag" data-tauri-drag-region />
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {tab === "compress" ? (
              <Compress />
            ) : tab === "settings" ? (
              <SettingsView sources={sources} saveDir={saveDir} onRefresh={() => void refreshSources()} />
            ) : (
              <Gallery filter={tab} items={items.filter((r) => matches(r, tab))} dir={saveDir} onChanged={() => void loadItems()} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function NavItem(props: { active: boolean; onClick: () => void; icon: ReactNode; count?: number; children: ReactNode }) {
  return (
    <button className={`nav ${props.active ? "on" : ""}`} onClick={props.onClick}>
      {props.active && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
      <span className="nav-icon">{props.icon}</span>
      <span className="nav-label">{props.children}</span>
      {props.count != null && props.count > 0 && <span className="nav-count">{props.count}</span>}
    </button>
  );
}

// ------------------------------------------------------------- Gallery

function Gallery({ filter, items, dir, onChanged }: { filter: Filter; items: Recording[]; dir: string; onChanged: () => void }) {
  const total = items.reduce((sum, r) => sum + r.bytes, 0);
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{FILTER_TITLES[filter]}</h1>
          <p className="muted">
            {items.length} {items.length === 1 ? "item" : "items"} · {formatBytes(total)} ·{" "}
            <button className="link" onClick={() => void api.open(dir)}>{shortenHome(dir)}</button>
          </p>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="empty-state">
          <Logo size={64} />
          <h3>Nothing here yet</h3>
          <p>Press {formatShortcut(loadShortcut())} for screenshots and recordings, or open the Camera. Everything is saved compact by default.</p>
          <button className="primary" onClick={() => void api.openToolbar()}>New Capture</button>
        </div>
      ) : (
        <motion.div className="grid" layout>
          <AnimatePresence mode="popLayout">
            {items.map((r, i) => (
              <RecordingCard key={r.path} index={i} item={r} onChanged={onChanged} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}

function RecordingCard({ item, index, onChanged }: { item: Recording; index: number; onChanged: () => void }) {
  const [duration, setDuration] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const image = isImage(item.path);

  return (
    <motion.div
      className="rec"
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { delay: Math.min(index, 12) * 0.035 } }}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.15 } }}
      whileHover={{ y: -3 }}
    >
      <button className="rec-thumb" onClick={() => void api.open(item.path)} title="Open">
        {image ? (
          <img src={convertFileSrc(item.path)} alt="" loading="lazy" draggable={false} />
        ) : (
          <video
            src={convertFileSrc(item.path)}
            muted
            preload="metadata"
            playsInline
            onLoadedMetadata={(e) => {
              setDuration(e.currentTarget.duration);
              // Paint a real first frame instead of black.
              e.currentTarget.currentTime = Math.min(0.15, (e.currentTarget.duration || 1) / 2);
            }}
            onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
            onMouseLeave={(e) => {
              e.currentTarget.pause();
              e.currentTarget.currentTime = 0.15;
            }}
          />
        )}
        {!image && <span className="rec-play"><IconPlay width={20} height={20} /></span>}
        {duration != null && Number.isFinite(duration) && <span className="rec-duration">{formatClock(duration)}</span>}
      </button>
      <div className="rec-body">
        <div className="rec-name" title={item.name}>{item.name.replace(/^Camly /, "").replace(/\.(mp4|mov|m4v|png|jpe?g|heic)$/i, "")}</div>
        <div className="rec-meta">
          {formatDate(item.modified)} · <strong>{formatBytes(item.bytes)}</strong>
          {duration ? ` · ${formatBytes((item.bytes / duration) * 60)}/min` : ""}
        </div>
        <div className="rec-actions">
          <button onClick={() => void api.reveal(item.path)} title={`Show in ${fileManager}`}><IconFolder width={15} height={15} /></button>
          <button
            title={`Move to ${trashName}`}
            className="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.trash(item.path);
              } finally {
                setBusy(false);
                onChanged();
              }
            }}
          >
            <IconTrash width={15} height={15} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ------------------------------------------------------------- Compress

type Job = {
  id: string;
  input: string;
  output?: string;
  progress: number;
  status: "running" | "done" | "error";
  inputBytes?: number;
  outputBytes?: number;
  error?: string;
};

function Compress() {
  const [settings, update] = useSettings();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dragging, setDragging] = useState(false);

  const patch = (id: string, p: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j)));

  const start = useCallback(
    async (paths: string[]) => {
      const videos = paths.filter((p) => /\.(mov|mp4|m4v|webm|mkv)$/i.test(p));
      for (const input of videos) {
        const id = crypto.randomUUID();
        setJobs((js) => [{ id, input, progress: 0, status: "running" }, ...js]);
        try {
          const output = await api.compress(id, input, compressOptions(settings));
          patch(id, { output });
        } catch (e) {
          patch(id, { status: "error", error: String(e) });
        }
      }
    },
    [settings],
  );

  useEffect(() => {
    const off = listen<CompressEvent>("compress", (e) => {
      const ev = e.payload;
      if (ev.event === "progress") patch(ev.id, { progress: ev.progress });
      if (ev.event === "done")
        patch(ev.id, { status: "done", progress: 1, output: ev.output, inputBytes: ev.inputBytes, outputBytes: ev.outputBytes });
      if (ev.event === "error") patch(ev.id, { status: "error", error: ev.message });
    });
    const offDrop = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "over" || e.payload.type === "enter") setDragging(true);
      else if (e.payload.type === "leave") setDragging(false);
      else if (e.payload.type === "drop") {
        setDragging(false);
        void start(e.payload.paths);
      }
    });
    return () => {
      void off.then((f) => f());
      void offDrop.then((f) => f());
    };
  }, [start]);

  const choose = async () => {
    const picked = await openDialog({
      multiple: true,
      title: "Choose videos to compress",
      filters: [{ name: "Video", extensions: isMac ? ["mov", "mp4", "m4v"] : ["mov", "mp4", "m4v", "webm", "mkv"] }],
    });
    if (Array.isArray(picked)) void start(picked);
    else if (typeof picked === "string") void start([picked]);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Compress</h1>
          <p className="muted">Shrink any video — system screen recordings, phone clips, OBS — with the same settings as Camly.</p>
        </div>
      </header>

      <motion.button
        className={`drop ${dragging ? "over" : ""}`}
        onClick={() => void choose()}
        animate={{ scale: dragging ? 1.015 : 1 }}
        whileHover={{ scale: 1.005 }}
      >
        <span className="drop-icon"><IconCompress width={30} height={30} /></span>
        <strong>Drop videos here</strong>
        <span>or click to choose · saved next to the original as “(compact).mp4”</span>
      </motion.button>

      <div className="settings-card compact">
        <Row title="Quality">
          <select value={settings.quality === "retina" ? "compact" : settings.quality} onChange={(e) => update({ quality: e.target.value as Quality })}>
            <option value="compact">Compact · 1080p</option>
            <option value="balanced">Balanced · 1440p</option>
            <option value="custom">Custom ({settings.customHeight}p · {settings.customMbps} Mbps)</option>
          </select>
        </Row>
        <Row title="Codec">
          <select value={settings.codec} onChange={(e) => update({ codec: e.target.value as "hevc" | "h264" })}>
            <option value="hevc">HEVC — smallest</option>
            <option value="h264">H.264 — plays everywhere</option>
          </select>
        </Row>
      </div>

      <div className="jobs">
        {jobs.map((j) => (
          <motion.div key={j.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={`job ${j.status}`}>
            <div className="job-top">
              <span className="job-name" title={j.input}>{fileName(j.input)}</span>
              {j.status === "done" && j.inputBytes != null && j.outputBytes != null && (
                <span className="job-saving">
                  {formatBytes(j.inputBytes)} → <strong>{formatBytes(j.outputBytes)}</strong>
                  {j.inputBytes > 0 && ` · −${Math.max(0, Math.round((1 - j.outputBytes / j.inputBytes) * 100))}%`}
                </span>
              )}
              {j.status === "running" && <span className="muted">{Math.round(j.progress * 100)}%</span>}
            </div>
            <div className="bar-track">
              <motion.div className="bar-fill" animate={{ width: `${Math.round(j.progress * 100)}%` }} transition={{ type: "spring", stiffness: 120, damping: 24 }} />
            </div>
            {j.status === "error" && <div className="job-error">{j.error}</div>}
            {j.status === "done" && j.output && (
              <div className="job-actions">
                <button onClick={() => void api.open(j.output!)}>Open</button>
                <button onClick={() => void api.reveal(j.output!)}>Show in {fileManager}</button>
                <button className="danger" onClick={() => void api.trash(j.input)}>
                  Move original to {trashName}
                </button>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Settings

type Pane = "video" | "audio" | "capture" | "storage" | "keyboard" | "permissions";
const PANES: [Pane, string, ReactNode, string][] = [
  ["video", "Video", <IconSliders key="v" />, "blue"],
  ["audio", "Audio", <IconMic key="a" />, "green"],
  ["capture", "Capture", <IconRecord key="c" />, "red"],
  ["storage", "Storage", <IconFolder key="s" />, "orange"],
  ["keyboard", "Keyboard", <IconKeyboard key="k" />, "purple"],
  ["permissions", "Permissions", <IconShield key="p" />, "gray"],
];

function SettingsView({ sources, saveDir, onRefresh }: { sources: Sources | null; saveDir: string; onRefresh: () => void }) {
  const [s, update] = useSettings();
  const [pane, setPane] = useState<Pane>("video");
  const main = sources?.displays.find((d) => d.isMain);
  const nativeW = main?.pixelWidth ?? 3024;
  const nativeH = main?.pixelHeight ?? 1964;
  const freeMin = useMemo(() => {
    const free = sources?.freeBytes ?? -1;
    const mbMin = ceilingMBPerMinute(s, nativeW, nativeH);
    return free > 0 ? Math.floor(free / 1_000_000 / mbMin) : null;
  }, [sources, s, nativeW, nativeH]);

  const chooseDir = async () => {
    const dir = await openDialog({ directory: true, multiple: false, title: "Save captures to" });
    if (typeof dir === "string") {
      update({ saveDir: dir });
      onRefresh();
    }
  };

  return (
    <div className="page settings">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Tuned for tiny files with crisp text. Changes apply instantly to every window.</p>
        </div>
      </header>

      <nav className="panes">
        {PANES.map(([key, label, icon, tint]) => (
          <button key={key} className={`pane-tab ${pane === key ? "on" : ""}`} onClick={() => setPane(key)}>
            {pane === key && <motion.span layoutId="pane-pill" className="pane-pill" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span className={`pane-icon ${tint}`}>{icon}</span>
            <span className="pane-label">{label}</span>
          </button>
        ))}
      </nav>

      <AnimatePresence mode="wait">
      <motion.div
        key={pane}
        className="pane-body"
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -12 }}
        transition={{ duration: 0.16 }}
      >

      {pane === "video" && (
      <Section icon={<IconSliders />} title="Video quality" tint="blue">
        <div className="quality-cards">
          {(["compact", "balanced", "retina", "custom"] as Quality[]).map((q) => (
            <motion.button
              key={q}
              whileTap={{ scale: 0.97 }}
              className={`qcard ${s.quality === q ? "on" : ""}`}
              onClick={() => update({ quality: q })}
            >
              {s.quality === q && <motion.span layoutId="qcard-ring" className="qcard-ring" />}
              <strong>{q === "custom" ? "Custom" : PRESETS[q].label}</strong>
              <span>{q === "custom" ? "Your resolution & bitrate" : PRESETS[q].detail}</span>
              <em>≤ {Math.round(ceilingMBPerMinute({ ...s, quality: q }, nativeW, nativeH))} MB/min</em>
              {q === "compact" && <i className="badge">Default</i>}
            </motion.button>
          ))}
        </div>
        {freeMin != null && <p className="section-note">Free space holds at least ~{formatMinutes(freeMin)} at this quality — usually far more.</p>}
        <div className="settings-card">
          {s.quality === "custom" && (
            <>
              <Row title="Max resolution">
                <select value={s.customHeight} onChange={(e) => update({ customHeight: Number(e.target.value) })}>
                  <option value={720}>720p</option>
                  <option value={1080}>1080p</option>
                  <option value={1440}>1440p</option>
                  <option value={2160}>2160p (4K)</option>
                  <option value={0}>Native</option>
                </select>
              </Row>
              <Row title="Bitrate" detail={`${s.customMbps} Mbps`}>
                <input type="range" min={1} max={30} step={0.5} value={s.customMbps} onChange={(e) => update({ customMbps: Number(e.target.value) })} />
              </Row>
            </>
          )}
          <Row title="Codec" detail={s.codec === "hevc" ? "About half the size of H.264" : "Plays on every device"}>
            <Segmented value={s.codec} options={[["hevc", "HEVC"], ["h264", "H.264"]]} onChange={(codec) => update({ codec })} />
          </Row>
          <Row title="Format" detail={s.container === "mp4" ? "Share anywhere" : "QuickTime & Final Cut"}>
            <Segmented value={s.container} options={[["mp4", "MP4"], ["mov", "MOV"]]} onChange={(container) => update({ container })} />
          </Row>
          <Row title="Frame rate" detail={s.fps === 30 ? "Ideal for screens & tutorials" : "Smooth motion, larger files"}>
            <Segmented value={String(s.fps) as "30" | "60"} options={[["30", "30 fps"], ["60", "60 fps"]]} onChange={(v) => update({ fps: v === "60" ? 60 : 30 })} />
          </Row>
        </div>
      </Section>
      )}

      {pane === "audio" && (
      <Section icon={<IconMic />} title="Audio" tint="green">
        <div className="settings-card">
          <Row title="Microphone">
            <select
              value={s.microphoneId === null ? "__none" : s.microphoneId}
              onChange={(e) => update({ microphoneId: e.target.value === "__none" ? null : e.target.value })}
            >
              <option value="__none">None</option>
              <option value="">Default microphone</option>
              {(sources?.microphones ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.name}{m.isDefault ? " (default)" : ""}</option>
              ))}
            </select>
          </Row>
          <Row title="Noise reduction" detail="Softens background hum and noise between words">
            <Switch checked={s.noiseReduction} onChange={(v) => update({ noiseReduction: v })} />
          </Row>
          <Row title="System audio" detail={isWindows ? "Needs a loopback device on Windows" : "Sound from apps and videos"}>
            <Switch checked={s.systemAudio} onChange={(v) => update({ systemAudio: v })} />
          </Row>
        </div>
        {sources?.microphonePermission === "denied" && (
          <p className="section-note warn">Microphone access is off. <button className="link" onClick={() => void api.privacy("microphone")}>Open settings</button></p>
        )}
      </Section>
      )}

      {pane === "capture" && (
      <Section icon={<IconRecord />} title="Capture" tint="red">
        <div className="settings-card">
          <Row title="Show mouse pointer">
            <Switch checked={s.showCursor} onChange={(v) => update({ showCursor: v })} />
          </Row>
          <Row title="Highlight clicks" detail={isMac ? undefined : "macOS only"}>
            <Switch checked={s.showClicks} onChange={(v) => update({ showClicks: v })} />
          </Row>
          <Row title="Keep in menu bar when closed" detail="✕ hides Camly so the shortcut keeps working; off = ✕ quits">
            <Switch checked={s.keepRunning} onChange={(v) => update({ keepRunning: v })} />
          </Row>
          <Row title="Floating thumbnail" detail="Shows each capture in the corner for 6 seconds">
            <Switch checked={s.showPreview} onChange={(v) => update({ showPreview: v })} />
          </Row>
          <Row title="Countdown">
            <Segmented value={String(s.timer) as "0" | "5" | "10"} options={[["0", "Off"], ["5", "5 s"], ["10", "10 s"]]} onChange={(v) => update({ timer: Number(v) as 0 | 5 | 10 })} />
          </Row>
          <Row title="Screenshot format">
            <Segmented
              value={s.shotFormat}
              options={isMac ? [["png", "PNG"], ["jpg", "JPEG"], ["heic", "HEIC"]] : [["png", "PNG"], ["jpg", "JPEG"]]}
              onChange={(shotFormat) => update({ shotFormat })}
            />
          </Row>
          <Row title="Copy screenshots to clipboard">
            <Switch checked={s.copyShots} onChange={(v) => update({ copyShots: v })} />
          </Row>
        </div>
      </Section>
      )}

      {pane === "storage" && (
      <Section icon={<IconFolder />} title="Storage" tint="orange">
        <div className="settings-card">
          <Row title="Save to" detail={shortenHome(saveDir)}>
            <div className="row-buttons">
              <button onClick={() => void chooseDir()}>Change…</button>
              <button onClick={() => void api.open(saveDir)}>Open</button>
              {s.saveDir && <button onClick={() => { update({ saveDir: "" }); onRefresh(); }}>Reset</button>}
            </div>
          </Row>
          <Row title="Disk guard" detail={`Stop & save safely below ${s.minFreeGB} GB free`}>
            <input type="range" min={0.5} max={10} step={0.5} value={s.minFreeGB} onChange={(e) => update({ minFreeGB: Number(e.target.value) })} />
          </Row>
        </div>
      </Section>
      )}

      {pane === "keyboard" && (
      <Section icon={<IconKeyboard />} title="Keyboard" tint="purple">
        <div className="settings-card">
          <Row title="Capture shortcut" detail="Opens the toolbar anywhere · stops a recording">
            <ShortcutField value={s.shortcut} onChange={(shortcut) => update({ shortcut })} />
          </Row>
          <Row title="Start" detail="From the toolbar or a selection"><kbd>⏎</kbd></Row>
          <Row title="Close toolbar"><kbd>Esc</kbd></Row>
        </div>
      </Section>
      )}

      {pane === "permissions" && (
      <Section icon={<IconShield />} title="Permissions" tint="gray">
        <PermissionList />
        {sources?.error && <p className="section-note warn">{sources.error}</p>}
      </Section>
      )}
      </motion.div>
      </AnimatePresence>
    </div>
  );
}

function loadShortcut(): string | null {
  try {
    return JSON.parse(localStorage.getItem("camly.settings.v2") ?? "{}").shortcut ?? null;
  } catch {
    return null;
  }
}

/** Click, then press the new combination (e.g. ⌘⇧2). Esc cancels. */
function ShortcutField({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === "Escape") return setListening(false);
      const acc = acceleratorFromEvent(e);
      if (acc) {
        onChange(acc);
        setListening(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, onChange]);

  return (
    <div className="shortcut-row">
      {value && !listening && <button className="link" onClick={() => onChange(null)}>Reset</button>}
      <button className={`shortcut-field ${listening ? "listening" : ""}`} onClick={() => setListening(true)}>
        {listening ? "Press keys…" : formatShortcut(value)}
      </button>
    </div>
  );
}

function formatMinutes(min: number) {
  return min >= 120 ? `${Math.floor(min / 60)} hours` : `${min} min`;
}

function Section(props: { icon: ReactNode; title: string; tint: string; children: ReactNode }) {
  return (
    <section className="section">
      <h2>
        <span className={`section-icon ${props.tint}`}>{props.icon}</span>
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

function Row(props: { title: string; detail?: string; children: ReactNode }) {
  return (
    <div className="row">
      <div className="row-text">
        <span className="row-title">{props.title}</span>
        {props.detail && <span className="row-detail">{props.detail}</span>}
      </div>
      <div className="row-control">{props.children}</div>
    </div>
  );
}

function Switch(props: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={props.checked}
      className={`switch ${props.checked ? "on" : ""}`}
      onClick={() => props.onChange(!props.checked)}
    >
      <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 35 }} />
    </button>
  );
}

function Segmented<T extends string>(props: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  const id = useMemo(() => Math.random().toString(36).slice(2), []);
  return (
    <div className="segmented">
      {props.options.map(([v, label]) => (
        <button key={v} className={props.value === v ? "on" : ""} onClick={() => props.onChange(v)}>
          {props.value === v && <motion.span layoutId={`seg-${id}`} className="segmented-pill" transition={{ type: "spring", stiffness: 520, damping: 38 }} />}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------- Permissions

const PERMISSIONS: { key: keyof Permissions; title: string; detail: string; optional?: boolean }[] = [
  { key: "screen", title: "Screen Recording", detail: "Needed for screenshots and screen recording. If macOS opens System Settings, switch Camly on." },
  { key: "microphone", title: "Microphone", detail: "Records your voice with screen recordings and camera videos.", optional: true },
  { key: "camera", title: "Camera", detail: "Photos, webcam videos and the face-cam bubble.", optional: true },
];

/** Live permission status (polled), with Grant buttons that trigger the real macOS prompts. */
function usePermissions() {
  const [perms, setPerms] = useState<Permissions | null>(null);
  const refresh = useCallback(async () => {
    try {
      setPerms(await api.permissions());
    } catch {
      /* helper missing */
    }
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 1500);
    return () => clearInterval(t);
  }, [refresh]);

  const grant = async (key: keyof Permissions) => {
    const before = perms?.[key];
    // Denied once: macOS never asks again — only System Settings can change it.
    if (before === "denied") {
      void api.privacy(key);
      return;
    }
    if (key === "screen") {
      const after = await api.permissions("screen");
      setPerms(after);
      if (after.screen !== "granted") void api.privacy("screen");
      return;
    }
    // Ask from the app's own process (WebKit) so macOS shows its prompt for Camly itself.
    try {
      const stream = await navigator.mediaDevices.getUserMedia(key === "camera" ? { video: true } : { audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      // Fall back to the native helper, then System Settings.
      const after = await api.permissions(key).catch(() => null);
      if (after) setPerms(after);
      if (!after || after[key] !== "granted") void api.privacy(key);
    }
    void refresh();
  };
  return { perms, grant };
}


function PermissionButton({ state, onGrant }: { state: PermissionState | undefined; onGrant: () => void }) {
  if (state === "granted") {
    return (
      <motion.span className="perm-granted" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
        <IconCheck /> Granted
      </motion.span>
    );
  }
  return (
    <motion.button whileTap={{ scale: 0.95 }} className="perm-grant" onClick={onGrant}>
      {state === "denied" ? "Open Settings" : "Grant"}
    </motion.button>
  );
}

function PermissionList() {
  const { perms, grant } = usePermissions();
  return (
    <div className="settings-card">
      {PERMISSIONS.map((p) => (
        <Row key={p.key} title={p.title} detail={p.detail}>
          <PermissionButton state={perms?.[p.key]} onGrant={() => void grant(p.key)} />
        </Row>
      ))}
    </div>
  );
}

function Onboarding({ onDone }: { onDone: () => void }) {
  const [, update] = useSettings();
  const { perms, grant } = usePermissions();
  const screenOk = perms?.screen === "granted";

  const finish = () => {
    update({ onboarded: true });
    onDone();
    void getCurrentWindow().hide();
    void api.openToolbar();
  };

  return (
    <div className="onboard">
      <div className="onboard-drag" data-tauri-drag-region />
      <motion.div className="onboard-body" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}>
        <motion.div initial={{ scale: 0.6, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}>
          <Logo size={72} />
        </motion.div>
        <h1>Welcome to Camly</h1>
        <p className="onboard-sub">Camly needs a few permissions to capture your screen, voice and camera. Everything stays on your Mac.</p>

        <div className="onboard-list">
          {PERMISSIONS.map((p, i) => (
            <motion.div
              key={p.key}
              className={`onboard-item ${perms?.[p.key] === "granted" ? "ok" : ""}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.08 * i + 0.15 } }}
            >
              <div className="onboard-text">
                <strong>
                  {p.title}
                  {p.optional && <span className="optional">Optional</span>}
                </strong>
                <span>{p.detail}</span>
              </div>
              <PermissionButton state={perms?.[p.key]} onGrant={() => void grant(p.key)} />
            </motion.div>
          ))}
        </div>

        <div className="onboard-foot">
          <span className="muted small">Press {formatShortcut(loadShortcut())} anytime to capture.</span>
          <motion.button whileTap={{ scale: 0.96 }} whileHover={{ scale: 1.02 }} className="onboard-continue" onClick={finish}>
            {screenOk ? "Continue" : "Skip for now"} →
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}

