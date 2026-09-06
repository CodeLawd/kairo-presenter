import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('native window lets the desktop show through glass panes', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  assert.match(source, /vibrancy: 'under-window'/)
  assert.match(source, /backgroundColor: '#00000000'/)
  assert.doesNotMatch(source, /backgroundColor: '#0d1b2a'/)
})
