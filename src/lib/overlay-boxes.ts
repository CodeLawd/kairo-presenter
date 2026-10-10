import type { OverlayBox, OverlayTheme } from './ipc'

export const MIN_BOX_WIDTH_PCT = 8
export const MIN_BOX_HEIGHT_PCT = 6
export const VERSE_HEIGHT_PCT = 24
export const REFERENCE_HEIGHT_PCT = 10
export const STACK_GAP_PCT = 2
export const FRAME_MARGIN_PCT = 6

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** Smallest box a layer may shrink to, in % of the frame. */
export interface BoxMinimum {
  widthPct: number
  heightPct: number
}

/** Text boxes keep room for a line of text. */
export const TEXT_BOX_MIN: BoxMinimum = { widthPct: MIN_BOX_WIDTH_PCT, heightPct: MIN_BOX_HEIGHT_PCT }
/** Shapes and media can be thin — a rule under a lower third is a shape too. */
export const ELEMENT_BOX_MIN: BoxMinimum = { widthPct: 0.5, heightPct: 0.5 }

export function clampOverlayBox(box: OverlayBox, min: BoxMinimum = TEXT_BOX_MIN): OverlayBox {
  const widthPct = clamp(box.widthPct, min.widthPct, 100)
  const heightPct = clamp(box.heightPct, min.heightPct, 100)
  return {
    xPct: clamp(box.xPct, 0, 100 - widthPct),
    yPct: clamp(box.yPct, 0, 100 - heightPct),
    widthPct,
    heightPct,
  }
}

export function moveOverlayBox(box: OverlayBox, dxPct: number, dyPct: number, min: BoxMinimum = TEXT_BOX_MIN): OverlayBox {
  return clampOverlayBox(
    {
      ...box,
      xPct: box.xPct + dxPct,
      yPct: box.yPct + dyPct,
    },
    min,
  )
}

export function resizeOverlayBox(
  box: OverlayBox,
  handle: ResizeHandle,
  dxPct: number,
  dyPct: number,
  min: BoxMinimum = TEXT_BOX_MIN,
): OverlayBox {
  let left = box.xPct
  let top = box.yPct
  let right = box.xPct + box.widthPct
  let bottom = box.yPct + box.heightPct

  if (handle.includes('e')) right += dxPct
  if (handle.includes('w')) left += dxPct
  if (handle.includes('s')) bottom += dyPct
  if (handle.includes('n')) top += dyPct

  if (right - left < min.widthPct) {
    if (handle.includes('w')) left = right - min.widthPct
    else right = left + min.widthPct
  }
  if (bottom - top < min.heightPct) {
    if (handle.includes('n')) top = bottom - min.heightPct
    else bottom = top + min.heightPct
  }

  left = clamp(left, 0, 100)
  right = clamp(right, 0, 100)
  top = clamp(top, 0, 100)
  bottom = clamp(bottom, 0, 100)

  if (right - left < min.widthPct) {
    if (handle.includes('w')) left = clamp(right - min.widthPct, 0, 100 - min.widthPct)
    else right = clamp(left + min.widthPct, min.widthPct, 100)
  }
  if (bottom - top < min.heightPct) {
    if (handle.includes('n')) top = clamp(bottom - min.heightPct, 0, 100 - min.heightPct)
    else bottom = clamp(top + min.heightPct, min.heightPct, 100)
  }

  return clampOverlayBox(
    {
      xPct: left,
      yPct: top,
      widthPct: right - left,
      heightPct: bottom - top,
    },
    min,
  )
}

/**
 * Resize that keeps the box's shape — Shift while dragging a handle. A corner
 * scales from the opposite corner, following whichever edge moved further; an
 * edge scales about the box's centre line.
 */
export function resizeOverlayBoxKeepingAspect(
  box: OverlayBox,
  handle: ResizeHandle,
  dxPct: number,
  dyPct: number,
  min: BoxMinimum = TEXT_BOX_MIN,
): OverlayBox {
  const width = box.widthPct + (handle.includes('e') ? dxPct : handle.includes('w') ? -dxPct : 0)
  const height = box.heightPct + (handle.includes('s') ? dyPct : handle.includes('n') ? -dyPct : 0)
  const horizontal = handle.includes('e') || handle.includes('w')
  const vertical = handle.includes('n') || handle.includes('s')
  let scale =
    horizontal && vertical
      ? Math.max(width / box.widthPct, height / box.heightPct)
      : horizontal
        ? width / box.widthPct
        : height / box.heightPct
  scale = Math.max(scale, min.widthPct / box.widthPct, min.heightPct / box.heightPct)
  // Never grow past the frame in either direction.
  scale = Math.min(scale, 100 / box.widthPct, 100 / box.heightPct)

  const w = box.widthPct * scale
  const h = box.heightPct * scale
  const left = handle.includes('w') ? box.xPct + box.widthPct - w : horizontal ? box.xPct : box.xPct + (box.widthPct - w) / 2
  const top = handle.includes('n') ? box.yPct + box.heightPct - h : vertical ? box.yPct : box.yPct + (box.heightPct - h) / 2
  return clampOverlayBox({ xPct: left, yPct: top, widthPct: w, heightPct: h }, min)
}

export function boxesForLayoutPreset(
  position: OverlayTheme['layout']['position'],
  referencePosition: OverlayTheme['reference']['position'],
  maxWidthPct: number,
  showReference: boolean
): { verse: OverlayBox; reference: OverlayBox } {
  const widthPct = position === 'full' ? 100 : clamp(maxWidthPct, 20, 100)
  const xPct = (100 - widthPct) / 2
  const verseH = position === 'full' ? (showReference ? 88 : 100) : VERSE_HEIGHT_PCT
  const refH = position === 'full' ? 12 : REFERENCE_HEIGHT_PCT
  const gap = position === 'full' ? 0 : STACK_GAP_PCT
  const pairHeight = verseH + (showReference ? gap + refH : 0)

  let pairTop: number
  if (position === 'full') pairTop = 0
  else if (position === 'top') pairTop = FRAME_MARGIN_PCT
  else if (position === 'center') pairTop = (100 - pairHeight) / 2
  else pairTop = 100 - FRAME_MARGIN_PCT - pairHeight

  if (showReference && referencePosition === 'above') {
    return {
      reference: clampOverlayBox({ xPct, yPct: pairTop, widthPct, heightPct: refH }),
      verse: clampOverlayBox({
        xPct,
        yPct: pairTop + refH + gap,
        widthPct,
        heightPct: verseH,
      }),
    }
  }

  return {
    verse: clampOverlayBox({ xPct, yPct: pairTop, widthPct, heightPct: verseH }),
    reference: clampOverlayBox({
      xPct,
      yPct: pairTop + verseH + gap,
      widthPct,
      heightPct: refH,
    }),
  }
}

export function placeReferenceAgainstVerse(
  verse: OverlayBox,
  reference: OverlayBox,
  position: OverlayTheme['reference']['position']
): OverlayBox {
  const gap = STACK_GAP_PCT
  if (position === 'above') {
    return clampOverlayBox({
      ...reference,
      xPct: verse.xPct,
      widthPct: verse.widthPct,
      yPct: verse.yPct - reference.heightPct - gap,
    })
  }
  return clampOverlayBox({
    ...reference,
    xPct: verse.xPct,
    widthPct: verse.widthPct,
    yPct: verse.yPct + verse.heightPct + gap,
  })
}

export function applyLayoutPreset(
  theme: OverlayTheme,
  position: OverlayTheme['layout']['position'],
  maxWidthPct = theme.layout.maxWidthPct
): OverlayTheme {
  const boxes = boxesForLayoutPreset(
    position,
    theme.reference.position,
    maxWidthPct,
    theme.reference.show
  )
  return {
    ...theme,
    verse: { ...theme.verse, box: boxes.verse },
    reference: { ...theme.reference, box: boxes.reference },
    layout: { ...theme.layout, position, maxWidthPct },
  }
}

export function overlayBoxStyle(box: OverlayBox): string {
  return [
    'position:absolute;',
    `left:${box.xPct}%;`,
    `top:${box.yPct}%;`,
    `width:${box.widthPct}%;`,
    `height:${box.heightPct}%;`,
    'box-sizing:border-box;',
    'overflow:hidden;',
  ].join(' ')
}
