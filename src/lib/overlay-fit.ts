/**
 * DOM auto-fit for overlay verse text. Renderer-only at runtime.
 * Typed without DOM globals so the shared lib still typechecks in Node.
 * overlay.html duplicates a tiny copy so the NDI window can fit without bundling.
 */

interface FitElement {
  dataset: { autoFit?: string; maxFontPx?: string }
  clientHeight: number
  clientWidth: number
  scrollHeight: number
  scrollWidth: number
  style: { fontSize: string }
  querySelector(selector: string): FitElement | null
}

interface FitRoot {
  querySelector(selector: string): FitElement | null
}

export function largestFontThatFits(
  minPx: number,
  maxPx: number,
  overflows: (px: number) => boolean
): number {
  const min = Math.max(1, Math.floor(minPx))
  const max = Math.max(min, Math.floor(maxPx))
  if (overflows(min)) return min
  let lo = min
  let hi = max
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)
    if (overflows(mid)) hi = mid - 1
    else lo = mid
  }
  return lo
}

/** True when the verse text does not fit the clip box (the NDI-visible area). */
export function overlayTextOverflows(
  text: { scrollHeight: number; scrollWidth: number },
  verse: { clientHeight: number; clientWidth: number },
  box: { clientHeight: number; clientWidth: number }
): boolean {
  // Flex min-height:auto can grow `.pa-verse` with its content. The box is
  // overflow:hidden, so it is the real 1920×1080 constraint.
  const limitH = Math.max(1, Math.min(verse.clientHeight, box.clientHeight))
  const limitW = Math.max(1, Math.min(verse.clientWidth, box.clientWidth))
  return text.scrollHeight > limitH + 1 || text.scrollWidth > limitW + 1
}

export function applyOverlayAutoFit(root: FitRoot): void {
  const box = root.querySelector('.pa-verse-box')
  const verse = root.querySelector('.pa-verse')
  if (!box || !verse) return
  if (box.dataset.autoFit !== 'true') return
  const maxPx = Number(box.dataset.maxFontPx)
  const cap = Number.isFinite(maxPx) && maxPx > 0 ? maxPx : 240
  const text = verse.querySelector('.pa-verse-text') ?? verse
  const fitted = largestFontThatFits(12, cap, (px) => {
    verse.style.fontSize = `${px}px`
    return overlayTextOverflows(text, verse, box)
  })
  verse.style.fontSize = `${fitted}px`
}
