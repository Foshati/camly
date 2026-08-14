const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

export const isMac = /Mac/i.test(ua);
export const isWindows = /Windows/i.test(ua);
export const platform: "mac" | "windows" | "linux" = isMac ? "mac" : isWindows ? "windows" : "linux";

/** "Finder" / "Explorer" / "Files" — for "Show in …" buttons. */
export const fileManager = isMac ? "Finder" : isWindows ? "Explorer" : "Files";
export const trashName = isMac ? "Trash" : isWindows ? "Recycle Bin" : "Trash";
