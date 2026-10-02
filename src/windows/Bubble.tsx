import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../lib/api";
import { useCameraStream } from "../lib/camera";
import { BUBBLE_PX, loadSettings, useSettings, type BubbleSize } from "../lib/settings";
import { IconClose } from "../components/Icons";

const SIZES: BubbleSize[] = ["s", "m", "l"];

/**
 * Floating face-cam. Its window title ("Camly Bubble") is whitelisted by the recorder,
 * so it is the only Camly window that appears in screen recordings.
 */
export default function Bubble() {
  const [settings, update] = useSettings();
  const [visible, setVisible] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const { stream, error } = useCameraStream(visible, settings.bubbleCameraId, 720);

  useEffect(() => {
    const off = listen<boolean>("bubble://state", (e) => setVisible(e.payload));
    return () => void off.then((f) => f());
  }, []);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  const cycleSize = () => {
    const next = SIZES[(SIZES.indexOf(settings.bubbleSize) + 1) % SIZES.length];
    update({ bubbleSize: next });
    void api.setBubble(true, BUBBLE_PX[next]);
  };

  const hide = () => {
    update({ bubble: false });
    void api.setBubble(false, BUBBLE_PX[loadSettings().bubbleSize]);
  };

  return (
    <AnimatePresence>
    {visible && (
    <motion.div
      key="bubble"
      className={`bubble ${settings.bubbleShape}`}
      data-tauri-drag-region
      onDoubleClick={cycleSize}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1, borderRadius: settings.bubbleShape === "circle" ? "50%" : "24%" }}
      exit={{ scale: 0.6, opacity: 0 }}
      transition={{ type: "spring", stiffness: 360, damping: 26 }}
    >
      {error ? (
        <div className="bubble-error" data-tauri-drag-region>{error}</div>
      ) : (
        <video
          ref={video}
          autoPlay
          muted
          playsInline
          data-tauri-drag-region
          style={{ transform: settings.cameraMirror ? "scaleX(-1)" : undefined }}
        />
      )}
      <div className="bubble-tools">
        <button title="Size (or double-click)" onClick={cycleSize}>{settings.bubbleSize.toUpperCase()}</button>
        <button title="Hide bubble" onClick={hide}><IconClose width={11} height={11} /></button>
      </div>
    </motion.div>
    )}
    </AnimatePresence>
  );
}

