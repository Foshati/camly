<div align="center">
  <img src="app-icon.png" alt="Camly Icon" width="120" height="120" />
  <h1>Camly</h1>
  <p><strong>Screenshots, screen recording, and webcam studio — compact by default.</strong></p>
  <p>A fast, native-grade desktop utility crafted with <strong>Tauri 2</strong>, <strong>React 19</strong>, and <strong>Motion</strong> for macOS, Windows, and Linux.</p>

  <p>
    <a href="https://github.com/Foshati/camly/releases/latest">
      <img src="https://img.shields.io/github/v/release/Foshati/camly?style=flat-square&color=3b82f6&label=Latest%20Release" alt="Latest Release" />
    </a>
    <img src="https://img.shields.io/badge/Platforms-macOS%20%7C%20Windows%20%7C%20Linux-4f46e5?style=flat-square" alt="Platform Support" />
    <img src="https://img.shields.io/badge/Tauri-v2-24c8db?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2" />
    <img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=black" alt="React 19" />
    <img src="https://img.shields.io/badge/TypeScript-5.8-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/License-MIT-10b981?style=flat-square" alt="License" />
  </p>

  <p>
    <a href="#-downloads"><strong>Download Installers</strong></a> •
    <a href="#-features"><strong>Features</strong></a> •
    <a href="#-capture-engines"><strong>Engines</strong></a> •
    <a href="#-keyboard-shortcuts"><strong>Shortcuts</strong></a> •
    <a href="#-building-from-source"><strong>Build from Source</strong></a>
  </p>
</div>

---

## 🚀 Downloads

Get the prebuilt installer for your operating system directly from [GitHub Releases](https://github.com/Foshati/camly/releases/latest):

| Operating System | Package Format | Architecture | Download Link |
|---|---|---|---|
| **macOS 15+** | `.dmg`, `.app` | Apple Silicon (`arm64`) | [Download DMG (arm64)](https://github.com/Foshati/camly/releases/latest) |
| **macOS 15+** | `.dmg`, `.app` | Intel (`x86_64`) | [Download DMG (x86_64)](https://github.com/Foshati/camly/releases/latest) |
| **Windows 10 / 11** | `.exe` (NSIS), `.msi` | 64-bit (`x64`) | [Download Windows Installer](https://github.com/Foshati/camly/releases/latest) |
| **Linux (Ubuntu / Debian)** | `.deb` | 64-bit (`x86_64`) | [Download Debian (.deb)](https://github.com/Foshati/camly/releases/latest) |
| **Linux (Universal)** | `.AppImage` | 64-bit (`x86_64`) | [Download AppImage](https://github.com/Foshati/camly/releases/latest) |
| **Linux (Fedora / RHEL)** | `.rpm` | 64-bit (`x86_64`) | [Download RPM (.rpm)](https://github.com/Foshati/camly/releases/latest) |

> [!TIP]
> On macOS, after downloading `.dmg`, drag `Camly.app` to your `Applications` folder. On first launch, grant Screen Recording and Microphone permissions when prompted.

---

## ✨ Features

- ⚡ **Ultra-Compact Files by Default**: Screen recordings default to high efficiency (HEVC hardware encoding on macOS, optimized H.264 CRF 28 elsewhere) — crisp captures taking megabytes instead of gigabytes.
- 🎯 **3 Versatile Capture Modes**:
  - **Full Screen**: Capture your entire display with a single tap.
  - **Window**: Target an exact application window with transparent borders and clean edges.
  - **Custom Region**: Click and drag to record or screenshot any precise area.
- 📸 **Instant Screenshots**: Snap any area with copy-to-clipboard, auto-save to disk, and instant pop-out preview.
- 🎥 **Dual-Engine Architecture**:
  - **macOS**: Native Swift helper leveraging Apple's `ScreenCaptureKit` and `VideoToolbox` (identical to macOS's native ⌘⇧5 pipeline).
  - **Windows & Linux**: Standalone portable pipeline utilizing `FFmpeg` and `xcap` with automatic hardware acceleration when available.
- 🫧 **Floating Camera Bubble**:
  - Turn on the webcam bubble (`🙂`) during screen recordings.
  - Drag it anywhere across multiple monitors.
  - Double-click to toggle between compact and enlarged sizes.
- 🛡️ **Crash Resilience & Low-Disk Guard**:
  - Videos are written in fragmented containers (`fMP4` / fragmented `MOV`) so recordings survive unexpected crashes or forced quits without corruption.
  - Low-disk guard constantly monitors available storage and safely finalizes files before free space runs out.
- 🗜️ **Built-in Drag-and-Drop Compressor**:
  - Drag any existing video file into Camly to compress it down to minimal file sizes with hardware encoders.
- 🗂️ **Integrated Media Library**:
  - Browse your history with filters for All, Recordings, Screenshots, and Camera clips.
  - Quick inline video player, copy to clipboard, reveal in Finder/Explorer, and trash bin.
- ⌨️ **Customizable Global Shortcut**:
  - Press `⌘⇧2` (macOS) or `Ctrl+Shift+2` (Windows/Linux) anywhere to open the toolbar or finish recording.
  - Remap hotkeys on the fly via Settings.
- 🎨 **Fluid Micro-Animations**: Built with **Motion (Framer Motion v12)**, respecting system accessibility `prefers-reduced-motion` settings.

---

## ⚙️ Capture Engines & Platform Matrix

| Platform | Screen Engine | Audio Engine | Screenshot Engine | Hardware Acceleration |
|---|---|---|---|---|
| **macOS 15+** | Native Swift (`ScreenCaptureKit`) | CoreAudio (`AVCaptureSession`) | ScreenCaptureKit | VideoToolbox (Apple Silicon / Intel T2) |
| **Windows 10/11** | FFmpeg (`gdigrab` / `dshow`) | DirectShow / Loopback | `xcap` cross-platform | NVENC / AMF / QSV (via FFmpeg) |
| **Linux (X11)** | FFmpeg (`x11grab`) | PulseAudio (`pactl` / ALSA) | `xcap` cross-platform | VAAPI (via FFmpeg) |
| **Linux (Wayland)** | Screen portal | PulseAudio | `xcap` | Supported |

---

## 🎛️ Quality Presets

Camly offers fine-tuned quality presets designed to balance resolution, frame rate, and storage:

| Preset | Target Resolution | Frame Rate | macOS Codec | Windows/Linux Codec | Best For |
|---|---|---|---|---|---|
| **Compact (Default)** | Up to 1080p | 30 fps | Hardware HEVC | H.264 (CRF 28) | Slack, Discord, bug reports, quick demos |
| **Balanced** | Up to 1440p | 60 fps | Hardware HEVC / H.264 | H.264 (CRF 23) | Product walkthroughs, tutorials |
| **Retina / Original** | Native Display | 60 fps | High-bitrate HEVC | H.264 (CRF 18) | Design reviews, ultra-sharp fidelity |
| **Custom** | User Configured | User Configured | HEVC / H.264 | User Configured | Tailored workflows, MP4 or MOV containers |

---

## ⌨️ Keyboard Shortcuts

| Action | macOS | Windows / Linux |
|---|---|---|
| **Toggle Toolbar / Finish Recording** | `⌘ ⇧ 2` | `Ctrl + Shift + 2` |
| **Capture Screenshot** | Buttons 1–3 → *Capture* | Buttons 1–3 → *Capture* |
| **Start Screen Record** | Buttons 4–6 (●) → *Record* | Buttons 4–6 (●) → *Record* |
| **Toggle Webcam Studio** | Click `📷` or Space to snap | Click `📷` or Space to snap |
| **Toggle Floating Camera Bubble** | Click `🙂` (Drag to move, Double-click to resize) | Click `🙂` (Drag to move, Double-click to resize) |
| **Pause / Resume Recording** | Pause button (macOS) | *macOS only* |
| **Cancel Capture Overlay** | `Esc` | `Esc` |

> Shortcuts can be reconfigured in **Settings → Keyboard shortcut**.

---

## 🛠️ Building from Source

### Prerequisites

- **Node.js**: `22.x` or later
- **Package Manager**: [pnpm](https://pnpm.io/) (`>= 8`)
- **Rust**: Latest stable (`rustup default stable`)
- **Platform-Specific**:
  - **macOS**: Xcode 16+ Command Line Tools (for Swift 5 and `ScreenCaptureKit`)
  - **Windows**: Visual Studio 2022 C++ build tools, `ffmpeg.exe` (placed in `src-tauri/binaries/`)
  - **Linux**: WebKit2GTK and build tools:
    ```bash
    sudo apt-get update && sudo apt-get install -y \
      libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
      libxdo-dev libxcb1-dev libxrandr-dev libdbus-1-dev ffmpeg pulseaudio-utils
    ```

### Local Setup & Development

```bash
# Clone the repository
git clone https://github.com/Foshati/camly.git
cd camly

# Setup dependencies, icons, and native helpers
pnpm setup

# Run the app in development mode with hot-reload
pnpm app
```

### Packaging Installers

```bash
# Build the native helper and package installers for current OS
pnpm bundle
```

Outputs will be generated in `src-tauri/target/release/bundle/`:
- **macOS**: `dmg/Camly_1.0.0_aarch64.dmg` or `macOS/Camly.app`
- **Windows**: `nsis/Camly_1.0.0_x64-setup.exe`, `msi/Camly_1.0.0_x64_en-US.msi`
- **Linux**: `deb/camly_1.0.0_amd64.deb`, `appimage/camly_1.0.0_amd64.AppImage`, `rpm/camly-1.0.0-1.x86_64.rpm`

---

## 🏗️ Project Architecture

```
camly/
├── .github/workflows/       # Automated multi-platform CI/CD release pipeline
├── recorder/                # Native Swift helper (macOS: ScreenCaptureKit + VideoToolbox)
│   ├── Capture.swift        # Screen capture stream management
│   ├── Compress.swift       # Video compression utility
│   ├── Encoding.swift       # Hardware-accelerated HEVC / H.264
│   ├── Recorder.swift       # Session orchestrator and JSON stdout event stream
│   ├── Screenshot.swift     # High-resolution display and window snaps
│   └── VoiceCleaner.swift   # Audio noise suppression & gain normalization
├── src/                     # React 19 Frontend
│   ├── components/          # Shared UI icons, logo, and buttons
│   ├── lib/                 # Tauri IPC bridges, camera utilities, formatters, settings
│   ├── windows/             # Multi-window views: Toolbar, Overlay, Preview, Library, Camera, Bubble
│   └── styles.css           # Modern Tailwind-inspired dark theme and glassmorphism styling
├── src-tauri/               # Rust Core (Tauri 2)
│   ├── src/
│   │   ├── lib.rs           # Plugin registration, window manager, single-instance lock
│   │   ├── recorder.rs      # Unified capture command dispatcher
│   │   ├── portable.rs      # Windows & Linux engine (FFmpeg + xcap + arboard)
│   │   ├── shortcut.rs      # System-wide configurable hotkey service
│   │   ├── tray.rs          # System tray icon and menu actions
│   │   └── windows.rs       # Window positioning, overlays, and toolbar behavior
│   └── tauri.conf.json      # Multi-window config, capabilities, and bundle metadata
└── scripts/                 # Build automation and icon generation scripts
```

---

## 🤖 CI / CD & Release Automation

Every tag push matching `v*` (e.g., `git tag v1.0.0 && git push origin v1.0.0`) triggers the automated GitHub Actions matrix workflow:
1. Compiles macOS binaries for both **Apple Silicon** (`aarch64`) and **Intel** (`x86_64`).
2. Bundles the Windows installer with portable FFmpeg.
3. Builds Debian (`.deb`), Red Hat (`.rpm`), and universal `.AppImage` packages on Ubuntu.
4. Gathers all binaries under a unified GitHub Release and automatically publishes it for users to download.

---

## 📄 License

Camly is open-source software licensed under the [MIT License](LICENSE).
Created with care by [Foshati](https://github.com/Foshati).
