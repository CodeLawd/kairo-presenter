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
  idleTimer,
  nextTimeOfDay,
  startTimerFor,
  screenTimerDef,
  screenTimerStyle,
  type ProgramTimerDef,
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
  // An unknown corner falls back to top-right.
  const [object] = s.props[0].objects
  assert.ok(Math.abs(object.x + object.w - 0.98) < 1e-9)
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

const image = (id: string, mediaPath: string) => ({
  id, kind: 'image' as const, mediaPath, fit: 'contain' as const, x: 0.1, y: 0.1, w: 0.2, h: 0.2, opacity: 1,
})

test('only active props are drawn', () => {
  const props: ProgramProp[] = [
    { id: 'a', name: 'A', background: null, objects: [image('a1', '/a.png')] },
    { id: 'b', name: 'B', background: null, objects: [image('b1', '/b.png')] },
  ]
  assert.equal(renderPropsHTML(props, []), '')
  const html = renderPropsHTML(props, ['b'])
  assert.ok(html.includes(encodeURIComponent('/b.png')))
  assert.ok(!html.includes(encodeURIComponent('/a.png')))
})

test('an empty, clear prop draws nothing even when switched on', () => {
  assert.equal(renderPropsHTML([{ id: 'e', name: 'Empty', background: null, objects: [] }], ['e']), '')
  assert.match(renderPropsHTML([{ id: 'c', name: 'Colour', background: '#112233', objects: [] }], ['c']), /background:#112233/)
})

test('prop objects are drawn at their place on the frame, back to front', () => {
  const html = renderPropsHTML([{
    id: 'p',
    name: 'Welcome',
    background: null,
    objects: [
      { id: 's', kind: 'shape', shape: 'rectangle', fill: '#315ede', radiusPx: 24, x: 0, y: 0.8, w: 1, h: 0.2, opacity: 0.9 },
      { id: 't', kind: 'text', text: 'Welcome <home>\nfriends', fontSizePx: 80, color: '#ffffff', bold: true, align: 'left', x: 0.05, y: 0.82, w: 0.9, h: 0.16, opacity: 1 },
      { id: 'o', kind: 'shape', shape: 'ellipse', fill: '#ff0000', radiusPx: 0, x: 0.4, y: 0.4, w: 0.2, h: 0.2, opacity: 1 },
    ],
  }], ['p'])
  assert.ok(html.indexOf('#315ede') < html.indexOf('Welcome'), 'the shape is behind the text')
  assert.match(html, /left:0%;top:80%;width:100%;height:20%;opacity:0\.9;/)
  assert.match(html, /border-radius:24px/)
  assert.match(html, /border-radius:50%/)
  assert.match(html, /font-size:80px/)
  assert.match(html, /justify-content:flex-start/)
  assert.ok(html.includes('Welcome &lt;home&gt;<br>friends'), 'text is escaped and keeps its line break')
})

test('a prop saved as one corner image becomes one image object in the same place', () => {
  const [prop] = normalizePresentationSettings({
    props: [{ id: 'old', name: 'Bug', mediaPath: '/bug.png', position: 'top-right', widthPct: 12, marginPct: 2, opacity: 0.8 }],
  }).props
  assert.equal(prop.name, 'Bug')
  assert.equal(prop.background, null)
  assert.equal(prop.objects.length, 1)
  const [object] = prop.objects
  assert.equal(object.kind, 'image')
  assert.equal(object.kind === 'image' && object.mediaPath, '/bug.png')
  assert.equal(object.opacity, 0.8)
  assert.ok(Math.abs(object.w - 0.12) < 1e-9)
  assert.ok(Math.abs(object.x + object.w - 0.98) < 1e-9, 'right edge 2% in from the right')
  assert.ok(object.y > 0 && object.y < 0.05, 'near the top')
})

test('an old prop with no image converts to an empty prop, not an error', () => {
  const [prop] = normalizePresentationSettings({ props: [{ id: 'x', name: 'X' }] }).props
  assert.deepEqual(prop.objects, [])
})

test('prop objects are kept on the frame and bad ones dropped', () => {
  const [prop] = normalizePresentationSettings({
    props: [{
      id: 'p',
      name: 'P',
      background: '',
      objects: [
        { id: 'a', kind: 'text', text: 'Hi', x: 0.95, y: -2, w: 0.5, h: 3 },
        { id: 'a', kind: 'text', text: 'duplicate id' },
        { id: 'b', kind: 'image', mediaPath: '' },
        { id: 'c', kind: 'video' },
        { id: 'd', kind: 'shape', shape: 'star', fill: 'not a colour' },
      ],
    }],
  }).props
  assert.equal(prop.background, null)
  assert.deepEqual(prop.objects.map((o) => o.id), ['a', 'd'])
  const [text, shape] = prop.objects
  assert.equal(text.h, 1)
  assert.ok(text.x + text.w <= 1, 'pulled back onto the frame')
  assert.equal(text.y, 0)
  assert.equal(shape.kind === 'shape' && shape.shape, 'rectangle')
})

test('images inside props are allowed through the media protocol', () => {
  const paths = presentationMediaPaths({
    logo: { mediaPath: '/logo.png' },
    props: [{ id: 'p', name: 'P', objects: [image('i', '/inside.png'), { id: 't', kind: 'text', text: 'x' }] }],
  })
  assert.deepEqual(paths, ['/logo.png', '/inside.png'])
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

test('saved messages survive a round trip and bad entries are dropped', () => {
  const settings = normalizePresentationSettings({
    messages: [
      { id: 'a', text: '  Parents of child 42, please come to the nursery  ' },
      { id: 'a', text: 'duplicate id' },
      { id: 'b', text: '   ' },
      { id: '', text: 'no id' },
      'not an object',
      { id: 'c', text: 'x'.repeat(900) },
    ],
  })
  assert.deepEqual(settings.messages.map((m) => m.id), ['a', 'c'])
  assert.equal(settings.messages[0].text, 'Parents of child 42, please come to the nursery')
  assert.equal(settings.messages[1].text.length, 500)
})

test('older settings without saved messages start with an empty list', () => {
  assert.deepEqual(normalizePresentationSettings({}).messages, [])
  assert.deepEqual(normalizePresentationSettings({ messages: 'nope' }).messages, [])
})

test('the saved message list is capped', () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ id: `m${i}`, text: `Message ${i}` }))
  assert.equal(normalizePresentationSettings({ messages: many }).messages.length, 50)
})

// ─── Timers ──────────────────────────────────────────────────────────────────

const at = (hours: number, minutes: number, seconds = 0): number => new Date(2026, 9, 18, hours, minutes, seconds).getTime()
const countdownTo = (targetTime: string): ProgramTimerDef => ({ id: 't', name: 'Pre-service', kind: 'countdownTo', durationSec: 0, targetTime, overrun: false })

test('settings saved before timers had a list get one countdown keeping the old roll-over choice', () => {
  const timers = normalizePresentationSettings({ timer: { rollover: false } }).timers
  assert.equal(timers.length, 1)
  assert.equal(timers[0].kind, 'countdown')
  assert.equal(timers[0].durationSec, 300)
  assert.equal(timers[0].overrun, false)
})

test('saved timers are cleaned up, and the list is never empty', () => {
  const timers = normalizePresentationSettings({
    timers: [
      { id: 'a', name: '  Segment ', kind: 'countdown', durationSec: 900, overrun: true },
      { id: 'a', name: 'duplicate' },
      { id: 'b', kind: 'countdownTo', targetTime: '25:99' },
      { id: '', name: 'no id' },
    ],
  }).timers
  assert.deepEqual(timers.map((t) => t.id), ['a', 'b'])
  assert.equal(timers[0].name, 'Segment')
  assert.equal(timers[1].name, 'Timer')
  assert.equal(timers[1].targetTime, '10:00', 'an impossible time falls back')
  assert.equal(normalizePresentationSettings({ timers: [] }).timers.length, 1)
})

test('a countdown to a time of day runs to today, or tomorrow once it has passed', () => {
  assert.equal(nextTimeOfDay('17:00', at(16, 30)), at(17, 0))
  assert.equal(nextTimeOfDay('09:00', at(16, 30)), at(9, 0) + 24 * 3600 * 1000)
  assert.equal(nextTimeOfDay('16:30', at(16, 30)), at(16, 30) + 24 * 3600 * 1000, 'exactly now means tomorrow')
})

test('a countdown to a time shows the time left before it starts, and runs to that time', () => {
  const def = countdownTo('17:00')
  const idle = idleTimer(def, at(16, 55))
  assert.equal(idle.remainingSec, 300)
  assert.equal(idle.endsAt, null)
  // Started late, after a pause: it still ends at 17:00.
  const running = startTimerFor(def, idle, at(16, 58))
  assert.equal(running.endsAt, at(17, 0))
  assert.equal(timerRemainingSec(running, at(16, 59)), 60)
})

test('a countdown carries on from where it was paused', () => {
  const def: ProgramTimerDef = { id: 'c', name: 'Game', kind: 'countdown', durationSec: 900, targetTime: '10:00', overrun: true }
  const started = startTimerFor(def, idleTimer(def, 0), 0)
  const paused = pauseTimer(started, 60_000)
  assert.equal(paused.remainingSec, 840)
  const resumed = startTimerFor(def, paused, 1_000_000)
  assert.equal(timerRemainingSec(resumed, 1_000_000), 840)
})

test('the timer on screens is the chosen one, else the first; its roll-over comes from it', () => {
  const presentation = normalizePresentationSettings({
    timer: { rollover: true },
    timers: [
      { id: 'one', name: 'One', kind: 'countdown', durationSec: 60, overrun: true },
      { id: 'two', name: 'Two', kind: 'countdown', durationSec: 60, overrun: false },
    ],
  })
  assert.equal(screenTimerDef(presentation, { screenTimerId: 'two' }).id, 'two')
  assert.equal(screenTimerDef(presentation, { screenTimerId: 'gone' }).id, 'one')
  assert.equal(screenTimerDef(presentation, { screenTimerId: null }).id, 'one')
  assert.equal(screenTimerStyle(presentation, { screenTimerId: 'two' }).rollover, false)
  assert.equal(screenTimerStyle(presentation, { screenTimerId: 'one' }).rollover, true)
})
