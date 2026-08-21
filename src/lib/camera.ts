import { useEffect, useState } from "react";

export type MediaDevice = { id: string; label: string };

/** Video/audio inputs as WebKit sees them. Labels appear once camera access is granted. */
export function useMediaDevices(refreshKey: unknown = 0) {
  const [cameras, setCameras] = useState<MediaDevice[]>([]);
  const [mics, setMics] = useState<MediaDevice[]>([]);

  useEffect(() => {
    const load = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const all = await navigator.mediaDevices.enumerateDevices();
      const pick = (kind: MediaDeviceKind, fallback: string) =>
        all
          .filter((d) => d.kind === kind && d.deviceId)
          .map((d, i) => ({ id: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
      setCameras(pick("videoinput", "Camera"));
      setMics(pick("audioinput", "Microphone"));
    };
    void load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", load);
  }, [refreshKey]);

  return { cameras, mics };
}

export type StreamState = { stream: MediaStream | null; error: string | null };

/** Live camera (and optional mic) stream; restarts when the devices or resolution change. */
export function useCameraStream(
  enabled: boolean,
  cameraId: string | null,
  height: 720 | 1080,
  micId: string | null | false = false,
): StreamState {
  const [state, setState] = useState<StreamState>({ stream: null, error: null });

  useEffect(() => {
    if (!enabled) {
      setState({ stream: null, error: null });
      return;
    }
    let cancelled = false;
    let current: MediaStream | null = null;

    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera is not available in this view.");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: cameraId ? { exact: cameraId } : undefined,
            width: { ideal: height === 1080 ? 1920 : 1280 },
            height: { ideal: height },
            frameRate: { ideal: 30 },
          },
          audio:
            micId === false
              ? false
              : {
                  deviceId: micId ? { exact: micId } : undefined,
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        current = stream;
        setState({ stream, error: null });
      } catch (e) {
        if (!cancelled) setState({ stream: null, error: describeMediaError(e) });
      }
    })();

    return () => {
      cancelled = true;
      current?.getTracks().forEach((t) => t.stop());
    };
  }, [enabled, cameraId, height, micId]);

  return state;
}

export function describeMediaError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError") return "Camera access is off. Allow Camly in System Settings → Privacy & Security → Camera.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found. Connect a camera or choose another one.";
  if (name === "NotReadableError") return "The camera is busy in another app.";
  return e instanceof Error ? e.message : String(e);
}

/** Best container WebKit can record; MP4 first so AVFoundation can re-encode it to HEVC. */
export function pickRecorderMime(): { mime: string; ext: "mp4" | "webm" } {
  const candidates: [string, "mp4" | "webm"][] = [
    ["video/mp4;codecs=avc1.640028,mp4a.40.2", "mp4"],
    ["video/mp4;codecs=avc1,mp4a.40.2", "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9,opus", "webm"],
    ["video/webm", "webm"],
  ];
  for (const [mime, ext] of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return { mime: "", ext: "mp4" };
}

