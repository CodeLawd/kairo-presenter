// ─── Overlay defaults + settings normalizer (D3 / D5a) ─────────────────────────
// Pure — no Node/DOM APIs — importable from main, preload, and renderer alike.
//
// electron-store (v8) does NOT deep-merge stored values with `defaults`; it
// shallow-`Object.assign`s at the top level only. That means a phase-1 user's
// stored `overlay` object (with missing theme fields) wholesale
// replaces the phase-2 default and `store.get('overlay').mode` comes back
// `undefined`. `normalizeOverlaySettings` is the single place that heals any
// shape (missing keys, wrong types, out-of-range numbers, malformed colors)
// back to something safe to render and persist. Every consumer — the one-time
// migration in `src/main/db/index.ts`, orchestrator, IPC handlers, and the
// renderer Settings/Theme pages on hydration — must route stored `overlay`
// through this before using it.

import { OUTPUT_ASPECT_VALUES } from './displays'
import type {
  AppSettings,
  OverlayBox,
  OverlayOutput,
  OverlayOutputKind,
  OverlayOutputVariant,
  OverlayTextOutline,
  OverlayTextShadow,
  OverlayTextStyle,
  OverlayTheme,
} from './ipc'
import { boxesForLayoutPreset, clampOverlayBox } from './overlay-boxes'
import { isLocalKind, MAX_NDI_OUTPUTS, MAX_SYPHON_OUTPUTS, OVERLAY_OUTPUT_KINDS } from './overlay-outputs'
import { normalizeOverlayElements } from './overlay-elements'
import { DEFAULT_CONFIDENCE_LAYOUT, DEFAULT_SHOW_FILTER, normalizeConfidenceLayout, normalizeShowFilter } from './program'
import {
  asObject,
  clampNum,
  nonNegNumber,
  safeBool,
  safeColor,
  safeEnum,
  safeString,
} from './normalize'

// ─── Theme defaults (schema locked — see docs/plans/2026-07-08-ndi-overlay.md) ─

const DEFAULT_BOXES = boxesForLayoutPreset('lower-third', 'below', 82, true)

export const DEFAULT_TEXT_SHADOW: OverlayTextShadow = {
  enabled: true,
  xPx: 0,
  yPx: 4,
  blurPx: 12,
  color: '#000000',
  opacity: 0.7,
}

export const DEFAULT_TEXT_OUTLINE: OverlayTextOutline = {
  enabled: false,
  position: 'outside',
  widthPx: 0,
  style: 'solid',
  color: '#000000',
  opacity: 1,
}

const DEFAULT_VERSE_STYLE: OverlayTextStyle = {
  fontFamily: "'Helvetica Neue', Arial, sans-serif",
  fontSizePx: 54,
  fontWeight: 600,
  color: '#ffffff',
  colorOpacity: 1,
  lineHeight: 1.35,
  letterSpacingPx: 0,
  align: 'center',
  verticalAlign: 'middle',
  textDecoration: 'none',
  textTransform: 'none',
  shadow: { ...DEFAULT_TEXT_SHADOW },
  outline: { ...DEFAULT_TEXT_OUTLINE },
  box: DEFAULT_BOXES.verse,
}

const DEFAULT_REFERENCE_STYLE: OverlayTextStyle = {
  fontFamily: "'Helvetica Neue', Arial, sans-serif",
  fontSizePx: 32,
  fontWeight: 700,
  color: '#5eead4',
  colorOpacity: 1,
  lineHeight: 1.25,
  letterSpacingPx: 0.32,
  align: 'center',
  verticalAlign: 'middle',
  textDecoration: 'none',
  textTransform: 'none',
  shadow: { ...DEFAULT_TEXT_SHADOW, enabled: false, yPx: 2, blurPx: 8 },
  outline: { ...DEFAULT_TEXT_OUTLINE },
  box: DEFAULT_BOXES.reference,
}

export const DEFAULT_OVERLAY_THEME: OverlayTheme = {
  elements: [],
  background: { type: 'transparent', color: '#0b1220', opacity: 1, mediaFit: 'cover' },
  verse: DEFAULT_VERSE_STYLE,
  reference: {
    ...DEFAULT_REFERENCE_STYLE,
    show: true,
    position: 'below',
  },
  layout: {
    position: 'lower-third',
    maxWidthPct: 82,
    paddingPx: 48,
    // Off until the operator turns it on — a theme should not arrive with a
    // dark box behind the text that nobody asked for.
    backdropBox: false,
    backdropColor: 'rgba(3, 10, 20, 0.75)',
    backdropRadiusPx: 0,
    autoFitText: false,
  },
}

// ─── Output defaults (phase 3) ─────────────────────────────────────────────────

const DEFAULT_TEMPLATE = '{Reference}\n{Text}'

/**
 * Builds one output with every field populated. Callers pass only what differs —
 * this is the single place that knows the full shape, so adding a field to
 * `OverlayOutput` cannot silently leave holes in stored data.
 */
export function makeOverlayOutput(
  id: string,
  kind: OverlayOutputKind,
  patch: Partial<OverlayOutput> = {}
): OverlayOutput {
  return {
    id,
    name: id,
    kind,
    enabled: false,
    order: 0,
    fallbackOnly: false,
    themeId: null,
    theme: structuredClone(DEFAULT_OVERLAY_THEME),
    template: DEFAULT_TEMPLATE,
    lyrics: null,
    displayId: null,
    displayLabel: '',
    devicePortId: '',
    devicePortLabel: '',
    deviceModeId: '',
    deviceKeyFill: false,
    displaySize: null,
    aspect: 'letterbox',
    customAspect: { width: 16, height: 9 },
    show: { ...DEFAULT_SHOW_FILTER },
    source: 'program',
    playlistId: '',
    slideSec: 8,
    confidence: { ...DEFAULT_CONFIDENCE_LAYOUT },
    ...patch,
  }
}

/** Disabled until the operator assigns a physical screen. */
export const PROJECTOR_OUTPUT_ID = 'projector'

export function makeProjectorOutput(order: number): OverlayOutput {
  return makeOverlayOutput(PROJECTOR_OUTPUT_ID, 'screen', { name: 'Main Screen', order })
}

/**
 * Audience always has one screen to start from, as ProPresenter's "Main
 * Screen": switched on, waiting for a display to be chosen.
 */
const DEFAULT_OVERLAY_OUTPUTS: OverlayOutput[] = [{ ...makeProjectorOutput(0), enabled: true }]

export const DEFAULT_OVERLAY_SETTINGS: AppSettings['overlay'] = {
  // — phase 1 —
  template: DEFAULT_TEMPLATE,
  showTranslation: true,
  showVerseNumbers: true,
  maxVerses: 0,
  // — phase 3 —
  outputs: DEFAULT_OVERLAY_OUTPUTS,
  // Legacy theme fallback for stored themes.
  theme: DEFAULT_OVERLAY_THEME,
}

// ─── Validation primitives (D5a) ───────────────────────────────────────────────

/** Strips characters that could break out of a quoted CSS font-family string. */
function safeFontFamily(v: unknown, fallback: string): string {
  const s = safeString(v, fallback).replace(/["\\;{}]/g, '').trim()
  return s || fallback
}

function normalizeBox(raw: unknown, fallback: OverlayBox): OverlayBox {
  const r = asObject(raw)
  return clampOverlayBox({
    xPct: clampNum(r.xPct, 0, 100, fallback.xPct),
    yPct: clampNum(r.yPct, 0, 100, fallback.yPct),
    widthPct: clampNum(r.widthPct, 8, 100, fallback.widthPct),
    heightPct: clampNum(r.heightPct, 6, 100, fallback.heightPct),
  })
}

function normalizeShadow(raw: unknown, fallback: OverlayTextShadow): OverlayTextShadow {
  // Legacy: `shadow: true | false`
  if (typeof raw === 'boolean') {
    return { ...fallback, enabled: raw }
  }
  const r = asObject(raw)
  return {
    enabled: safeBool(r.enabled, fallback.enabled),
    xPx: clampNum(r.xPx, -40, 40, fallback.xPx),
    yPx: clampNum(r.yPx, -40, 40, fallback.yPx),
    blurPx: clampNum(r.blurPx, 0, 80, fallback.blurPx),
    color: safeColor(r.color, fallback.color),
    opacity: clampNum(r.opacity, 0, 1, fallback.opacity),
  }
}

function normalizeOutline(raw: unknown, fallback: OverlayTextOutline): OverlayTextOutline {
  const r = asObject(raw)
  return {
    enabled: safeBool(r.enabled, fallback.enabled),
    position: safeEnum(r.position, ['outside', 'inside', 'center'] as const, fallback.position),
    widthPx: clampNum(r.widthPx, 0, 24, fallback.widthPx),
    style: safeEnum(r.style, ['solid', 'dashed', 'dotted'] as const, fallback.style),
    color: safeColor(r.color, fallback.color),
    opacity: clampNum(r.opacity, 0, 1, fallback.opacity),
  }
}

function normalizeTextStyle(
  raw: unknown,
  fallback: OverlayTextStyle,
  boxFallback: OverlayBox,
  legacy?: { uppercase?: unknown; shadow?: unknown }
): OverlayTextStyle {
  const r = asObject(raw)
  const legacyUpper = safeBool(legacy?.uppercase ?? r.uppercase, false)
  const textTransform =
    'textTransform' in r
      ? safeEnum(
          r.textTransform,
          ['none', 'uppercase', 'capitalize', 'lowercase'] as const,
          fallback.textTransform
        )
      : legacyUpper
        ? 'uppercase'
        : fallback.textTransform

  return {
    fontFamily: safeFontFamily(r.fontFamily, fallback.fontFamily),
    fontSizePx: clampNum(r.fontSizePx, 12, 200, fallback.fontSizePx),
    fontWeight: clampNum(r.fontWeight, 100, 900, fallback.fontWeight),
    color: safeColor(r.color, fallback.color),
    colorOpacity: clampNum(r.colorOpacity, 0, 1, fallback.colorOpacity),
    lineHeight: clampNum(r.lineHeight, 0.9, 2.5, fallback.lineHeight),
    letterSpacingPx: clampNum(r.letterSpacingPx, -4, 20, fallback.letterSpacingPx),
    align: safeEnum(r.align, ['left', 'center', 'right', 'justify'] as const, fallback.align),
    verticalAlign: safeEnum(r.verticalAlign, ['top', 'middle', 'bottom'] as const, fallback.verticalAlign),
    textDecoration: safeEnum(
      r.textDecoration,
      ['none', 'underline', 'line-through'] as const,
      fallback.textDecoration
    ),
    textTransform,
    shadow: normalizeShadow(r.shadow ?? legacy?.shadow, fallback.shadow),
    outline: normalizeOutline(r.outline, fallback.outline),
    box: normalizeBox(r.box, boxFallback),
  }
}

// ─── Theme normalizer ──────────────────────────────────────────────────────────

export function normalizeOverlayTheme(raw: unknown): OverlayTheme {
  const r = asObject(raw)
  const d = DEFAULT_OVERLAY_THEME

  const bg = asObject(r.background) as Partial<OverlayTheme['background']>
  const verse = asObject(r.verse)
  const reference = asObject(r.reference)
  const layout = asObject(r.layout) as Partial<OverlayTheme['layout']>

  const position = safeEnum(
    layout.position,
    ['lower-third', 'center', 'top', 'full'] as const,
    d.layout.position
  )
  const maxWidthPct = clampNum(layout.maxWidthPct, 20, 100, d.layout.maxWidthPct)
  const refShow = safeBool(reference.show, d.reference.show)
  const refPosition = safeEnum(reference.position, ['above', 'below'] as const, d.reference.position)
  const presetBoxes = boxesForLayoutPreset(position, refPosition, maxWidthPct, refShow)

  return {
    elements: normalizeOverlayElements(r.elements),
    background: {
      type: safeEnum(
        bg.type,
        ['color', 'gradient', 'transparent', 'image', 'video'] as const,
        d.background.type
      ),
      color: safeColor(bg.color, d.background.color),
      color2: bg.color2 !== undefined ? safeColor(bg.color2, d.background.color) : undefined,
      angleDeg: bg.angleDeg !== undefined ? clampNum(bg.angleDeg, 0, 360, 0) : undefined,
      opacity: clampNum(bg.opacity, 0, 1, d.background.opacity),
      // Path validity (existence, readability) is enforced by the pa-media://
      // allowlist in the main process, not here — this stays a pure module.
      mediaPath:
        typeof bg.mediaPath === 'string' && bg.mediaPath.trim() !== ''
          ? bg.mediaPath.trim()
          : undefined,
      mediaFit: safeEnum(bg.mediaFit, ['cover', 'contain', 'fill'] as const, 'cover'),
      mediaLoop: safeBool(bg.mediaLoop, false),
      hue: clampNum(bg.hue, -180, 180, 0),
      saturation: clampNum(bg.saturation, 0, 2, 1),
      brightness: clampNum(bg.brightness, 0.25, 1.75, 1),
      contrast: clampNum(bg.contrast, 0.25, 1.75, 1),
      blurPx: clampNum(bg.blurPx, 0, 40, 0),
    },
    verse: normalizeTextStyle(verse, d.verse, presetBoxes.verse, { shadow: verse.shadow }),
    reference: {
      ...normalizeTextStyle(reference, d.reference, presetBoxes.reference, {
        uppercase: reference.uppercase,
        shadow: reference.shadow,
      }),
      show: refShow,
      position: refPosition,
    },
    layout: {
      position,
      maxWidthPct,
      paddingPx: clampNum(layout.paddingPx, 0, 200, d.layout.paddingPx),
      backdropBox: safeBool(layout.backdropBox, d.layout.backdropBox),
      backdropColor: safeColor(layout.backdropColor, d.layout.backdropColor),
      // Retired: corners are always square. Kept in the shape so older stores
      // and saved themes still parse; healed to 0 on every read.
      backdropRadiusPx: 0,
      autoFitText: safeBool(layout.autoFitText, d.layout.autoFitText),
    },
  }
}

// ─── Output normalizer + legacy migration (phase 3) ────────────────────────────

interface LegacyOverlayFields {
  mode?: 'auto' | 'ndi' | 'message'
  theme: OverlayTheme
  template: string
}

/** Older stores without explicit outputs retain only their independent NDI route. */
function migrateLegacyOutputs(legacy: LegacyOverlayFields): OverlayOutput[] {
  return [
    makeOverlayOutput('main', 'ndi', {
      name: 'NDI feed',
      enabled: legacy.mode !== 'message',
      theme: legacy.theme,
    }),
    makeProjectorOutput(0),
  ]
}

/**
 * A content-kind override, or null when the output has none. Absent/invalid is
 * null rather than a filled-in default: "no override" has to survive a round
 * trip through the store, otherwise every output would silently grow one.
 */
function normalizeOutputVariant(raw: unknown, fallbackTemplate: string): OverlayOutputVariant | null {
  if (!raw || typeof raw !== 'object') return null
  const r = asObject(raw)
  return {
    themeId: typeof r.themeId === 'string' && r.themeId ? r.themeId : null,
    theme: normalizeOverlayTheme(r.theme),
    template: safeString(r.template, fallbackTemplate),
  }
}

export function normalizeOverlayOutputs(raw: unknown, legacy: LegacyOverlayFields): OverlayOutput[] {
  if (!Array.isArray(raw)) return migrateLegacyOutputs(legacy)

  const seenIds = new Set<string>()
  let ndiEnabled = 0
  let syphonEnabled = 0
  const screenDisplays = new Set<number>()
  const normalized: OverlayOutput[] = []

  for (const item of raw) {
    const r = asObject(item)
    const id = safeString(r.id, '').trim()
    if (!id || seenIds.has(id)) continue
    seenIds.add(id)

    if (!OVERLAY_OUTPUT_KINDS.includes(r.kind as OverlayOutputKind)) continue
    const kind = r.kind as OverlayOutputKind
    const device = kind === 'device'
    let enabled = safeBool(r.enabled, false)
    if (kind === 'ndi' && enabled) {
      if (ndiEnabled >= MAX_NDI_OUTPUTS) enabled = false
      else ndiEnabled++
    }
    if (kind === 'syphon' && enabled) {
      if (syphonEnabled >= MAX_SYPHON_OUTPUTS) enabled = false
      else syphonEnabled++
    }
    const displayId = kind === 'screen' ? normalizeDisplayId(r.displayId) : null
    // Two windows on one display would sit on top of each other — only the
    // first one configured is allowed to be live.
    if (kind === 'screen' && enabled && displayId !== null) {
      if (screenDisplays.has(displayId)) enabled = false
      else screenDisplays.add(displayId)
    }

    normalized.push({
      id,
      name: safeString(r.name, id).trim() || id,
      kind,
      enabled,
      order: clampNum(r.order, 0, 999, normalized.length),
      fallbackOnly: safeBool(r.fallbackOnly, false),
      themeId: typeof r.themeId === 'string' && r.themeId ? r.themeId : null,
      theme: normalizeOverlayTheme(r.theme),
      template: safeString(r.template, legacy.template),
      lyrics: normalizeOutputVariant(r.lyrics, legacy.template),
      displayId,
      displayLabel: kind === 'screen' ? safeString(r.displayLabel, '').trim() : '',
      devicePortId: device ? safeString(r.devicePortId, '').trim() : '',
      devicePortLabel: device ? safeString(r.devicePortLabel, '').trim() : '',
      deviceModeId: device ? safeString(r.deviceModeId, '').trim() : '',
      deviceKeyFill: device && safeBool(r.deviceKeyFill, false),
      displaySize: kind === 'screen' ? normalizeDisplaySize(r.displaySize) : null,
      aspect: kind === 'screen' ? safeEnum(r.aspect, OUTPUT_ASPECT_VALUES, 'letterbox') : 'letterbox',
      customAspect: normalizeCustomAspect(r.customAspect),
      show: normalizeShowFilter(r.show),
      source: isLocalKind(kind) ? safeEnum(r.source, ['program', 'playlist'] as const, 'program') : 'program',
      playlistId: isLocalKind(kind) ? safeString(r.playlistId, '').trim() : '',
      slideSec: Math.round(clampNum(r.slideSec, 3, 600, 8)),
      confidence: normalizeConfidenceLayout(r.confidence),
    })
  }

  // An explicit array is the operator's saved list, including an empty one.
  // Only a missing array above needs legacy migration; otherwise deleted
  // screens would be recreated on the next write or restart.
  // Never an empty Audience: a setup with no outputs gets the Main Screen back.
  return normalized.length > 0 ? normalized : DEFAULT_OVERLAY_OUTPUTS.map((o) => structuredClone(o))
}

function normalizeDisplayId(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isSafeInteger(raw) ? raw : null
}

function normalizeDisplaySize(raw: unknown): OverlayOutput['displaySize'] {
  const r = asObject(raw)
  const width = r.width
  const height = r.height
  if (typeof width !== 'number' || typeof height !== 'number') return null
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

// ─── Overlay settings normalizer (D3) ──────────────────────────────────────────

export function normalizeOverlaySettings(raw: unknown): AppSettings['overlay'] {
  const r = asObject(raw)
  const d = DEFAULT_OVERLAY_SETTINGS

  const template = safeString(r.template, d.template)
  const mode = safeEnum(r.mode, ['auto', 'ndi', 'message'] as const, 'auto')
  const theme = normalizeOverlayTheme(r.theme)

  return {
    template,
    showTranslation: safeBool(r.showTranslation, d.showTranslation),
    showVerseNumbers: safeBool(r.showVerseNumbers, d.showVerseNumbers),
    maxVerses: nonNegNumber(r.maxVerses, d.maxVerses),
    outputs: normalizeOverlayOutputs(r.outputs, { mode, theme, template }),
    theme,
  }
}

/** A custom output ratio: two whole numbers, 1–100 each (e.g. 32 × 9). */
function normalizeCustomAspect(raw: unknown): { width: number; height: number } {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    width: Math.round(clampNum(r.width, 1, 100, 16)),
    height: Math.round(clampNum(r.height, 1, 100, 9)),
  }
}
