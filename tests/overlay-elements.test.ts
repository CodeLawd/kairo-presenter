import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_OVERLAY_THEME, normalizeOverlayTheme } from '../src/lib/overlay-defaults'
import { ELEMENT_BOX_MIN, resizeOverlayBox, resizeOverlayBoxKeepingAspect } from '../src/lib/overlay-boxes'
import {
  createOverlayElement,
  duplicateOverlayElement,
  MAX_OVERLAY_ELEMENTS,
  normalizeOverlayElements,
  reorderOverlayElement,
} from '../src/lib/overlay-elements'
import { configuredMediaPaths } from '../src/lib/overlay-outputs'
import { renderOverlayHTML } from '../src/lib/overlay-template'
import type { OverlayElement } from '../src/lib/ipc'

const rect = (id: string, patch: Partial<OverlayElement> = {}): OverlayElement => ({
  ...createOverlayElement('rectangle', undefined, id),
  ...patch,
})

test('a theme saved before elements existed normalizes to none', () => {
  const { elements: _omit, ...legacy } = DEFAULT_OVERLAY_THEME
  assert.deepEqual(normalizeOverlayTheme(legacy).elements, [])
})

test('normalizing elements drops junk, duplicates and out-of-range values', () => {
  const elements = normalizeOverlayElements([
    { id: 'a', kind: 'ellipse', opacity: 4, box: { xPct: 90, yPct: 0, widthPct: 50, heightPct: 10 } },
    { id: 'a', kind: 'rectangle' },
    { kind: 'rectangle' },
    'nope',
    { id: 'b', kind: 'rectangle', mediaPath: '/tmp/x.png', fill: 'url(javascript:1)' },
  ])
  assert.deepEqual(elements.map((el) => el.id), ['a', 'b'])
  assert.equal(elements[0].opacity, 1)
  // Kept inside the frame.
  assert.equal(elements[0].box.xPct + elements[0].box.widthPct, 100)
  // Shapes carry no media, and only real colours pass.
  assert.equal(elements[1].mediaPath, undefined)
  assert.equal(elements[1].fill, '#ffffff')
})

test('a theme holds at most MAX_OVERLAY_ELEMENTS', () => {
  const many = Array.from({ length: MAX_OVERLAY_ELEMENTS + 5 }, (_, i) => rect(`r${i}`))
  assert.equal(normalizeOverlayElements(many).length, MAX_OVERLAY_ELEMENTS)
  assert.equal(duplicateOverlayElement(many.slice(0, MAX_OVERLAY_ELEMENTS), 'r0').id, null)
})

test('elements can shrink far below the text-box minimum', () => {
  const thin = resizeOverlayBox({ xPct: 10, yPct: 10, widthPct: 50, heightPct: 20 }, 's', 0, -19.5, ELEMENT_BOX_MIN)
  assert.equal(thin.heightPct, 0.5)
})

test('duplicate lands just above the original, nudged', () => {
  const { elements, id } = duplicateOverlayElement([rect('a'), rect('b')], 'a', 'copy')
  assert.equal(id, 'copy')
  assert.deepEqual(elements.map((el) => el.id), ['a', 'copy', 'b'])
  assert.equal(elements[1].box.xPct, elements[0].box.xPct + 2)
})

test('reordering stays within the under-text or over-text group', () => {
  const list = [rect('a'), rect('b'), rect('over', { aboveText: true }), rect('c')]
  const order = (els: OverlayElement[], aboveText: boolean): string[] =>
    els.filter((el) => el.aboveText === aboveText).map((el) => el.id)

  assert.deepEqual(order(reorderOverlayElement(list, 'a', 'front'), false), ['b', 'c', 'a'])
  assert.deepEqual(order(reorderOverlayElement(list, 'c', 'back'), false), ['c', 'a', 'b'])
  assert.deepEqual(order(reorderOverlayElement(list, 'a', 'forward'), false), ['b', 'a', 'c'])
  assert.deepEqual(order(reorderOverlayElement(list, 'a', 'backward'), false), ['a', 'b', 'c'])
  assert.deepEqual(order(reorderOverlayElement(list, 'a', 'front'), true), ['over'])
})

test('elements render as their own layers under and over the text', () => {
  const theme = {
    ...DEFAULT_OVERLAY_THEME,
    elements: [
      rect('under', { fill: '#ff0000', radiusPx: 12 }),
      { ...createOverlayElement('ellipse', undefined, 'over'), aboveText: true },
    ],
  }
  const html = renderOverlayHTML(theme, 'John 3:16', 'For God so loved the world')
  const below = html.indexOf('pa-elements-below')
  const text = html.indexOf('pa-layer')
  const above = html.indexOf('pa-elements-above')
  assert.ok(below > -1 && below < text && text < above, 'below, then text, then above')
  assert.match(html, /background:rgba\(255, 0, 0, 1\); border-radius:12px;/)
  assert.match(html, /border-radius:50%/)
})

test('a theme without elements renders no element layers', () => {
  const html = renderOverlayHTML(DEFAULT_OVERLAY_THEME, 'John 3:16', 'Text')
  assert.doesNotMatch(html, /pa-elements/)
})

test('media elements render from pa-media with their adjustments; unpicked ones render nothing', () => {
  const theme = {
    ...DEFAULT_OVERLAY_THEME,
    elements: [
      { ...createOverlayElement('video', '/media/loop one.mp4', 'v'), brightness: 1.2, blurPx: 4, mediaLoop: false },
      createOverlayElement('image', undefined, 'empty'),
    ],
  }
  const html = renderOverlayHTML(theme, '', 'Text')
  assert.match(html, /<video src="pa-media:\/\/[^"]*loop%20one\.mp4"/)
  assert.match(html, /filter:brightness\(1\.2\) blur\(4px\)/)
  assert.doesNotMatch(html, / loop /)
  assert.equal(html.match(/class="pa-element"/g)?.length, 1)
})

test('element media and a theme default are servable over pa-media', () => {
  const withElement = { ...DEFAULT_OVERLAY_THEME, elements: [createOverlayElement('image', '/media/logo.png', 'i')] }
  const baseline = { ...DEFAULT_OVERLAY_THEME, elements: [createOverlayElement('video', '/media/old.mp4', 'v')] }
  const paths = configuredMediaPaths(
    { theme: DEFAULT_OVERLAY_THEME, outputs: [] },
    [{ id: 't', theme: withElement, baseline }],
  )
  assert.ok(paths.includes('/media/logo.png'))
  assert.ok(paths.includes('/media/old.mp4'))
})

const BOX = { xPct: 20, yPct: 20, widthPct: 20, heightPct: 10 }
const shape = (b: { widthPct: number; heightPct: number }): number => b.heightPct / b.widthPct

test('Shift on a corner scales from the opposite corner and keeps the shape', () => {
  const next = resizeOverlayBoxKeepingAspect(BOX, 'se', 10, 1, ELEMENT_BOX_MIN)
  assert.equal(shape(next), shape(BOX))
  assert.equal(next.widthPct, 30, 'follows the edge that moved further')
  assert.deepEqual([next.xPct, next.yPct], [20, 20])

  const nw = resizeOverlayBoxKeepingAspect(BOX, 'nw', -10, 0, ELEMENT_BOX_MIN)
  assert.equal(nw.xPct + nw.widthPct, 40, 'right edge stays')
  assert.equal(nw.yPct + nw.heightPct, 30, 'bottom edge stays')
})

test('Shift on an edge keeps the shape about the centre line', () => {
  const next = resizeOverlayBoxKeepingAspect(BOX, 'e', 20, 0, ELEMENT_BOX_MIN)
  assert.equal(next.widthPct, 40)
  assert.equal(next.heightPct, 20)
  assert.equal(next.yPct + next.heightPct / 2, 25, 'vertical centre stays')
})

test('Shift never grows a box past the frame', () => {
  const next = resizeOverlayBoxKeepingAspect(BOX, 'se', 500, 0, ELEMENT_BOX_MIN)
  assert.ok(next.widthPct <= 100 && next.heightPct <= 100)
  assert.equal(shape(next), shape(BOX))
})

test('a rotated element renders turned about its centre; an unturned one has no transform', () => {
  const html = renderOverlayHTML(
    { ...DEFAULT_OVERLAY_THEME, elements: [rect('turned', { rotationDeg: -30 }), rect('flat')] },
    '',
    'Text',
  )
  assert.equal(html.match(/transform:rotate\(-30deg\)/g)?.length, 1)
  assert.equal(normalizeOverlayElements([{ id: 'x', rotationDeg: 400 }])[0].rotationDeg, 180)
})

test('every catalog shape has a unique id and a drawable path', async () => {
  const { OVERLAY_SHAPE_GROUPS } = await import('../src/lib/overlay-shapes')
  const shapes = OVERLAY_SHAPE_GROUPS.flatMap((g) => g.shapes)
  assert.ok(shapes.length >= 80)
  assert.equal(new Set(shapes.map((s) => s.id)).size, shapes.length)
  for (const shape of shapes) assert.match(shape.path, /^M[\d.\s\-MLHVCQAZ]+$/, shape.id)
})

test('catalog shapes render as stretched SVG; lines are stroke only', () => {
  const star = createOverlayElement('shape', undefined, 's', 'star-5')
  const line = createOverlayElement('shape', undefined, 'l', 'line-arrow')
  const html = renderOverlayHTML({ ...DEFAULT_OVERLAY_THEME, elements: [star, line] }, '', 'Text')
  assert.match(html, /preserveAspectRatio="none"/)
  assert.match(html, /vector-effect="non-scaling-stroke"/)
  assert.equal(html.match(/<path /g)?.length, 2)
  assert.match(html, /fill="none" fill-rule="evenodd" stroke="rgba\(255, 255, 255, 1\)" stroke-width="6"/)
  assert.equal(line.stroke.enabled, true, 'a new line starts visible')
  assert.ok(line.box.widthPct > line.box.heightPct, 'a new line starts flat')
})

test('a shape the catalog does not know is dropped on load', () => {
  const elements = normalizeOverlayElements([
    { id: 'gone', kind: 'shape', shape: 'not-a-shape' },
    { id: 'kept', kind: 'shape', shape: 'heart' },
  ])
  assert.deepEqual(elements.map((el) => [el.id, el.shape]), [['kept', 'heart']])
})
