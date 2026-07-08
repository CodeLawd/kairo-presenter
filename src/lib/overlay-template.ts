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

// ─── CSS builders ───────────────────────────────────────────────────────────────

function backgroundLayerStyle(theme: OverlayTheme): string {
  const bg = theme.background
  if (bg.type === 'transparent') {
    return 'position:absolute; inset:0; background:transparent;'
  }
  if (bg.type === 'gradient') {
    const angle = bg.angleDeg ?? 0
    const color2 = bg.color2 ?? bg.color
    return `position:absolute; inset:0; opacity:${bg.opacity}; background:linear-gradient(${angle}deg, ${bg.color}, ${color2});`
  }
  return `position:absolute; inset:0; opacity:${bg.opacity}; background:${bg.color};`
}

function layoutPositionStyle(position: OverlayTheme['layout']['position']): string {
  switch (position) {
    case 'top':
      return 'align-items:flex-start; justify-content:center; padding-top:4%;'
    case 'center':
      return 'align-items:center; justify-content:center;'
    case 'full':
      return 'align-items:center; justify-content:center;'
    case 'lower-third':
    default:
      return 'align-items:flex-end; justify-content:center; padding-bottom:6%;'
  }
}

function verseStyle(verse: OverlayTheme['verse']): string {
  return [
    `font-family:${verse.fontFamily};`,
    `font-size:${verse.fontSizePx}px;`,
    `font-weight:${verse.fontWeight};`,
    `color:${verse.color};`,
    `line-height:${verse.lineHeight};`,
    `text-align:${verse.align};`,
    'white-space:normal;',
    verse.shadow ? 'text-shadow:0 2px 10px rgba(0,0,0,0.7), 0 0 2px rgba(0,0,0,0.6);' : '',
  ].join(' ')
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
 * Pure function — same (theme, reference, text) in, same HTML string out.
 */
export function renderOverlayHTML(theme: OverlayTheme, reference: string, text: string): string {
  const safeText = escapeAndBreak(text)
  const safeReference = escapeAndBreak(reference)

  const { verse, reference: ref, layout } = theme

  const referenceBlock = ref.show
    ? `<div class="pa-reference" style="${referenceStyle(ref)}">${safeReference}</div>`
    : ''

  const verseBlock = `<div class="pa-verse" style="${verseStyle(verse)}">${safeText}</div>`

  const contentInner =
    ref.position === 'above'
      ? `${referenceBlock}${verseBlock}`
      : `${verseBlock}${referenceBlock}`

  const boxStyleParts = [
    `max-width:${layout.maxWidthPct}%;`,
    `padding:${layout.paddingPx}px;`,
  ]
  if (layout.backdropBox) {
    boxStyleParts.push(`background:${layout.backdropColor};`)
    boxStyleParts.push(`border-radius:${layout.backdropRadiusPx}px;`)
  }

  return `
    <div class="pa-overlay-root" style="position:absolute; inset:0;">
      <div class="pa-bg" style="${backgroundLayerStyle(theme)}"></div>
      <div class="pa-layer" style="position:absolute; inset:0; display:flex; ${layoutPositionStyle(layout.position)}">
        <div class="pa-content-box" style="${boxStyleParts.join(' ')}">
          ${contentInner}
        </div>
      </div>
    </div>
  `.trim()
}
