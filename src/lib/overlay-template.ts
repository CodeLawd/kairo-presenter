// ─── Shared overlay template — single source of truth for WYSIWYG (D5) ────────
// Pure — no Node/DOM APIs — imported by both the main-process overlay window
// (via executeJavaScript) and the renderer Theme editor preview
// (via dangerouslySetInnerHTML). Same string in, same pixels out.
//
// D5a: `reference` and `text` are untrusted (STT/LLM/Bible DB/manual input) and
// MUST be escaped before interpolation. Theme values are assumed already
// clamped/validated by `normalizeOverlaySettings` (src/lib/overlay-defaults.ts)
// — this module does not re-validate them, only the two free-text strings.

import type { OverlayTheme } from './ipc'

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

function layoutPositionStyle(position: OverlayTheme['layout']['position']): string {
  switch (position) {
    case 'top':
      return 'align-items:flex-start; justify-content:center; padding-top:4%;'
    case 'center':
      return 'align-items:center; justify-content:center;'
    case 'full':
      // Full-bleed: the content box IS the frame; it stretches edge to edge.
      return 'align-items:stretch; justify-content:stretch;'
    case 'lower-third':
    default:
      return 'align-items:flex-end; justify-content:center; padding-bottom:6%;'
  }
}

function verseStyle(verse: OverlayTheme['verse'], fontSizePx: number): string {
  return [
    `font-family:${verse.fontFamily};`,
    `font-size:${fontSizePx}px;`,
    `font-weight:${verse.fontWeight};`,
    `color:${verse.color};`,
    `line-height:${verse.lineHeight};`,
    `text-align:${verse.align};`,
    'white-space:normal;',
    verse.shadow ? 'text-shadow:0 2px 10px rgba(0,0,0,0.7), 0 0 2px rgba(0,0,0,0.6);' : '',
  ].join(' ')
}

// ─── Auto-fit (full-bleed) ──────────────────────────────────────────────────────
// Pure estimate — no DOM measurement is possible here (this module renders to a
// string consumed by two different renderers). Character width is approximated
// as a fraction of the font size; the factor is deliberately conservative so the
// real render errs toward fitting. Because BOTH the preview and the NDI window
// render from the same computed px, WYSIWYG still holds exactly.

const AVG_CHAR_WIDTH_FACTOR = 0.55
const MIN_AUTO_FIT_PX = 24
const MAX_AUTO_FIT_PX = 200
/** Vertical slack for the reference row (line-height + gap) when it shares the frame. */
const REFERENCE_ROW_FACTOR = 1.6
const REFERENCE_ROW_GAP_PX = 24

/**
 * Largest verse font size (px) whose estimated wrapped height fits the frame,
 * accounting for padding and the reference row. Used when
 * `layout.position === 'full' && layout.autoFitText`.
 */
export function estimateAutoFitVerseFontPx(
  text: string,
  theme: OverlayTheme,
  frameWidth = 1920,
  frameHeight = 1080
): number {
  const { verse, reference, layout } = theme
  const usableW = Math.max(120, frameWidth - layout.paddingPx * 2)
  const referenceH = reference.show
    ? reference.fontSizePx * REFERENCE_ROW_FACTOR + REFERENCE_ROW_GAP_PX
    : 0
  const usableH = Math.max(80, frameHeight - layout.paddingPx * 2 - referenceH)

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
    const charW = sizePx * AVG_CHAR_WIDTH_FACTOR
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

function referenceStyle(reference: OverlayTheme['reference']): string {
  return [
    `font-family:${reference.fontFamily};`,
    `font-size:${reference.fontSizePx}px;`,
    `font-weight:${reference.fontWeight};`,
    `color:${reference.color};`,
    reference.uppercase ? 'text-transform:uppercase;' : '',
    'letter-spacing:0.02em;',
  ].join(' ')
}

// ─── Renderer ───────────────────────────────────────────────────────────────────

/**
 * Renders the inner markup + inline styles for a scripture overlay slide.
 * Pure function — same (theme, reference, text, frame) in, same HTML string out.
 * `frameWidth`/`frameHeight` matter only to the auto-fit estimate; both real
 * consumers (NDI overlay window and Theme editor preview) render at 1920×1080.
 */
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
  const isFull = layout.position === 'full'

  const verseFontPx =
    isFull && layout.autoFitText
      ? estimateAutoFitVerseFontPx(text, theme, frameWidth, frameHeight)
      : verse.fontSizePx

  const referenceBlock = ref.show
    ? `<div class="pa-reference" style="${referenceStyle(ref)}">${safeReference}</div>`
    : ''

  const verseBlock = `<div class="pa-verse" style="${verseStyle(verse, verseFontPx)}">${safeText}</div>`

  const contentInner =
    ref.position === 'above'
      ? `${referenceBlock}${verseBlock}`
      : `${verseBlock}${referenceBlock}`

  const boxStyleParts = isFull
    ? [
        // True full-bleed: box fills the frame; children stretch so text-align
        // governs horizontal placement; the column centers vertically.
        'flex:1;',
        'max-width:100%;',
        `padding:${layout.paddingPx}px;`,
        'display:flex;',
        'flex-direction:column;',
        'align-items:stretch;',
        'justify-content:center;',
        `gap:${REFERENCE_ROW_GAP_PX}px;`,
        'overflow:hidden;',
      ]
    : [`max-width:${layout.maxWidthPct}%;`, `padding:${layout.paddingPx}px;`]
  if (layout.backdropBox) {
    boxStyleParts.push(`background:${layout.backdropColor};`)
    // An edge-to-edge box with rounded corners leaks the background at the
    // corners — full-bleed always renders square.
    boxStyleParts.push(`border-radius:${isFull ? 0 : layout.backdropRadiusPx}px;`)
  }

  return `
    <div class="pa-overlay-root" style="position:absolute; inset:0;">
      ${backgroundLayerHTML(theme)}
      <div class="pa-layer" style="position:absolute; inset:0; display:flex; ${layoutPositionStyle(layout.position)}">
        <div class="pa-content-box" style="${boxStyleParts.join(' ')}">
          ${contentInner}
        </div>
      </div>
    </div>
  `.trim()
}
