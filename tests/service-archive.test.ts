import assert from 'node:assert/strict'
import test from 'node:test'
import { ServiceRecords } from '../src/lib/service-archive'
import { extractNuggetQuotes, serviceTalkTimeMs, serviceTextExport } from '../src/lib/service-records'
import type { SermonPlan, TranscriptResult } from '../src/lib/ipc'
import { MemoryStorage, transcriptSegment } from './fixtures'

const quote = 'Faith is choosing to trust God even when the next step is not visible.'
const segment = (id: string): TranscriptResult => transcriptSegment(id, quote, { words: [] })
const tick = () => new Promise(resolve => setImmediate(resolve))

test('service stays open across transcription pauses; end isolates the next service', () => {
  const db = new MemoryStorage()
  const records = new ServiceRecords(db, async () => '[]')
  records.create('Morning service', 'Pastor Ada', null)
  const id = records.active()!.id
  assert.equal(records.active()!.status, 'live')
  records.transcript(segment('one'))
  records.transcript(segment('one'))
  assert.equal(records.active()!.transcript.length, 1)
  // Pausing transcription must not pause or close the service.
  records.setRunning(false)
  assert.equal(records.active()!.status, 'live')
  records.transcript(segment('while-paused-pipeline'))
  assert.equal(records.active()!.transcript.length, 2)
  records.setRunning(true)
  records.transcript(segment('two'))
  const restored = new ServiceRecords(db, async () => '[]')
  restored.init()
  assert.equal(restored.active()!.status, 'live')
  assert.equal(restored.active()!.id, id)
  assert.equal(restored.active()!.transcript.length, 3)
  assert.throws(() => restored.create('Another', '', null), /End the current/)
  restored.end()
  restored.create('Evening service', '', null)
  assert.equal(restored.active()!.transcript.length, 0)
  assert.equal(restored.snapshot().services.find(s => s.id === id)!.status, 'ended')
})

test('legacy paused status migrates to live on init', () => {
  const db = new MemoryStorage()
  const records = new ServiceRecords(db, async () => '[]')
  records.create('Legacy', '', null)
  const id = records.active()!.id
  db.set('services', db.get('services').map(s => s.id === id ? { ...s, status: 'paused' as 'live' } : s))
  const restored = new ServiceRecords(db, async () => '[]')
  restored.init()
  assert.equal(restored.active()!.status, 'live')
})

test('a delayed AI quote stays in its original service after ending', async () => {
  let complete!: (text: string) => void
  const records = new ServiceRecords(new MemoryStorage(), () => new Promise(resolve => { complete = resolve }))
  records.create('First', '', null)
  const firstId = records.active()!.id
  records.transcript(segment('first'))
  records.end()
  records.create('Second', '', null)
  complete(JSON.stringify([quote]))
  await tick()
  assert.equal(records.active()!.nuggets.length, 0)
  assert.equal(records.snapshot().services.find(s => s.id === firstId)!.nuggets[0].text, quote)
})

test('notes are snapshots and failures retain speech for retry', async () => {
  let failed = true
  const records = new ServiceRecords(new MemoryStorage(), async () => {
    if (failed) throw new Error('Offline')
    return JSON.stringify([quote])
  })
  const note: SermonPlan = { id: 'note', title: 'Faith', sourceFileName: 'faith.txt', sourceText: 'Original sermon notes', items: [], createdAt: 1, updatedAt: 1 }
  records.create('Sunday', '', note)
  note.sourceText = 'Changed later'
  records.transcript(segment('speech'))
  records.setRunning(false)
  await tick()
  assert.equal(records.active()!.analysisError, 'Offline')
  assert.equal(records.active()!.transcript.length, 1)
  assert.equal(records.active()!.notes[0].sourceText, 'Original sermon notes')
  failed = false; records.retryAnalysis(records.active()!.id)
  await tick()
  assert.equal(records.active()!.nuggets.length, 1)
  assert.equal(records.active()!.analysisError, null)
  records.retryAnalysis(records.active()!.id)
  await tick()
  assert.equal(records.active()!.nuggets.length, 1)
  assert.match(serviceTextExport(records.active()!), /Original sermon notes/)
})

test('automatic selection accepts only exact quotes and can select nothing', () => {
  assert.deepEqual(extractNuggetQuotes(JSON.stringify([quote, 'Invented teaching that was never actually said in this transcript.', quote]), [segment('one')]), [quote])
  assert.deepEqual(extractNuggetQuotes('[]', [segment('one')]), [])
  assert.deepEqual(extractNuggetQuotes('', [segment('one')]), [])
  assert.deepEqual(extractNuggetQuotes('   ', [segment('one')]), [])
  assert.deepEqual(extractNuggetQuotes(`Here you go:\n${JSON.stringify([quote])}\n`, [segment('one')]), [quote])
  assert.throws(() => extractNuggetQuotes('not json', []), /incomplete JSON/)
  assert.throws(() => extractNuggetQuotes('["unterminated', []), /incomplete JSON/)
})

test('ending a service queues it for the web and survives a restart', () => {
  const db = new MemoryStorage()
  const queued: string[] = []
  const records = new ServiceRecords(db, async () => '[]')
  records.onServiceEnded(id => queued.push(id))
  records.create('Morning service', 'Pastor Ada', null)
  const id = records.active()!.id
  records.transcript(segment('one'))

  assert.equal(records.active()!.upload.status, 'idle')
  records.end()

  assert.deepEqual(queued, [id], 'the uploader is told exactly once')
  const ended = records.snapshot().services.find(record => record.id === id)!
  assert.equal(ended.upload.status, 'queued')
  assert.deepEqual(records.queuedForUpload().map(record => record.id), [id])

  // A fresh process reading the same store still sees the work waiting.
  const reopened = new ServiceRecords(db, async () => '[]')
  reopened.onServiceEnded(id => queued.push(id))
  reopened.init()
  assert.deepEqual(reopened.queuedForUpload().map(record => record.id), [id])
})

test('upload state moves through the machine and leaves the queue when published', () => {
  const db = new MemoryStorage()
  const records = new ServiceRecords(db, async () => '[]')
  records.create('Morning service', 'Pastor Ada', null)
  const id = records.active()!.id
  records.end()

  records.markUpload(id, { status: 'uploading', lastAttemptAt: 1 })
  assert.equal(records.snapshot().services[0].upload.status, 'uploading')

  records.markUpload(id, { status: 'failed', error: 'Offline.', attempts: 1 })
  assert.equal(records.queuedForUpload().length, 1, 'a failure stays in the queue')

  records.markUpload(id, { status: 'uploaded', sermonId: 'abc123', error: null })
  assert.equal(records.queuedForUpload().length, 0)
  assert.equal(records.snapshot().services[0].upload.sermonId, 'abc123')
})

test('a manual retry clears the error and asks the uploader again', () => {
  const db = new MemoryStorage()
  const queued: string[] = []
  const records = new ServiceRecords(db, async () => '[]')
  records.onServiceEnded(id => queued.push(id))
  records.create('Morning service', 'Pastor Ada', null)
  const id = records.active()!.id
  records.end()
  records.markUpload(id, { status: 'failed', error: 'Offline.', attempts: 3 })

  records.requeueUpload(id)
  const state = records.snapshot().services[0].upload
  assert.equal(state.status, 'queued')
  assert.equal(state.error, null)
  assert.equal(state.attempts, 0, 'backoff starts over on a deliberate retry')
  assert.deepEqual(queued, [id, id])

  assert.throws(() => records.requeueUpload('nope'), /Service not found/)
})

test('records written before recaps existed get an upload state on load', () => {
  const db = new MemoryStorage()
  db.store = {
    activeId: null,
    services: [{
      id: 'legacy', title: 'Old service', speaker: '', createdAt: 1, endedAt: 2,
      status: 'ended', transcript: [], scriptures: [], notes: [], nuggets: [],
      analysisError: null,
    }],
  }
  const records = new ServiceRecords(db, async () => '[]')
  records.init()

  const migrated = records.snapshot().services[0]
  assert.equal(migrated.upload.status, 'idle')
  // Idle, not queued: a service that ended months ago should not suddenly
  // publish itself the first time someone opens the new build.
  assert.equal(records.queuedForUpload().length, 0)
})

test('an unnamed service records first and is named when it ends', () => {
  const db = new MemoryStorage()
  const records = new ServiceRecords(db, async () => '[]')
  records.create()
  assert.equal(records.active()!.title, '')
  records.transcript(segment('one'))
  records.end({ title: '  Sunday morning  ', speaker: ' Pastor Ada ' })
  const [saved] = records.snapshot().services
  assert.equal(saved.title, 'Sunday morning')
  assert.equal(saved.speaker, 'Pastor Ada')
  assert.equal(saved.status, 'ended')
  assert.equal(saved.transcript.length, 1)
  assert.equal(records.snapshot().activeId, null)
})

test('ending without a name files the service by date rather than losing it', () => {
  const db = new MemoryStorage()
  const records = new ServiceRecords(db, async () => '[]')
  records.create()
  records.end()
  assert.match(records.snapshot().services[0].title, /^Service — /)
})

test('notes chosen at the end are attached to the saved service', () => {
  const db = new MemoryStorage()
  const records = new ServiceRecords(db, async () => '[]')
  const note: SermonPlan = { id: 'note', title: 'Faith', sourceFileName: 'faith.txt', sourceText: 'Notes', items: [], createdAt: 1, updatedAt: 1 }
  records.create()
  records.end({ title: 'Sunday', note })
  assert.deepEqual(records.snapshot().services[0].notes.map(n => n.id), ['note'])
})

test('discarding the open service leaves nothing behind', () => {
  const db = new MemoryStorage()
  const records = new ServiceRecords(db, async () => '[]')
  records.create('Kept', '', null)
  records.end({})
  records.create()
  records.transcript(segment('one'))
  records.discard()
  assert.equal(records.snapshot().activeId, null)
  assert.deepEqual(records.snapshot().services.map(s => s.title), ['Kept'])
  records.create()
  assert.ok(records.active())
})

test('the service clock counts talk time: it stops while paused and banks pauses at the end', () => {
  const base = { createdAt: 0, endedAt: null }
  assert.equal(serviceTalkTimeMs({ ...base }, 60_000), 60_000)
  // Paused at 40s: still 40s at 90s.
  assert.equal(serviceTalkTimeMs({ ...base, pausedMs: 0, pausedAt: 40_000 }, 90_000), 40_000)
  // Resumed after a 50s pause: 60s of talk at 110s.
  assert.equal(serviceTalkTimeMs({ ...base, pausedMs: 50_000, pausedAt: null }, 110_000), 60_000)
  // Ended: an open pause no longer grows.
  assert.equal(serviceTalkTimeMs({ createdAt: 0, endedAt: 100_000, pausedMs: 20_000, pausedAt: null }, 500_000), 80_000)

  const records = new ServiceRecords(new MemoryStorage(), async () => '[]')
  records.create()
  records.setRunning(true)
  assert.equal(records.active()!.pausedAt ?? null, null)
  records.setRunning(false)
  const pausedAt = records.active()!.pausedAt
  assert.equal(typeof pausedAt, 'number')
  // Repeated status reports do not move the pause start.
  records.setRunning(false)
  assert.equal(records.active()!.pausedAt, pausedAt)
  records.setRunning(true)
  assert.equal(records.active()!.pausedAt, null)
  assert.ok((records.active()!.pausedMs ?? 0) >= 0)
  records.setRunning(false)
  const id = records.active()!.id
  records.end({ title: 'Evening' })
  const ended = records.snapshot().services.find((item) => item.id === id)!
  assert.equal(ended.pausedAt, null)
})
