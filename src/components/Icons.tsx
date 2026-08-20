import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const IconClose = (p: P) => (
  <svg {...base} {...p}><path d="M7 7l10 10M17 7L7 17" /></svg>
);
export const IconScreen = (p: P) => (
  <svg {...base} {...p}><rect x="3" y="5" width="18" height="12" rx="2" /><rect x="5" y="7" width="14" height="8" rx="1" fill="currentColor" stroke="none" opacity=".9" /><path d="M9 20h6" /></svg>
);
export const IconWindow = (p: P) => (
  <svg {...base} {...p}><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="6.5" cy="8" r=".6" fill="currentColor" /><circle cx="8.6" cy="8" r=".6" fill="currentColor" /><circle cx="10.7" cy="8" r=".6" fill="currentColor" /></svg>
);
export const IconRegion = (p: P) => (
  <svg {...base} {...p}><rect x="3.5" y="5.5" width="17" height="13" rx="2" strokeDasharray="2.6 2.4" /></svg>
);
export const IconChevron = (p: P) => (
  <svg {...base} width={12} height={12} {...p}><path d="M7 10l5 5 5-5" /></svg>
);
export const IconCheck = (p: P) => (
  <svg {...base} width={14} height={14} strokeWidth={2.2} {...p}><path d="M5 12.5l4.2 4.2L19 7" /></svg>
);
export const IconTimer = (p: P) => (
  <svg {...base} width={14} height={14} {...p}><circle cx="12" cy="13" r="7.5" /><path d="M12 9.5V13l2.2 1.6M10 3h4" /></svg>
);
export const IconPlay = (p: P) => (
  <svg {...base} {...p}><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" /></svg>
);
export const IconFolder = (p: P) => (
  <svg {...base} {...p}><path d="M3.5 7.5a2 2 0 012-2h4l2 2h7a2 2 0 012 2v7a2 2 0 01-2 2h-13a2 2 0 01-2-2z" /></svg>
);
export const IconTrash = (p: P) => (
  <svg {...base} {...p}><path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l.8 12h9.4l.8-12" /></svg>
);
export const IconCompress = (p: P) => (
  <svg {...base} {...p}><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" /></svg>
);
export const IconFilm = (p: P) => (
  <svg {...base} {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4" /></svg>
);
export const IconGear = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></svg>
);
export const IconMic = (p: P) => (
  <svg {...base} {...p}><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3" /></svg>
);
export const IconRecord = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" /></svg>
);
export const IconStop = (p: P) => (
  <svg {...base} {...p}><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" /></svg>
);
export const IconPause = (p: P) => (
  <svg {...base} {...p}><path d="M9 6.5v11M15 6.5v11" strokeWidth={2.4} /></svg>
);
export const IconWarning = (p: P) => (
  <svg {...base} {...p}><path d="M12 4l9 15.5H3z" /><path d="M12 10v4.5M12 17.2v.3" /></svg>
);
export const IconDisk = (p: P) => (
  <svg {...base} {...p}><rect x="3.5" y="6" width="17" height="12" rx="2.5" /><path d="M7 14.5h4" /><circle cx="16.5" cy="14.5" r=".8" fill="currentColor" /></svg>
);
export const IconCamera = (p: P) => (
  <svg {...base} {...p}><path d="M4 8.5a2 2 0 012-2h2l1.4-2h5.2l1.4 2h2a2 2 0 012 2V17a2 2 0 01-2 2H6a2 2 0 01-2-2z" /><circle cx="12" cy="12.6" r="3.6" /></svg>
);
export const IconFace = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="10" r="2.8" /><path d="M6.8 18.2c1.2-2.3 3-3.4 5.2-3.4s4 1.1 5.2 3.4" /></svg>
);
export const IconVideo = (p: P) => (
  <svg {...base} {...p}><rect x="3" y="6.5" width="12.5" height="11" rx="2.2" /><path d="M15.5 10.5l5-3v9l-5-3z" /></svg>
);
export const IconFlip = (p: P) => (
  <svg {...base} {...p}><path d="M12 3v18M8.5 7L4 12l4.5 5zM15.5 7L20 12l-4.5 5z" /></svg>
);
export const IconGrid = (p: P) => (
  <svg {...base} {...p}><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17" /></svg>
);
export const IconImage = (p: P) => (
  <svg {...base} {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="9.5" r="1.6" /><path d="M20.5 16l-5-5-8.5 8.5" /></svg>
);
export const IconKeyboard = (p: P) => (
  <svg {...base} {...p}><rect x="2.5" y="6" width="19" height="12" rx="2.2" /><path d="M6 9.5h.01M9.3 9.5h.01M12.6 9.5h.01M15.9 9.5h.01M19 9.5h.01M6 12.5h.01M18 12.5h.01M8 15h8" strokeWidth={1.9} /></svg>
);
export const IconShield = (p: P) => (
  <svg {...base} {...p}><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z" /><path d="M8.8 12.2l2.2 2.2 4.4-4.6" /></svg>
);
export const IconSliders = (p: P) => (
  <svg {...base} {...p}><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>
);
