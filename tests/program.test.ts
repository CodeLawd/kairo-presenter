import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_PRESENTATION_SETTINGS,
  formatTimer,
  normalizePresentationSettings,
  normalizeShowFilter,
  timerReadout,
  formatClock,
  pauseTimer,
  presentationMediaPaths,
  renderLogoHTML,
  renderMessageHTML,
  renderPropsHTML,
  resetTimer,
  startTimer,
  timerRemainingSec,
  transitionMs,
  type ProgramProp,
} from '../src/lib/program'
import { frameHeightFor, testPatternLayout } from '../src/lib/displays'

test('an empty or foreign store normalizes to the defaults', () => {
  assert.deepEqual(normalizePresentationSettings(undefined), DEFAULT_PRESENTATION_SETTINGS)
  assert.deepEqual(normalizePresentationSettings('nonsense'), DEFAULT_PRESENTATION_SETTINGS)
})

test('the normalizer clamps numbers and rejects unsafe colours', () => {
  const s = normalizePresentationSettings({
    transition: { kind: 'fade', durationMs: 99999 },
    message: { fontSizePx: 2, color: 'red;} body{display:none', background: '#123456' },
    audio: { volume: 7 },
  })
  assert.equal(s.transition.kind, 'fade')
  assert.equal(s.transition.durationMs, 3000)
  assert.equal(s.message.fontSizePx, 16)
  assert.equal(s.message.color, DEFAULT_PRESENTATION_SETTINGS.message.color)
  assert.equal(s.message.background, '#123456')
  assert.equal(s.audio.volume, 1)
})

test('props need a unique id; duplicates are dropped', () => {
  const s = normalizePresentationSettings({
    props: [
      { id: 'a', mediaPath: '/x.png', position: 'sideways' },
      { id: 'a', mediaPath: '/y.png' },
      { mediaPath: '/no-id.png' },
    ],
  })
  assert.equal(s.props.length, 1)
  assert.equal(s.props[0].position, 'top-right')
})

test('two enabled stage displays on one display: the second is turned off', () => {
  const s = normalizePresentationSettings({
    stageDisplays: [
      { id: 's1', enabled: true, displayId: 7 },
      { id: 's2', enabled: true, displayId: 7 },
      { id: 's3', enabled: true, displayId: 8 },
    ],
  })
  assert.deepEqual(s.stageDisplays.map((d) => d.enabled), [true, false, true])
})

test('cut means no fade, whatever the stored duration', () => {
  assert.equal(transitionMs({ kind: 'cut', durationMs: 800 }), 0)
  assert.equal(transitionMs({ kind: 'fade', durationMs: 800 }), 800)
})

test('logo and prop images are servable media; empty paths are not', () => {
  const paths = presentationMediaPaths({
    logo: { mediaPath: '/logo.png' },
    props: [{ id: 'p', mediaPath: '/bug.png' }, { id: 'q', mediaPath: '' }],
  })
  assert.deepEqual(paths, ['/logo.png', '/bug.png'])
})

test('a running countdown is derived from the clock and survives pause / resume', () => {
  const t0 = 1_000_000
  let timer = resetTimer({ durationSec: 0, endsAt: null, remainingSec: 0 }, 300)
  assert.equal(timerRemainingSec(timer, t0), 300)
  timer = startTimer(timer, t0)
  assert.equal(timerRemainingSec(timer, t0 + 10_000), 290)
  timer = pauseTimer(timer, t0 + 10_000)
  assert.equal(timerRemainingSec(timer, t0 + 999_999), 290)
  timer = startTimer(timer, t0 + 20_000)
  assert.equal(timerRemainingSec(timer, t0 + 320_000), -10)
})

test('timer formatting covers hours and overruns', () => {
  assert.equal(formatTimer(300), '5:00')
  assert.equal(formatTimer(3723), '1:02:03')
  assert.equal(formatTimer(-12), '-0:12')
})

test('message markup escapes operator text', () => {
  const html = renderMessageHTML('<img src=x onerror=alert(1)>\nline two', DEFAULT_PRESENTATION_SETTINGS.message)
  assert.ok(!html.includes('<img'))
  assert.ok(html.includes('&lt;img'))
  assert.ok(html.includes('<br>'))
  assert.equal(renderMessageHTML('   ', DEFAULT_PRESENTATION_SETTINGS.message), '')
  assert.equal(renderMessageHTML(null, DEFAULT_PRESENTATION_SETTINGS.message), '')
})

test('a scrolling message is one line with the ticker animation', () => {
  const html = renderMessageHTML('a\nb', { ...DEFAULT_PRESENTATION_SETTINGS.message, scroll: true })
  assert.match(html, /pa-ticker/)
  assert.ok(!html.includes('<br>'))
})

test('only active props with an image are drawn', () => {
  const props: ProgramProp[] = [
    { id: 'a', name: 'A', mediaPath: '/a.png', position: 'top-left', widthPct: 10, marginPct: 2, opacity: 1 },
    { id: 'b', name: 'B', mediaPath: '/b.png', position: 'center', widthPct: 10, marginPct: 2, opacity: 1 },
  ]
  assert.equal(renderPropsHTML(props, []), '')
  const html = renderPropsHTML(props, ['b'])
  assert.ok(html.includes(encodeURIComponent('/b.png')))
  assert.ok(!html.includes(encodeURIComponent('/a.png')))
})

test('the logo layer is empty when off and a colour without an image', () => {
  assert.equal(renderLogoHTML({ mediaPath: '/l.png', background: '#000' }, false), '')
  const plain = renderLogoHTML({ mediaPath: '', background: '#112233' }, true)
  assert.ok(plain.includes('#112233'))
  assert.ok(!plain.includes('<img'))
})

test('show filters default room layers on, confidence layers off', () => {
  assert.deepEqual(normalizeShowFilter(undefined), {
    scripture: true,
    lyrics: true,
    documents: true,
    backgrounds: true,
    messages: true,
    overlays: true,
    countdown: false,
    clock: false,
    stageMessage: false,
  })
  assert.equal(normalizeShowFilter({ countdown: true }).countdown, true)
  assert.equal(normalizeShowFilter({ lyrics: false }).lyrics, false)
})

test('fill uses the display aspect at 1920 wide; letterbox stays 1080', () => {
  assert.equal(frameHeightFor({ width: 1024, height: 768 }, 'fill'), 1440)
  assert.equal(frameHeightFor({ width: 1024, height: 768 }, 'letterbox'), 1080)
  assert.equal(frameHeightFor({ width: 3440, height: 1440 }, 'fill'), 804)
  assert.equal(frameHeightFor({ width: 0, height: 0 }, 'fill'), 1080)
})

test('each preset shape sets the frame height, whatever the display', () => {
  const display = { width: 1920, height: 1080 }
  assert.equal(frameHeightFor(display, '16:10'), 1200)
  assert.equal(frameHeightFor(display, '4:3'), 1440)
  assert.equal(frameHeightFor(display, '21:9'), 823)
  assert.equal(frameHeightFor(display, '9:16'), 3413)
  assert.equal(frameHeightFor(display, '1:1'), 1920)
  assert.equal(frameHeightFor(display, '32:9'), 540)
})

test('a custom ratio is used, and absurd ones are clamped to a usable frame', () => {
  const display = { width: 1920, height: 1080 }
  assert.equal(frameHeightFor(display, 'custom', { width: 3, height: 2 }), 1280)
  assert.equal(frameHeightFor(display, 'custom', { width: 100, height: 1 }), 360)
  assert.equal(frameHeightFor(display, 'custom', { width: 1, height: 100 }), 4320)
  assert.equal(frameHeightFor(display, 'custom', null), 1080)
})

test("NDI sound is off by default and kept when set", () => {
  assert.equal(normalizePresentationSettings(undefined).audio.ndi, false);
  assert.equal(normalizePresentationSettings({ audio: { ndi: true } }).audio.ndi, true);
});

test("the program preload sends on the channel main listens to", async () => {
  const { readFileSync } = await import("node:fs");
  const { PROGRAM } = await import("../src/lib/program");
  const preload = readFileSync("src/preload/program.ts", "utf8");
  assert.ok(preload.includes(`'${PROGRAM.NDI_AUDIO}'`), "src/preload/program.ts must use PROGRAM.NDI_AUDIO's value");
  // Sandboxed preload: a shared import would become a chunk it cannot require.
  assert.ok(!/from '@shared\//.test(preload));
});

test('timer style defaults to roll over on and keeps valid choices', () => {
  assert.equal(normalizePresentationSettings(undefined).timer.rollover, true)
  const style = normalizePresentationSettings({ timer: { rollover: false, color: '#ffffff', backdrop: true } }).timer
  assert.equal(style.rollover, false)
  assert.equal(style.color, '#ffffff')
  assert.equal(style.backdrop, true)
})

test('timerReadout agrees on time-up and pause for every surface', () => {
  const running = { durationSec: 60, endsAt: 61_000, remainingSec: 60 }
  assert.deepEqual(timerReadout(running, 1_000, true), { seconds: 60, timeUp: false, paused: false })
  assert.deepEqual(timerReadout(running, 61_000, true), { seconds: 0, timeUp: true, paused: false })
  assert.deepEqual(timerReadout(running, 73_000, false), { seconds: 0, timeUp: true, paused: false })
  const paused = { durationSec: 60, endsAt: null, remainingSec: 30 }
  assert.deepEqual(timerReadout(paused, 0, true), { seconds: 30, timeUp: false, paused: true })
  const zero = { durationSec: 0, endsAt: null, remainingSec: 0 }
  assert.equal(timerReadout(zero, 0, true).timeUp, false)
})

test('formatClock reads like the screens', () => {
  assert.equal(formatClock(new Date(2026, 0, 1, 21, 5)), '9:05 PM')
  assert.equal(formatClock(new Date(2026, 0, 1, 0, 30)), '12:30 AM')
})

test('the test pattern frame leaves bars exactly where the output will', () => {
  const tv = { x: 1920, y: 0, width: 1920, height: 1080 }
  // 16:9 on a 16:9 screen: no bars.
  assert.deepEqual(testPatternLayout(tv, false, 1080).frame, { width: 1, height: 1 })
  // 4:3 on a 16:9 screen: bars at the sides, full height.
  const fourThree = testPatternLayout(tv, false, 1440).frame
  assert.equal(fourThree.height, 1)
  assert.equal(Number(fourThree.width.toFixed(3)), 0.75)
  // 21:9 on a 16:9 screen: bars above and below, full width.
  const wide = testPatternLayout(tv, false, 823).frame
  assert.equal(wide.width, 1)
  assert.ok(wide.height < 0.8)
  // On the control display it is a half-size window of the frame's own shape.
  const rehearsal = testPatternLayout({ x: 0, y: 0, width: 1440, height: 900 }, true, 1440)
  assert.deepEqual(rehearsal.bounds, { x: 360, y: 180, width: 720, height: 540 })
  assert.deepEqual(rehearsal.frame, { width: 1, height: 1 })
})
