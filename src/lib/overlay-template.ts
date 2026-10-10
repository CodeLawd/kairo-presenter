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
  OverlayElement,
  OverlayTextOutline,
  OverlayTextShadow,
  OverlayTextStyle,
  OverlayTheme,
} from './ipc'
import { overlayBoxStyle } from './overlay-boxes'
import { overlayShape } from './overlay-shapes'
import { mediaFilterCss, normalizeMediaPlayback } from './media-playback'

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
export function escapeAndBreak(input: string): string {
  return escapeHtml(input).replace(/\n/g, '<br>')
}

export interface OverlayColoredLine {
  text: string
  color?: string
}

/** Only hex colors reach the overlay — lyric gloss / paint values are operator-set. */
export function sanitizeOverlayColor(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const t = raw.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t.toUpperCase()
  if (/^#[0-9a-fA-F]{3}$/.test(t)) {
    const [, a, b, c] = t
    return `#${a}${a}${b}${b}${c}${c}`.toUpperCase()
  }
  return undefined
}

/** Escaped lyric body with per-line color spans. Unsafe color values are dropped. */
export function formatOverlayColoredText(lines: OverlayColoredLine[]): string {
  return lines
    .map(({ text, color }) => {
      const safe = escapeHtml(text)
      const hex = sanitizeOverlayColor(color)
      return hex ? `<span style="color:${hex}">${safe}</span>` : safe
    })
    .join('<br>')
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
    const playback = normalizeMediaPlayback({
      loop: bg.mediaLoop,
      hue: bg.hue,
      saturation: bg.saturation,
      brightness: bg.brightness,
      contrast: bg.contrast,
    })
    const filter = mediaFilterCss(playback)
    const blurPx = bg.blurPx ?? 0
    // A blur fades the frame's edges in; scaling the media past them keeps the edges solid.
    const blurStyle = blurPx > 0 ? ` filter:blur(${blurPx}px); transform:scale(${1 + (blurPx * 4) / 1080});` : ''
    const mediaStyle = `width:100%; height:100%; object-fit:${bg.mediaFit ?? 'cover'}; display:block;${blurStyle}`
    const media =
      bg.type === 'video'
        ? `<video src="${src}" style="${mediaStyle}" autoplay${playback.loop ? ' loop' : ''} muted playsinline preload="auto" crossorigin="anonymous"></video>`
        : `<img src="${src}" style="${mediaStyle}" alt="">`
    const filterStyle = filter ? ` filter:${filter};` : ''
    return `<div class="pa-bg" style="position:absolute; inset:0; opacity:${bg.opacity}; overflow:hidden;${filterStyle}">${media}</div>`
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

// ─── Elements ───────────────────────────────────────────────────────────────────

function elementHTML(el: OverlayElement): string {
  const turn = el.rotationDeg ? ` transform:rotate(${el.rotationDeg}deg);` : ''
  const frame = `${overlayBoxStyle(el.box)} opacity:${el.opacity};${turn}`
  if (el.kind === 'image' || el.kind === 'video') {
    if (!el.mediaPath) return ''
    const src = escapeHtml(overlayMediaUrl(el.mediaPath))
    const filter = [
      mediaFilterCss(normalizeMediaPlayback(el)),
      el.blurPx > 0 ? `blur(${el.blurPx}px)` : '',
    ]
      .filter(Boolean)
      .join(' ')
    const style = `width:100%; height:100%; object-fit:${el.mediaFit}; display:block;${filter ? ` filter:${filter};` : ''}`
    const media =
      el.kind === 'video'
        ? `<video src="${src}" style="${style}" autoplay${el.mediaLoop ? ' loop' : ''} muted playsinline preload="auto"></video>`
        : `<img src="${src}" style="${style}" alt="">`
    return `<div class="pa-element" style="${frame}">${media}</div>`
  }
  if (el.kind === 'shape') {
    const def = overlayShape(el.shape)
    if (!def) return ''
    const fill = def.lineOnly ? 'none' : colorWithOpacity(el.fill, el.fillOpacity)
    const stroke =
      el.stroke.enabled && el.stroke.widthPx > 0
        ? ` stroke="${colorWithOpacity(el.stroke.color, el.stroke.opacity)}" stroke-width="${el.stroke.widthPx}" stroke-linejoin="round" stroke-linecap="round"`
        : ''
    // Stretched to the box like an Office shape; the stroke keeps its width
    // however far it stretches, and may spill past the box edge.
    return `<div class="pa-element" style="${frame} overflow:visible;"><svg viewBox="0 0 100 100" preserveAspectRatio="none" style="display:block; width:100%; height:100%; overflow:visible;"><path d="${def.path}" fill="${fill}" fill-rule="evenodd"${stroke} vector-effect="non-scaling-stroke"/></svg></div>`
  }
  const radius = el.kind === 'ellipse' ? '50%' : `${el.radiusPx}px`
  // Inside the box, so the border never changes the shape's footprint.
  const stroke =
    el.stroke.enabled && el.stroke.widthPx > 0
      ? ` box-shadow:inset 0 0 0 ${el.stroke.widthPx}px ${colorWithOpacity(el.stroke.color, el.stroke.opacity)};`
      : ''
  return `<div class="pa-element" style="${frame} background:${colorWithOpacity(el.fill, el.fillOpacity)}; border-radius:${radius};${stroke}"></div>`
}

/**
 * One group of elements — under the text or over it — as its own layer, so the
 * output window can keep it across slides (see overlay.html `setElements`).
 * Empty when the group has nothing to draw.
 */
function elementsLayerHTML(theme: OverlayTheme, aboveText: boolean): string {
  const markup = theme.elements
    .filter((el) => el.aboveText === aboveText)
    .map(elementHTML)
    .join('')
  if (!markup) return ''
  const cls = aboveText ? 'pa-elements-above' : 'pa-elements-below'
  return `<div class="${cls}" style="position:absolute;inset:0;overflow:hidden;pointer-events:none;">${markup}</div>`
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
    'overflow-wrap:break-word;',
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
export const MIN_AUTO_FIT_PX = 12
/** Safety ceiling — smart fill caps well below this. */
export const MAX_AUTO_FIT_PX = 240

/**
 * Typical projected verse. Short lines ("Jesus wept.") grow only up to the
 * size this would use in the same box, so they stay a verse — not a billboard.
 */
export const SMART_FILL_REFERENCE =
  'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.'

function estimateBoxFillFontPx(
  text: string,
  theme: OverlayTheme,
  frameWidth: number,
  frameHeight: number
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

  let lo = MIN_AUTO_FIT_PX
  let hi = MAX_AUTO_FIT_PX
  if (!fits(lo)) return lo
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)
    if (fits(mid)) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Font size for Fit to box: shrinks until the text fits, but never larger
 * than a typical verse in this box (smart fill).
 */
export function estimateAutoFitVerseFontPx(
  text: string,
  theme: OverlayTheme,
  frameWidth = 1920,
  frameHeight = 1080
): number {
  const forThis = estimateBoxFillFontPx(text, theme, frameWidth, frameHeight)
  const typical = estimateBoxFillFontPx(SMART_FILL_REFERENCE, theme, frameWidth, frameHeight)
  return Math.min(forThis, typical)
}

// ─── Renderer ───────────────────────────────────────────────────────────────────

/**
 * Renders the inner markup + inline styles for a scripture overlay slide.
 * Pure function — same (theme, reference, text, frame) in, same HTML string out.
 * `frameWidth`/`frameHeight` matter only to the auto-fit estimate; both real
 * consumers (NDI overlay window and Theme editor preview) render at 1920×1080.
 */
function textBoxChrome(theme: OverlayTheme, style: OverlayTextStyle): string {
  const { layout } = theme
  const justify =
    style.verticalAlign === 'top'
      ? 'flex-start'
      : style.verticalAlign === 'bottom'
        ? 'flex-end'
        : 'center'
  const parts = [
    `padding:${layout.paddingPx}px;`,
    'display:flex;',
    'flex-direction:column;',
    'align-items:stretch;',
    `justify-content:${justify};`,
    // Flex items default to min-height:auto (content size). Without this, a
    // huge estimated font grows the box and DOM auto-fit never shrinks.
    'min-height:0;',
    'min-width:0;',
  ]
  if (layout.backdropBox) {
    // Square corners always — the program has no rounded chrome.
    parts.push(`background:${layout.backdropColor};`)
  }
  return parts.join(' ')
}

function verseFillCss(style: OverlayTextStyle, autoFit: boolean): string {
  const wrap = 'overflow-wrap:break-word;'
  if (!autoFit) return `width:100%;${wrap}`
  const justify =
    style.verticalAlign === 'top'
      ? 'flex-start'
      : style.verticalAlign === 'bottom'
        ? 'flex-end'
        : 'center'
  return [
    'width:100%;',
    'height:100%;',
    'max-height:100%;',
    'max-width:100%;',
    'min-height:0;',
    'min-width:0;',
    'overflow:hidden;',
    'box-sizing:border-box;',
    'display:flex;',
    'flex-direction:column;',
    `justify-content:${justify};`,
    wrap,
  ].join(' ')
}

export function renderOverlayHTML(
  theme: OverlayTheme,
  reference: string,
  text: string,
  frameWidth = 1920,
  frameHeight = 1080,
  options?: { coloredLines?: OverlayColoredLine[] }
): string {
  const safeText = options?.coloredLines?.length
    ? formatOverlayColoredText(options.coloredLines)
    : escapeAndBreak(text)
  const safeReference = escapeAndBreak(reference)

  const { verse, reference: ref, layout } = theme

  const verseFontPx = layout.autoFitText
    ? estimateAutoFitVerseFontPx(text, theme, frameWidth, frameHeight)
    : verse.fontSizePx

  const verseBox = verse.box
  const refBox = ref.box
  const verseChrome = textBoxChrome(theme, verse)
  const refChrome = textBoxChrome(theme, ref)

  const verseBlock = text.trim()
    ? `<div class="pa-verse-box" data-auto-fit="${layout.autoFitText ? 'true' : 'false'}" data-max-font-px="${verseFontPx}" style="${overlayBoxStyle(verseBox)} ${verseChrome}">
      <div class="pa-verse" style="${textStyleCss(verse, verseFontPx)} ${verseFillCss(verse, layout.autoFitText)}"><div class="pa-verse-text" style="width:100%;max-width:100%;overflow-wrap:break-word;">${safeText}</div></div>
    </div>`
    : ''

  const referenceBlock = ref.show && reference.trim()
    ? `<div class="pa-reference-box" style="${overlayBoxStyle(refBox)} ${refChrome}">
      <div class="pa-reference" style="${textStyleCss(ref, ref.fontSizePx)} width:100%;">${safeReference}</div>
    </div>`
    : ''

  return `
    <div class="pa-overlay-root" style="position:absolute;inset:0;overflow:hidden;box-sizing:border-box;">
      ${backgroundLayerHTML(theme)}
      ${elementsLayerHTML(theme, false)}
      <div class="pa-layer" style="position:absolute;inset:0;overflow:hidden;">
        ${verseBlock}
        ${referenceBlock}
      </div>
      ${elementsLayerHTML(theme, true)}
    </div>
  `.trim()
}
