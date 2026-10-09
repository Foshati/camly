![Camly: screen recording, screenshots and webcam capture, compact by default](docs/assets/camly-banner.svg)

<div align="center">
  <p>
    <a href="https://github.com/Foshati/camly">
      <img src="app-icon.png" alt="Camly logo" width="144" height="144" />
    </a>
  </p>
  <h1>Camly</h1>
  <p>
    <strong>Screen recording. Screenshots. Webcam capture.</strong><br />
    Compact by default. Saved locally.
  </p>
  <hr />
  <p>
    <a href="https://github.com/Foshati/camly/releases/latest"><img src="https://img.shields.io/github/v/release/Foshati/camly?style=for-the-badge&amp;label=download&amp;color=3b82f6" alt="Download the latest Camly release" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/Foshati/camly?style=for-the-badge&amp;color=10b981" alt="MIT license" /></a>
    <a href="https://github.com/Foshati/camly/actions/workflows/check.yml"><img src="https://img.shields.io/github/actions/workflow/status/Foshati/camly/check.yml?branch=main&amp;style=for-the-badge&amp;label=build" alt="Frontend build status" /></a>
    <a href="https://github.com/Foshati/camly/stargazers"><img src="https://img.shields.io/github/stars/Foshati/camly?style=for-the-badge&amp;color=f59e0b" alt="GitHub stars" /></a>
  </p>
  <p>
    <a href="https://github.com/Foshati/camly/releases/latest"><strong>Download Camly</strong></a> &nbsp;·&nbsp;
    <a href="#features">Features</a> &nbsp;·&nbsp;
    <a href="#platform-support">Platform support</a> &nbsp;·&nbsp;
    <a href="#faq">FAQ</a> &nbsp;·&nbsp;
    <a href="CONTRIBUTING.md">Contribute</a>
  </p>
</div>

**Camly is a free, open-source desktop screen recorder, screenshot tool, and webcam recorder for macOS, Windows, and Linux (X11).** Capture a display, an application window, or a selected area; keep recordings on your computer; and use compact quality presets for product demos, tutorials, and bug reports.

## Why Camly?

- **Quick screen capture:** take screenshots or record a full display, window, or custom region from a floating toolbar.
- **Smaller recordings by default:** the Compact preset targets up to 1080p. macOS uses hardware HEVC encoding; Windows and Linux use FFmpeg H.264 encoding.
- **Local workflow:** save recordings and screenshots to a folder you choose, then preview, copy, or reveal them in your file manager. No account is required.
- **Camera tools in the same app:** take webcam photos, record camera clips, or show a movable face-cam bubble during screen recording.
- **Open to inspection and contribution:** built with Tauri 2, React 19, TypeScript, Rust, and a native Swift capture helper on macOS. Licensed under MIT.

Camly fits short software walkthroughs, reproducible bug reports, narrated tutorials, and everyday screenshots. File size depends on content, duration, frame rate, and preset; there is no fixed compression ratio.

## Download

Download installers from the **[latest GitHub release](https://github.com/Foshati/camly/releases/latest)**. These links point to the verified **v1.1.0** assets; the latest-release page is the source of truth for newer versions and available builds.

| System | Architecture | Installer |
|---|---|---|
| macOS 15+ | Apple Silicon | [DMG for Apple Silicon](https://github.com/Foshati/camly/releases/download/v1.1.0/Camly_1.1.0_aarch64.dmg) |
| macOS 15+ | Intel | [DMG for Intel](https://github.com/Foshati/camly/releases/download/v1.1.0/Camly_1.1.0_x64.dmg) |
| Windows 10 / 11 | x64 | [EXE installer](https://github.com/Foshati/camly/releases/download/v1.1.0/Camly_1.1.0_x64-setup.exe) · [MSI installer](https://github.com/Foshati/camly/releases/download/v1.1.0/Camly_1.1.0_x64_en-US.msi) |
| Linux | x86_64 | [DEB](https://github.com/Foshati/camly/releases/download/v1.1.0/Camly_1.1.0_amd64.deb) · [AppImage](https://github.com/Foshati/camly/releases/download/v1.1.0/Camly_1.1.0_amd64.AppImage) · [RPM](https://github.com/Foshati/camly/releases/download/v1.1.0/Camly-1.1.0-1.x86_64.rpm) |

On macOS, open the DMG and drag **Camly.app** into **Applications**. On Windows, choose the EXE for a typical installation. On Linux, use the package for your distribution or make the AppImage executable before running it. Linux recordings require an **X11 session**, **FFmpeg**, and PulseAudio-compatible audio tools; see [platform support](#platform-support).

## Get started

1. Install and launch Camly. Grant screen capture permission, and camera or microphone permission if you use those features.
2. Open the toolbar with **⌘ Shift 2** on macOS or **Ctrl Shift 2** on Windows/Linux.
3. Choose **Screenshot** or **Record**, then select a display, window, or region.
4. Choose your save folder, microphone, and quality preset in Settings. Start capturing; use the toolbar or global shortcut to finish a recording.
5. Open the media library to preview the result, copy screenshots, or reveal a file in Finder, Explorer, or Files.

For a first test, record a short clip and play it back to check the selected microphone, audio, and output format.

## Features

| Feature | What you can do |
|---|---|
| Screen recorder | Record a display, application window, or selected region |
| Screenshot tool | Save screen captures, copy to the clipboard, and preview the result |
| Webcam recorder | Take camera photos and record webcam clips with camera and microphone selection |
| Face-cam bubble | Move the camera overlay and change its size or shape |
| Quality presets | Choose Compact (up to 1080p), Balanced (up to 1440p), Retina (native pixels), or Custom |
| Video compression | Drop an existing video into the library to compress it locally |
| Media library | Filter recordings, screenshots, and camera clips; preview, reveal, copy, or trash files |
| Recording safeguards | Fragmented MP4/MOV output and a configurable low-disk auto-stop threshold |
| Keyboard shortcut | Remap the global toolbar/stop shortcut in Settings |

The camera bubble is a desktop overlay: whether it appears in a recording depends on the selected capture target. Capture the display or a region containing it when you want it included; it is not a universal compositor for window-only recordings.

### Quality and formats

**Compact** is the default, using 30 fps initially and up to 1080p. **Balanced** allows up to 1440p; **Retina** keeps native pixels. Frame rate is a separate 30/60 fps setting, so changing the preset does not automatically change it. **Custom** exposes resolution and bitrate controls.

Screen recordings support MP4/MOV containers and HEVC/H.264 choices. For sharing with a player that cannot decode HEVC, choose **H.264 + MP4**. Webcam capture uses formats supported by the platform webview, with an optional local conversion step. Screenshot formats also depend on the capture engine.

## Platform support

| Capability | macOS 15+ | Windows 10 / 11 | Linux |
|---|---|---|---|
| Screen recording engine | ScreenCaptureKit / Swift | FFmpeg gdigrab | FFmpeg x11grab (X11 only) |
| Screenshots | ScreenCaptureKit | xcap | xcap; session permissions vary |
| Video encoding | VideoToolbox hardware encoding | Software libx264 / libx265 | Software libx264 / libx265 |
| Microphone recording | Native capture | DirectShow devices | PulseAudio-compatible input |
| System audio recording | Supported | No dedicated loopback capture implemented | Default sink monitor through pactl |
| Screen recording pause/resume | Supported | Not implemented | Not implemented |
| FFmpeg installation | Native screen capture does not require FFmpeg | Included in release installers | Install separately; DEB/RPM declare dependencies |

**Linux Wayland screen recording is not implemented.** Use an X11 login session for screen recordings. Screenshots use a separate xcap path and depend on compositor permissions. Linux release packages are built on Ubuntu 24.04; compatibility with older distributions is not guaranteed.

## FAQ

### Is Camly free and open source?

Yes. Camly is distributed under the [MIT license](LICENSE), and its source code is available in this repository. You can use, modify, and redistribute it under the license terms.

### Does Camly upload my screen recordings?

Camly's capture, compression, and media library run locally. The current application code has no account login, cloud upload service, or analytics integration. Files are saved to the configured output folder; sharing them is a separate action you control.

### Can I record my screen with a webcam overlay?

Yes. Enable the face-cam bubble from the toolbar, position it over the display or region you are capturing, and record a short test. Capturing only another application's window may exclude the bubble.

### Can I record system audio and a microphone?

macOS supports both. Linux uses a microphone input and a default sink monitor when the relevant audio tools are available. Windows supports microphone capture through DirectShow; automatic system-audio loopback is not implemented.

### Why is my video large, or incompatible with another player?

Try Compact and 30 fps for smaller files. For broad playback compatibility, choose H.264 with MP4. Busy scenes and longer recordings produce larger files even with the same preset.

### What if recording does not start?

Check screen capture permissions, your save folder, and free disk space. On Linux, check that you are using X11 and that FFmpeg is on your PATH. See [support and troubleshooting](SUPPORT.md) or [report a bug](https://github.com/Foshati/camly/issues/new?template=bug_report.yml).

### Is Camly an alternative to Loom or OBS Studio?

Camly is an option for local screenshots, short screen recordings, and webcam capture. It does not currently provide Loom-style hosted sharing or OBS-style streaming and scene composition. Choose it when you want a compact local capture workflow.

## Build from source

You need **Node.js 22**, **pnpm 8+**, stable Rust, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). macOS additionally needs Xcode Command Line Tools with the macOS 15 SDK. Windows/Linux use the portable engine and have a different setup from the Swift helper.

```bash
git clone https://github.com/Foshati/camly.git
cd camly
pnpm install --frozen-lockfile
pnpm build
```

Then follow the **[development guide](docs/DEVELOPMENT.md)** for your platform's native dependencies, development command, and packaging instructions.

## Architecture

| Directory | Responsibility |
|---|---|
| [src/windows/](src/windows) | React toolbar, capture overlay, library, preview, webcam, and camera bubble |
| [src/lib/](src/lib) | Tauri IPC, settings, camera helpers, and platform utilities |
| [src-tauri/src/](src-tauri/src) | Rust app core, windows, shortcuts, tray, and portable capture engine |
| [recorder/](recorder) | Native Swift screen capture, screenshots, encoding, audio, and compression on macOS |
| [scripts/](scripts) | Native helper and icon build scripts |
| [.github/workflows/](.github/workflows) | Build checks and installer release automation |

## Help improve Camly

Found a problem? [Report a bug](https://github.com/Foshati/camly/issues/new?template=bug_report.yml). Have an idea? [Suggest a feature](https://github.com/Foshati/camly/issues/new?template=feature_request.yml). Code, documentation, translations, and platform testing are welcome; start with [CONTRIBUTING.md](CONTRIBUTING.md).

If Camly is useful to you, **[star the repository](https://github.com/Foshati/camly)** to bookmark it and help others discover it. Sharing a real capture workflow or reporting a reproducible issue also helps the project grow.

Created by [Foshati](https://github.com/Foshati). [MIT license](LICENSE).
