import assert from 'node:assert/strict'
import test from 'node:test'
import { mediaMimeType, parseByteRange, rangeResponseHeaders } from '../src/lib/pa-media-range'

test('MP4s are served as video/mp4', () => {
  assert.equal(mediaMimeType('/Media/Paint Sweeps Countdown.mp4'), 'video/mp4')
  assert.equal(mediaMimeType('/Media/slide.PNG'), 'image/png')
})

test('byte ranges are inclusive and clamp to the file', () => {
  assert.deepEqual(parseByteRange('bytes=0-1023', 5000), { start: 0, end: 1023 })
  assert.deepEqual(parseByteRange('bytes=100-', 5000), { start: 100, end: 4999 })
  assert.deepEqual(parseByteRange('bytes=-200', 5000), { start: 4800, end: 4999 })
  assert.equal(parseByteRange('bytes=8000-9000', 5000), null)
  assert.equal(parseByteRange(null, 5000), null)
})

test('a ranged MP4 answers 206 with Accept-Ranges', () => {
  const { status, headers } = rangeResponseHeaders(394_695_246, 'video/mp4', { start: 0, end: 1023 })
  assert.equal(status, 206)
  assert.equal(headers['Accept-Ranges'], 'bytes')
  assert.equal(headers['Content-Range'], 'bytes 0-1023/394695246')
  assert.equal(headers['Content-Length'], '1024')
})
