# Plan: NDI Scripture Renderer — true in-app theming (Phase 2) — REV 3

**Status:** ready for implementation (rev 3 — adds settings normalizer/migration, mode-precedence table, HTML-escaping requirements, `library` clear mechanism, restored OverlayTheme schema)
**Implementer:** Sonnet subagent
**Reviewer:** Fable (main session)
**Depends on:** phase 1 (2026-07-08-overlay-theme.md) — already merged into working tree.

## Goal

The app renders the scripture slide itself — background, font, size, color, position controlled by an in-app Theme editor with pixel-exact preview — and delivers it to ProPresenter as an NDI video source. PP shows it like any video input.

## Feasibility — already spiked, do not re-verify

- `grandiose-mac@0.0.6` loads and sends on this machine (macOS arm64, Node 22): sender created, 30fps BGRA 1920×1080 sustained, source discoverable as `JOSHUAS-MACBOOK-PRO.LOCAL (ProAutomate Scripture)`.
- PP 19.0.1 exposes `GET /v1/video_inputs` (returns `[]` until user adds an input in PP UI).
- **Verified in M0 (user-assisted):** video-input trigger endpoint shape; PP's handling of NDI alpha. Both BLOCK M1 — see M0.

## Decisions locked in this revision

**D1 — Output precedence per mode (`overlay.mode`).** Exact truth table — implement precisely this:

| mode | 1st | 2nd | 3rd |
|---|---|---|---|
| `auto` (default) | library match | NDI (if ready) | message overlay |
| `ndi` | NDI (library NEVER searched) | message overlay + health warning | — |
| `message` | library match | message overlay | — (NDI never used) |

`message` mode is deliberately identical to phase-1 shipped behavior: **library-first**, then message overlay. The only mode that skips the library search is `ndi` (user explicitly chose their own rendering). `presentScripture` branches on mode BEFORE the `searchLibraries` call — the Path A early-return currently at orchestrator.ts:461 moves inside the mode branch.

**D2 — Clear semantics are mechanism-aware.** Orchestrator tracks `lastOverlayMechanism: 'library' | 'ndi' | 'message' | null`, set on EVERY successful present — including the library path (this prevents a stale value: e.g. message push, then library present, then Clear must not fire a redundant message-clear against the live library slides... it may, harmlessly, but the mapping below keeps intent clear). `clearOverlay()` and the auto-clear timer act on it:
- `library`: `GET /v1/clear/layer/presentation`.
- `ndi`: overlay window → blank/transparent frame, AND `GET /v1/clear/layer/presentation` (removes the triggered video input).
- `message`: clearScriptureMessage + clearMessages (phase-1 behavior).
- `null`/unknown (e.g. after app restart): clear all three — idempotent and cheap.
`proPresenterService.clearAll()` also gains the NDI frame reset (it already clears both PP layers).

**D3 — Settings shape: everything nests under the existing `overlay` object.** No new top-level key; one merge path in Settings.tsx (`{ ...prev.overlay, ...stored.overlay }` already exists — extend its defaults):
```ts
overlay: {
  // — phase 1 (existing, unchanged) —
  template: string; showTranslation: boolean; showVerseNumbers: boolean;
  maxVerses: number; autoClearSec: number;
  // — phase 2 (new) —
  mode: 'auto' | 'ndi' | 'message'   // default 'auto'
  ppVideoInputUuid: string           // default '' — persisted after discovery (D7)
  theme: OverlayTheme                // default: DEFAULT_OVERLAY_THEME below
}
```
**Migration is mandatory — electron-store does NOT deep-merge.** `conf` shallow-`Object.assign`s defaults at startup, so an existing user's stored `overlay` object (phase-1 shape, no `mode`/`theme`) wholesale-replaces the default and `store.get('overlay').mode` comes back `undefined`. Requirements:
1. `src/lib/overlay-defaults.ts` (shared, no Node/DOM APIs): export `DEFAULT_OVERLAY_SETTINGS` (full object incl. `DEFAULT_OVERLAY_THEME`) and `normalizeOverlaySettings(raw: unknown): AppSettings['overlay']` — spreads defaults at every nesting level (`overlay`, `overlay.theme`, and each theme sub-object: background/verse/reference/layout), tolerates `undefined`/partial input.
2. One-time write-back migration in `src/main/db/index.ts` right after store creation: `store.set('overlay', normalizeOverlaySettings(store.get('overlay')))` — disk copy healed on first launch.
3. Every consumer still calls `normalizeOverlaySettings(store.get('overlay'))` instead of raw `store.get` (orchestrator, IPC handlers) — belt and braces; renderer Settings/Theme pages use it when hydrating.

**D4 — Overlay HTML asset loading (the dev-works/prod-blank trap):** use electron-vite's `?asset` import — `import overlayHtml from './overlay.html?asset'` in `overlay-window.ts`, then `win.loadFile(overlayHtml)`. electron-vite copies the file into `out/main/chunks|assets` and rewrites the path for both dev and build. Add `src/main/services/ndi/overlay.html` as the file. **Acceptance includes a production check:** `npm run build` then `npx electron out/main/index.js` (or the build's start command) must show the NDI sender working with the real asset path — not just dev mode.

**D5 — Shared template = single source of truth for WYSIWYG.** `src/lib/overlay-template.ts` exports:
- `renderOverlayHTML(theme: OverlayTheme, reference: string, text: string): string` — returns the inner markup + inline styles (pure function, no DOM/Node APIs, importable by both worlds).
- overlay.html is a minimal shell (`<body>` + container div + a `window.__setContent(html)` script). Main updates it via `webContents.executeJavaScript('window.__setContent(...)')` with the rendered string (JSON-stringified).
- The renderer Theme page preview renders the same `renderOverlayHTML` output via `dangerouslySetInnerHTML` inside a scaled 16:9 box. Same string in, same pixels out.

**D5a — Escaping and value constraints (required, not optional).** Verse text arrives from STT/LLM/Bible DB/manual input — treat as untrusted:
- `reference` and `text` MUST pass through an `escapeHtml()` (escape `& < > " '`) before interpolation into markup. Line breaks: escape first, then convert `\n` → `<br>`.
- Theme values are interpolated into inline CSS — constrain, don't trust: colors validated against `/^#[0-9a-fA-F]{3,8}$|^rgba?\([\d.,\s%]+\)$/` (fallback to default on mismatch); every numeric field clamped to a sane range (e.g. fontSizePx 12–200, opacity 0–1, angleDeg 0–360, maxWidthPct 20–100); `fontFamily` used as a quoted CSS string with `"`/`;`/`}`/backslash stripped; enum fields (`align`, `position`, etc.) validated against their literal unions.
- `normalizeOverlaySettings` (D3) is the single place that enforces the clamps/validation, so `renderOverlayHTML` can assume a sane theme — but it still escapes reference/text itself.

**D6 — Theme editor is a new sidebar route, not a Settings section.** The Settings modal is 840×640 — too small for editor + preview. Files:
- `src/renderer/src/App.tsx`: add `'theme'` to `NavRoute`, add to `views` map.
- `src/renderer/src/components/layout/Sidebar.tsx`: add nav entry (icon: `Palette` from lucide-react), label "Theme".
- `src/renderer/src/components/theme/ThemeEditor.tsx`: the page.
The `overlay.mode` selector ALSO lives on this page (radio: Auto / NDI (custom theme) / PP message), next to a status line showing NDI availability + PP video-input state.

**D7 — PP video input binding: persist uuid, name-match only as discovery.** On connect (and on demand before a push when uuid empty): `GET /v1/video_inputs`; if `overlay.ppVideoInputUuid` is set and present in the list → use it. Else find by name containing `ProAutomate`; if found, persist its uuid via `store.set`. If neither → NDI not ready (health warning + fallback per D1). Never hard-fail a push over discovery.

## OverlayTheme schema (concrete — implement exactly; add to `src/lib/ipc.ts`)

```ts
export interface OverlayTheme {
  background: {
    type: 'color' | 'gradient' | 'transparent'
    color: string          // '#0b1220'
    color2?: string        // gradient end; used when type === 'gradient'
    angleDeg?: number      // gradient angle, 0–360
    opacity: number        // 0–1, applies to the whole background layer
  }
  verse: {
    fontFamily: string     // CSS family list
    fontSizePx: number     // 12–200
    fontWeight: number     // 100–900
    color: string
    lineHeight: number     // 0.9–2.5
    align: 'left' | 'center' | 'right'
    shadow: boolean        // text-shadow for legibility over video
  }
  reference: {
    show: boolean
    position: 'above' | 'below'
    fontFamily: string
    fontSizePx: number
    fontWeight: number
    color: string
    uppercase: boolean
  }
  layout: {
    position: 'lower-third' | 'center' | 'top' | 'full'
    maxWidthPct: number    // 20–100
    paddingPx: number      // 0–200
    backdropBox: boolean   // rounded box behind the text block
    backdropColor: string  // rgba recommended
    backdropRadiusPx: number // 0–64
  }
}

export const DEFAULT_OVERLAY_THEME: OverlayTheme = {
  background: { type: 'transparent', color: '#0b1220', opacity: 1 },
  verse: {
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
    fontSizePx: 54, fontWeight: 600, color: '#ffffff',
    lineHeight: 1.35, align: 'center', shadow: true,
  },
  reference: {
    show: true, position: 'below',
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
    fontSizePx: 32, fontWeight: 700, color: '#5eead4', uppercase: false,
  },
  layout: {
    position: 'lower-third', maxWidthPct: 82, paddingPx: 48,
    backdropBox: true, backdropColor: 'rgba(3, 10, 20, 0.75)', backdropRadiusPx: 16,
  },
}
```

(Type lives in `src/lib/ipc.ts` next to `AppSettings`; `DEFAULT_OVERLAY_THEME` + `DEFAULT_OVERLAY_SETTINGS` + `normalizeOverlaySettings` live in `src/lib/overlay-defaults.ts` per D3.)

## Architecture

```
Theme page (renderer) ── renderOverlayHTML(theme, sample) ──► WYSIWYG preview
        │ settings IPC (overlay.theme / overlay.mode)
        ▼
Main: OverlayRenderer (offscreen BrowserWindow 1920×1080, transparent, frame:false, offscreen:true)
        │ executeJavaScript(__setContent(renderOverlayHTML(...)))
        │ 'paint' → NativeImage.getBitmap() (BGRA on macOS)
        ▼
Main: NdiService (grandiose-mac sender "ProAutomate Scripture", ~10fps repeat loop of last frame)
        ▼
PP Video Input (NDI) — trigger endpoint verified in M0 → presentation layer
```

### Components

**`src/main/services/ndi/index.ts` — NdiService singleton**
- `require('grandiose-mac')` inside try/catch at init; failure → `available = false`, everything else no-ops. Never crash main over NDI.
- `start()`: create sender `{ name: 'ProAutomate Scripture', clockVideo: true }`; frame loop repeats current buffer ~10fps (100ms interval). Initial frame: fully transparent 1920×1080 (alpha 0) pending M0 alpha verdict.
- `updateFrame(bgraBuffer, w, h)`, `clearFrame()` (back to transparent), `stop()` (release sender; wire `app.on('before-quit')`).
- Frame fields: fourCC `1094862674` ('BGRA'), `lineStrideBytes = w*4`, progressive, 30000/1001.
- `getStatus(): { available, sending }`.

**`src/main/services/ndi/overlay-window.ts`**
- Offscreen hidden BrowserWindow per D4/D5; `setFrameRate(10)`; `paint` → `ndiService.updateFrame`.
- `showScripture(reference, text, theme)`, `clear()`.
- Lazy-create on first use; only when NdiService.available.

**Orchestrator (`src/main/orchestrator.ts`)**
- `presentScripture` restructured per D1; `pushScriptureOverlay` gains an NDI branch; `lastOverlayMechanism` per D2; auto-clear + `clearOverlay()` + `testOverlay()` all mode-aware (test button exercises whichever mechanism the current mode selects).
- NDI push sequence: ensure video input binding (D7) → overlayWindow.showScripture → wait one paint (or ~150ms) → trigger video input → mark mechanism.

**IPC (3-file pattern per CLAUDE.md)**
- `NDI.GET_STATUS: 'ndi:getStatus'` → `{ available, sending, ppInputConfigured }` (invoke).
- Theme/mode persist through existing settings API — no extra channels.

## Native-module constraints

- `grandiose-mac` in `dependencies` (externalized by `externalizeDepsPlugin()` — native .node can't bundle).
- N-API prebuild expected to load in Electron main; **M0 confirms inside the real app**. If ABI mismatch: add `@electron/rebuild` devDependency + postinstall. Test, don't assume.

## Milestones

**M0 — de-risk (no UI). BLOCKS M1 on two live verifications:**
1. Add dep; NdiService with the spike's hardcoded test frame; start unconditionally on app launch (log availability).
2. `npm run dev` → main logs sender creation (ABI OK). Also run the **production build check from D4**.
3. **USER STEP — DONE 2026-07-08.** `GET /v1/video_inputs` shape (flat, NOT nested under `id`):
   `[{"uuid":"8D0AE33F-…","name":"Input 1: Input 1","index":0},{"uuid":"34825979-1865-447B-B81E-3FEB3699FD0B","name":"Input 2","index":1}]`
   **Finding: PP names video inputs "Input N" — it does NOT expose the NDI source name.** The D7 name-contains-"ProAutomate" discovery can never match; uuid was bound manually in settings for now. **Follow-up required:** Theme page needs a video-input picker (list from `GET /v1/video_inputs`, user selects, persist uuid). `GET /v1/video_inputs/{uuid}` (detail) is 404 — list endpoint only.
4. **Verify trigger endpoint — DONE 2026-07-08:** `GET /v1/video_inputs/{uuid}/trigger` → HTTP 204. Primary path in `triggerVideoInput` is correct; POST fallback untested (not needed).
5. **Verify alpha:** send (a) the opaque test frame, (b) a fully transparent frame, (c) a frame with opaque lower-third over transparent. Record what PP shows for each. If alpha is NOT honored (black instead of transparent): clear semantics rely solely on presentation-layer clear (D2 already covers this) and idle frame becomes solid black — acceptable — record the verdict either way.

**M1 — real pipeline:** overlay window + shared template + DEFAULT_OVERLAY_THEME + orchestrator dispatch (D1/D2) + binding persistence (D7). Acceptance: mode=ndi approve → styled verse on PP output; clearOverlay + clearAll both remove it; mode=message still works; PP without NDI input → warning + fallback.

**M2 — Theme editor page (D6):** full controls (background color/gradient/opacity; verse font family/size/weight/color/line-height/align/shadow; reference show/position/size/color/uppercase; layout position preset/max-width/padding/backdrop box+color+radius) + WYSIWYG preview + mode selector + NDI status line + Send test/Clear buttons + persistence. Theme change while overlay is live → re-render overlay window immediately.

## Acceptance checklist

1. `npm run typecheck` passes.
2. Dev AND production build boot with NDI working; app with `grandiose-mac` load failure still boots with fallback logged.
3. Theme edits: instant in preview; on PP after "Send test verse".
4. Mode matrix: `auto` (library wins when match exists), `ndi` (library skipped), `message` (no NDI use) — each verified once.
5. Clear matrix: manual clear + auto-clear both fully remove output in ndi and message modes.
6. Migration test: hand-edit `proautomate-settings.json` to the phase-1 `overlay` shape (delete `mode`/`theme`/`ppVideoInputUuid`), boot app → no crash, `store.get('overlay')` normalized, disk file healed with full shape. Escaping test: push a verse containing `<b>&"'` → renders literally, no markup injection in preview or overlay window.
7. App quit clean (sender released, no hang).

## Out of scope

- Image/video backgrounds, multiple theme presets (v2.1)
- Audio over NDI
- Windows/x64 work beyond the load guard

---

## Rev 4 addendum — 2026-07-08 (fullscreen / auto-fit / media backgrounds)

Schema additions (all healed by `normalizeOverlayTheme`; escaping/clamping rules extend D5a):

| Field | Values | Clamp/validation | Notes |
|-------|--------|------------------|-------|
| `background.type` | + `'image'` \| `'video'` | enum, junk → `'transparent'` default | media element (`<img>`/`<video autoplay loop muted playsinline>`) inside the bg layer; CSS bg kept for color/gradient |
| `background.mediaPath` | absolute local path | string, trimmed; blank → `undefined`. Existence is NOT checked here (pure module) | rendered as `pa-media://media/<encodeURIComponent(path)>` — escaped like any attr |
| `background.mediaFit` | `'cover'`\|`'contain'`\|`'fill'` | enum, default `'cover'` | maps to `object-fit` |
| `layout.autoFitText` | boolean | `safeBool`, default `false` | only honored when `layout.position === 'full'` |

Rendering:
- `'full'` position is now truly full-bleed: content box `flex:1; max-width:100%`, children stretched, backdrop corners forced square. `maxWidthPct` ignored (UI disables it).
- Auto-fit: `estimateAutoFitVerseFontPx` in `overlay-template.ts` — pure char-metric estimate (0.55 avg-width factor, conservative), binary search 24–200px, reference row + padding subtracted. Both preview and NDI window render from the same computed px, so WYSIWYG holds even where the estimate is imperfect.
- Preview now renders a real 1920×1080 frame scaled with `transform: scale(panelWidth/1920)` — proportions finally match the output.

Security (extends D5a):
- `pa-media://` protocol (main/index.ts): serves ONLY the path currently stored at `overlay.theme.background.mediaPath` (path-resolved equality); anything else → 403. Prevents the scheme becoming an arbitrary-file-read bridge from the renderer.
- Renderer CSP gained `img-src pa-media:` / `media-src pa-media:`.
- ThemeEditor persists the picked path BEFORE state renders the media element (allowlist must be current when the request lands).

Settings write-ownership (closes latent D3 gap):
- Main's SETTINGS.SET merge already read fresh-from-disk, but both pages sent full stale objects. Now: Settings modal sends only phase-1 fields; ThemeEditor sends only `mode`/`ppVideoInputUuid`/`theme`. Cross-page clobber (incl. orchestrator's persisted `ppVideoInputUuid`) is no longer possible.

Perf note: video backgrounds raise the offscreen frame rate to 24fps (`OSR_FRAME_RATE_VIDEO`); static themes stay at 10fps. Live-validate CPU on the production Mac before a Sunday.

21:26 "small text" incident — RESOLVED, not a code bug: settings file mtime 21:31:18 proves the 64px/lower-third theme was saved AFTER the 21:26 push (which correctly rendered the then-current old theme) and BEFORE the 21:35–21:36 pushes. conf v10 reads the file on every `store.get` — no caching layer exists in that path.
