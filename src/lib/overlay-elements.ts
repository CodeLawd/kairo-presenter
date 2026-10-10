// ─── Theme elements: shapes, images and videos on the slide ───────────────────
// Pure — no Node/DOM APIs. Defaults, the normalizer and the list edits the Theme
// editor makes; the markup lives in overlay-template.ts with the rest.

import type { OverlayBox, OverlayElement, OverlayElementKind } from './ipc'
import { clampOverlayBox, ELEMENT_BOX_MIN } from './overlay-boxes'
import { asObject, clampNum, safeBool, safeColor, safeEnum, safeString } from './normalize'
import { overlayShape } from './overlay-shapes'

export const OVERLAY_ELEMENT_KINDS: readonly OverlayElementKind[] = ['rectangle', 'ellipse', 'shape', 'image', 'video']

/** A theme carries at most this many — each is a DOM node on every output. */
export const MAX_OVERLAY_ELEMENTS = 40

export function isMediaElement(element: Pick<OverlayElement, 'kind'>): boolean {
  return element.kind === 'image' || element.kind === 'video'
}

/** A line or connector: border only, no fill. */
export function isLineElement(element: Pick<OverlayElement, 'kind' | 'shape'>): boolean {
  return element.kind === 'shape' && !!overlayShape(element.shape)?.lineOnly
}

export function overlayElementLabel(element: Pick<OverlayElement, 'kind' | 'shape'>): string {
  if (element.kind === 'shape') return overlayShape(element.shape)?.label ?? 'Shape'
  return { rectangle: 'Rectangle', ellipse: 'Ellipse', image: 'Image', video: 'Video' }[element.kind]
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `el-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Where a new element lands: centred, a quarter of the frame wide and square on screen. */
const DEFAULT_BOX: OverlayBox = { xPct: 40, yPct: 32.22, widthPct: 20, heightPct: 35.56 }
/** Lines start wide and flat, so a horizontal rule looks like one. */
const DEFAULT_LINE_BOX: OverlayBox = { xPct: 35, yPct: 45, widthPct: 30, heightPct: 10 }
/** A 16:9 box for media, so a picture starts at its likely shape. */
const DEFAULT_MEDIA_BOX: OverlayBox = { xPct: 35, yPct: 32.5, widthPct: 30, heightPct: 35 }

export function createOverlayElement(
  kind: OverlayElementKind,
  mediaPath?: string,
  id = newId(),
  shape?: string,
): OverlayElement {
  const line = kind === 'shape' && !!overlayShape(shape)?.lineOnly
  return {
    id,
    kind,
    shape: kind === 'shape' ? shape : undefined,
    box: { ...(kind === 'image' || kind === 'video' ? DEFAULT_MEDIA_BOX : line ? DEFAULT_LINE_BOX : DEFAULT_BOX) },
    aboveText: false,
    opacity: 1,
    rotationDeg: 0,
    fill: '#ffffff',
    fillOpacity: 1,
    // A line is nothing but its stroke.
    stroke: line ? { enabled: true, color: '#ffffff', opacity: 1, widthPx: 6 } : { enabled: false, color: '#000000', opacity: 1, widthPx: 4 },
    radiusPx: 0,
    mediaPath,
    mediaFit: 'cover',
    mediaLoop: true,
    hue: 0,
    saturation: 1,
    brightness: 1,
    contrast: 1,
    blurPx: 0,
  }
}

export function normalizeOverlayElement(raw: unknown): OverlayElement | null {
  const r = asObject(raw)
  const kind = safeEnum(r.kind, OVERLAY_ELEMENT_KINDS, 'rectangle')
  const id = safeString(r.id, '').trim()
  if (!id) return null
  // A shape the catalog no longer has is dropped rather than drawn as something else.
  const shape = kind === 'shape' ? safeString(r.shape, '') : undefined
  if (kind === 'shape' && !overlayShape(shape)) return null
  const d = createOverlayElement(kind, undefined, id, shape)
  const box = asObject(r.box)
  const stroke = asObject(r.stroke)
  const mediaPath = typeof r.mediaPath === 'string' && r.mediaPath.trim() !== '' ? r.mediaPath.trim() : undefined
  return {
    ...d,
    box: clampOverlayBox(
      {
        xPct: clampNum(box.xPct, 0, 100, d.box.xPct),
        yPct: clampNum(box.yPct, 0, 100, d.box.yPct),
        widthPct: clampNum(box.widthPct, 0, 100, d.box.widthPct),
        heightPct: clampNum(box.heightPct, 0, 100, d.box.heightPct),
      },
      ELEMENT_BOX_MIN,
    ),
    aboveText: safeBool(r.aboveText, d.aboveText),
    opacity: clampNum(r.opacity, 0, 1, d.opacity),
    rotationDeg: clampNum(r.rotationDeg, -180, 180, d.rotationDeg),
    fill: safeColor(r.fill, d.fill),
    fillOpacity: clampNum(r.fillOpacity, 0, 1, d.fillOpacity),
    stroke: {
      enabled: safeBool(stroke.enabled, d.stroke.enabled),
      color: safeColor(stroke.color, d.stroke.color),
      opacity: clampNum(stroke.opacity, 0, 1, d.stroke.opacity),
      widthPx: clampNum(stroke.widthPx, 0, 200, d.stroke.widthPx),
    },
    radiusPx: clampNum(r.radiusPx, 0, 1080, d.radiusPx),
    // Path validity is enforced by the pa-media:// allowlist in main, as for the background.
    mediaPath: isMediaElement({ kind }) ? mediaPath : undefined,
    mediaFit: safeEnum(r.mediaFit, ['cover', 'contain', 'fill'] as const, d.mediaFit),
    mediaLoop: safeBool(r.mediaLoop, d.mediaLoop),
    hue: clampNum(r.hue, -180, 180, d.hue),
    saturation: clampNum(r.saturation, 0, 2, d.saturation),
    brightness: clampNum(r.brightness, 0.25, 1.75, d.brightness),
    contrast: clampNum(r.contrast, 0.25, 1.75, d.contrast),
    blurPx: clampNum(r.blurPx, 0, 40, d.blurPx),
  }
}

export function normalizeOverlayElements(raw: unknown): OverlayElement[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: OverlayElement[] = []
  for (const item of raw) {
    const element = normalizeOverlayElement(item)
    if (!element || seen.has(element.id)) continue
    seen.add(element.id)
    out.push(element)
    if (out.length === MAX_OVERLAY_ELEMENTS) break
  }
  return out
}

// ─── List edits ─────────────────────────────────────────────────────────────────

export function updateOverlayElement(
  elements: readonly OverlayElement[],
  id: string,
  patch: Partial<Omit<OverlayElement, 'id' | 'kind'>>,
): OverlayElement[] {
  return elements.map((el) => (el.id === id ? { ...el, ...patch } : el))
}

export function removeOverlayElement(elements: readonly OverlayElement[], id: string): OverlayElement[] {
  return elements.filter((el) => el.id !== id)
}

/** A copy of `id`, nudged so it doesn't hide exactly behind the original, placed just above it. */
export function duplicateOverlayElement(
  elements: readonly OverlayElement[],
  id: string,
  newElementId = newId(),
): { elements: OverlayElement[]; id: string | null } {
  const index = elements.findIndex((el) => el.id === id)
  if (index === -1 || elements.length >= MAX_OVERLAY_ELEMENTS) return { elements: [...elements], id: null }
  const source = elements[index]
  const copy: OverlayElement = {
    ...structuredClone(source),
    id: newElementId,
    box: clampOverlayBox({ ...source.box, xPct: source.box.xPct + 2, yPct: source.box.yPct + 2 }, ELEMENT_BOX_MIN),
  }
  const next = [...elements]
  next.splice(index + 1, 0, copy)
  return { elements: next, id: newElementId }
}

/**
 * Moves `id` one step in drawing order within its own group (under or over the
 * text) — or all the way with `to: 'front' | 'back'`.
 */
export function reorderOverlayElement(
  elements: readonly OverlayElement[],
  id: string,
  to: 'forward' | 'backward' | 'front' | 'back',
): OverlayElement[] {
  const target = elements.find((el) => el.id === id)
  if (!target) return [...elements]
  const group = elements.filter((el) => el.aboveText === target.aboveText)
  const others = elements.filter((el) => el.aboveText !== target.aboveText)
  const from = group.indexOf(target)
  const rest = group.filter((el) => el !== target)
  const at =
    to === 'front' ? rest.length : to === 'back' ? 0 : to === 'forward' ? Math.min(rest.length, from + 1) : Math.max(0, from - 1)
  rest.splice(at, 0, target)
  // Groups draw separately, so their relative order in the array doesn't matter.
  return [...others, ...rest]
}
