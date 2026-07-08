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

import type { AppSettings, OverlayTheme } from './ipc'

// ─── Theme defaults (schema locked — see docs/plans/2026-07-08-ndi-overlay.md) ─

export const DEFAULT_OVERLAY_THEME: OverlayTheme = {
  background: { type: 'transparent', color: '#0b1220', opacity: 1 },
  verse: {
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
    fontSizePx: 54,
    fontWeight: 600,
    color: '#ffffff',
    lineHeight: 1.35,
    align: 'center',
    shadow: true,
  },
  reference: {
    show: true,
    position: 'below',
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
    fontSizePx: 32,
    fontWeight: 700,
    color: '#5eead4',
    uppercase: false,
  },
  layout: {
    position: 'lower-third',
    maxWidthPct: 82,
    paddingPx: 48,
    backdropBox: true,
    backdropColor: 'rgba(3, 10, 20, 0.75)',
    backdropRadiusPx: 16,
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

// ─── Theme normalizer ──────────────────────────────────────────────────────────

export function normalizeOverlayTheme(raw: unknown): OverlayTheme {
  const r = asObject(raw)
  const d = DEFAULT_OVERLAY_THEME

  const bg = asObject(r.background) as Partial<OverlayTheme['background']>
  const verse = asObject(r.verse) as Partial<OverlayTheme['verse']>
  const reference = asObject(r.reference) as Partial<OverlayTheme['reference']>
  const layout = asObject(r.layout) as Partial<OverlayTheme['layout']>

  return {
    background: {
      type: safeEnum(bg.type, ['color', 'gradient', 'transparent'] as const, d.background.type),
      color: safeColor(bg.color, d.background.color),
      color2: bg.color2 !== undefined ? safeColor(bg.color2, d.background.color) : undefined,
      angleDeg: bg.angleDeg !== undefined ? clampNum(bg.angleDeg, 0, 360, 0) : undefined,
      opacity: clampNum(bg.opacity, 0, 1, d.background.opacity),
    },
    verse: {
      fontFamily: safeFontFamily(verse.fontFamily, d.verse.fontFamily),
      fontSizePx: clampNum(verse.fontSizePx, 12, 200, d.verse.fontSizePx),
      fontWeight: clampNum(verse.fontWeight, 100, 900, d.verse.fontWeight),
      color: safeColor(verse.color, d.verse.color),
      lineHeight: clampNum(verse.lineHeight, 0.9, 2.5, d.verse.lineHeight),
      align: safeEnum(verse.align, ['left', 'center', 'right'] as const, d.verse.align),
      shadow: safeBool(verse.shadow, d.verse.shadow),
    },
    reference: {
      show: safeBool(reference.show, d.reference.show),
      position: safeEnum(reference.position, ['above', 'below'] as const, d.reference.position),
      fontFamily: safeFontFamily(reference.fontFamily, d.reference.fontFamily),
      fontSizePx: clampNum(reference.fontSizePx, 12, 200, d.reference.fontSizePx),
      fontWeight: clampNum(reference.fontWeight, 100, 900, d.reference.fontWeight),
      color: safeColor(reference.color, d.reference.color),
      uppercase: safeBool(reference.uppercase, d.reference.uppercase),
    },
    layout: {
      position: safeEnum(
        layout.position,
        ['lower-third', 'center', 'top', 'full'] as const,
        d.layout.position
      ),
      maxWidthPct: clampNum(layout.maxWidthPct, 20, 100, d.layout.maxWidthPct),
      paddingPx: clampNum(layout.paddingPx, 0, 200, d.layout.paddingPx),
      backdropBox: safeBool(layout.backdropBox, d.layout.backdropBox),
      backdropColor: safeColor(layout.backdropColor, d.layout.backdropColor),
      backdropRadiusPx: clampNum(layout.backdropRadiusPx, 0, 64, d.layout.backdropRadiusPx),
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
