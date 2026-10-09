# Building Camly from source

Camly uses Tauri 2, React 19, TypeScript, Rust, and a native Swift helper on macOS. Windows/Linux use the portable Rust capture engine with FFmpeg and xcap.

## Shared prerequisites

Install Node.js 22, pnpm 8 or later, stable Rust, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.

```bash
git clone https://github.com/Foshati/camly.git
cd camly
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` checks TypeScript and builds the frontend. It does not compile or exercise native capture. Existing icons are committed; regenerate them with `pnpm icons` only when changing the app icon (the Python icon script needs Pillow).

## macOS

Install Xcode Command Line Tools with a macOS 15 SDK. The helper targets macOS 15 and uses ScreenCaptureKit, AVFoundation, and VideoToolbox.

```bash
pnpm recorder
pnpm tauri dev
```

For an installer:

```bash
pnpm bundle
```

`pnpm app`, `pnpm setup`, and `pnpm bundle` invoke the Swift helper script and therefore are macOS-specific in the current project. Cross-building Intel on an Apple Silicon Mac also requires the Rust target and matching helper:

```bash
rustup target add x86_64-apple-darwin
TARGET_TRIPLE=x86_64-apple-darwin bash scripts/build-recorder.sh
pnpm tauri build --target x86_64-apple-darwin
```

## Windows

Install Visual Studio C++ Build Tools and WebView2 as described in the Tauri prerequisites. Development can use FFmpeg from PATH. Packaging requires an FFmpeg executable at `src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe`; the release workflow downloads and prepares it.

```powershell
pnpm tauri dev
pnpm tauri build
```

Run these commands directly instead of `pnpm app` / `pnpm bundle`, which invoke the macOS Swift build. Output installers are under `src-tauri/target/release/bundle/nsis/` and `msi/`.

## Linux

Use Ubuntu 24.04 or another distribution providing the equivalent development libraries. xcap's PipeWire dependencies require suitable recent headers. On Ubuntu 24.04:

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf libxdo-dev libxcb1-dev libxrandr-dev libdbus-1-dev \
  libpipewire-0.3-dev libclang-dev libwayland-dev libegl-dev libgbm-dev \
  libfuse2t64 file ffmpeg pulseaudio-utils
pnpm tauri dev
```

For packages:

```bash
NO_STRIP=true pnpm tauri build
```

The release workflow sets `NO_STRIP=true` to avoid linuxdeploy's bundled strip failing on newer ELF sections. Outputs are under `src-tauri/target/release/bundle/`. Screen recording currently needs X11; Wayland screen recording is not implemented.

## Validation and releases

- Frontend: `pnpm build`.
- Rust: `cargo check --manifest-path src-tauri/Cargo.toml` with native dependencies installed.
- Swift: `pnpm recorder` on macOS.
- Capture behavior: manually test the affected display/window/region, microphone, and media output in the native app.

The [release workflow](../.github/workflows/release.yml) builds macOS Apple Silicon/Intel, Windows x64, and Linux x86_64 installers on version tags. Its manual dispatch can rebuild selected platforms for an existing tag. A public release can contain only the platforms that succeeded; always inspect actual assets and workflow results before announcing support or downloads.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for pull requests and [the README](../README.md) for user-facing capabilities.
