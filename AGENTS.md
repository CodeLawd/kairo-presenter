# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project

Kairo — Standalone Electron desktop app for church presentation and automation. Built with electron-vite + React + TypeScript + Tailwind CSS.

## Commands

```bash
bun install        # install deps (use Bun)
bun run dev        # dev mode with hot reload
bun run build      # production build → out/
bun run lint       # ESLint on .ts/.tsx
bun run typecheck  # tsc check (node + web)
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

Custom colors:
- `surface` / `surface-secondary` / `surface-tertiary` / `surface-elevated` / `surface-border` — dark background layers
- `teal-{50-950}` — primary accent (teal)
- `navy-{50-950}` — secondary accent (dark blue)

Reusable component classes defined in `index.css` `@layer components`: `.card`, `.btn-primary`, `.btn-secondary`, `.input`, `.label`, `.page-header`, `.page-subtitle`, `.badge-connected`, `.badge-disconnected`.

## Releases

Cut a release with `bun run release` (a patch; or `minor`, `major` or an exact version like `1.4.0`).
`scripts/release.mjs` checks the tree is clean, runs typecheck and tests, bumps, tags and pushes;
the tag builds and publishes every platform.

**Every release adds its changelog entry first.** The public `/changelog` page reads
`website/src/lib/changelog.ts`. Before running the release, add an entry for the *new* version at
the top of the list and commit it:
- `version` (no `v`), `date` (YYYY-MM-DD, the release day), a short `title`, and 2–4 `notes`.
- Write for church teams, not developers: what they can now do, or what got fixed, in plain words.
  No commit hashes, file names, env vars or API details. Draft it from the commits since the last
  tag (`git log v<last>..HEAD`).
- Skip it only when nothing changes that a church would notice (CI, tests, build plumbing):
  `bun run release --skip-changelog`.

The release script stops, before changing anything, if the entry is missing.

## Legacy files (safe to delete)

These are from the original Electron Forge scaffold and are no longer used:
`forge.config.ts`, `forge.env.d.ts`, `vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.ts`, `src/main.ts`, `src/preload.ts`, `src/renderer.ts`, root `index.html`
