import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_TRANSCRIPT_WORDS,
  nextUploadBackoffMs,
  shouldRetryUpload,
  toSermonUpload,
  TranscriptTooLongError,
} from '../src/lib/sermon-upload'
import type { ServiceRecord } from '../src/lib/service-records'
import type { TranscriptResult } from '../src/lib/ipc'
import { transcriptSegment } from './fixtures'
import { ServiceRecords } from '../src/lib/service-archive'
import { SermonUploader } from '../src/main/services/cloud/sermon-upload'
import { MemoryStorage } from './fixtures'

function segment(id: string, text: string, timestamp = 1_000): TranscriptResult {
  return transcriptSegment(id, text, { timestamp, duration: 2 })
}

function record(overrides: Partial<ServiceRecord> = {}): ServiceRecord {
  return {
    id: 'service-1',
    title: 'Sunday Morning',
    speaker: 'Pastor Dara',
    createdAt: 1_700_000_000_000,
    endedAt: 1_700_000_600_000,
    status: 'ended',
    transcript: [segment('a', 'grace and peace'), segment('b', 'to you', 2_000)],
    scriptures: [{ reference: 'Romans 8:1', translation: 'NIV' } as never],
    notes: [],
    nuggets: [],
    analysisError: null,
    ...overrides,
  }
}

describe('toSermonUpload', () => {
  test('maps a record onto the upload payload', () => {
    const payload = toSermonUpload(record())
    assert.equal(payload.localId, 'service-1')
    assert.equal(payload.title, 'Sunday Morning')
    assert.equal(payload.startedAt, 1_700_000_000_000)
    assert.equal(payload.endedAt, 1_700_000_600_000)
    assert.equal(payload.transcript.length, 2)
    assert.deepEqual(payload.scriptures, [{ reference: 'Romans 8:1', translation: 'NIV' }])
  })

  test('keeps word timings — they cannot be recovered later', () => {
    const payload = toSermonUpload(record())
    assert.equal(payload.transcript[0].words.length, 1)
    assert.equal(payload.transcript[0].words[0].confidence, 0.9)
  })

  test('drops empty segments and duplicate ids', () => {
    const payload = toSermonUpload(
      record({
        transcript: [
          segment('a', 'kept'),
          segment('a', 'duplicate id'),
          segment('c', '   '),
        ],
      }),
    )
    assert.deepEqual(
      payload.transcript.map((item) => item.id),
      ['a'],
    )
    assert.equal(payload.transcript[0].text, 'kept')
  })

  test('refuses a service too long for the server rather than truncating it', () => {
    // Silently publishing a recap missing its last hour is worse than not
    // publishing one at all.
    const long = record({
      transcript: [segment('a', 'word '.repeat(MAX_TRANSCRIPT_WORDS + 10))],
    })
    assert.throws(() => toSermonUpload(long), TranscriptTooLongError)
  })

  test('falls back to now when a service somehow has no end time', () => {
    const payload = toSermonUpload(record({ endedAt: null }))
    assert.ok(payload.endedAt > 0)
  })
})

describe('retry policy', () => {
  test('retries offline and server failures, gives up on refusals', () => {
    assert.equal(shouldRetryUpload(null), true, 'offline')
    assert.equal(shouldRetryUpload(500), true)
    assert.equal(shouldRetryUpload(429), true)
    assert.equal(shouldRetryUpload(408), true)
    assert.equal(shouldRetryUpload(400), false)
    assert.equal(shouldRetryUpload(403), false)
    assert.equal(shouldRetryUpload(413), false)
  })

  test('backs off further each attempt, then holds at an hour', () => {
    assert.equal(nextUploadBackoffMs(1), 30_000)
    assert.equal(nextUploadBackoffMs(2), 120_000)
    assert.ok(nextUploadBackoffMs(4) > nextUploadBackoffMs(3))
    assert.equal(nextUploadBackoffMs(50), 3_600_000)
    assert.equal(nextUploadBackoffMs(0), 30_000)
  })
})

test('wakes queued services immediately when the cloud session becomes available', async () => {
  const records = new ServiceRecords(new MemoryStorage(), async () => '[]')
  records.create('Sunday Morning', 'Pastor Dara', null)
  records.transcript(segment('speech', 'Grace and peace to everyone gathered here today.'))
  const serviceId = records.active()!.id
  records.end()

  const uploaded: string[] = []
  const uploader = new SermonUploader(records, {
    canUpload: () => true,
    uploadSermon: async (payload) => {
      uploaded.push(payload.localId)
      return { id: 'cloud-sermon-1', status: 'pending' }
    },
  })

  uploader.start()
  uploader.wake()
  await new Promise((resolve) => setTimeout(resolve, 25))

  assert.deepEqual(uploaded, [serviceId])
  assert.equal(records.snapshot().services[0].upload.status, 'uploaded')
})
