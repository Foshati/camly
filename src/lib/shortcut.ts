import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "./settings";

import { isMac } from "./platform";

export { isMac };
export const DEFAULT_SHORTCUT = isMac ? "Super+Shift+Digit2" : "Control+Shift+Digit2";

const MAC_SYMBOL: Record<string, string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", Super: "⌘" };
const PC_NAME: Record<string, string> = { Control: "Ctrl", Alt: "Alt", Shift: "Shift", Super: "Win" };

/** "Control+Super+Digit2" → "⌃⌘2" on Mac, "Ctrl+Win+2" elsewhere. */
export function formatShortcut(accelerator: string | null | undefined): string {
  const parts = (accelerator || DEFAULT_SHORTCUT).split("+");
  const key = keyLabel(parts.pop() ?? "");
  const mods = parts.map((m) => (isMac ? MAC_SYMBOL[m] : PC_NAME[m]) ?? m);
  return isMac ? mods.join("") + key : [...mods, key].join("+");
}

function keyLabel(code: string): string {
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Key")) return code.slice(3);
  const named: Record<string, string> = {
    Space: isMac ? "Space" : "Space", Enter: "↩", Escape: "Esc", Backquote: "`", Minus: "-", Equal: "=",
    BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\",
  };
  return named[code] ?? code;
}

/** Builds an accelerator from a key press; null until a real key is held with ≥1 modifier. */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean) as string[];
  const real = mods.filter((m) => m !== "Shift");
  if (!real.length && !/^F\d+$/.test(e.code)) return null;
  return [...mods, e.code].join("+");
}

/** Label of the active global shortcut, kept in sync with Settings. */
export function useShortcutLabel(): string {
  const [settings] = useSettings();
  return formatShortcut(settings.shortcut);
}

/** Registers the saved shortcut with the OS (called once by the always-loaded toolbar). */
export function useApplySavedShortcut() {
  const [settings] = useSettings();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    invoke<string>("set_shortcut", { accelerator: settings.shortcut })
      .then(() => setError(null))
      .catch((e) => setError(String(e)));
  }, [settings.shortcut]);
  return error;
}
