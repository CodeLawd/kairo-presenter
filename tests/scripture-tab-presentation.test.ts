import assert from 'node:assert/strict'
import test from 'node:test'
import { pushScriptureFromTab } from '../src/lib/scripture-tab-presentation'
import type { ScriptureSuggestion } from '../src/lib/ipc'

test('a Scripture-tab push goes live without entering detected content', async () => {
  const detected: ScriptureSuggestion[] = []
  const presented: ScriptureSuggestion[] = []
  const suggestion: ScriptureSuggestion = {
    id: 'manual-1',
    reference: 'Psalms 2:3',
    verses: [{ book: 'Psalms', chapter: 2, verse: 3, text: 'Verse text' }],
    translation: 'NKJV',
    confidence: 1,
    source: 'manual',
    triggerText: 'Psalms 2:3',
  }

  await pushScriptureFromTab({
    presentDirectly: async (value) => { presented.push(value) },
    register: async (value) => { detected.push(value) },
    approve: async () => undefined,
  }, suggestion)

  assert.deepEqual(presented, [suggestion])
  assert.deepEqual(detected, [])
})
