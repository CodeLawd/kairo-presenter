// ─── Display binding for `screen` outputs ──────────────────────────────────────
// Pure — no Node/DOM APIs — importable from main, preload, and renderer alike.
//
// A screen output remembers the display it was pointed at. Electron's
// `Display.id` is the fast path, but Windows re-ids a monitor when it is
// replugged, so the label + size recorded at bind time is the second chance.
// There is deliberately no third chance: falling back to "some other screen"
// would put the program over the operator's controls in the middle of a service.

import type { DisplayInfo, OverlayOutput } from './ipc'

type DisplayBinding = Pick<OverlayOutput, 'displayId' | 'displayLabel' | 'displaySize'>

/**
 * The display `output` is bound to, or null when it is not connected (or was
 * never chosen). A result whose `id` differs from `output.displayId` came from
 * the label + size re-match — the caller should persist the new id.
 */
export function resolveDisplay(
  output: DisplayBinding,
  displays: readonly DisplayInfo[],
  claimedIds: ReadonlySet<number> = new Set(),
): DisplayInfo | null {
  if (output.displayId === null) return null

  const byId = displays.find((d) => d.id === output.displayId)
  if (byId) return claimedIds.has(byId.id) ? null : byId

  const label = output.displayLabel.trim()
  const size = output.displaySize
  if (!label || !size) return null
  const matches = displays.filter(
    (d) => d.label === label && d.size.width === size.width && d.size.height === size.height,
  )
  // Two identical projectors: guessing which one is which is exactly the
  // "some other screen" fallback this module exists to refuse.
  return matches.length === 1 && !claimedIds.has(matches[0].id) ? matches[0] : null
}

/** The binding fields to store when an operator picks `display`. */
export function bindingForDisplay(display: DisplayInfo): DisplayBinding {
  return {
    displayId: display.id,
    displayLabel: display.label,
    displaySize: { width: display.size.width, height: display.size.height },
  }
}

/** "DELL U2720Q · 2560×1440" — the label an operator recognises a display by. */
export function describeDisplay(display: Pick<DisplayInfo, 'label' | 'size' | 'scaleFactor'>): string {
  const name = display.label.trim() || 'Display'
  const width = Math.round(display.size.width * display.scaleFactor)
  const height = Math.round(display.size.height * display.scaleFactor)
  return `${name} · ${width}×${height}`
}

/**
 * Frame height (in 1920-wide theme pixels) for a screen output on a display of
 * `size`: 1080 when letterboxing, else the display's own aspect — a 4:3
 * projector gets 1440, a 21:9 panel about 823.
 */
export function frameHeightFor(size: { width: number; height: number }, fill: boolean): number {
  if (!fill || size.width <= 0 || size.height <= 0) return 1080
  return Math.max(360, Math.min(4320, Math.round((1920 * size.height) / size.width)))
}
