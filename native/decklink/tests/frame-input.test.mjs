import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('frame input reads full and partial packets without starving HD playback', { skip: process.platform !== 'darwin' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'kairo-frame-input-'))
  try {
    const binary = join(dir, 'reader')
    const build = spawnSync('xcrun', ['clang++', '-std=c++17', '-O2', resolve('native/decklink/tests/frame-input.cpp'), '-o', binary], { encoding: 'utf8' })
    assert.equal(build.status, 0, build.stderr)
    // Four HD frames plus a partial component: exercise bulk reads and EOF.
    const input = Buffer.alloc(1920 * 1080 * 4 * 4 + 13, 37)
    const path = join(dir, 'frames.bgra')
    writeFileSync(path, input)
    const fd = openSync(path, 'r')
    let result
    try {
      // Avoid measuring Node spawnSync's slow producer-side pipe pumping.
      result = spawnSync(binary, [], { stdio: [fd, 'pipe', 'pipe'], timeout: 5000 })
    } finally { closeSync(fd) }
    assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message)
    assert.equal(result.stdout.toString().trim(), `${input.length} ${input.length * 37}`)
    // CPU time excludes process startup and scheduling noise. Four frames must
    // use less than their 160 ms playback budget at 25 fps.
    const cpuMs = Number(result.stderr.toString().trim())
    assert.ok(cpuMs < 160, `four HD frames consumed ${cpuMs.toFixed(1)} ms of CPU`)
    const partial = spawnSync(binary, [], { input: Buffer.alloc(17, 37) })
    assert.equal(partial.stdout.toString().trim(), '17 629')
    const empty = spawnSync(binary, [], { input: Buffer.alloc(0) })
    assert.equal(empty.stdout.toString().trim(), '0 0')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
