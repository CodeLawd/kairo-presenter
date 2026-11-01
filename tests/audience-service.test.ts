import assert from 'node:assert/strict'
import test from 'node:test'
import { AudienceService } from '../src/main/services/audience/service'
import { SampleAudienceSource } from '../src/main/services/audience/sources/sample'

test('questions require approval, show separately, and answering clears the live layer', async () => {
  let live: unknown = null
  const service = new AudienceService({ showQuestion: q => { live = q }, clearQuestion: () => { live = null } })
  await service.start(new SampleAudienceSource())
  assert.equal(service.getState().questions.length, 3)
  assert.throws(() => service.show('sample:0'), /Approve/)
  await service.moderate('sample:0', 'approved')
  assert.equal(live, null)
  service.show('sample:0')
  assert.deepEqual(live, { text: 'How can we put what we learned today into practice this week?', author: 'Ruth' })
  await service.moderate('sample:0', 'answered')
  assert.equal(live, null)
  assert.equal(service.getState().liveId, null)
  const copy = service.getState()
  copy.questions.length = 0
  assert.equal(service.getState().questions.length, 3)
  await service.stop('sample')
  assert.equal(service.getState().sources[0].state, 'stopped')
  assert.equal(service.getState().questions.length, 0)
})

import type { AudienceUpdate } from '../src/main/services/audience/source'

test('a room ending remotely clears the join card and allows a new session', async () => {
  let output: unknown = null
  let emit: (update: AudienceUpdate) => void = () => undefined
  const makeSource = () => ({
    id: 'kairo',
    onUpdate(callback: (update: AudienceUpdate) => void) { emit = callback; return () => undefined },
    async start() { emit({ session: { roomId: 'room', code: 'ABCDEF', title: 'Test', url: 'https://example.com', qrDataUrl: '' }, status: { id: 'kairo', kind: 'kairo', label: 'Kairo Q&A', state: 'live' } }) },
    async stop() {},
  })
  const service = new AudienceService({ showQuestion: q => { output = q }, clearQuestion: () => { output = null } })
  await service.start(makeSource())
  emit({ questions: [{ id: 'kairo:old', sourceId: 'kairo', text: 'Previous room', author: null, votes: 0, state: 'review', createdAt: 100 }] })
  service.showJoinCode()
  assert.ok(output)
  emit({ status: { id: 'kairo', kind: 'kairo', label: 'Kairo Q&A', state: 'stopped' }, session: null })
  assert.equal(output, null)
  assert.equal(service.getState().liveId, null)
  await service.start(makeSource())
  assert.equal(service.getState().session?.code, 'ABCDEF')
  assert.equal(service.getState().questions.length, 0)
})

test('stopping an unrelated source keeps the Kairo join card on screens', async () => {
  let live: unknown = null
  const service = new AudienceService({ showQuestion: q => { live = q }, clearQuestion: () => { live = null } })
  let publish: (update: AudienceUpdate) => void = () => undefined
  await service.start({ id: 'kairo', onUpdate(callback) { publish = callback; return () => undefined }, async start() { publish({ session: { roomId: 'room', code: 'ABCDEF', url: 'https://example.com', title: 'Test', qrDataUrl: '' } }) }, async stop() {} })
  await service.start(new SampleAudienceSource())
  service.showJoinCode()
  await service.stop('sample')
  assert.ok(live)
  assert.equal(service.getState().liveId, 'join')
})

test('application shutdown disposes local connections without awaiting a remote session end', async () => {
  let disposed = false
  let ended = false
  let publish: (update: AudienceUpdate) => void = () => undefined
  const service = new AudienceService({ showQuestion() {}, clearQuestion() {} })
  await service.start({
    id: 'slido:test',
    onUpdate(callback) { publish = callback; return () => { publish = () => undefined } },
    async start() { publish({ status: { id: 'slido:test', kind: 'slido', label: 'Test source', state: 'live' } }) },
    async stop() { ended = true },
    dispose() { disposed = true },
  })
  service.shutdown()
  assert.equal(disposed, true)
  assert.equal(ended, false)
  assert.equal(service.getState().sources[0].state, 'stopped')
  publish({ status: { id: 'slido:test', kind: 'slido', label: 'Test source', state: 'live' } })
  assert.equal(service.getState().sources[0].state, 'stopped')
})

test('repeated Connect is idempotent and preserves the existing source and queue', async () => {
  const service = new AudienceService({ showQuestion() {}, clearQuestion() {} })
  await service.start(new SampleAudienceSource())
  await service.moderate('sample:0', 'approved')
  let duplicateStarted = false
  const state = await service.start({ id: 'sample', onUpdate() { return () => undefined }, async start() { duplicateStarted = true }, async stop() {} })
  assert.equal(duplicateStarted, false)
  assert.equal(state.questions.length, 3)
  assert.equal(state.questions[0].state, 'approved')
})

test('sample availability is explicit and defaults off for the renderer', () => {
  const output = { showQuestion() {}, clearQuestion() {} }
  assert.equal(new AudienceService(output).getState().sampleAvailable, false)
  assert.equal(new AudienceService(output, { sampleAvailable: true }).getState().sampleAvailable, true)
})
