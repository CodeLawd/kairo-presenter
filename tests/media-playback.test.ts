import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyPlaybackToBackground,
  DEFAULT_MEDIA_PLAYBACK,
  isDefaultMediaPlayback,
  mediaFilterCss,
  normalizeMediaPlayback,
  normalizePlaybackMap,
  themeOwnsBackground,
  themeWithLiveMedia,
} from '../src/lib/media-playback'
import { DEFAULT_OVERLAY_THEME } from '../src/lib/overlay-defaults'
import { renderOverlayHTML } from '../src/lib/overlay-template'

test('missing playback is identity with loop off', () => {
  assert.deepEqual(normalizeMediaPlayback(undefined), DEFAULT_MEDIA_PLAYBACK)
  assert.equal(isDefaultMediaPlayback(DEFAULT_MEDIA_PLAYBACK), true)
})

test('out of range color values are clamped', () => {
  const playback = normalizeMediaPlayback({
    loop: false,
    hue: 400,
    saturation: -1,
    brightness: 0,
    contrast: 9,
  })
  assert.equal(playback.loop, false)
  assert.equal(playback.hue, 180)
  assert.equal(playback.saturation, 0)
  assert.equal(playback.brightness, 0.25)
  assert.equal(playback.contrast, 1.75)
})

test('identity grade emits no CSS filter', () => {
  assert.equal(mediaFilterCss(DEFAULT_MEDIA_PLAYBACK), '')
})

test('a dimmed loop emits brightness only', () => {
  assert.equal(
    mediaFilterCss({ ...DEFAULT_MEDIA_PLAYBACK, brightness: 0.7 }),
    'brightness(0.7)',
  )
})

test('default entries are dropped from the persisted map', () => {
  const map = normalizePlaybackMap({
    'a.mp4': DEFAULT_MEDIA_PLAYBACK,
    'b.mp4': { ...DEFAULT_MEDIA_PLAYBACK, brightness: 0.8 },
  })
  assert.equal('a.mp4' in map, false)
  assert.equal(map['b.mp4']?.brightness, 0.8)
})

test('overlay video does not loop until asked', () => {
  const theme = {
    ...DEFAULT_OVERLAY_THEME,
    background: {
      ...DEFAULT_OVERLAY_THEME.background,
      type: 'video' as const,
      mediaPath: '/media/loop.mp4',
    },
  }
  const html = renderOverlayHTML(theme, '', '')
  assert.match(html, /autoplay muted/)
  assert.doesNotMatch(html, /autoplay loop muted/)

  const looping = {
    ...theme,
    background: applyPlaybackToBackground(
      theme.background,
      { ...DEFAULT_MEDIA_PLAYBACK, loop: true },
      'video',
    ),
  }
  assert.match(renderOverlayHTML(looping, '', ''), /autoplay loop muted/)
})

test('a background-only overlay skips empty verse chrome', () => {
  const background = applyPlaybackToBackground(
    { ...DEFAULT_OVERLAY_THEME.background, type: 'video', mediaPath: '/media/loop.mp4' },
    DEFAULT_MEDIA_PLAYBACK,
    'video',
  )
  const html = renderOverlayHTML({ ...DEFAULT_OVERLAY_THEME, background }, '', '')
  assert.match(html, /class="pa-bg"/)
  assert.doesNotMatch(html, /pa-verse-box/)
})

test('themeWithLiveMedia lays the file under the theme', () => {
  const next = themeWithLiveMedia(
    DEFAULT_OVERLAY_THEME,
    { kind: 'video', path: '/media/loop.mp4' },
    { ...DEFAULT_MEDIA_PLAYBACK, brightness: 0.5 },
  )
  assert.equal(next.background.type, 'video')
  assert.equal(next.background.mediaPath, '/media/loop.mp4')
  assert.equal(next.background.brightness, 0.5)
})

test('overlay color grade lands on the background layer', () => {
  const background = applyPlaybackToBackground(
    { ...DEFAULT_OVERLAY_THEME.background, type: 'video', mediaPath: '/media/loop.mp4' },
    { ...DEFAULT_MEDIA_PLAYBACK, brightness: 0.6, saturation: 0.8 },
    'video',
  )
  const html = renderOverlayHTML({ ...DEFAULT_OVERLAY_THEME, background }, '', '')
  assert.match(html, /filter:saturate\(0\.8\) brightness\(0\.6\)/)
})

test('a theme with its own background outranks the dock loop', () => {
  // Scripture theme configured with a look of its own.
  assert.equal(
    themeOwnsBackground({
      ...DEFAULT_OVERLAY_THEME,
      background: { ...DEFAULT_OVERLAY_THEME.background, type: 'image', mediaPath: '/bg/still.png' },
    }),
    true,
  )
  // Lyric themes are forced transparent, so the dock still fills them.
  assert.equal(themeOwnsBackground(DEFAULT_OVERLAY_THEME), false)
})
