# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ProAutomate — Electron desktop app for ProPresenter church tech automation. Built with electron-vite + React + TypeScript + Tailwind CSS.

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

**IPC contract:** All renderer↔main calls go through `window.api` (typed in `src/renderer/src/env.d.ts`). The preload bridges `ipcRenderer.invoke` → `ipcMain.handle`. New IPC channels: add handler in `src/main/ipc/index.ts`, extend the `api` object in `src/preload/index.ts`, extend `ProAutomateAPI` type in `env.d.ts`.

**Persistent settings:** `electron-store` (v8, CJS-compatible) via `src/main/db/index.ts`. `AppSettings` interface defines all valid keys and defaults. Renderer accesses settings only via `window.api.settings.*`.

**Renderer state:** Zustand store at `src/renderer/src/stores/useAppStore.ts`. Holds runtime state (PP connection, transcription). Settings come from IPC not Zustand.

**Path alias:** `@/` → `src/renderer/src/` in renderer. `@main/` → `src/main/` in main/preload. Configured in both `electron.vite.config.ts` and `tsconfig.web.json`.

## Key constraints

- `nodeIntegration: false`, `contextIsolation: true` — never bypass.
- `externalizeDepsPlugin()` on main + preload — Node deps (electron-store, electron-log) are NOT bundled; they must be in `dependencies`, not `devDependencies`.
- Renderer deps (React, lucide-react, Zustand, Tailwind) are bundled by Vite — fine in `devDependencies`.
- electron-store v8 (not v9+) — v9+ is ESM-only and breaks with Electron's CJS main process.
- electron-log: import as `electron-log/main` in main process, `electron-log/renderer` in renderer if needed.

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

Custom colors:
- `surface` / `surface-secondary` / `surface-tertiary` / `surface-elevated` / `surface-border` — dark background layers
- `teal-{50-950}` — primary accent (teal)
- `navy-{50-950}` — secondary accent (dark blue)

Reusable component classes defined in `index.css` `@layer components`: `.card`, `.btn-primary`, `.btn-secondary`, `.input`, `.label`, `.page-header`, `.page-subtitle`, `.badge-connected`, `.badge-disconnected`.

## Legacy files (safe to delete)

These are from the original Electron Forge scaffold and are no longer used:
`forge.config.ts`, `forge.env.d.ts`, `vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.ts`, `src/main.ts`, `src/preload.ts`, `src/renderer.ts`, root `index.html`
