// ─── Overlay outputs — layer routing (phase 3) ─────────────────────────────────
// Pure — no Node/DOM APIs — importable from main, preload, and renderer alike.
//
// Two kinds of destination:
//
//   Kairo-rendered (`screen`, extra `ndi` feeds) — separate windows, so every
//     one of them gets the push, concurrently.
//   ProPresenter layers — PP's REST API has no "send this to screen 2"; the
//     routing primitive is the LAYER, and a Look decides which layers each
//     screen shows. Outputs on one layer compete (first success wins: the
//     primary NDI feed, else a library match); different layers fan out in
//     parallel. The primary NDI feed counts as a PP output because PP cuts to
//     its video input.
//
// Whether an output competes is a property of the output
// (`competesForPpLayer`), not of a layer.
//
// This module is deliberately free of theme normalization so it can be imported
// by `overlay-defaults.ts` without a cycle — `normalizeOverlayOutputs` lives
// there, next to `normalizeOverlayTheme` and the shared clamp helpers.

import type {
  AppSettings,
  OverlayContentKind,
  OverlayLayer,
  OverlayOutput,
  OverlayOutputKind,
  OverlayOutputVariant,
  OverlayTheme,
} from './ipc'
import { isOwnedNdiName } from './brand'

// ─── Layer map ─────────────────────────────────────────────────────────────────

export const OVERLAY_OUTPUT_KINDS: readonly OverlayOutputKind[] = [
  'ndi',
  'library',
  'message',
  'stage',
  'screen',
] as const

/**
 * How many `ndi` outputs can be live at once. Each gets its own NDI sender and
 * offscreen window; the first keeps the legacy sender name ProPresenter's video
 * input is bound to, the rest are extra feeds for livestream / recording. Each
 * one costs a 1920×1080 capture, so the count stays small. Single source of
 * truth for the normalizer and the UI.
 */
export const MAX_NDI_OUTPUTS = 4

/** The ProPresenter layer each kind writes to; null for Kairo's own screens. */
const LAYER_OF: Record<OverlayOutputKind, OverlayLayer | null> = {
  ndi: 'presentation',
  library: 'presentation',
  message: 'messages',
  stage: 'stage',
  screen: null,
}

/** Stable ProPresenter layer order — only affects reporting; layers run concurrently. */
export const OVERLAY_LAYERS: readonly OverlayLayer[] = ['presentation', 'messages', 'stage'] as const

export function layerOfKind(kind: OverlayOutputKind): OverlayLayer | null {
  return LAYER_OF[kind]
}

/**
 * The ProPresenter layer this output competes for, or null when it is one of
 * Kairo's own destinations (a screen, or an NDI feed other than the primary).
 * `outputs` is the full configured list — the primary NDI feed is decided there.
 */
export function ppLayerOf(output: OverlayOutput, outputs: readonly OverlayOutput[]): OverlayLayer | null {
  if (output.kind === 'ndi') return output.id === primaryNdiOutputId(outputs) ? 'presentation' : null
  return layerOfKind(output.kind)
}

export function competesForPpLayer(output: OverlayOutput, outputs: readonly OverlayOutput[]): boolean {
  return ppLayerOf(output, outputs) !== null
}

/** Human-facing "where does this land" label for an output kind. */
export function outputDestinationLabel(kind: OverlayOutputKind): string {
  switch (kind) {
    case 'screen': return 'Kairo screen'
    case 'ndi': return 'NDI feed'
    case 'library': return 'ProPresenter presentation layer'
    case 'message': return 'ProPresenter messages layer'
    case 'stage': return 'ProPresenter stage screens'
  }
}

/**
 * Whether an output can only work through ProPresenter's API. `ndi` is not one:
 * its frame leaves this machine whatever PP is doing — only the optional cut to
 * the video input needs the API.
 */
export function outputRequiresPropresenter(kind: OverlayOutputKind): boolean {
  return kind === 'library' || kind === 'message' || kind === 'stage'
}

/** Kinds Kairo renders itself, through a `ProgramSurface`. */
export function isRenderedKind(kind: OverlayOutputKind): boolean {
  return kind === 'ndi' || kind === 'screen'
}

/**
 * Whether an output takes service pushes. False only for a `screen` running
 * its own playlist (a lobby display) — it ignores pushes and Clear alike.
 */
export function followsProgram(output: Pick<OverlayOutput, 'kind' | 'source'>): boolean {
  return !(output.kind === 'screen' && output.source === 'playlist')
}

/** Enabled outputs Kairo renders itself — documents and backgrounds go to these. */
export function surfaceOutputs(outputs: readonly OverlayOutput[]): OverlayOutput[] {
  return outputs.filter((o) => o.enabled && isRenderedKind(o.kind) && followsProgram(o))
}

/**
 * The rendered output a preview (or "apply this theme") should target: an
 * enabled screen, else an enabled NDI output, else any NDI output.
 */
export function primaryRenderedOutput(outputs: readonly OverlayOutput[]): OverlayOutput | null {
  return (
    outputs.find((o) => o.kind === 'screen' && o.enabled) ??
    outputs.find((o) => o.kind === 'ndi' && o.enabled) ??
    findNdiOutput(outputs)
  )
}

// ─── Grouping ──────────────────────────────────────────────────────────────────

export interface OverlayLayerGroup {
  layer: OverlayLayer
  /** Enabled outputs on this layer, in ascending `order`. */
  outputs: OverlayOutput[]
}

/** Takes part in a normal push: enabled, not a last resort, and following the service. */
function inNormalPass(o: OverlayOutput): boolean {
  return o.enabled && !o.fallbackOnly && followsProgram(o)
}

/**
 * Enabled outputs that compete for a ProPresenter layer, bucketed by layer,
 * each bucket sorted by `order`. Empty buckets are dropped.
 *
 * `fallbackOnly` outputs are excluded — they are retrieved separately via
 * `fallbackOutputs()` once the normal pass has failed everywhere.
 *
 * `include` narrows which outputs take part (content filters, PP reachable)
 * without changing which NDI feed is primary — that is decided on `outputs`.
 */
export function groupOutputsByLayer(
  outputs: readonly OverlayOutput[],
  include: (output: OverlayOutput) => boolean = () => true,
): OverlayLayerGroup[] {
  const groups: OverlayLayerGroup[] = []
  for (const layer of OVERLAY_LAYERS) {
    const inLayer = outputs
      .filter((o) => inNormalPass(o) && include(o) && ppLayerOf(o, outputs) === layer)
      .sort((a, b) => {
        // Themed NDI must run before a library name-match on the same layer.
        // Otherwise a "John 3:16" presentation in PP wins and the operator's
        // theme never leaves this app.
        if (layer === 'presentation') {
          const rank = (kind: OverlayOutput['kind']) => (kind === 'ndi' ? 0 : 1)
          const byKind = rank(a.kind) - rank(b.kind)
          if (byKind !== 0) return byKind
        }
        return a.order - b.order
      })
    if (inLayer.length > 0) groups.push({ layer, outputs: inLayer })
  }
  return groups
}

/** Kairo's own destinations in a normal push — screens and extra NDI feeds. All of them run. */
export function renderedOutputs(
  outputs: readonly OverlayOutput[],
  include: (output: OverlayOutput) => boolean = () => true,
): OverlayOutput[] {
  return outputs.filter((o) => inNormalPass(o) && include(o) && !competesForPpLayer(o, outputs))
}

/**
 * Enabled last-resort outputs, in ascending `order`. Tried in sequence only when
 * the primary fan-out produced no successful push at all — this is what keeps
 * the legacy modes' "…then the message overlay" behaviour intact.
 */
export function fallbackOutputs(outputs: readonly OverlayOutput[]): OverlayOutput[] {
  return outputs.filter((o) => o.enabled && o.fallbackOnly).sort((a, b) => a.order - b.order)
}

/**
 * The primary `ndi` output: the first enabled one in list order. It keeps the
 * legacy sender name, so it is the one ProPresenter's video input shows.
 */
export function primaryNdiOutputId(outputs: readonly OverlayOutput[]): string | null {
  return outputs.find((o) => o.kind === 'ndi' && o.enabled)?.id ?? null
}

/**
 * The NDI output settings pages talk about: the primary (first enabled) one,
 * else the first configured, so a disabled NDI output can still be edited.
 */
export function findNdiOutput(outputs: readonly OverlayOutput[]): OverlayOutput | null {
  return outputs.find((o) => o.kind === 'ndi' && o.enabled) ?? outputs.find((o) => o.kind === 'ndi') ?? null
}

/**
 * Resolves the NDI input for a push. A confirmed durable UUID wins over the
 * older per-output value and name discovery; an unconfirmed durable UUID is
 * never silently substituted for another input.
 */
export function chooseNdiVideoInputId(
  durableId: string,
  outputId: string,
  discovered: readonly { uuid: string; name: string }[],
): string | null {
  const durable = durableId.trim()
  if (durable && discovered.some((input) => input.uuid === durable)) return durable

  const output = outputId.trim()
  if (output) return output

  return discovered.find((input) => isOwnedNdiName(input.name))?.uuid ?? null
}

/**
 * The one Look to trigger for a push, or null. A Look is whole-system state —
 * triggering several in a row would just leave the last one standing — so this
 * deliberately returns the first configured one rather than a list.
 */
export function firstLookId(groups: readonly OverlayLayerGroup[]): string | null {
  for (const group of groups) {
    for (const output of group.outputs) {
      const id = output.lookId.trim()
      if (id) return id
    }
  }
  return null
}

// ─── Dispatch plan ─────────────────────────────────────────────────────────────

export interface OverlayDispatchPlan {
  /** Kairo's screens and extra NDI feeds — every one gets the push, concurrently. */
  rendered: OverlayOutput[]
  /**
   * One bucket per PP layer that has work. Buckets run CONCURRENTLY (they land
   * on different layers, so they can all be on screen at once); within a bucket
   * the outputs run in order and stop at the first success (they compete for the
   * same layer — the second would just replace the first).
   */
  groups: OverlayLayerGroup[]
  /** Tried in order, only if nothing above produced a success. */
  fallbacks: OverlayOutput[]
}

/**
 * The push plan for `outputs` (the full configured list). `include` narrows
 * which ones take part — content filters, whether PP is reachable — without
 * moving the primary NDI role to another feed.
 */
export function getDispatchPlan(
  outputs: readonly OverlayOutput[],
  include: (output: OverlayOutput) => boolean = () => true,
): OverlayDispatchPlan {
  return {
    rendered: renderedOutputs(outputs, include),
    groups: groupOutputsByLayer(outputs, include),
    fallbacks: fallbackOutputs(outputs).filter(include),
  }
}

// ─── Content kinds ─────────────────────────────────────────────────────────────

export const OVERLAY_CONTENT_KINDS: readonly OverlayContentKind[] = ['scripture', 'lyrics'] as const

export function contentKindLabel(kind: OverlayContentKind): string {
  return kind === 'lyrics' ? 'Lyrics' : 'Scripture'
}

/**
 * What the two text layers are *called* for a given content kind. The theme
 * shape is shared — `verse` is the body, `reference` is the line above or below
 * it — but "Reference" reads as a Bible citation, which is meaningless on a
 * lyric slide where that line holds the song and section.
 */
export function overlayLayerLabel(kind: OverlayContentKind, layer: 'verse' | 'reference'): string {
  if (kind === 'lyrics') return layer === 'verse' ? 'Lyrics' : 'Song title'
  return layer === 'verse' ? 'Scripture' : 'Reference'
}

/**
 * A theme as `kind` is allowed to define it.
 *
 * Lyric themes describe text only. The background behind a lyric slide is a
 * motion loop that changes every song, so it belongs to a live control surface
 * — not to a theme that gets configured once and left alone. Forcing transparent
 * here means a lyric theme can never bake in a background, however it was
 * seeded (duplicated from a scripture theme, or restored from an older store).
 */
export function themeForContentKind(theme: OverlayTheme, kind: OverlayContentKind): OverlayTheme {
  if (kind !== 'lyrics') return theme
  if (theme.background.type === 'transparent') return theme
  return { ...theme, background: { ...theme.background, type: 'transparent' } }
}

/**
 * Look lyrics inherit from scripture when no lyrics theme is applied.
 * Fit-to-box stays off — that toggle lives on the scripture theme and must
 * not grow a couplet to fill the verse box on a lyric push.
 */
export function inheritLyricsTheme(scriptureTheme: OverlayTheme): OverlayTheme {
  const lyrics = themeForContentKind(scriptureTheme, 'lyrics')
  if (!lyrics.layout.autoFitText) return lyrics
  return { ...lyrics, layout: { ...lyrics.layout, autoFitText: false } }
}

/**
 * The override an output carries for `kind`, or null when it has none.
 * Scripture is never an override — it *is* the output's own theme/template — so
 * asking for it always returns null and every resolver below falls through to
 * the base fields.
 */
export function outputVariant(
  output: OverlayOutput,
  kind: OverlayContentKind,
): OverlayOutputVariant | null {
  return kind === 'lyrics' ? output.lyrics ?? null : null
}

/** True when `kind` has its own styling rather than inheriting scripture's. */
export function hasContentOverride(output: OverlayOutput, kind: OverlayContentKind): boolean {
  return outputVariant(output, kind) !== null
}

/** The theme an output renders `kind` with. */
export function outputThemeFor(output: OverlayOutput, kind: OverlayContentKind): OverlayTheme {
  const variant = outputVariant(output, kind)
  const theme = variant
    ? variant.theme
    : kind === 'lyrics'
      ? inheritLyricsTheme(output.theme)
      : output.theme
  // Always run the kind policy at resolve time. A stored lyrics override can
  // still carry a scripture background (applied from a scripture draft, or
  // restored from an older store), and that look must not win over the dock.
  return themeForContentKind(theme, kind)
}

/** The `themeId` shown as the source of `kind`'s look. Display only. */
export function outputThemeIdFor(output: OverlayOutput, kind: OverlayContentKind): string | null {
  const variant = outputVariant(output, kind)
  return variant ? variant.themeId : output.themeId
}

/** The token template an output pushes `kind` with. */
export function outputTemplateFor(output: OverlayOutput, kind: OverlayContentKind): string {
  return outputVariant(output, kind)?.template ?? output.template
}

/**
 * Writes a patch to whichever slot holds `kind`'s config — the override when one
 * exists, the base fields otherwise. Lets every editor surface stay unaware of
 * which kind it is currently pointed at.
 */
export function withContentPatch(
  output: OverlayOutput,
  kind: OverlayContentKind,
  patch: Partial<OverlayOutputVariant>,
): OverlayOutput {
  const variant = outputVariant(output, kind)
  if (!variant) return { ...output, ...patch }
  return { ...output, lyrics: { ...variant, ...patch } }
}

/**
 * Turns `kind`'s override on (seeded from the output's scripture config, so the
 * first thing the operator sees is what they already had) or off.
 */
export function setContentOverride(
  output: OverlayOutput,
  kind: OverlayContentKind,
  on: boolean,
): OverlayOutput {
  if (kind !== 'lyrics') return output
  if (!on) return { ...output, lyrics: null }
  if (output.lyrics) return output
  const theme = structuredClone(output.theme)
  return {
    ...output,
    lyrics: {
      themeId: output.themeId,
      theme: inheritLyricsTheme({
        ...theme,
        // A lyric slide has no citation to print. Seeding this on would make
        // every new override start by showing "Song — Verse 1" on the wall,
        // which is the first thing an operator would turn off.
        reference: { ...theme.reference, show: false },
      }),
      // Same reasoning for the token template on message/stage outputs.
      template: '{Text}',
    },
  }
}

// ─── Theme selection ───────────────────────────────────────────────────────────

/**
 * The theme currently on the rendered output for `kind` — the single answer to
 * "what does a push look like right now". Every preview surface must go through
 * this, and it is the one place the deprecated `overlay.theme` fallback has to
 * be deleted when the legacy field finally goes.
 */
export function liveOverlayTheme(
  overlay: AppSettings['overlay'],
  kind: OverlayContentKind = 'scripture',
): OverlayTheme {
  const rendered = primaryRenderedOutput(overlay.outputs)
  return rendered ? outputThemeFor(rendered, kind) : overlay.theme
}

// ─── Media allowlist ───────────────────────────────────────────────────────────

/**
 * Every background media path the user has configured — the definition of what
 * the `pa-media://` protocol is allowed to serve, in one greppable place.
 *
 * Reads RAW stored values rather than normalized ones on purpose: this runs once
 * per media request (and `stream: true` means a <video> issues many), and
 * validating a file path does not need clamped fonts, boxes or colors.
 */
export function configuredMediaPaths(storedOverlay: unknown, storedThemeLibrary: unknown): string[] {
  const paths: string[] = []

  const collect = (theme: unknown): void => {
    const mediaPath = (theme as { background?: { mediaPath?: unknown } })?.background?.mediaPath
    if (typeof mediaPath === 'string' && mediaPath.trim() !== '') paths.push(mediaPath)
  }

  const overlay = storedOverlay as { theme?: unknown; outputs?: unknown } | null
  collect(overlay?.theme)
  if (Array.isArray(overlay?.outputs)) {
    for (const output of overlay.outputs) {
      collect((output as { theme?: unknown })?.theme)
      // Per-content-kind overrides carry their own background media.
      collect((output as { lyrics?: { theme?: unknown } })?.lyrics?.theme)
    }
  }
  if (Array.isArray(storedThemeLibrary)) {
    for (const item of storedThemeLibrary) collect((item as { theme?: unknown })?.theme)
  }

  return paths
}
