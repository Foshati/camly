# Contributing to Camly

Thanks for helping improve Camly. Bug reports, feature proposals, documentation improvements, and tests on macOS, Windows, and Linux are welcome.

## Report a bug or suggest a feature

Search [existing issues](https://github.com/Foshati/camly/issues) first. Use the [bug report form](https://github.com/Foshati/camly/issues/new?template=bug_report.yml) for problems or the [feature request form](https://github.com/Foshati/camly/issues/new?template=feature_request.yml) for ideas. Describe the workflow and platform, and remove personal information from screenshots and logs.

For installation help, start with [SUPPORT.md](SUPPORT.md). Check the [platform matrix](README.md#platform-support) before reporting a currently unsupported feature as a regression.

## Make a change

1. Fork the repository and create a focused branch.
2. Follow the [development guide](docs/DEVELOPMENT.md) to set up your platform.
3. Keep the change focused. For a large feature, discuss its intended behavior in an issue first.
4. Run `pnpm build` to type-check and build the frontend. For Rust changes, run `cargo check --manifest-path src-tauri/Cargo.toml` after installing native dependencies. Build the Swift helper on macOS when changing recorder code.
5. Manually exercise the affected flow in the desktop app. Report your OS, capture target, audio inputs, and result in the pull request.
6. Update user-facing documentation when behavior or platform support changes. Keep the README, support guide, and release notes consistent.

Do not commit recordings with private content, generated installers, credentials, or local build output. Do not change version numbers or publish release tags for an ordinary contribution.

## Review expectations

Explain the problem, resulting behavior, and how you validated the change. UI changes should include a screenshot or short recording with private information removed. Changes to capture, encoding, permissions, and audio need explicit platform validation; a successful frontend build alone does not verify native recording.

Be respectful, describe reproducible problems, and give others room to disagree. Contributions are provided under the project's [MIT license](LICENSE).
