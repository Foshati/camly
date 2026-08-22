import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { animate, AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import { api, isImage, type CameraMedia, type Shot } from "../lib/api";
import { loadSettings } from "../lib/settings";
import { fileManager } from "../lib/platform";
import { fileName, formatBytes, formatClock } from "../lib/format";
import { IconClose, IconFolder, IconPlay, IconTrash, IconWarning } from "../components/Icons";

type Stopped = { event: "stopped"; path: string; seconds: number; bytes: number; width: number; height: number; reason: string };
type Payload = Stopped | Shot | CameraMedia | { event: "error"; message: string; code?: string };

const VISIBLE_MS = 6000;
const ERROR_VISIBLE_MS = 12000;

/**
 * Floating thumbnail after a capture (like macOS screenshots).
 * Unfocused windows get no hover events on macOS, so dismissal is explicit:
 * ✕, swipe right, or a 6-second countdown that restarts while the pointer moves over it.
 */
export default function Preview() {
  const [data, setData] = useState<Payload | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const x = useMotionValue(0);
  const fade = useTransform(x, [0, 220], [1, 0]);
  const lastPayload = useRef<Payload | null>(null);

  const hide = useCallback(() => {
    lastPayload.current = null;
    setData(null);
    // Let the exit animation play before the window disappears.
    setTimeout(() => {
      if (!lastPayload.current) void getCurrentWindow().hide();
    }, 260);
  }, []);

  const keepAlive = useCallback(() => {
    const ms = lastPayload.current?.event === "error" ? ERROR_VISIBLE_MS : VISIBLE_MS;
    setDeadline(Date.now() + ms);
  }, []);

  useEffect(() => {
    const off = listen<Payload>("preview://show", (e) => {
      if (e.payload.event !== "error" && !loadSettings().showPreview) {
        void getCurrentWindow().hide();
        return;
      }
      lastPayload.current = e.payload;
      x.set(0);
      setData(e.payload);
      setDeadline(Date.now() + (e.payload.event === "error" ? ERROR_VISIBLE_MS : VISIBLE_MS));
    });
    return () => void off.then((f) => f());
  }, [x]);

  useEffect(() => {
    if (!data) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= deadline) hide();
    }, 100);
    return () => clearInterval(t);
  }, [data, deadline, hide]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hide]);

  const total = data?.event === "error" ? ERROR_VISIBLE_MS : VISIBLE_MS;
  const left = Math.max(0, Math.min(1, (deadline - now) / total));

  return (
    <div className="preview-root" onPointerMove={keepAlive} onPointerDown={keepAlive}>
      <AnimatePresence>
        {data && (
          <motion.div
            key={data.event === "error" ? `error-${data.message}` : data.path}
            className={`card ${data.event === "error" ? "error" : ""}`}
            style={{ x, opacity: fade }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.05, right: 0.9 }}
            onDragEnd={(_, info) => {
              if (info.offset.x > 90 || info.velocity.x > 600) {
                void animate(x, 400, { duration: 0.18 }).then(hide);
              }
            }}
            initial={{ x: 380, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 380, opacity: 0, transition: { duration: 0.22 } }}
            transition={{ type: "spring", stiffness: 340, damping: 30 }}
          >
            <button className="card-x" title="Close (Esc)" onClick={hide} onPointerDown={(e) => e.stopPropagation()}>
              <IconClose width={11} height={11} />
            </button>
            {data.event === "error" ? <ErrorBody data={data} /> : <MediaBody data={data} onDone={hide} />}
            <div className="card-timer"><span style={{ transform: `scaleX(${left})` }} /></div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ErrorBody({ data }: { data: { message: string; code?: string } }) {
  const permission = data.code === "permission" || /permission/i.test(data.message);
  return (
    <div className="error-body">
      <IconWarning width={26} height={26} />
      <p>{data.message}</p>
      {permission && <button className="pill" onClick={() => void api.privacy("screen")}>Open Privacy Settings</button>}
    </div>
  );
}

function MediaBody({ data, onDone }: { data: Stopped | Shot | CameraMedia; onDone: () => void }) {
  const image = isImage(data.path);
  const seconds = data.event === "shot" ? undefined : data.seconds;
  const copied = data.event === "shot" && data.copied;
  const lowDisk = data.event === "stopped" && data.reason === "lowDisk";
  const kind = data.event === "shot" ? "Screenshot" : data.event === "camera" ? (data.kind === "photo" ? "Photo" : "Camera video") : "Recording";

  return (
    <>
      <button className="card-thumb" onClick={() => void api.open(data.path)} title="Open">
        {image ? (
          <img src={convertFileSrc(data.path)} alt="" draggable={false} />
        ) : (
          <video
            src={convertFileSrc(data.path)}
            muted
            playsInline
            preload="auto"
            // WebKit paints nothing until a frame is decoded: nudge past 0 to get a poster.
            onLoadedMetadata={(e) => {
              e.currentTarget.currentTime = Math.min(0.15, (e.currentTarget.duration || 1) / 2);
            }}
          />
        )}
        {!image && <span className="card-play"><IconPlay width={20} height={20} /></span>}
        {seconds != null && <span className="card-duration">{formatClock(seconds)}</span>}
        <span className="card-kind">{kind} saved</span>
        {copied && <span className="card-badge">Copied</span>}
      </button>
      <div className="card-info">
        <div className="card-name" title={data.path}>{fileName(data.path)}</div>
        <div className="card-meta">
          {formatBytes(data.bytes)} · {data.width}×{data.height}
          {lowDisk && <span className="card-warn"> · stopped: disk almost full</span>}
        </div>
      </div>
      <div className="card-actions">
        <button onClick={() => void api.open(data.path)}>Open</button>
        <button onClick={() => void api.reveal(data.path)}><IconFolder width={14} height={14} /> {fileManager}</button>
        <button onClick={() => void api.showLibrary("recordings")}>Library</button>
        <button
          className="danger"
          title="Delete"
          onClick={async () => {
            await api.trash(data.path);
            onDone();
          }}
        >
          <IconTrash width={14} height={14} />
        </button>
      </div>
    </>
  );
}
