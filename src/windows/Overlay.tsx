import { useEffect, useRef, useState, type PointerEvent } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "motion/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { saveRegion, type Rect } from "../lib/settings";

type ModePayload =
  | { mode: "select"; rect: Rect | null }
  | { mode: "countdown"; seconds: number; rect: Rect | null };

type Drag =
  | { kind: "new"; ox: number; oy: number }
  | { kind: "move"; dx: number; dy: number }
  | { kind: "resize"; handle: string; start: Rect; px: number; py: number };

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
const MIN = 40;

/** Full-screen transparent window: region picker (like Cmd+Shift+5) and countdown. */
export default function Overlay() {
  const [mode, setMode] = useState<"idle" | "select" | "countdown">("idle");
  const [rect, setRect] = useState<Rect | null>(null);
  const [count, setCount] = useState(0);
  const origin = useRef({ x: 0, y: 0 });
  const drag = useRef<Drag | null>(null);

  const toGlobal = (r: Rect): Rect => ({ ...r, x: r.x + origin.current.x, y: r.y + origin.current.y });
  const toLocal = (r: Rect): Rect => ({ ...r, x: r.x - origin.current.x, y: r.y - origin.current.y });

  const publish = (r: Rect) => {
    const g = toGlobal(r);
    void emitTo("toolbar", "region://changed", g);
    return g;
  };

  useEffect(() => {
    const off = listen<ModePayload>("overlay://mode", async (e) => {
      const win = getCurrentWindow();
      const sf = await win.scaleFactor();
      const pos = (await win.outerPosition()).toLogical(sf);
      origin.current = { x: pos.x, y: pos.y };

      const w = window.innerWidth, h = window.innerHeight;
      const fallback: Rect = { x: w * 0.2, y: h * 0.2, width: w * 0.6, height: h * 0.6 };
      const local = e.payload.rect ? clamp(toLocal(e.payload.rect), w, h) : fallback;
      setRect(local);

      if (e.payload.mode === "select") {
        setMode("select");
        publish(local);
      } else {
        setRect(e.payload.rect ? local : null);
        setCount(e.payload.seconds);
        setMode("countdown");
      }
    });
    return () => void off.then((f) => f());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== "countdown" || count <= 0) return;
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [mode, count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode !== "select") return;
      if (e.key === "Enter") void emitTo("toolbar", "region://record");
      if (e.key === "Escape") void emitTo("toolbar", "region://cancel");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  const onPointerDown = (e: PointerEvent) => {
    if (mode !== "select") return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const handle = (e.target as HTMLElement).dataset.handle;
    if (handle && rect) {
      drag.current = { kind: "resize", handle, start: rect, px: e.clientX, py: e.clientY };
    } else if (rect && inside(rect, e.clientX, e.clientY)) {
      drag.current = { kind: "move", dx: e.clientX - rect.x, dy: e.clientY - rect.y };
    } else {
      drag.current = { kind: "new", ox: e.clientX, oy: e.clientY };
      setRect({ x: e.clientX, y: e.clientY, width: 0, height: 0 });
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || !rect) return;
    const W = window.innerWidth, H = window.innerHeight;
    let next: Rect;
    if (d.kind === "new") {
      next = {
        x: Math.min(d.ox, e.clientX),
        y: Math.min(d.oy, e.clientY),
        width: Math.abs(e.clientX - d.ox),
        height: Math.abs(e.clientY - d.oy),
      };
    } else if (d.kind === "move") {
      next = {
        ...rect,
        x: Math.min(Math.max(0, e.clientX - d.dx), W - rect.width),
        y: Math.min(Math.max(0, e.clientY - d.dy), H - rect.height),
      };
    } else {
      next = resizeRect(d.start, d.handle, e.clientX - d.px, e.clientY - d.py);
    }
    next = clamp(next, W, H);
    setRect(next);
    publish(next);
  };

  const onPointerUp = () => {
    if (!drag.current || !rect) return;
    drag.current = null;
    const fixed = rect.width < MIN || rect.height < MIN
      ? { ...rect, width: Math.max(rect.width, 320), height: Math.max(rect.height, 200) }
      : rect;
    const clamped = clamp(fixed, window.innerWidth, window.innerHeight);
    setRect(clamped);
    saveRegion(publish(clamped));
  };

  if (mode === "idle") return <div className="overlay-root" />;

  if (mode === "countdown") {
    const box = rect ?? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    return (
      <div className="overlay-root countdown">
        <div className="countdown-box" style={{ left: box.x, top: box.y, width: box.width, height: box.height }}>
          <AnimatePresence mode="popLayout">
            {count > 0 && (
              <motion.div
                key={count}
                className="countdown-num"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 1.35, opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 22 }}
              >
                {count}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  return (
    <div
      className="overlay-root select"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={() => void emitTo("toolbar", "region://record")}
    >
      {!rect && <div className="overlay-dim" />}
      {rect && (
        <motion.div
          className="sel"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18 }}
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          <div className="sel-size">
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>
          <div className="sel-grid" />
          {HANDLES.map((h) => (
            <span key={h} data-handle={h} className={`sel-h h-${h}`} />
          ))}
        </motion.div>
      )}
    </div>
  );
}

function inside(r: Rect, x: number, y: number) {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

function clamp(r: Rect, W: number, H: number): Rect {
  const x = Math.max(0, Math.min(r.x, W - 1));
  const y = Math.max(0, Math.min(r.y, H - 1));
  return { x, y, width: Math.min(r.width, W - x), height: Math.min(r.height, H - y) };
}

function resizeRect(s: Rect, handle: string, dx: number, dy: number): Rect {
  let { x, y, width, height } = s;
  if (handle.includes("e")) width = Math.max(MIN, s.width + dx);
  if (handle.includes("s")) height = Math.max(MIN, s.height + dy);
  if (handle.includes("w")) {
    width = Math.max(MIN, s.width - dx);
    x = s.x + s.width - width;
  }
  if (handle.includes("n")) {
    height = Math.max(MIN, s.height - dy);
    y = s.y + s.height - height;
  }
  return { x, y, width, height };
}
