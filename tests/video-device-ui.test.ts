import { it } from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { makeOverlayOutput } from '../src/lib/overlay-defaults'
import type { VideoDeviceSnapshot } from '../src/lib/video-devices'
Object.assign(globalThis, { React })

async function render(snapshot: VideoDeviceSnapshot): Promise<string> {
  const { VideoDeviceFields } = await import('../src/renderer/src/components/screens/VideoDeviceFields')
  const output = makeOverlayOutput('card', 'device', { enabled: true, devicePortId: 'fake:1', deviceModeId: 'fake:mode' })
  return renderToStaticMarkup(React.createElement(VideoDeviceFields, { output, snapshot, onChange: () => {} }))
}
const port = { id: 'fake:1', provider: 'fake', deviceName: 'Test card', portName: 'SDI 1',
  supportsKeyFill: false, unavailableReason: null,
  modes: [{ id: 'fake:mode', label: '1080p29.97', width: 1920, height: 1080, frameRateN: 30000, frameRateD: 1001, interlaced: false }] }

it('says video cards are unsupported when no provider is built in', async () => {
  const markup = await render({ ports: [], providers: [], outputs: {} })
  assert.match(markup, /cannot drive video cards yet/)
  assert.doesNotMatch(markup, /<select/)
})
it('shows installation guidance without dead pickers when the driver is missing', async () => {
  const markup = await render({ ports: [], providers: [{ name: 'decklink', available: false }], outputs: {} })
  assert.match(markup, /Install Blackmagic Desktop Video/)
  assert.doesNotMatch(markup, /<select/)
})
it('shows a busy reason and port selection without enabling unsupported key/fill', async () => {
  const markup = await render({ ports: [{ ...port, unavailableReason: 'In use by another app' }],
    providers: [{ name: 'fake', available: true }], outputs: { card: { ready: false, reason: 'In use by another app' } } })
  assert.match(markup, /In use by another app/)
  assert.match(markup, /SDI 1/)
  assert.doesNotMatch(markup, /type="checkbox"/)
})
it('shows supported mode and optional key/fill for a ready port', async () => {
  const markup = await render({ ports: [{ ...port, supportsKeyFill: true }],
    providers: [{ name: 'fake', available: true }], outputs: { card: { ready: true, reason: '' } } })
  assert.match(markup, /1080p29.97/)
  assert.doesNotMatch(markup, /Match the switcher|Connector numbers/)
  assert.match(markup, /type="checkbox"/)
})
it('shows raster, frame rate, scan type and honest diagnostic availability', async () => {
  const markup = await render({ ports: [port], providers: [{ name:'fake', available:true }], outputs: { card:{ready:true,reason:''} } })
  assert.match(markup,/29.97 fps/)
  assert.match(markup,/Waiting for the card/)
  // A healthy output adds no status line.
  assert.doesNotMatch(markup,/text-amber-400">/)
})
it('shows actual capture and hardware playback metrics with test pattern controls', async () => {
  const markup = await render({ ports:[port],providers:[{name:'fake',available:true}], outputs:{card:{ready:true,reason:'',testPattern:'motion',diagnostics:{capturedFrames:50,captureFps:30,hardware:{completed:49,late:1,dropped:2,repeated:3,received:50,outputFps:29.97}}}} })
  assert.match(markup,/Rendered/)
  assert.match(markup,/29.97/)
  assert.match(markup,/Late/)
  assert.match(markup,/Dropped/)
  assert.match(markup,/Repeated/)
  assert.match(markup,/aria-checked="true"[^>]*>Motion</)
})

it('offers test patterns as one choice with Off, and folds frame counters behind a health line', async () => {
  const markup = await render({ ports: [port], providers: [{ name: 'fake', available: true }],
    outputs: { card: { ready: true, reason: '', testPattern: 'bars',
      diagnostics: { capturedFrames: 10, captureFps: 25, hardware: { completed: 100, late: 2, dropped: 1, repeated: 50, received: 40, outputFps: 25 } } } } })
  assert.match(markup, />Off</)
  assert.match(markup, /aria-checked="true"[^>]*>Color bars</)
  assert.match(markup, /2 late · 1 dropped/)
  assert.match(markup, /<details/)
  assert.doesNotMatch(markup, /Stop test pattern/)
})
