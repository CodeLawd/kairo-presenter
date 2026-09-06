import assert from 'node:assert/strict'
import test from 'node:test'
import { ServiceRecords, type ServiceArchiveStorage } from '../src/lib/service-archive'
import { extractNuggetQuotes, serviceTextExport, type ServiceSnapshot } from '../src/lib/service-records'
import type { SermonPlan, TranscriptResult } from '../src/lib/ipc'

class MemoryStorage implements ServiceArchiveStorage {
  private value: ServiceSnapshot = { activeId: null, services: [] }
  get store() { return structuredClone(this.value) }
  set store(value: ServiceSnapshot) { this.value = structuredClone(value) }
  get<K extends keyof ServiceSnapshot>(key: K): ServiceSnapshot[K] { return structuredClone(this.value[key]) }
  set<K extends keyof ServiceSnapshot>(key: K, value: ServiceSnapshot[K]): void { this.value[key] = structuredClone(value) }
}
const quote = 'Faith is choosing to trust God even when the next step is not visible.'
const segment = (id: string): TranscriptResult => ({ id, text: quote, words: [], isFinal: true, timestamp: Date.now(), duration: 3 })
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
  assert.throws(() => extractNuggetQuotes('not json', []))
})
