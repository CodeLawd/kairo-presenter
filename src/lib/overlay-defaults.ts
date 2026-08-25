// ─── Overlay defaults + settings normalizer (D3 / D5a) ─────────────────────────
// Pure — no Node/DOM APIs — importable from main, preload, and renderer alike.
//
// electron-store (v8) does NOT deep-merge stored values with `defaults`; it
// shallow-`Object.assign`s at the top level only. That means a phase-1 user's
// stored `overlay` object (no `mode`/`theme`/`ppVideoInputUuid`) wholesale
// replaces the phase-2 default and `store.get('overlay').mode` comes back
// `undefined`. `normalizeOverlaySettings` is the single place that heals any
// shape (missing keys, wrong types, out-of-range numbers, malformed colors)
// back to something safe to render and persist. Every consumer — the one-time
// migration in `src/main/db/index.ts`, orchestrator, IPC handlers, and the
// renderer Settings/Theme pages on hydration — must route stored `overlay`
// through this before using it.

import type {
  AppSettings,
  OverlayBox,
  OverlayTextOutline,
  OverlayTextShadow,
  OverlayTextStyle,
  OverlayTheme,
} from './ipc'
import { boxesForLayoutPreset, clampOverlayBox } from './overlay-boxes'

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
    backdropBox: true,
    backdropColor: 'rgba(3, 10, 20, 0.75)',
    backdropRadiusPx: 16,
    autoFitText: false,
  },
}

export const DEFAULT_OVERLAY_SETTINGS: AppSettings['overlay'] = {
  // — phase 1 —
  template: '{Reference}\n{Text}',
  showTranslation: true,
  showVerseNumbers: true,
  maxVerses: 0,
  autoClearSec: 0,
  // — phase 2 —
  mode: 'auto',
  ppVideoInputUuid: '',
  theme: DEFAULT_OVERLAY_THEME,
}

// ─── Validation primitives (D5a) ───────────────────────────────────────────────

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^rgba?\([\d.,\s%]+\)$/

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asObject(v: unknown): Record<string, unknown> {
  return isPlainObject(v) ? v : {}
}

function safeString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function safeBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function safeNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = safeNumber(v, fallback)
  return Math.min(max, Math.max(min, n))
}

function nonNegNumber(v: unknown, fallback: number): number {
  const n = safeNumber(v, fallback)
  return n < 0 ? fallback : n
}

function safeColor(v: unknown, fallback: string): string {
  return typeof v === 'string' && COLOR_RE.test(v.trim()) ? v.trim() : fallback
}

/** Strips characters that could break out of a quoted CSS font-family string. */
function safeFontFamily(v: unknown, fallback: string): string {
  const s = safeString(v, fallback).replace(/["\\;{}]/g, '').trim()
  return s || fallback
}

function safeEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
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
      backdropRadiusPx: clampNum(layout.backdropRadiusPx, 0, 64, d.layout.backdropRadiusPx),
      autoFitText: safeBool(layout.autoFitText, d.layout.autoFitText),
    },
  }
}

// ─── Overlay settings normalizer (D3) ──────────────────────────────────────────

export function normalizeOverlaySettings(raw: unknown): AppSettings['overlay'] {
  const r = asObject(raw) as Partial<AppSettings['overlay']>
  const d = DEFAULT_OVERLAY_SETTINGS

  return {
    template: safeString(r.template, d.template),
    showTranslation: safeBool(r.showTranslation, d.showTranslation),
    showVerseNumbers: safeBool(r.showVerseNumbers, d.showVerseNumbers),
    maxVerses: nonNegNumber(r.maxVerses, d.maxVerses),
    autoClearSec: nonNegNumber(r.autoClearSec, d.autoClearSec),
    mode: safeEnum(r.mode, ['auto', 'ndi', 'message'] as const, d.mode),
    ppVideoInputUuid: safeString(r.ppVideoInputUuid, d.ppVideoInputUuid),
    theme: normalizeOverlayTheme(r.theme),
  }
}
