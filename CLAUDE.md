# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Kairo — Electron desktop app for ProPresenter church tech automation. Built with electron-vite + React + TypeScript + Tailwind CSS.

## Commands

```bash
npm install        # install deps (use npm, not yarn)
npm run dev        # dev mode with hot reload
npm run build      # production build → out/
npm run lint       # ESLint on .ts/.tsx
npm run typecheck  # tsc check (node + web)
```

## Architecture

Three Electron process contexts, each built by electron-vite:

| Context | Entry | Notes |
|---------|-------|-------|
| Main (Node) | `src/main/index.ts` | electron-log initialized here |
| Preload (bridge) | `src/preload/index.ts` | exposes `window.api` via contextBridge |
| Renderer (React) | `src/renderer/index.html` + `src/renderer/src/main.tsx` | Vite + React |

**IPC contract:** All renderer↔main calls go through `window.api` (typed in `src/renderer/src/env.d.ts`). The preload bridges `ipcRenderer.invoke` → `ipcMain.handle`. New IPC channels: add handler in `src/main/ipc/index.ts`, extend the `api` object in `src/preload/index.ts`, extend `KairoAPI` type in `env.d.ts`.

**Persistent settings:** `electron-store` (v8, CJS-compatible) via `src/main/db/index.ts`. `AppSettings` interface defines all valid keys and defaults. Renderer accesses settings only via `window.api.settings.*`.

**Renderer state:** Zustand store at `src/renderer/src/stores/useAppStore.ts`. Holds runtime state (PP connection, transcription). Settings come from IPC not Zustand.

**Path alias:** `@/` → `src/renderer/src/` in renderer. `@main/` → `src/main/` in main/preload. Configured in both `electron.vite.config.ts` and `tsconfig.web.json`.

## Key constraints

- `nodeIntegration: false`, `contextIsolation: true` — never bypass.
- `externalizeDepsPlugin()` on main + preload — Node deps (electron-store, electron-log) are NOT bundled; they must be in `dependencies`, not `devDependencies`.
- Renderer deps (React, @phosphor-icons/react, Zustand, Tailwind) are bundled by Vite — fine in `devDependencies`.
- electron-store v8 (not v9+) — v9+ is ESM-only and breaks with Electron's CJS main process.
- electron-log: import as `electron-log/main` in main process, `electron-log/renderer` in renderer if needed.

## Workspace folder

One folder on disk owns operator-facing content, default `~/Documents/Kairo Presenter`
(changeable in Settings → General → Storage, stored as `workspace.folder`; `''` = default):

```
Kairo Presenter/
  Songs/   one <slug>__<id>.song.json per song — SOURCE OF TRUTH for the library
  Media/   backgrounds the media dock indexes (media.folder points here on fresh installs)
```

`workspaceService` (`src/main/services/workspace/`) creates the folders on launch, moves
them, and offers to adopt a pre-existing media folder. `lyricsService.syncFromFolder()`
rebuilds SQLite from `Songs/` at startup — a deleted file removes the song, a dropped-in
file adds one. `lyrics.db` in userData is a search/index cache, not the record.
Song file read/write helpers: `src/main/services/lyrics/song-files.ts`; the file format
and path helpers are shared in `src/lib/workspace.ts`.

## Service layer (`src/main/services/`)

Each service is a singleton class exported as a named instance:

| Service | Purpose |
|---------|---------|
| `propresenter/` | WebSocket connection to ProPresenter Stage Display API |
| `audio/` | Audio capture stream management |
| `stt/` | Speech-to-text provider abstraction (Deepgram / Whisper) |
| `scripture/` | Bible API lookup + reference parsing |
| `lyrics/` | Song library + OpenLyrics integration |

Services are not imported by the renderer directly — expose their output through IPC handlers in `src/main/ipc/index.ts`.

## Tailwind palette

Brand palette: onyx `#0C111D` (primary, `ink`), off-white `#F9FAFB` (`paper`), slate `#374151` (muted, `stone`), cobalt `#315EDE` (live).
Every UI color is a token in `src/renderer/src/index.css` (dark + light), blended from these four — don't add raw hex for chrome.
- `surface` / `surface-secondary` / `surface-tertiary` / `surface-rail` / `surface-header` / `surface-elevated` / `surface-border` — background layers
- `teal-{50-950}` — legacy name for the accent: white (paper) in dark, ink in light, via `--accent-*` vars. CTAs are `bg-teal-500 text-on-accent hover:bg-teal-600`
- `live` / `bg-tint-live` — `#315EDE`, used ONLY for what is on screen (live slide/media/page outline, live row). Picked/selected stays white, so the two never look alike. One exception: the header update pill (`UpdatePill.tsx`) is solid blue so a pending update is noticed
- `ink`, `paper`, `stone` — the raw brand colors; Tailwind `white` is paper
- `amber-*` / `yellow-*` are remapped to the neutral accent too — the old warm gold is retired; `tint-amber` / `tint-yellow` are neutral washes. Red (errors) and green (ok) stay semantic
- `tint-*` — solid accent/status washes

Reusable component classes defined in `index.css` `@layer components`: `.card`, `.btn-primary`, `.btn-secondary`, `.input`, `.label`, `.page-header`, `.page-subtitle`, `.badge-connected`, `.badge-disconnected`.

## Legacy files (safe to delete)

These are from the original Electron Forge scaffold and are no longer used:
`forge.config.ts`, `forge.env.d.ts`, `vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.ts`, `src/main.ts`, `src/preload.ts`, `src/renderer.ts`, root `index.html`
