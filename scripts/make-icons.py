#!/usr/bin/env python3
"""Draws the Camly app icon (app-icon.png, 1024px) and the menu-bar template
icon (src-tauri/icons/tray.png) with the standard library only."""
import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def write_png(path, w, h, pixels):
    raw = b"".join(b"\x00" + bytes(pixels[y * w * 4:(y + 1) * w * 4]) for y in range(h))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png)


def coverage(d):
    """Signed distance (negative = inside) → anti-aliased alpha."""
    return max(0.0, min(1.0, 0.5 - d))


def rounded_rect_sd(x, y, cx, cy, hw, hh, r):
    qx, qy = abs(x - cx) - hw + r, abs(y - cy) - hh + r
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r


def blend(dst, src, a):
    return [dst[i] * (1 - a) + src[i] * a for i in range(3)]


def lerp(a, b, t):
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]


STOPS = [(0.0, (139, 233, 255)), (0.38, (63, 169, 255)), (0.72, (31, 107, 255)), (1.0, (75, 59, 232))]


def gradient(t):
    t = max(0.0, min(1.0, t))
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        if t <= t1:
            return lerp(c0, c1, (t - t0) / (t1 - t0))
    return list(STOPS[-1][1])


def glyph_coverage(fx, fy, cx, cy, unit):
    """Instagram-style camera: rounded square outline, lens ring, flash dot (unit = 1/64 of the tile)."""
    stroke = 4.2 * unit
    sq = rounded_rect_sd(fx, fy, cx, cy, 17 * unit, 17 * unit, 10.5 * unit)
    a = coverage(abs(sq) - stroke / 2)
    ring = math.hypot(fx - cx, fy - cy) - 8.2 * unit
    a = max(a, coverage(abs(ring) - stroke / 2))
    dot = math.hypot(fx - (cx + 10.3 * unit), fy - (cy - 10.3 * unit)) - 2.6 * unit
    return max(a, coverage(dot))


def app_icon(size=1024):
    px = [0] * (size * size * 4)
    s = size / 1024
    tile = 824 * s           # macOS icon grid: 824px tile inside 1024px canvas
    unit = tile / 60
    c = 512 * s
    for y in range(size):
        for x in range(size):
            fx, fy = x + 0.5, y + 0.5
            body = coverage(rounded_rect_sd(fx, fy, c, c, tile / 2, tile / 2, 16 * unit))
            if body <= 0:
                continue
            # Radial gradient from the bottom-left corner, like Instagram's.
            ox, oy = c - tile * 0.32, c + tile * 0.55
            t = math.hypot(fx - ox, fy - oy) / (tile * 1.25)
            col = gradient(t)
            # Soft top sheen.
            sheen = max(0.0, 1 - (fy - (c - tile / 2)) / (tile * 0.5)) * 0.22
            col = blend(col, [255, 255, 255], sheen)
            col = blend(col, [255, 255, 255], glyph_coverage(fx, fy, c, c, unit))
            i = (y * size + x) * 4
            px[i:i + 4] = [int(col[0]), int(col[1]), int(col[2]), int(255 * body)]
    write_png(os.path.join(ROOT, "app-icon.png"), size, size, px)


def tray_icon(size=44):
    px = [0] * (size * size * 4)
    unit = size / 44
    c = size / 2
    for y in range(size):
        for x in range(size):
            a = glyph_coverage(x + 0.5, y + 0.5, c, c, unit)
            i = (y * size + x) * 4
            px[i:i + 4] = [0, 0, 0, int(255 * a)]
    write_png(os.path.join(ROOT, "src-tauri", "icons", "tray.png"), size, size, px)


if __name__ == "__main__":
    tray_icon()
    app_icon()
    print("✓ app-icon.png and src-tauri/icons/tray.png")
