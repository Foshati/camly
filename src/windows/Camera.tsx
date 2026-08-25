import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";
import { api, compressOptions, saveDirOf, type CameraMedia, type CompressEvent } from "../lib/api";
import { pickRecorderMime, useCameraStream, useMediaDevices } from "../lib/camera";
import { cameraBitrate, useSettings } from "../lib/settings";
import { isMac } from "../lib/platform";
import { formatBytes, formatClock } from "../lib/format";
import { IconFlip, IconGrid, IconPause, IconPlay, IconTimer, IconWarning } from "../components/Icons";

type Mode = "photo" | "video";
type Phase = "idle" | "countdown" | "recording" | "paused" | "saving";

/** Photo Booth–style camera: photos and webcam videos of the user's face. */
export default function Camera() {
  const [settings, update] = useSettings();
  const [active, setActive] = useState(true);
  const [mode, setMode] = useState<Mode>("photo");
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [flash, setFlash] = useState(false);
  const [last, setLast] = useState<CameraMedia | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [delay, setDelay] = useState<0 | 3>(0);

  const video = useRef<HTMLVideoElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const clock = useRef<{ startedAt: number; pausedTotal: number; pausedAt: number }>({ startedAt: 0, pausedTotal: 0, pausedAt: 0 });

  const { stream, error } = useCameraStream(
    active,
    settings.cameraId,
    settings.cameraRes,
    mode === "video" ? settings.cameraMicId : false,
  );
  const { cameras, mics } = useMediaDevices(stream);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  // Release the camera whenever the window is hidden.
  useEffect(() => {
    const offs = [
      listen("camera://opened", () => setActive(true)),
      listen("window://hidden", () => {
        if (recorder.current?.state !== "inactive") recorder.current?.stop();
        setActive(false);
      }),
    ];
    return () => offs.forEach((p) => void p.then((f) => f()));
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => {
      const c = clock.current;
      setElapsed((Date.now() - c.startedAt - c.pausedTotal) / 1000);
    }, 250);
    return () => clearInterval(t);
  }, [phase]);

  const countdown = async () => {
    if (!delay) return;
    setPhase("countdown");
    for (let i = delay; i > 0; i--) {
      setCount(i);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setCount(0);
  };

  // ------------------------------------------------------------- photo

  const takePhoto = async () => {
    const v = video.current;
    if (!v || !stream || !v.videoWidth) return;
    await countdown();
    setFlash(true);
    setTimeout(() => setFlash(false), 380);

    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d")!;
    if (settings.cameraMirror) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

    const png = settings.photoFormat === "png";
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, png ? "image/png" : "image/jpeg", 0.92));
    setPhase("idle");
    if (!blob) return setStatus("Could not capture the photo.");

    try {
      const dir = await saveDirOf(settings);
      const { target } = await api.cameraPaths(dir, "photo", png ? "png" : "jpg");
      await api.writeChunk(target, new Uint8Array(await blob.arrayBuffer()), false);
      const media: CameraMedia = { event: "camera", kind: "photo", path: target, width: canvas.width, height: canvas.height, bytes: blob.size };
      setLast(media);
      void api.showMediaPreview(media);
    } catch (e) {
      setStatus(String(e));
    }
  };

  // ------------------------------------------------------------- video

  const startVideo = async () => {
    if (!stream) return;
    await countdown();
    const { mime, ext } = pickRecorderMime();
    const dir = await saveDirOf(settings);
    const paths = await api.cameraPaths(dir, "video", ext);
    let first = true;
    writes.current = Promise.resolve();

    const rec = new MediaRecorder(stream, {
      mimeType: mime || undefined,
      videoBitsPerSecond: cameraBitrate(settings),
      audioBitsPerSecond: 128_000,
    });
    // Stream to disk every second: a crash never loses more than a moment.
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      const append = !first;
      first = false;
      writes.current = writes.current.then(async () =>
        api.writeChunk(paths.temp, new Uint8Array(await e.data.arrayBuffer()), append),
      );
    };
    rec.onstop = () => void finishVideo(paths, ext);
    recorder.current = rec;
    clock.current = { startedAt: Date.now(), pausedTotal: 0, pausedAt: 0 };
    setElapsed(0);
    rec.start(1000);
    setPhase("recording");
  };

  const finishVideo = async (paths: { temp: string; target: string }, ext: string) => {
    setPhase("saving");
    const seconds = (Date.now() - clock.current.startedAt - clock.current.pausedTotal) / 1000;
    try {
      await writes.current;
      let finalPath = paths.target;
      // macOS re-encodes MP4 to HEVC in hardware; elsewhere every clip (often WebM) becomes compact MP4.
      const optimize = isMac ? ext === "mp4" && settings.codec === "hevc" : true;
      if (optimize) {
        setStatus(isMac ? "Optimizing to HEVC…" : "Optimizing…");
        try {
          finalPath = await compressTo(paths.temp, paths.target.replace(/\.webm$/i, ".mp4"), settings);
          await api.discardTemp(paths.temp);
        } catch {
          finalPath = await api.finalize(paths.temp, paths.target);
        }
      } else {
        finalPath = await api.finalize(paths.temp, paths.target);
      }
      const v = video.current;
      const media: CameraMedia = {
        event: "camera",
        kind: "video",
        path: finalPath,
        width: v?.videoWidth ?? 0,
        height: v?.videoHeight ?? 0,
        bytes: await api.fileSize(finalPath),
        seconds,
      };
      setLast(media);
      void api.showMediaPreview(media);
      setStatus(null);
    } catch (e) {
      setStatus(String(e));
    } finally {
      recorder.current = null;
      setPhase("idle");
    }
  };

  const togglePause = () => {
    const rec = recorder.current;
    if (!rec) return;
    if (rec.state === "recording") {
      rec.pause();
      clock.current.pausedAt = Date.now();
      setPhase("paused");
    } else if (rec.state === "paused") {
      rec.resume();
      clock.current.pausedTotal += Date.now() - clock.current.pausedAt;
      setPhase("recording");
    }
  };

  const shutter = useCallback(() => {
    if (phase === "countdown" || phase === "saving") return;
    if (mode === "photo") void takePhoto();
    else if (phase === "recording" || phase === "paused") recorder.current?.stop();
    else void startVideo();
  }, [phase, mode, stream, settings, delay]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLSelectElement) return;
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault();
        shutter();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shutter]);

  const busy = phase !== "idle";
  const recording = phase === "recording" || phase === "paused";

  return (
    <div className="cam">
      <div className="cam-top" data-tauri-drag-region>
        <span className="cam-title" data-tauri-drag-region>Camera</span>
        {recording && (
          <span className={`cam-rec ${phase === "paused" ? "paused" : ""}`}>
            <i /> {formatClock(elapsed)}
          </span>
        )}
      </div>

      <div className="cam-stage">
        {error ? (
          <div className="cam-error">
            <IconWarning width={30} height={30} />
            <p>{error}</p>
            <button className="pill" onClick={() => void api.privacy("camera")}>Open Camera Settings</button>
          </div>
        ) : (
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            className="cam-video"
            style={{ transform: settings.cameraMirror ? "scaleX(-1)" : undefined }}
          />
        )}
        <AnimatePresence>
          {settings.cameraGrid && (
            <motion.div key="grid" className="cam-grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          )}
        </AnimatePresence>
        <AnimatePresence mode="popLayout">
          {phase === "countdown" && count > 0 && (
            <motion.div
              key={count}
              className="countdown-num cam-count"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.35, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 22 }}
            >
              {count}
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {flash && (
            <motion.div key="flash" className="cam-flash" initial={{ opacity: 0.95 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.38, ease: "easeOut" }} />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {status && (
            <motion.div key="status" className="cam-status" initial={{ opacity: 0, y: -8, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: -8, x: "-50%" }}>
              {status}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="cam-bar">
        <div className="cam-left">
          {last ? (
            <motion.button
              key={last.path}
              className="cam-last"
              title="Open last capture"
              onClick={() => void api.open(last.path)}
              initial={{ scale: 0.4, opacity: 0, rotate: -6 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              whileHover={{ scale: 1.06 }}
            >
              {last.kind === "photo" ? <img src={convertFileSrc(last.path)} alt="" /> : <video src={convertFileSrc(last.path)} muted preload="metadata" />}
              <span>{formatBytes(last.bytes)}</span>
            </motion.button>
          ) : (
            <span className="cam-last empty" />
          )}
          <div className="seg cam-mode">
            {(["photo", "video"] as const).map((m) => (
              <button key={m} className={mode === m ? "on" : ""} disabled={busy} onClick={() => setMode(m)}>
                {mode === m && <motion.span layoutId="cam-mode-pill" className="seg-pill" />}
                <span className="seg-label">{m === "photo" ? "Photo" : "Video"}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="cam-center">
          <AnimatePresence>
            {recording && (
              <motion.button
                key="pause"
                className="cam-small"
                title={phase === "paused" ? "Resume" : "Pause"}
                onClick={togglePause}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
              >
                {phase === "paused" ? <IconPlay width={18} height={18} /> : <IconPause width={18} height={18} />}
              </motion.button>
            )}
          </AnimatePresence>
          <motion.button
            whileTap={{ scale: 0.88 }}
            whileHover={{ scale: 1.04 }}
            className={`shutter ${mode} ${recording ? "live" : ""}`}
            title={mode === "photo" ? "Take Photo (Space)" : recording ? "Stop (Space)" : "Record (Space)"}
            disabled={!stream || phase === "saving" || phase === "countdown"}
            onClick={shutter}
          >
            <motion.span
              layout
              animate={{
                width: recording ? 28 : 56,
                height: recording ? 28 : 56,
                borderRadius: recording ? 7 : 28,
                backgroundColor: mode === "photo" ? "#ffffff" : "#ff453a",
              }}
              transition={{ type: "spring", stiffness: 420, damping: 28 }}
            />
          </motion.button>
        </div>

        <div className="cam-right">
          <button className={`cam-small ${delay ? "on" : ""}`} title="3-second timer" disabled={busy} onClick={() => setDelay(delay ? 0 : 3)}>
            <IconTimer width={18} height={18} />
          </button>
          <button className={`cam-small ${settings.cameraMirror ? "on" : ""}`} title="Mirror" onClick={() => update({ cameraMirror: !settings.cameraMirror })}>
            <IconFlip width={18} height={18} />
          </button>
          <button className={`cam-small ${settings.cameraGrid ? "on" : ""}`} title="Grid" onClick={() => update({ cameraGrid: !settings.cameraGrid })}>
            <IconGrid width={18} height={18} />
          </button>
          <select value={settings.cameraId ?? ""} disabled={busy} onChange={(e) => update({ cameraId: e.target.value || null })} title="Camera">
            <option value="">Default camera</option>
            {cameras.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          {mode === "video" ? (
            <select value={settings.cameraMicId ?? ""} disabled={busy} onChange={(e) => update({ cameraMicId: e.target.value || null })} title="Microphone">
              <option value="">Default mic</option>
              {mics.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          ) : (
            <select value={settings.photoFormat} onChange={(e) => update({ photoFormat: e.target.value as "jpg" | "png" })} title="Photo format">
              <option value="jpg">JPEG</option>
              <option value="png">PNG</option>
            </select>
          )}
          <select value={settings.cameraRes} disabled={busy} onChange={(e) => update({ cameraRes: Number(e.target.value) === 720 ? 720 : 1080 })} title="Resolution">
            <option value={1080}>1080p</option>
            <option value={720}>720p</option>
          </select>
        </div>
      </div>
    </div>
  );
}

/** Re-encodes the raw webcam MP4 to compact HEVC via the native helper. */
function compressTo(input: string, output: string, settings: Parameters<typeof compressOptions>[0]): Promise<string> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const off = listen<CompressEvent>("compress", (e) => {
      if (e.payload.id !== id) return;
      if (e.payload.event === "done") {
        void off.then((f) => f());
        resolve(e.payload.output);
      } else if (e.payload.event === "error") {
        void off.then((f) => f());
        reject(new Error(e.payload.message));
      }
    });
    void off.then(() => api.compress(id, input, compressOptions(settings), output).catch(reject));
  });
}
