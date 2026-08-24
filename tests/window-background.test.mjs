import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('native window background matches the graphite renderer theme', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  assert.match(source, /backgroundColor: '#171717'/)
  assert.doesNotMatch(source, /backgroundColor: '#0d1b2a'/)
})
