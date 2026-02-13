# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DevTerm is an Electron-based developer terminal application with SSH support, split panes, SFTP file upload, and theme customization. It uses node-pty for local shell processes, ssh2 for remote connections, and xterm.js for terminal rendering.

## Commands

```bash
npm start          # Launch the app
npm run dev        # Launch in dev mode
npm test           # Run all tests (Jest)
npm run lint       # Lint src/ and tests/
npm run build      # Build Windows installer (electron-builder)
npm run pack       # Build unpacked directory

# Run a single test file
npx jest tests/terminal-manager.test.js --forceExit --detectOpenHandles
```

## Architecture

### Process Model (Electron)

- **Main process** (`src/main/`): Manages terminal processes, SSH connections, credentials, and GitHub setup. Entry point is `main.js`.
- **Preload** (`src/preload/preload.js`): Exposes `window.electronAPI` via contextBridge. All renderer-to-main communication goes through this API.
- **Renderer** (`src/renderer/`): Pure browser JS (no bundler). Classes are attached to `window` (e.g., `window.DevTerm`, `window.ThemeManager`). Scripts loaded via `<script>` tags in `index.html`.

### Main Process Modules

| Module | Role |
|---|---|
| `terminal-manager.js` | Spawns/manages local pty processes (PowerShell on Windows, $SHELL on Unix). Max 8 terminals. |
| `ssh-manager.js` | SSH terminal sessions and SFTP uploads via ssh2. `SSHTerminal` extends EventEmitter. |
| `credential-store.js` | Persists SSH profiles and GitHub configs as JSON in `app.getPath('userData')`. Encrypts passwords/PATs with `safeStorage`. |
| `github-setup.js` | Automates GitHub SSH key setup on remote servers (keygen, add to GitHub API, configure git, clone repo). |
| `ipc-handlers.js` | Registers all `ipcMain.handle`/`ipcMain.on` handlers. Central bridge between main and renderer. |
| `config.js` | Constants: `MAX_TERMINALS`, default shell, platform, home dir. |

### Renderer Modules

| Module | Role |
|---|---|
| `app.js` | `DevTermApp` class — manages pane layout (single, split-v/h, quad, 3-pane variants), toolbar, and coordinates all panels. |
| `terminal-bridge.js` | `TerminalBridge` class — maps terminal IDs to xterm.js instances, routes data between renderer and main. |
| `ssh-panel.js` | `SSHPanel` class — SSH profile management UI and SFTP upload modal with file tree selection. |
| `github-panel.js` | `GitHubPanel` class — UI for GitHub auto-config wizard (PAT validation, step-by-step progress). |
| `commands.js` | `CommandsManager` — saved commands panel, persisted in localStorage. |
| `shortcuts.js` | Global keyboard shortcuts (Ctrl+\, Ctrl+-, Ctrl+1-4, Ctrl+W, Ctrl+B, Ctrl+Shift+S/U/G). |
| `theme.js` | `ThemeManager` — 6 themes (dark, monokai, dracula, nord, solarized, gruvbox) via CSS custom properties. |

### IPC Communication Pattern

All IPC flows through `preload.js` which exposes typed methods on `window.electronAPI`. Terminal I/O uses `ipcRenderer.send` (fire-and-forget) for input/resize/close. Profile CRUD and SSH creation use `ipcRenderer.invoke` (async request/response). Progress events (upload, GitHub setup) use `ipcRenderer.on` with cleanup functions returned.

### Data Storage

- SSH profiles: `{userData}/ssh-profiles.json` (passwords encrypted via Electron safeStorage)
- GitHub configs: `{userData}/github-configs.json` (PATs encrypted)
- Theme/font/commands: `localStorage` in renderer

## Code Style

- ESLint: single quotes, mandatory semicolons, `no-console` off
- Unused function params prefixed with `_` (e.g., `_event`)
- CommonJS modules (`require`/`module.exports`), no bundler
- Node-pty spawned with `useConpty: false` on Windows
