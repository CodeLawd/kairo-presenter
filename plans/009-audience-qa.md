# Plan 009: Audience Q&A and audience sources

> **Executor instructions**: Build in phase order. Each phase ships on its own and
> must leave the app releasable. Honour the STOP conditions.
>
> **Drift check (run first)**: `git diff --stat 53d1d4a..HEAD -- src/lib/program.ts src/main/services/output/program-service.ts src/renderer/src/components/layout/AppShell.tsx server/cloudflare website/src/app`

## Status

- **Priority**: P2
- **Effort**: L (about 3–4 focused weeks across phases A–D)
- **Risk**: MED (new public-facing surface; third-party page reading in phase D)
- **Depends on**: —
- **Category**: feature
- **Planned at**: commit `53d1d4a`, 2026-11-01

## Why this matters

Teams want live questions from the room on screen: sermon Q&A, youth nights,
conferences, all-hands. Slido's API is export-based and rate-limited, so it can't
drive a live screen. Kairo should own the flow end to end — audience phones →
moderation queue → screen — and treat other platforms (Slido first) as optional
sources feeding the same queue. This is also the first feature that serves any
presenter, not only churches.

## What the operator gets

- A new **Audience** workspace on the rail (hue `coral`, the free tool hue).
- Title bar of the workspace: session state, join code, joined count.
- Left column: questions sorted by votes (or newest), filtered Review / Approved /
  Answered / Hidden. Nothing reaches the screen until approved.
- Right column: live preview (red outline as elsewhere), Clear, Mark answered, and a
  join card with QR and "Show join code on screen".
- **Sources** menu: Kairo Q&A (default), Slido (phase D). Every source lands in the
  one queue.

Audience side: `kairopresenter.com/q/<CODE>` — a phone page with no app and no
account. Ask (anonymous or with a name), upvote, see approved questions.

## Current state

- Workspaces are a static list in `src/renderer/src/components/layout/AppShell.tsx`
  (`workspaces`, ~line 54); hues in `src/renderer/src/lib/hue.ts`.
- The program screen's text layers live in `ProgramState` (`src/lib/program.ts:486`).
  `message` is a one-line ticker styled by `PresentationSettings.message`; it is the
  wrong shape for a question card (asker line + multi-line question), so Q&A gets its
  own layer rather than reusing it.
- `programService.showMessage/clearMessage`
  (`src/main/services/output/program-service.ts:66`) is the pattern to copy for
  show/clear and broadcast to outputs.
- Cloud: `server/cloudflare/index.ts` is a Worker that forwards `/v1/*` to one NestJS
  container (`max_instances: 1`, in-memory state). Long-lived WebSockets must not go
  through that container. The Worker already uses Durable Objects, so a new DO class
  sits next to `KairoAPI` in the same Worker.
- Website: Next.js on Workers (`website/`), existing short route `website/src/app/s/[token]`.
- Device auth and organisations already exist (`src/main/services/cloud/session.ts`,
  `server/src/orgs`, `server/src/licensing`).
- Embedded web pages: `src/main/services/web/index.ts`.

## Design

### Shared model — `src/lib/audience.ts` (new)

```ts
export type AudienceQuestionState = 'review' | 'approved' | 'answered' | 'hidden'

export interface AudienceQuestion {
  id: string            // `${sourceId}:${externalId}`
  sourceId: string
  text: string          // trimmed, max 280 chars
  author: string | null // null = anonymous
  votes: number
  state: AudienceQuestionState
  createdAt: number
}

export interface AudienceSourceStatus {
  id: string
  kind: 'kairo' | 'slido'
  label: string         // "Kairo Q&A", "Slido · #123456"
  state: 'connecting' | 'live' | 'error' | 'stopped'
  error?: string        // plain words, shown to the operator
  joined?: number
}
```

Pure helpers here (sorting, merge of a source update into the queue, normalising
incoming text) so they are unit-testable in `tests/`.

### Main process — `src/main/services/audience/` (new)

- `audienceService` singleton: owns the merged queue, the list of sources, and which
  question is live. Emits `audience:changed` to the renderer.
- `AudienceSource` interface: `start()`, `stop()`, `onUpdate(cb)`, optional
  `setState(questionId, state)` for sources that can moderate upstream.
- `sources/kairo.ts` (phase C), `sources/slido.ts` (phase D), `sources/sample.ts`
  (phase A, dev and demo only).
- Moderation state (approved/hidden/answered) is owned by Kairo for every source, so
  a Slido question hidden in Kairo stays hidden even if Slido shows it.

### Program layer

- Add `question: ProgramQuestion | null` to `ProgramState`
  (`{ text: string; author: string | null }`) and a `question` style block to
  `PresentationSettings` (position, font size, colours), normalised like `message`.
- `programService.showQuestion(q)` / `clearQuestion()`; outputs render it in
  `RenderedOutputFields.tsx` alongside the message layer. Screens' Look filter gets a
  `question` toggle the way messages have one.
- Join card: `showJoinCode()` renders code + QR as the same layer variant.

### IPC

`window.api.audience.*`: `getState`, `startSource(kind, options)`, `stopSource(id)`,
`setQuestionState(id, state)`, `show(id)`, `clear()`, `showJoinCode()`,
`onChanged(cb)`. Handlers in `src/main/ipc/index.ts`, types in `src/lib/ipc.ts`.

### Cloud (phase B)

- New Durable Object `AudienceRoom` in `server/cloudflare/` — one instance per room,
  holding questions, votes and connected sockets in DO storage (SQLite). Uses the
  hibernation WebSocket API so idle rooms cost nothing.
- Worker routes handled **before** container forwarding:
  - `POST /v1/audience/rooms` — authenticated (device session → container verifies
    licence once), returns `{ roomId, code, operatorToken }`.
  - `GET /v1/audience/rooms/:code/ws?role=operator|audience` — WebSocket upgrade.
- Messages are small JSON events: `ask`, `vote`, `snapshot`, `question`, `state`,
  `joined`. Operator-only events require `operatorToken`.
- Abuse limits in the DO: 1 question / 20 s and 30 votes / min per participant
  (participant = random id in a cookie), 280-char cap, a basic word filter that only
  forces `review`. Rooms close 24 h after the operator ends them and are deleted;
  no audience PII is stored beyond the optional name.
- Codes: 6 characters, no ambiguous letters (no 0/O/1/I), checked for collisions.

### Audience page (phase B)

`website/src/app/q/[code]/page.tsx` — client page, connects straight to the DO
socket via `api.kairopresenter.com`. Light, phone-first, organisation name and event
title at the top, ask box, approved list with upvotes. `noindex`. Reconnects on
network drop and keeps an unsent draft.

### Slido source (phase D)

- Runs in a hidden `BrowserWindow` with a persistent partition
  (`persist:audience-slido`) so a moderator sign-in survives restarts.
- **Code-only mode (default)**: opens the public participant page for an event code
  and reads visible questions and vote counts. No sign-in.
- **Moderator mode (opt-in)**: the operator signs in once in a visible window; reads
  the moderator view, including questions waiting for review.
- Reading is done by a small preload script that extracts questions and posts them
  over a dedicated IPC channel. All selectors live in one file
  (`sources/slido-selectors.ts`) so a Slido redesign is a one-file fix.
- Failure is loud and safe: if nothing parses for 30 s while the page is loaded, the
  source goes to `error` ("Slido changed their page — questions aren't coming in").
  The queue keeps what it had; the operator can keep presenting.
- Kairo never writes to Slido in this phase.

## Phases

| Phase | Ships | Effort |
|---|---|---|
| A | Audience workspace, queue UI, program `question` layer, screens rendering, sample source behind a dev flag | 3–4 days |
| B | `AudienceRoom` DO, room creation, audience phone page | 4–5 days |
| C | Kairo source wired to the room, join card + QR on screen, reconnect handling, session end | 2–3 days |
| D | Slido source (code-only, then moderator mode) | 3–4 days |
| Later | Polls, word cloud, YouTube/Facebook live chat sources, export after the event | — |

## Scope

**In scope**: `src/lib/audience.ts`, `src/lib/program.ts`, `src/lib/ipc.ts`,
`src/main/services/audience/**`, `src/main/services/output/program-service.ts`,
`src/main/ipc/index.ts`, `src/preload/index.ts`, `src/renderer/src/env.d.ts`,
`src/renderer/src/components/audience/**` (new),
`src/renderer/src/components/layout/AppShell.tsx`,
`src/renderer/src/components/screens/RenderedOutputFields.tsx`,
`server/cloudflare/**`, `server/wrangler.jsonc`, `website/src/app/q/**`, tests.

**Out of scope**: polls and word clouds, writing back to Slido, changes to the
NestJS container's request path, any change to scripture/lyrics behaviour.

## Steps

1. **A1** Add `src/lib/audience.ts` with types and pure helpers; tests in
   `tests/audience.test.ts` (sort, merge, normalise, state transitions).
2. **A2** Add the `question` layer to `ProgramState` / `PresentationSettings` with
   normalisers and defaults; extend `programService`; render in outputs; Look toggle.
3. **A3** `audienceService` + sample source + IPC.
4. **A4** Audience workspace UI (`components/audience/`), rail entry with hue `coral`,
   following the mockup: queue left, live + join card right, filters, sort.
5. **B1** `AudienceRoom` DO and Worker routes; wrangler binding + migration.
6. **B2** Room creation authorised against the existing device session.
7. **B3** `/q/[code]` audience page.
8. **C1** Kairo source: create room, operator socket, map events into the queue,
   reconnect with backoff, "End session".
9. **C2** Join card on screen with QR; joined count in the workspace header.
10. **D0** STOP check (below). **D1** Slido code-only. **D2** Slido moderator mode.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Quality gate | `npm run typecheck && npm test && npm run test:main && npm run lint` | all pass |
| Worker types/deploy dry run | `bun run --cwd server cf:deploy -- --dry-run` | builds, binding listed |
| Website | `bun run --cwd website build` | exit 0 |

## Acceptance

- Phase A: in dev, sample questions appear; approving one puts it on every screen
  whose Look allows questions; Clear removes it; Mark answered moves it out of the
  queue. Typecheck, tests, lint pass.
- Phase B/C: 300 simulated participants (script in `scripts/`) asking and voting in
  one room for 10 minutes — operator queue stays consistent with the room snapshot,
  no dropped questions, vote counts match.
- Phone page usable at 375 px wide, light and dark.
- Pulling the network from Kairo for 60 s: queue keeps showing, reconnects, catches
  up from the snapshot.
- Phase D: code-only Slido source shows questions from a real test event within 3 s
  of them appearing on Slido; breaking a selector produces the error state, not a
  crash.

## STOP conditions

- **Before D1**: read Slido's current terms of service. If they prohibit automated
  reading of event pages by the event owner, stop and record `BLOCKED (Slido terms)`;
  ship A–C without it.
- If room creation cannot be authorised without routing through the single container
  on every message, stop and redesign — sockets must never pass through the container.
- If the `question` layer requires changing how existing message or slide layers
  render, stop and raise it; this plan adds a layer, it does not alter others.

## Open decisions

- **Approve vs show**: in the mockup one click approves and shows. Alternative: approve
  first, show separately. Default for phase A: two separate actions (Approve, Show),
  since accidental live text is the worse failure.
- Which plans include Audience (all, or paid tier only).
- Join URL: `kairopresenter.com/q/CODE` vs a shorter dedicated domain later.
