# Scribble

Chat like you're passing notes.

Scribble is a real-time messaging app with end-to-end private DMs, group chats, native desktop notifications, and system tray integration — built with Tauri and Firebase.

## Features

- **Private DMs** — conversations are strictly client-to-client. No user can see another pair's messages
- **Private Groups** — create groups with random 6-character join codes, shared manually
- **Desktop Notifications** — native Windows toast notifications with sound
- **System Tray** — close hides to tray; right-click for Show / Quit
- **Dark Mode** — toggle between light and dark themes
- **Image Sharing** — upload and share images in chats
- **Auto Updates** — in-app update banner when a new version is released
- **Cross-Platform** — built with Tauri; runs on Windows, macOS, Linux

## Download

**[Download the latest version](https://lincolnhay69-ops.github.io/scribble-download/)**

Or use the web version at **[lincolnhay69-ops.github.io/Skribble](https://lincolnhay69-ops.github.io/Skribble/)**

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop Framework | [Tauri 2](https://v2.tauri.app) |
| Frontend | HTML / CSS / JavaScript |
| Backend | [Firebase](https://firebase.google.com) (Auth, Realtime DB, Storage) |
| Notifications | [tauri-plugin-notification](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/notification) |
| System Tray | Tauri tray-icon feature |
| Build System | npm + Cargo |

## Development

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Rust](https://rustup.rs)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)

### Setup

```bash
git clone https://github.com/lincolnhay69-ops/Skribble.git
cd Skribble
npm install
cd src-tauri
cargo build
cd ..
npm run tauri dev
```

### Release

```powershell
.\release.ps1
```

This single command builds the app, tags the release, creates a GitHub Release with the installer, deploys the web version, and updates Firebase.

## Release History

| Version | Date | Highlights |
|---|---|---|
| [v2.0.99](https://github.com/lincolnhay69-ops/Skribble/releases/tag/v2.0.99) | 2026-06-19 | DM privacy, groups, tray, notifications, auto-updates |
| [v2.0.80](https://github.com/lincolnhay69-ops/Skribble/releases/tag/v2.0.80) | 2026-06-17 | Initial public release |

## License

Open source. Built with love by [Lincoln](https://github.com/lincolnhay69-ops).
