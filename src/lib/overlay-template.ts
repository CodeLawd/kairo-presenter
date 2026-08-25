// ─── Shared overlay template — single source of truth for WYSIWYG (D5) ────────
// Pure — no Node/DOM APIs — imported by both the main-process overlay window
// (via executeJavaScript) and the renderer Theme editor preview
// (via dangerouslySetInnerHTML). Same string in, same pixels out.
//
// D5a: `reference` and `text` are untrusted (STT/LLM/Bible DB/manual input) and
// MUST be escaped before interpolation. Theme values are assumed already
// clamped/validated by `normalizeOverlaySettings` (src/lib/overlay-defaults.ts)
// — this module does not re-validate them, only the two free-text strings.

import type {
  OverlayTextOutline,
  OverlayTextShadow,
  OverlayTextStyle,
  OverlayTheme,
} from './ipc'
import { overlayBoxStyle } from './overlay-boxes'

// ─── Escaping ───────────────────────────────────────────────────────────────────

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Escape first, then convert newlines to <br> — never the other order. */
function escapeAndBreak(input: string): string {
  return escapeHtml(input).replace(/\n/g, '<br>')
}

// ─── Media URLs (image/video backgrounds) ───────────────────────────────────────
// Local media files are served through the pa-media:// protocol registered in
// src/main/index.ts, which refuses any path other than the currently-configured
// theme.background.mediaPath. The whole absolute path rides in one
// encodeURIComponent'd segment so slashes never split it.

export const PA_MEDIA_URL_PREFIX = 'pa-media://media/'

export function overlayMediaUrl(absPath: string): string {
  return `${PA_MEDIA_URL_PREFIX}${encodeURIComponent(absPath)}`
}

// ─── Color helpers ──────────────────────────────────────────────────────────────

function hexToRgb(color: string): { r: number; g: number; b: number } | null {
  const hex = color.trim()
  const short = /^#([0-9a-fA-F]{3})$/.exec(hex)
  if (short) {
    const [r, g, b] = short[1].split('')
    return {
      r: parseInt(r + r, 16),
      g: parseInt(g + g, 16),
      b: parseInt(b + b, 16),
    }
  }
  const full = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (full) {
    return {
      r: parseInt(full[1].slice(0, 2), 16),
      g: parseInt(full[1].slice(2, 4), 16),
      b: parseInt(full[1].slice(4, 6), 16),
    }
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(hex)
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) }
  }
  return null
}

export function colorWithOpacity(color: string, opacity: number): string {
  const rgb = hexToRgb(color)
  if (!rgb) return color
  const a = Math.min(1, Math.max(0, opacity))
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`
}

function shadowCss(shadow: OverlayTextShadow): string {
  if (!shadow.enabled) return ''
  const color = colorWithOpacity(shadow.color, shadow.opacity)
  return `text-shadow:${shadow.xPx}px ${shadow.yPx}px ${shadow.blurPx}px ${color};`
}

function outlineCss(outline: OverlayTextOutline): string {
  if (!outline.enabled || outline.widthPx <= 0) return ''
  const color = colorWithOpacity(outline.color, outline.opacity)
  // CSS text-stroke is the portable solid outline; dashed/dotted fall back to solid.
  const width =
    outline.position === 'inside'
      ? Math.max(0.5, outline.widthPx * 0.55)
      : outline.widthPx
  return [
    `-webkit-text-stroke:${width}px ${color};`,
    'paint-order:stroke fill;',
  ].join(' ')
}

// ─── CSS builders ───────────────────────────────────────────────────────────────

function backgroundLayerHTML(theme: OverlayTheme): string {
  const bg = theme.background

  if ((bg.type === 'image' || bg.type === 'video') && bg.mediaPath) {
    const src = escapeHtml(overlayMediaUrl(bg.mediaPath))
    const mediaStyle = `width:100%; height:100%; object-fit:${bg.mediaFit ?? 'cover'}; display:block;`
    const media =
      bg.type === 'video'
        ? `<video src="${src}" style="${mediaStyle}" autoplay loop muted playsinline></video>`
        : `<img src="${src}" style="${mediaStyle}" alt="">`
    return `<div class="pa-bg" style="position:absolute; inset:0; opacity:${bg.opacity}; overflow:hidden;">${media}</div>`
  }

  let style: string
  if (bg.type === 'color') {
    style = `position:absolute; inset:0; opacity:${bg.opacity}; background:${bg.color};`
  } else if (bg.type === 'gradient') {
    const angle = bg.angleDeg ?? 0
    const color2 = bg.color2 ?? bg.color
    style = `position:absolute; inset:0; opacity:${bg.opacity}; background:linear-gradient(${angle}deg, ${bg.color}, ${color2});`
  } else {
    // 'transparent', and image/video with no file picked yet.
    style = 'position:absolute; inset:0; background:transparent;'
  }
  return `<div class="pa-bg" style="${style}"></div>`
}

function textStyleCss(style: OverlayTextStyle, fontSizePx: number): string {
  const decoration = style.textDecoration === 'none' ? 'none' : style.textDecoration
  const transform = style.textTransform === 'none' ? 'none' : style.textTransform
  return [
    `font-family:${style.fontFamily};`,
    `font-size:${fontSizePx}px;`,
    `font-weight:${style.fontWeight};`,
    `color:${colorWithOpacity(style.color, style.colorOpacity)};`,
    `line-height:${style.lineHeight};`,
    `letter-spacing:${style.letterSpacingPx}px;`,
    `text-align:${style.align};`,
    `text-decoration:${decoration};`,
    `text-transform:${transform};`,
    'white-space:normal;',
    shadowCss(style.shadow),
    outlineCss(style.outline),
  ].join(' ')
}

// ─── Auto-fit (verse box) ───────────────────────────────────────────────────────
// Pure estimate — no DOM measurement is possible here. Character width is
// approximated as a fraction of the font size; the factor is conservative so
// the real render errs toward fitting. DOM fit in overlay.html / ThemeEditor
// then snaps to the true size.

const AVG_CHAR_WIDTH_FACTOR = 0.55
const MIN_AUTO_FIT_PX = 12
const MAX_AUTO_FIT_PX = 200

/**
 * Largest verse font size (px) whose estimated wrapped height fits the verse
 * box. Used when `layout.autoFitText` is on, for any layout position.
 * Capped by `verse.fontSizePx` so the Size slider remains a maximum.
 */
export function estimateAutoFitVerseFontPx(
  text: string,
  theme: OverlayTheme,
  frameWidth = 1920,
  frameHeight = 1080
): number {
  const { verse, layout } = theme
  const box = verse.box
  const usableW = Math.max(80, (frameWidth * box.widthPct) / 100 - layout.paddingPx * 2)
  const usableH = Math.max(48, (frameHeight * box.heightPct) / 100 - layout.paddingPx * 2)

  const paragraphs = text
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
  if (paragraphs.length === 0) return verse.fontSizePx

  const longestWord = paragraphs
    .join(' ')
    .split(/\s+/)
    .reduce((max, w) => Math.max(max, w.length), 1)

  const fits = (sizePx: number): boolean => {
    const charW = sizePx * AVG_CHAR_WIDTH_FACTOR + Math.abs(verse.letterSpacingPx) * 0.35
    if (longestWord * charW > usableW) return false
    const charsPerLine = Math.max(1, Math.floor(usableW / charW))
    let lines = 0
    for (const p of paragraphs) {
      lines += Math.max(1, Math.ceil(p.length / charsPerLine))
    }
    return lines * sizePx * verse.lineHeight <= usableH
  }

  const loFloor = MIN_AUTO_FIT_PX
  const hiCap = Math.min(MAX_AUTO_FIT_PX, verse.fontSizePx)
  let lo = loFloor
  let hi = hiCap
  if (!fits(lo)) return lo
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)
    if (fits(mid)) lo = mid
    else hi = mid - 1
  }
  return lo
}

// ─── Renderer ───────────────────────────────────────────────────────────────────

/**
 * Renders the inner markup + inline styles for a scripture overlay slide.
 * Pure function — same (theme, reference, text, frame) in, same HTML string out.
 * `frameWidth`/`frameHeight` matter only to the auto-fit estimate; both real
 * consumers (NDI overlay window and Theme editor preview) render at 1920×1080.
 */
function textBoxChrome(theme: OverlayTheme, style: OverlayTextStyle, edgeToEdge: boolean): string {
  const { layout } = theme
  const justify =
    style.verticalAlign === 'top'
      ? 'flex-start'
      : style.verticalAlign === 'bottom'
        ? 'flex-end'
        : 'center'
  const radius = edgeToEdge ? 0 : layout.backdropRadiusPx
  const parts = [
    `padding:${layout.paddingPx}px;`,
    'display:flex;',
    'flex-direction:column;',
    'align-items:stretch;',
    `justify-content:${justify};`,
  ]
  if (layout.backdropBox) {
    parts.push(`background:${layout.backdropColor};`)
    parts.push(`border-radius:${radius}px;`)
  }
  return parts.join(' ')
}

function isEdgeToEdgeBox(box: OverlayTheme['verse']['box']): boolean {
  return box.xPct <= 0.5 && box.yPct <= 0.5 && box.widthPct >= 99 && box.heightPct >= 99
}

export function renderOverlayHTML(
  theme: OverlayTheme,
  reference: string,
  text: string,
  frameWidth = 1920,
  frameHeight = 1080
): string {
  const safeText = escapeAndBreak(text)
  const safeReference = escapeAndBreak(reference)

  const { verse, reference: ref, layout } = theme

  const verseFontPx = layout.autoFitText
    ? estimateAutoFitVerseFontPx(text, theme, frameWidth, frameHeight)
    : verse.fontSizePx

  const verseBox = verse.box
  const refBox = ref.box
  const verseChrome = textBoxChrome(theme, verse, isEdgeToEdgeBox(verseBox))
  const refChrome = textBoxChrome(theme, ref, isEdgeToEdgeBox(refBox))

  const verseBlock = `<div class="pa-verse-box" data-auto-fit="${layout.autoFitText ? 'true' : 'false'}" data-max-font-px="${verse.fontSizePx}" style="${overlayBoxStyle(verseBox)} ${verseChrome}">
      <div class="pa-verse" style="${textStyleCss(verse, verseFontPx)} width:100%;">${safeText}</div>
    </div>`

  const referenceBlock = ref.show
    ? `<div class="pa-reference-box" style="${overlayBoxStyle(refBox)} ${refChrome}">
      <div class="pa-reference" style="${textStyleCss(ref, ref.fontSizePx)} width:100%;">${safeReference}</div>
    </div>`
    : ''

  return `
    <div class="pa-overlay-root" style="position:absolute; inset:0;">
      ${backgroundLayerHTML(theme)}
      <div class="pa-layer" style="position:absolute; inset:0;">
        ${verseBlock}
        ${referenceBlock}
      </div>
    </div>
  `.trim()
}
