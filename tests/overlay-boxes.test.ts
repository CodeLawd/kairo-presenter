import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyLayoutPreset,
  boxesForLayoutPreset,
  clampOverlayBox,
  moveOverlayBox,
  placeReferenceAgainstVerse,
  resizeOverlayBox,
} from '../src/lib/overlay-boxes'
import { DEFAULT_OVERLAY_THEME, normalizeOverlayTheme } from '../src/lib/overlay-defaults'
import {
  estimateAutoFitVerseFontPx,
  formatOverlayColoredText,
  renderOverlayHTML,
  sanitizeOverlayColor,
  SMART_FILL_REFERENCE,
} from '../src/lib/overlay-template'
import { largestFontThatFits, overlayTextOverflows, playOverlayVideos, seekOverlayVideos, setOverlayVideosPaused } from '../src/lib/overlay-fit'

test('clamps overlay boxes onto the canvas', () => {
  const boxed = clampOverlayBox({ xPct: -10, yPct: 90, widthPct: 40, heightPct: 40 })
  assert.equal(boxed.xPct, 0)
  assert.ok(boxed.yPct + boxed.heightPct <= 100)
  assert.ok(boxed.widthPct >= 8)
})

test('moves and resizes without leaving the frame', () => {
  const start = { xPct: 10, yPct: 10, widthPct: 40, heightPct: 20 }
  const moved = moveOverlayBox(start, 80, 80)
  assert.equal(moved.xPct + moved.widthPct, 100)
  assert.equal(moved.yPct + moved.heightPct, 100)

  const resized = resizeOverlayBox(start, 'se', 100, 100)
  assert.equal(resized.xPct, 10)
  assert.equal(resized.widthPct, 90)
  assert.equal(resized.heightPct, 90)
})

test('layout presets stack verse and reference inside the frame', () => {
  const lower = boxesForLayoutPreset('lower-third', 'below', 82, true)
  assert.ok(lower.verse.yPct > 50)
  assert.ok(lower.reference.yPct > lower.verse.yPct)
  assert.equal(lower.verse.widthPct, 82)

  const full = boxesForLayoutPreset('full', 'below', 82, true)
  assert.equal(full.verse.xPct, 0)
  assert.equal(full.verse.widthPct, 100)
})

test('snaps the reference box above or below the verse', () => {
  const verse = { xPct: 10, yPct: 40, widthPct: 80, heightPct: 20 }
  const reference = { xPct: 0, yPct: 0, widthPct: 50, heightPct: 10 }
  const below = placeReferenceAgainstVerse(verse, reference, 'below')
  assert.equal(below.xPct, 10)
  assert.equal(below.widthPct, 80)
  assert.ok(below.yPct >= verse.yPct + verse.heightPct)
})

test('migrates themes that predate canvas boxes', () => {
  const { box: _verseBox, ...verse } = DEFAULT_OVERLAY_THEME.verse
  const { box: _refBox, ...reference } = DEFAULT_OVERLAY_THEME.reference
  const normalized = normalizeOverlayTheme({
    ...DEFAULT_OVERLAY_THEME,
    verse,
    reference,
    layout: { ...DEFAULT_OVERLAY_THEME.layout, position: 'center' },
  })
  assert.ok(normalized.verse.box.widthPct > 0)
  assert.ok(normalized.reference.box.heightPct > 0)
  assert.equal(normalized.layout.position, 'center')
})

test('migrates legacy boolean shadow and uppercase reference', () => {
  const { textTransform: _t, shadow: _s, ...legacyReference } = DEFAULT_OVERLAY_THEME.reference
  const { shadow: _vs, ...legacyVerse } = DEFAULT_OVERLAY_THEME.verse
  const normalized = normalizeOverlayTheme({
    ...DEFAULT_OVERLAY_THEME,
    verse: { ...legacyVerse, shadow: true },
    reference: { ...legacyReference, uppercase: true, shadow: false },
  })
  assert.equal(normalized.verse.shadow.enabled, true)
  assert.equal(normalized.reference.shadow.enabled, false)
  assert.equal(normalized.reference.textTransform, 'uppercase')
  assert.equal(normalized.verse.verticalAlign, 'middle')
})

test('auto-fit uses the verse box, not only fullscreen', () => {
  const shortTheme = applyLayoutPreset(
    {
      ...DEFAULT_OVERLAY_THEME,
      verse: {
        ...DEFAULT_OVERLAY_THEME.verse,
        fontSizePx: 120,
        box: { xPct: 10, yPct: 10, widthPct: 80, heightPct: 20 },
      },
      layout: { ...DEFAULT_OVERLAY_THEME.layout, autoFitText: true, paddingPx: 8 },
    },
    'lower-third'
  )
  shortTheme.verse.box = { xPct: 10, yPct: 10, widthPct: 80, heightPct: 16 }
  shortTheme.layout.autoFitText = true

  const short = 'Jesus wept.'
  const long =
    'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life. For God sent not his Son into the world to condemn the world; but that the world through him might be saved.'

  const shortPx = estimateAutoFitVerseFontPx(short, shortTheme)
  const longPx = estimateAutoFitVerseFontPx(long, shortTheme)
  assert.ok(longPx < shortPx)
})

test('smart fill keeps a short verse at typical size instead of filling the screen', () => {
  const theme: typeof DEFAULT_OVERLAY_THEME = {
    ...DEFAULT_OVERLAY_THEME,
    verse: {
      ...DEFAULT_OVERLAY_THEME.verse,
      fontSizePx: 54,
      box: { xPct: 5, yPct: 15, widthPct: 90, heightPct: 70 },
    },
    layout: { ...DEFAULT_OVERLAY_THEME.layout, autoFitText: true, paddingPx: 24 },
  }
  const wept = estimateAutoFitVerseFontPx('Jesus wept.', theme)
  const typical = estimateAutoFitVerseFontPx(SMART_FILL_REFERENCE, theme)
  assert.equal(wept, typical)
  assert.ok(wept < 180)
})

test('overlay HTML places verse and reference in independent boxes', () => {
  const html = renderOverlayHTML(DEFAULT_OVERLAY_THEME, 'John 3:16', 'For God so loved the world.')
  assert.match(html, /pa-verse-box/)
  assert.match(html, /pa-reference-box/)
  assert.match(html, /left:\d/)
  assert.doesNotMatch(html, /pa-content-box/)
})

test('overlay HTML constrains auto-fit verse so the text cannot grow the box', () => {
  const theme = {
    ...DEFAULT_OVERLAY_THEME,
    layout: { ...DEFAULT_OVERLAY_THEME.layout, autoFitText: true },
  }
  const html = renderOverlayHTML(theme, 'John 3:16', 'For God so loved the world.')
  assert.match(html, /class="pa-verse"[^>]*min-height:0/)
  assert.match(html, /class="pa-verse"[^>]*overflow:hidden/)
  assert.match(html, /class="pa-verse"[^>]*max-height:100%/)
  assert.match(html, /overflow-wrap:break-word/)
})

test('playOverlayVideos starts muted videos after innerHTML insert', () => {
  const played: string[] = []
  const ready = {
    muted: false,
    playsInline: false,
    readyState: 2,
    play: async () => {
      played.push('ready')
    },
    pause: () => undefined,
    addEventListener: () => undefined,
  }
  const pending = {
    muted: false,
    playsInline: false,
    readyState: 0,
    play: async () => {
      played.push('pending')
    },
    pause: () => undefined,
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'canplay') listener()
    },
  }
  playOverlayVideos({ querySelectorAll: () => [ready, pending] })
  assert.equal(ready.muted, true)
  assert.equal(ready.playsInline, true)
  assert.deepEqual(played, ['ready', 'pending'])
})

test('playOverlayVideos leaves videos paused when asked', () => {
  const played: string[] = []
  const paused: string[] = []
  const video = {
    muted: false,
    playsInline: false,
    readyState: 2,
    dataset: { paPaused: '' },
    play: async () => {
      played.push('play')
    },
    pause: () => {
      paused.push('pause')
    },
    addEventListener: () => undefined,
  }
  playOverlayVideos({ querySelectorAll: () => [video] }, true)
  assert.deepEqual(played, [])
  assert.deepEqual(paused, ['pause'])
  assert.equal(video.dataset.paPaused, '1')
})

test('setOverlayVideosPaused resumes from the start after the clip ends', () => {
  const actions: string[] = []
  const video = {
    muted: true,
    playsInline: true,
    readyState: 4,
    ended: true,
    currentTime: 12,
    dataset: { paPaused: '1' },
    play: async () => {
      actions.push('play')
    },
    pause: () => {
      actions.push('pause')
    },
    addEventListener: () => undefined,
  }
  setOverlayVideosPaused({ querySelectorAll: () => [video] }, false)
  assert.equal(video.currentTime, 0)
  assert.deepEqual(actions, ['play'])
  assert.equal(video.dataset.paPaused, '')
})

test('seekOverlayVideos clamps to the clip duration', () => {
  const video = {
    muted: true,
    playsInline: true,
    readyState: 4,
    currentTime: 1,
    duration: 10,
    play: async () => undefined,
    pause: () => undefined,
    addEventListener: () => undefined,
  }
  seekOverlayVideos({ querySelectorAll: () => [video] }, 12)
  assert.equal(video.currentTime, 10)
  seekOverlayVideos({ querySelectorAll: () => [video] }, -3)
  assert.equal(video.currentTime, 0)
})

test('largestFontThatFits binary-searches the last size that does not overflow', () => {
  assert.equal(
    largestFontThatFits(12, 80, (px) => px > 40),
    40
  )
  assert.equal(
    largestFontThatFits(12, 80, () => true),
    12
  )
})

test('auto-fit overflow uses the clip box when the verse element has grown with its text', () => {
  const text = { scrollHeight: 900, scrollWidth: 400 }
  const grownVerse = { clientHeight: 900, clientWidth: 800 }
  const clipBox = { clientHeight: 200, clientWidth: 800 }
  assert.equal(overlayTextOverflows(text, grownVerse, clipBox), true)
  assert.equal(
    overlayTextOverflows({ scrollHeight: 180, scrollWidth: 400 }, grownVerse, clipBox),
    false
  )
})

test('sanitizeOverlayColor only accepts hex', () => {
  assert.equal(sanitizeOverlayColor('#d4a017'), '#D4A017')
  assert.equal(sanitizeOverlayColor('#fc0'), '#FFCC00')
  assert.equal(sanitizeOverlayColor('red'), undefined)
  assert.equal(sanitizeOverlayColor('url(javascript:alert(1))'), undefined)
})

test('formatOverlayColoredText paints gloss lines and escapes the rest', () => {
  const html = formatOverlayColoredText([
    { text: 'Aka Aka ya' },
    { text: '(The arm of the Lord)', color: '#D4A017' },
  ])
  assert.equal(
    html,
    'Aka Aka ya<br><span style="color:#D4A017">(The arm of the Lord)</span>',
  )
  assert.match(
    formatOverlayColoredText([{ text: '<b>x</b>', color: '#D4A017' }]),
    /&lt;b&gt;x&lt;\/b&gt;/,
  )
})

test('overlay HTML keeps lyric gloss colors on the verse body', () => {
  const html = renderOverlayHTML(
    DEFAULT_OVERLAY_THEME,
    'Song · Chorus',
    'Aka Aka ya\n(The arm of the Lord)',
    1920,
    1080,
    {
      coloredLines: [
        { text: 'Aka Aka ya' },
        { text: '(The arm of the Lord)', color: '#D4A017' },
      ],
    },
  )
  assert.match(html, /<span style="color:#D4A017">\(The arm of the Lord\)<\/span>/)
})
