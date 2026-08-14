import { useId } from "react";

/** Camly mark: Instagram-style camera glyph on a blue gradient squircle. */
export function Logo({ size = 28 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Camly" role="img">
      <defs>
        <radialGradient id={`${id}-g`} cx="18%" cy="105%" r="125%">
          <stop offset="0" stopColor="#8BE9FF" />
          <stop offset="0.38" stopColor="#3FA9FF" />
          <stop offset="0.72" stopColor="#1F6BFF" />
          <stop offset="1" stopColor="#4B3BE8" />
        </radialGradient>
        <linearGradient id={`${id}-s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".35" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill={`url(#${id}-g)`} />
      <rect x="2" y="2" width="60" height="60" rx="16" fill={`url(#${id}-s)`} />
      <rect x="15" y="15" width="34" height="34" rx="10.5" fill="none" stroke="#fff" strokeWidth="4.2" />
      <circle cx="32" cy="32" r="8.2" fill="none" stroke="#fff" strokeWidth="4.2" />
      <circle cx="42.3" cy="21.7" r="2.6" fill="#fff" />
    </svg>
  );
}
