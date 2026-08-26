// ─── Overlay outputs — layer routing (phase 3) ─────────────────────────────────
// Pure — no Node/DOM APIs — importable from main, preload, and renderer alike.
//
// ProPresenter's REST API has no "send this to screen 2". The routing primitive
// is the LAYER; a Look decides which layers each screen shows. So an output is a
// (PP layer, content, styling) triple, and the dispatch rule falls out of the
// layer map below:
//
//   across layer groups → fan out in parallel (stage AND messages AND presentation)
//   within a layer group → first success wins (library, else NDI — they compete
//                          for the same presentation layer)
//
// This module is deliberately free of theme normalization so it can be imported
// by `overlay-defaults.ts` without a cycle — `normalizeOverlayOutputs` lives
// there, next to `normalizeOverlayTheme` and the shared clamp helpers.

import type { AppSettings, OverlayLayer, OverlayOutput, OverlayOutputKind, OverlayTheme } from './ipc'

// ─── Layer map ─────────────────────────────────────────────────────────────────

export const OVERLAY_OUTPUT_KINDS: readonly OverlayOutputKind[] = [
  'ndi',
  'library',
  'message',
  'stage',
] as const

/**
 * How many `ndi` outputs can be live at once. The NDI sender and the offscreen
 * overlay window are both singletons, so a second feed would silently overwrite
 * the first's frame. Single source of truth for the normalizer and the UI — the
 * day those become pools, this is the only number that changes.
 */
export const MAX_NDI_OUTPUTS = 1

const LAYER_OF: Record<OverlayOutputKind, OverlayLayer> = {
  ndi: 'presentation',
  library: 'presentation',
  message: 'messages',
  stage: 'stage',
}

/** Stable group order — only affects reporting; groups run concurrently. */
export const OVERLAY_LAYERS: readonly OverlayLayer[] = ['presentation', 'messages', 'stage'] as const

export function layerOfKind(kind: OverlayOutputKind): OverlayLayer {
  return LAYER_OF[kind]
}

/** Human-facing label for the "where does this land" column in the Outputs UI. */
export function layerLabel(layer: OverlayLayer): string {
  if (layer === 'presentation') return 'Presentation layer'
  if (layer === 'messages') return 'Messages layer'
  return 'Stage screens'
}

// ─── Grouping ──────────────────────────────────────────────────────────────────

export interface OverlayLayerGroup {
  layer: OverlayLayer
  /** Enabled outputs on this layer, in ascending `order`. */
  outputs: OverlayOutput[]
}

/**
 * Enabled outputs bucketed by layer, each bucket sorted by `order`. Empty
 * buckets are dropped, so an empty result means "nothing to push".
 *
 * `fallbackOnly` outputs are excluded — they are not part of the normal fan-out
 * and are retrieved separately via `fallbackOutputs()` once the primary pass has
 * failed everywhere.
 */
export function groupOutputsByLayer(outputs: readonly OverlayOutput[]): OverlayLayerGroup[] {
  const groups: OverlayLayerGroup[] = []

  for (const layer of OVERLAY_LAYERS) {
    const inLayer = outputs
      .filter((o) => o.enabled && !o.fallbackOnly && layerOfKind(o.kind) === layer)
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

/**
 * Enabled last-resort outputs, in ascending `order`. Tried in sequence only when
 * the primary fan-out produced no successful push at all — this is what keeps
 * the legacy modes' "…then the message overlay" behaviour intact.
 */
export function fallbackOutputs(outputs: readonly OverlayOutput[]): OverlayOutput[] {
  return outputs.filter((o) => o.enabled && o.fallbackOnly).sort((a, b) => a.order - b.order)
}

/**
 * The single `ndi` output, if one is enabled. The normalizer caps the list at
 * one — a second simultaneous NDI feed needs a sender pool (see the deferred
 * section of the phase-3 plan).
 */
export function findNdiOutput(outputs: readonly OverlayOutput[]): OverlayOutput | null {
  return outputs.find((o) => o.kind === 'ndi') ?? null
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
  /**
   * One bucket per PP layer that has work. Buckets run CONCURRENTLY (they land
   * on different layers, so they can all be on screen at once); within a bucket
   * the outputs run in order and stop at the first success (they compete for the
   * same layer — the second would just replace the first).
   */
  groups: OverlayLayerGroup[]
  /** Tried in order, only if `groups` produced no success at all. */
  fallbacks: OverlayOutput[]
}

export function getDispatchPlan(outputs: readonly OverlayOutput[]): OverlayDispatchPlan {
  return { groups: groupOutputsByLayer(outputs), fallbacks: fallbackOutputs(outputs) }
}

// ─── Theme selection ───────────────────────────────────────────────────────────

/**
 * The theme currently on the rendered output — the single answer to "what does
 * a verse preview look like right now". Every preview surface must go through
 * this, and it is the one place the deprecated `overlay.theme` fallback has to
 * be deleted when the legacy field finally goes.
 */
export function liveOverlayTheme(overlay: AppSettings['overlay']): OverlayTheme {
  const enabledNdi = overlay.outputs.find((output) => output.kind === 'ndi' && output.enabled)
  return enabledNdi?.theme ?? findNdiOutput(overlay.outputs)?.theme ?? overlay.theme
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
    for (const output of overlay.outputs) collect((output as { theme?: unknown })?.theme)
  }
  if (Array.isArray(storedThemeLibrary)) {
    for (const item of storedThemeLibrary) collect((item as { theme?: unknown })?.theme)
  }

  return paths
}
