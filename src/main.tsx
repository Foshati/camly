import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MotionConfig } from "motion/react";
import Toolbar from "./windows/Toolbar";
import Overlay from "./windows/Overlay";
import Preview from "./windows/Preview";
import Library from "./windows/Library";
import Camera from "./windows/Camera";
import Bubble from "./windows/Bubble";
import { platform } from "./lib/platform";
import "./styles.css";

// One bundle, six windows: the window label picks the screen.
const label = getCurrentWindow().label;
document.documentElement.dataset.window = label;
document.documentElement.dataset.platform = platform;

const screens: Record<string, () => React.JSX.Element> = {
  toolbar: Toolbar,
  overlay: Overlay,
  preview: Preview,
  library: Library,
  camera: Camera,
  bubble: Bubble,
};
const Screen = screens[label] ?? Library;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Honors System Settings → Accessibility → Reduce Motion. */}
    <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 420, damping: 34 }}>
      <Screen />
    </MotionConfig>
  </React.StrictMode>,
);

// Native feel: no browser context menu, no text selection on chrome.
window.addEventListener("contextmenu", (e) => {
  if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
});
