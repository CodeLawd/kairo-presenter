import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
const helper = resolve('native/decklink/build/decklink-helper')
test('native self-test validates hardware clock recovery and pixel conversion', () => {
  const result = spawnSync(helper, ['--self-test'], { encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  assert.equal(JSON.parse(result.stdout).ok, true)
})
test('invalid probe arguments never acquire hardware', () => {
  const result = spawnSync(helper, ['--probe', 'invalid', 'invalid', '-1'], { encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /Invalid/)
})
test('partial numeric duration is rejected before touching hardware', () => {
  const result = spawnSync(helper, ['--probe', 'decklink:1:0', 'decklink:1', '2oops'], { encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 2)
})
