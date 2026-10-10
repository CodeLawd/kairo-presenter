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
 * The shape a screen output draws in. Everything renders 1920 wide; the shape
 * sets the height, and the window scales that frame onto the display with
 * black bars wherever the two shapes differ. `letterbox` is 16:9 (its old
 * name, kept so saved settings read the same); `fill` takes the display's own
 * shape; `custom` uses `customAspect`.
 */
export type OutputAspect = 'letterbox' | '16:10' | '4:3' | '21:9' | '32:9' | '9:16' | '1:1' | 'fill' | 'custom'

export const OUTPUT_ASPECTS: ReadonlyArray<{ value: OutputAspect; label: string; ratio: [number, number] | null }> = [
  { value: 'letterbox', label: '16:9 — TVs, most projectors', ratio: [16, 9] },
  { value: '16:10', label: '16:10 — many projectors and laptops', ratio: [16, 10] },
  { value: '4:3', label: '4:3 — older projectors', ratio: [4, 3] },
  { value: '21:9', label: '21:9 — ultrawide', ratio: [21, 9] },
  { value: '32:9', label: '32:9 — super-wide LED wall', ratio: [32, 9] },
  { value: '9:16', label: '9:16 — portrait TV', ratio: [9, 16] },
  { value: '1:1', label: '1:1 — square LED panel', ratio: [1, 1] },
  { value: 'fill', label: 'Match the display', ratio: null },
  { value: 'custom', label: 'Custom ratio…', ratio: null },
]

export const OUTPUT_ASPECT_VALUES = OUTPUT_ASPECTS.map((option) => option.value)

/** Width ÷ height an output draws at, or null when it follows an unknown display. */
export function aspectRatioOf(
  aspect: OutputAspect,
  custom: { width: number; height: number } | null | undefined,
  display: { width: number; height: number } | null | undefined,
): number | null {
  if (aspect === 'fill') return display && display.width > 0 && display.height > 0 ? display.width / display.height : null
  if (aspect === 'custom') return custom && custom.width > 0 && custom.height > 0 ? custom.width / custom.height : 16 / 9
  const ratio = OUTPUT_ASPECTS.find((option) => option.value === aspect)?.ratio ?? [16, 9]
  return ratio[0] / ratio[1]
}

/**
 * Frame height (in 1920-wide theme pixels) for a screen output: 1080 for 16:9,
 * 1440 for 4:3, ~823 for 21:9, ~3413 for portrait 9:16; `fill` follows the
 * display. Clamped so a typo in a custom ratio cannot make an unusable frame.
 */
export function frameHeightFor(
  size: { width: number; height: number },
  aspect: OutputAspect,
  custom?: { width: number; height: number } | null,
): number {
  const ratio = aspectRatioOf(aspect, custom, size) ?? 16 / 9
  return Math.max(360, Math.min(4320, Math.round(1920 / ratio)))
}

/**
 * Where a test pattern goes: the window (the whole display, or the half-size
 * rehearsal window on the display with Kairo's controls — the same places the
 * real output opens) and the frame inside it as fractions of that window, so
 * the black bars land exactly where the output's will.
 */
export function testPatternLayout(
  display: { x: number; y: number; width: number; height: number },
  rehearsal: boolean,
  frameHeight: number,
): { bounds: { x: number; y: number; width: number; height: number }; frame: { width: number; height: number } } {
  let bounds = display
  if (rehearsal) {
    // The rehearsal window takes the frame's own shape, so it has no bars.
    const width = Math.round(display.width / 2)
    const height = Math.round((width * frameHeight) / 1920)
    bounds = {
      width,
      height,
      x: display.x + Math.round((display.width - width) / 2),
      y: display.y + Math.round((display.height - height) / 2),
    }
  }
  const scale = Math.min(bounds.width / 1920, bounds.height / frameHeight)
  return { bounds, frame: { width: (1920 * scale) / bounds.width, height: (frameHeight * scale) / bounds.height } }
}
