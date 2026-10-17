import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('native interface fallback preserves current drivers, supports legacy, and explains missing ports', { skip: process.platform !== 'darwin' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'kairo-decklink-compat-'))
  try {
    const binary = join(dir, 'compatibility')
    const build = spawnSync('xcrun', ['clang++', '-std=c++17', '-Wall', '-Wextra', resolve('native/decklink/tests/compatibility.cpp'), '-o', binary], { encoding: 'utf8' })
    assert.equal(build.status, 0, build.stderr)
    const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('SDK adapters write frames and read profile attributes with both COM layouts', {
  skip: process.platform !== 'darwin' || !process.env.DECKLINK_SDK_PATH,
}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'kairo-decklink-sdk-compat-'))
  try {
    const binary = join(dir, 'sdk-compatibility')
    const build = spawnSync('xcrun', ['clang++', '-std=c++17', '-Wall', '-Wextra',
      '-I', join(process.env.DECKLINK_SDK_PATH, 'Mac/include'),
      resolve('native/decklink/tests/sdk-compatibility.cpp'),
      join(process.env.DECKLINK_SDK_PATH, 'Mac/include/DeckLinkAPIDispatch.cpp'),
      '-framework', 'CoreFoundation', '-o', binary], { encoding: 'utf8' })
    assert.equal(build.status, 0, build.stderr)
    const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
