# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Kairo — Standalone Electron desktop app for church presentation and automation. Built with electron-vite + React + TypeScript + Tailwind CSS.

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
| `audio/` | Audio capture stream management |
| `stt/` | Speech-to-text provider abstraction (Deepgram / Whisper) |
| `scripture/` | Bible API lookup + reference parsing |
| `lyrics/` | Song library + OpenLyrics integration |

Services are not imported by the renderer directly — expose their output through IPC handlers in `src/main/ipc/index.ts`.

## Tailwind palette

Brand palette: onyx `#0C111D` (`ink`), off-white `#F9FAFB` (`paper`), slate `#374151` (`stone`) — brand marks only.
App chrome is grey with only a faint cool bias (blue +3–4 over red — grey, never navy), so colour comes only from the accent, live, tool hues and status.
Every UI color is a token in `src/renderer/src/index.css` (dark + light) — don't add raw hex for chrome.
- `surface-rail` / `surface-header` (darkest frame) → `surface` (workspace) → `surface-secondary` (sidebars, docks, cards) → `surface-tertiary` (controls, hover) → `surface-elevated` (lifted). Neighbouring regions always differ by a visible step. The page area is one rounded panel (`rounded-xl bg-surface`) inset by a gap on the chrome (header + rail) — no line between chrome and page. Inside the panel, columns split with a `--surface-line` hairline (`.hairline-r/-l/-t/-b`, inset so nothing shifts)
- `surface-stage` / `surface-display` — the band behind a screen canvas and the displays drawn on it
- `teal-{50-950}` — legacy name for the accent, now **blue** (`--accent-*`): what is picked (`.row-selected` pill, selected tabs/rows) and primary actions. CTAs are `bg-teal-500 text-on-accent hover:bg-teal-600`
- `live` / `bg-tint-live` — **red** (broadcast tally), used ONLY for what is on screen (live slide/media/page outline, live row). Blue picked and red live never look alike
- Tool hues `--hue-*` via `src/renderer/src/lib/hue.ts`: Operator green, Scripture blue (light sky, lighter than the accent), Lyrics violet, Documents cyan, Theme pink, Media orange. Used on icons and small marks only — never row backgrounds or body text. Coloured icons use Phosphor `weight="fill"` so the colour carries; neutral icons stay outlined. Rail icons are grey until active
- `amber-*` / `yellow-*` are remapped to neutral; `tint-amber` / `tint-yellow` are neutral washes. Red (errors) and green (ok) stay semantic
- `tint-*` — solid accent/status washes
- Modals use frosted glass, like ProPresenter's macOS windows: `.glass` on a modal's sidebar and title bar (content pane stays solid), `.modal-glass` on a whole small dialog. Scrims behind them are `bg-black/35` so colour can show through
- Settings and Screens follow macOS System Settings: traffic lights (`components/shared/MacTrafficLights.tsx`) top the glass sidebar, the open pane titles itself, blue pill for the open item. Settings-like content uses grouped boxes — title above, one rounded box, rows split by an inset line (`.pref-group`; `.pref-group-dim` on a dark `bg-surface` box). No boxes inside boxes

Reusable component classes defined in `index.css` `@layer components`: `.card`, `.btn-primary`, `.btn-secondary`, `.input`, `.label`, `.page-header`, `.page-subtitle`, `.badge-connected`, `.badge-disconnected`.

## Legacy files (safe to delete)

These are from the original Electron Forge scaffold and are no longer used:
`forge.config.ts`, `forge.env.d.ts`, `vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.ts`, `src/main.ts`, `src/preload.ts`, `src/renderer.ts`, root `index.html`
