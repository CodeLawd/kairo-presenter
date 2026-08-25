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

export function clampOverlayBox(box: OverlayBox): OverlayBox {
  const widthPct = clamp(box.widthPct, MIN_BOX_WIDTH_PCT, 100)
  const heightPct = clamp(box.heightPct, MIN_BOX_HEIGHT_PCT, 100)
  return {
    xPct: clamp(box.xPct, 0, 100 - widthPct),
    yPct: clamp(box.yPct, 0, 100 - heightPct),
    widthPct,
    heightPct,
  }
}

export function moveOverlayBox(box: OverlayBox, dxPct: number, dyPct: number): OverlayBox {
  return clampOverlayBox({
    ...box,
    xPct: box.xPct + dxPct,
    yPct: box.yPct + dyPct,
  })
}

export function resizeOverlayBox(
  box: OverlayBox,
  handle: ResizeHandle,
  dxPct: number,
  dyPct: number
): OverlayBox {
  let left = box.xPct
  let top = box.yPct
  let right = box.xPct + box.widthPct
  let bottom = box.yPct + box.heightPct

  if (handle.includes('e')) right += dxPct
  if (handle.includes('w')) left += dxPct
  if (handle.includes('s')) bottom += dyPct
  if (handle.includes('n')) top += dyPct

  if (right - left < MIN_BOX_WIDTH_PCT) {
    if (handle.includes('w')) left = right - MIN_BOX_WIDTH_PCT
    else right = left + MIN_BOX_WIDTH_PCT
  }
  if (bottom - top < MIN_BOX_HEIGHT_PCT) {
    if (handle.includes('n')) top = bottom - MIN_BOX_HEIGHT_PCT
    else bottom = top + MIN_BOX_HEIGHT_PCT
  }

  left = clamp(left, 0, 100)
  right = clamp(right, 0, 100)
  top = clamp(top, 0, 100)
  bottom = clamp(bottom, 0, 100)

  if (right - left < MIN_BOX_WIDTH_PCT) {
    if (handle.includes('w')) left = clamp(right - MIN_BOX_WIDTH_PCT, 0, 100 - MIN_BOX_WIDTH_PCT)
    else right = clamp(left + MIN_BOX_WIDTH_PCT, MIN_BOX_WIDTH_PCT, 100)
  }
  if (bottom - top < MIN_BOX_HEIGHT_PCT) {
    if (handle.includes('n')) top = clamp(bottom - MIN_BOX_HEIGHT_PCT, 0, 100 - MIN_BOX_HEIGHT_PCT)
    else bottom = clamp(top + MIN_BOX_HEIGHT_PCT, MIN_BOX_HEIGHT_PCT, 100)
  }

  return clampOverlayBox({
    xPct: left,
    yPct: top,
    widthPct: right - left,
    heightPct: bottom - top,
  })
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
