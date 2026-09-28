import assert from 'node:assert/strict'
import test from 'node:test'

import type { DisplayInfo } from '../src/lib/ipc'
import { bindingForDisplay, describeDisplay, resolveDisplay } from '../src/lib/displays'

function display(id: number, label: string, width = 1920, height = 1080, extra: Partial<DisplayInfo> = {}): DisplayInfo {
  return {
    id,
    label,
    bounds: { x: 0, y: 0, width, height },
    size: { width, height },
    scaleFactor: 1,
    primary: false,
    hostsMainWindow: false,
    ...extra,
  }
}

const laptop = display(1, 'Built-in Retina Display', 1512, 982, { primary: true, hostsMainWindow: true })
const projector = display(2, 'EPSON PJ')

test('a bound display is found by id', () => {
  assert.equal(resolveDisplay(bindingForDisplay(projector), [laptop, projector]), projector)
})

test('a replugged display with a new id is re-matched by label and size', () => {
  const replugged = display(99, 'EPSON PJ')
  const found = resolveDisplay(bindingForDisplay(projector), [laptop, replugged])
  assert.equal(found, replugged)
  // The caller learns it must persist the new id.
  assert.notEqual(found?.id, projector.id)
})

test('two identical displays are ambiguous — no guess', () => {
  const binding = bindingForDisplay(projector)
  assert.equal(resolveDisplay(binding, [laptop, display(10, 'EPSON PJ'), display(11, 'EPSON PJ')]), null)
})

test('a label match at a different size is a different display', () => {
  assert.equal(resolveDisplay(bindingForDisplay(projector), [laptop, display(5, 'EPSON PJ', 1280, 800)]), null)
})

test('an unplugged display resolves to nothing — never to the primary display', () => {
  assert.equal(resolveDisplay(bindingForDisplay(projector), [laptop]), null)
  assert.equal(resolveDisplay(bindingForDisplay(projector), []), null)
})

test('an output with no display chosen resolves to nothing', () => {
  assert.equal(resolveDisplay({ displayId: null, displayLabel: '', displaySize: null }, [laptop, projector]), null)
})

test('a replugged output cannot claim a display already assigned to another screen', () => {
  const replugged = display(99, 'EPSON PJ')
  assert.equal(resolveDisplay(bindingForDisplay(projector), [laptop, replugged], new Set([99])), null)
})

test('a display is described by its name and physical resolution', () => {
  assert.equal(describeDisplay({ ...laptop, scaleFactor: 2 }), 'Built-in Retina Display · 3024×1964')
  assert.equal(describeDisplay({ ...projector, label: '  ' }), 'Display · 1920×1080')
})
