import assert from 'node:assert/strict'
import test from 'node:test'
import { confirmPresenterOutput } from '../src/lib/presenter-confirmation'
import type { ProPresenterStatus } from '../src/lib/ipc'

const status = (name: string | null): ProPresenterStatus => ({
  state: 'connected', host: 'localhost', port: 50000, version: '19',
  activeSlideId: name ? 'slide:0' : null,
  activePresentationId: name ? 'presentation' : null,
  activePresentationName: name,
  activePlaylistId: null, activePlaylistName: null,
})

test('confirms a library projection when the expected reference becomes active', async () => {
  let reads = 0
  let time = 0
  const level = await confirmPresenterOutput({
    reference: 'John 3:16', successfulKinds: ['library'],
    readStatus: () => status(++reads === 2 ? 'Scripture — John 3:16' : 'Welcome'),
    now: () => time,
    wait: async ms => { time += ms },
  })
  assert.equal(level, 'active-document')
  assert.equal(reads, 2)
})

test('does not pretend non-observable overlay outputs were visibly confirmed', async () => {
  const level = await confirmPresenterOutput({
    reference: 'John 3:16', successfulKinds: ['message'], readStatus: () => status(null),
  })
  assert.equal(level, 'request-accepted')
})

test('times out a library observation as accepted rather than failed', async () => {
  let time = 0
  const level = await confirmPresenterOutput({
    reference: 'Romans 8:28', successfulKinds: ['library'], readStatus: () => status('Welcome'),
    timeoutMs: 150, pollMs: 75, now: () => time, wait: async ms => { time += ms },
  })
  assert.equal(level, 'request-accepted')
})
