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

export function applyOverlayAutoFit(root: FitRoot): void {
  const box = root.querySelector('.pa-verse-box')
  const verse = root.querySelector('.pa-verse')
  if (!box || !verse) return
  if (box.dataset.autoFit !== 'true') return
  const maxPx = Number(box.dataset.maxFontPx)
  const cap = Number.isFinite(maxPx) && maxPx > 0 ? maxPx : 200
  const fitted = largestFontThatFits(12, cap, (px) => {
    verse.style.fontSize = `${px}px`
    return verse.scrollHeight > box.clientHeight + 1 || verse.scrollWidth > box.clientWidth + 1
  })
  verse.style.fontSize = `${fitted}px`
}
