# Camly support and troubleshooting

Start with [downloads and quick start](README.md#download) and the [platform support matrix](README.md#platform-support). The [Persian guide](README.fa.md) covers installation and common questions too.

## Common problems

| Symptom | What to check |
|---|---|
| No display/window available on macOS | Grant Screen Recording permission in System Settings → Privacy & Security, then restart Camly if requested |
| Camera or microphone unavailable | Check the OS privacy permissions, selected device, and whether another app is using it |
| Recording cannot start on Linux | Use X11; check `ffmpeg -version`, the save folder, and free disk space |
| No system audio on Linux | Check `pactl get-default-sink` and your PulseAudio-compatible audio service |
| No system audio on Windows | Dedicated automatic loopback capture is not implemented; microphone capture is supported |
| Recording stops early | Check free disk space and the configured minimum-free-space threshold |
| Video will not play elsewhere | Try a new recording with H.264 and MP4; HEVC support varies by player |
| Camera bubble absent from output | Capture the display or a region containing it; another application's window may exclude the bubble |
| Shortcut has no effect | Check Settings → Keyboard shortcut and conflicts with OS/application shortcuts |
| Installer produces an OS security warning | Check the download came from this repository's Releases page. Signing/notarization status is not guaranteed; follow your OS's documented trust process and report the exact message |

For Linux AppImage, install FFmpeg separately and make the file executable. DEB/RPM dependency resolution depends on the distribution and enabled repositories. Packages are built on Ubuntu 24.04 and are not guaranteed to work on older distributions.

## Ask for help

Search [existing issues](https://github.com/Foshati/camly/issues). If the problem is new, [open a bug report](https://github.com/Foshati/camly/issues/new?template=bug_report.yml) with:

- Camly version and installer filename.
- OS version, CPU architecture, and X11/Wayland session on Linux.
- Exact steps, capture target, audio inputs, and observed behavior.
- The error message and a short, sanitized example if useful.

Do not attach passwords, private recordings, or logs containing personal data. For a new capability, use the [feature request form](https://github.com/Foshati/camly/issues/new?template=feature_request.yml).
