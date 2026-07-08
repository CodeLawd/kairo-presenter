# Plan: Scripture Overlay — in-app template controls + guided PP theme setup

**Status:** ready for implementation
**Implementer:** Sonnet subagent
**Reviewer:** Fable (main session)

## Context

ProAutomate pushes detected scriptures to ProPresenter two ways (both live-verified against PP 19.0.1 on 2026-07-08):

1. **Library path** — presentation named like the reference exists (Bible-tab-generated, e.g. `Joshua 1_8 (KJV)`) → triggered natively, PP Bible theme applies. Already good.
2. **Message overlay path** — verse text pushed via PP messages layer using an auto-created message template named `ProAutomate Scripture` (`src/main/services/propresenter/client.ts`, `SCRIPTURE_MESSAGE_NAME`).

Problem: overlay **visual styling** (font, size, color, background, position) lives in PP's message *theme* and is **not exposed by PP's REST API**. The API only controls the message's text template string and token values. The user's PP has only two message themes, both designed for short alerts — verse text renders clipped/ugly.

This plan adds everything the app CAN control, plus a guided flow for the one-time PP-side theme styling.

## Hard API facts (all live-verified — do not re-derive, do not "fix")

- `POST /v1/messages` (create) requires ALL fields: `id`, `message`, `tokens`, `theme`, `visible_on_network`, `is_active`. Missing any → HTTP 400.
- `PUT /v1/message/{uuid}` (update) requires the same full body.
- Message string uses `{TokenName}` placeholders; `tokens` array declares them: `[{name, text: {text}}]`.
- Trigger: `POST /v1/message/{uuid}/trigger` with body `[{name, text: {text: value}}, …]` → 204.
- Clear one message: `GET /v1/message/{uuid}/clear` → 204.
- Clear whole layers: `GET /v1/clear/layer/presentation`, `GET /v1/clear/layer/messages` (GET, not POST — POST returns 404).
- Token names `Reference` and `Text` are the contract between app and the PP message — **do not rename them**.
- No API exists to: list message themes, edit theme styling, upload media, or create presentations.

## Scope

### 1. New settings: `overlay` section in `AppSettings`

Files: `src/lib/ipc.ts` (AppSettings interface, line ~10), `src/main/db/index.ts` (defaults).

```ts
overlay: {
  /** PP message template string. Must contain {Reference} and/or {Text}. */
  template: string            // default: '{Reference}\n{Text}'
  /** Append translation to reference shown on screen: "John 3:16 (KJV)" */
  showTranslation: boolean    // default: true
  /** Show verse numbers when pushing multi-verse passages */
  showVerseNumbers: boolean   // default: true
  /** Max verses per push; 0 = no cap (whole detected range) */
  maxVerses: number           // default: 0
  /** Auto-clear overlay after N seconds; 0 = manual clear only */
  autoClearSec: number        // default: 0
}
```

### 2. Main-process changes

**`src/main/services/propresenter/client.ts`:**
- `ensureScriptureMessage(template: string)` — take template as a parameter instead of the hardcoded `'{Reference}\n{Text}'`.
- After finding an existing message by name, compare its `message` field to `template`; if different, `PUT /v1/message/{uuid}` with the full body (all fields, see API facts) to update the template. Log the update.
- `showScriptureMessage(reference, text, template)` — pass template through to `ensureScriptureMessage`.

**`src/main/orchestrator.ts` (`presentScripture` + `formatMessageText`):**
- Read overlay settings via `store.get('overlay')` (import `store` from `./db` — check existing import pattern; orchestrator currently doesn't import store, IPC handlers do. Prefer: read overlay settings inside `presentScripture` via `store`).
- `formatMessageText`: respect `showVerseNumbers` and `maxVerses` (slice verses if capped; if sliced, append ellipsis `…` to last line).
- Reference string: respect `showTranslation` (`John 3:16 (KJV)` vs `John 3:16`).
- After successful overlay push: if `autoClearSec > 0`, `setTimeout` → `clearScriptureMessage()`. Store the timer; cancel the pending timer if a new push happens first (one timer at a time, like `autoTimers` pattern).

### 3. New IPC (follow the 3-file pattern in CLAUDE.md exactly)

`src/lib/ipc.ts` IPC constants (PROPRESENTER group):
```
TEST_OVERLAY:  'propresenter:testOverlay',   // invoke — push a sample verse overlay
CLEAR_OVERLAY: 'propresenter:clearOverlay',  // invoke — clear the scripture message
```
- Handler in `src/main/ipc/index.ts`:
  - `TEST_OVERLAY`: pushes John 3:16 KJV sample text through the same orchestrator/service path the real flow uses (respecting current overlay settings). Implement as a small public method on the ProPresenter service or orchestrator — do not duplicate formatting logic in the IPC layer.
  - `CLEAR_OVERLAY`: calls client `clearScriptureMessage()` and layer clear `clearMessages()`.
- Extend `ProAutomateAPI['propresenter']` type in `src/lib/ipc.ts` + implementation in `src/preload/index.ts` + `src/renderer/src/env.d.ts` if it declares the api type separately (check — env.d.ts may just reference shared type).

### 4. Renderer: "Overlay" section in Settings page

File: `src/renderer/src/components/settings/Settings.tsx`. Follow the existing section/card structure and component classes (`.card`, `.label`, `.input`, `.btn-primary`, `.btn-secondary` from index.css).

Contents:
1. **Template editor** — textarea bound to `overlay.template`. Validation: must contain `{Text}` (warn inline if missing). Small helper text listing available tokens: `{Reference}`, `{Text}`.
2. **Toggles / numbers** — showTranslation, showVerseNumbers, maxVerses (number input, 0 = all), autoClearSec (number input, 0 = manual).
3. **Approximate preview** — a 16:9 dark `div` rendering the template with a sample verse substituted, centered white text. Label it clearly: “Approximate preview — actual look is controlled by the ProPresenter message theme.” Do NOT attempt pixel-faithful mimicry.
4. **Live test buttons** — “Send test verse” → `window.api.propresenter.testOverlay()`; “Clear” → `window.api.propresenter.clearOverlay()`. Disable both when PP not connected (use existing store/status pattern other components use).
5. **Guided PP theme setup card** — static instructions:
   1. In ProPresenter open the Messages panel (speech-bubble icon).
   2. Edit the message “ProAutomate Scripture” → Theme → Edit Theme (or create a new message theme).
   3. One full-width text box, ~48–60pt, lower-third or centered, dark backdrop box. Remove unused placeholder boxes.
   4. Click “Send test verse” here while styling to see changes live.

Settings persistence: same pattern as other sections (`window.api.settings.set('overlay', …)`), values loaded on mount via `settings.get('overlay')`.

### 5. Out of scope (do NOT build)

- NDI / video-input render pipeline (future v2 for true in-app theming).
- Editing PP theme styling via API (impossible).
- Any renderer state moved into Zustand — settings stay IPC-backed per CLAUDE.md.
- Touching the lyrics service or its (known-broken) `createGroupedPresentation` path.

## Constraints

- Follow `CLAUDE.md`: contextIsolation stays on; new IPC = handler + preload + type, all three.
- electron-store v8 API only.
- No new dependencies.
- Write code matching surrounding style (2-space, single quotes in main/*, section comment bars).

## Acceptance checklist

1. `npm run typecheck` passes (node + web).
2. App boots (`npm run dev`), Settings shows Overlay section, values persist across restart (check `~/Library/Application Support/proautomate/proautomate-settings.json` gains `overlay` key).
3. With PP running at `localhost:57563`: “Send test verse” shows John 3:16 on PP output using current template; “Clear” removes it. (PP reachable — verify with `curl -s http://localhost:57563/version`.)
4. Changing template + test again → PP message template updated (GET `/v1/message/{uuid}` shows new `message` string).
5. Existing flows unbroken: scripture approve → PP still works; `clearAll` still clears both layers.

## Bonus task (separate commit-sized change, do after main scope)

**Reconnect storm fix:** when PP is unreachable, log shows connect attempts ~4×/second — renderer re-invokes `propresenter:connect` on every error status broadcast while the client also runs its own backoff (`scheduleReconnect`). Find the renderer effect that re-calls `connect` on status change (likely Settings.tsx or Dashboard.tsx subscribing to `onStatusChange` / polling) and remove the renderer-side auto-retry — the main-process client already handles reconnection with exponential backoff. Renderer should only connect on explicit user action (Connect button) and at app start.
