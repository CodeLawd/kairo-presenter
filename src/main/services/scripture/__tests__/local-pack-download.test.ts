import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import os from 'node:os'
import { downloadBiblePack, temporaryPackPath } from '../local-bible-pack'
import { getDownloadablePack } from '../../../../lib/bible-translations'

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface StubResponse {
  ok: boolean
  status: number
  arrayBuffer: () => Promise<ArrayBuffer>
}

function stubFetcher(payload: Buffer, status = 200): typeof fetch {
  const response: StubResponse = {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer,
  }
  return (async () => response) as unknown as typeof fetch
}

function sha256Hex(payload: Buffer): string {
  return createHash('sha256').update(payload).digest('hex')
}

// ─── Contract ─────────────────────────────────────────────────────────────────

test('the download targets the dedicated bible-packs release with a pinned hash', () => {
  const pack = getDownloadablePack('NKJV')
  assert.ok(pack, 'NKJV must have a downloadable pack')
  assert.equal(
    pack.url,
    'https://github.com/CodeLawd/kairo-bible-packs/releases/download/bible-packs-v1/nkjv-pack.db.gz',
  )
  assert.match(pack.sha256, /^[0-9a-f]{64}$/)
})

test('translations without a registry pack are rejected before any fetch', async () => {
  const fetcher = stubFetcher(Buffer.from('whatever'))
  await assert.rejects(downloadBiblePack('KJV', fetcher), /No downloadable local pack/)
})

// ─── Failure paths ────────────────────────────────────────────────────────────

test('a missing release fails with the HTTP status, not a security error', async () => {
  const fetcher = stubFetcher(Buffer.alloc(0), 404)
  await assert.rejects(downloadBiblePack('NKJV', fetcher), /HTTP 404/)
})

test('an oversized payload is rejected before hashing', async () => {
  const fetcher = stubFetcher(Buffer.alloc(10 * 1024 * 1024 + 1))
  await assert.rejects(downloadBiblePack('NKJV', fetcher), /invalid size/)
})

test('bytes that miss the pinned hash fail the security check', async () => {
  const fetcher = stubFetcher(Buffer.from('tampered-bytes'))
  await assert.rejects(downloadBiblePack('NKJV', fetcher), /security check/)
})

test('a hash-matching but corrupt gzip fails decompression, not install', async () => {
  const payload = Buffer.from('not-gzip-but-hash-matched')
  const fetcher = stubFetcher(payload)
  await assert.rejects(downloadBiblePack('NKJV', fetcher, sha256Hex(payload)), /decompress/)
})

// ─── Success path ─────────────────────────────────────────────────────────────

test('matching bytes gunzip to the SQLite payload', async () => {
  const sqlite = Buffer.from('SQLite format 3\0synthetic-pack-bytes')
  const compressed = gzipSync(sqlite)
  const fetcher = stubFetcher(compressed)
  const result = await downloadBiblePack('NKJV', fetcher, sha256Hex(compressed))
  assert.deepEqual(result, sqlite)
})

test('streamed downloads report measured bytes, then verification', async () => {
  const sqlite = Buffer.from('Synthetic SQLite pack')
  const compressed = gzipSync(sqlite)
  const events: Array<{ phase: string; receivedBytes: number; totalBytes?: number }> = []
  const fetcher = (async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(compressed.subarray(0, 8))
      controller.enqueue(compressed.subarray(8))
      controller.close()
    },
  }), { headers: { 'content-length': String(compressed.length) } })) as typeof fetch
  assert.deepEqual(await downloadBiblePack('NKJV', fetcher, sha256Hex(compressed), p => events.push(p)), sqlite)
  assert.ok(events.some(e => e.phase === 'downloading' && e.receivedBytes === 8))
  assert.equal(events.at(-1)?.phase, 'verifying')
  assert.equal(events.at(-1)?.receivedBytes, compressed.length)
  assert.equal(events.at(-1)?.totalBytes, compressed.length)
})

test('unknown content length stays indeterminate and oversized streams stop early', async () => {
  const compressed = gzipSync(Buffer.from('Synthetic payload'))
  const events: Array<{ totalBytes?: number }> = []
  const fetcher = (async () => new Response(compressed)) as typeof fetch
  await downloadBiblePack('NKJV', fetcher, sha256Hex(compressed), p => events.push(p))
  assert.ok(events.length > 0)
  assert.ok(events.every(e => e.totalBytes === undefined))
  let canceled = false
  const oversized = (async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(6 * 1024 * 1024)) },
    cancel() { canceled = true },
  }))) as typeof fetch
  await assert.rejects(downloadBiblePack('NKJV', oversized), /invalid size/)
  assert.equal(canceled, true)
})

// ─── Temporary files ──────────────────────────────────────────────────────────

test('temporary pack paths are unique, kindsafe and confined to the temp dir', () => {
  const first = temporaryPackPath()
  const second = temporaryPackPath()
  assert.notEqual(first, second)
  for (const candidate of [first, second]) {
    assert.ok(candidate.startsWith(os.tmpdir()))
    assert.match(candidate, /kairo-nkjv-.*\.db$/)
    assert.ok(!candidate.includes('..'))
  }
})

test('temporary pack paths slug the requested translation', () => {
  assert.match(temporaryPackPath('ESV'), /kairo-esv-.*\.db$/)
})
