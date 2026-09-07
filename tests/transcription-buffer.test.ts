import assert from 'node:assert/strict'
import test from 'node:test'
import { TranscriptionBuffer } from '../src/main/services/stt/buffer'

test('a trigger consumes the dirty context instead of scheduling it twice', async () => {
  const buffer = new TranscriptionBuffer({ analyzeIntervalSeconds: 0.01 })
  try {
    let analyses = 0
    buffer.on('analyzeReady', () => { analyses++ })
    buffer.push({ id: 'one', text: 'turn to Psalm 115 verses two to thirteen', timestamp: Date.now(), duration: 2, words: [], isFinal: true })
    assert.equal(analyses, 1)
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(analyses, 1)
  } finally { buffer.destroy() }
})
