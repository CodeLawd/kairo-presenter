import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  bundleFromExecutable,
  isAdhocSignature,
  pickMacZip,
  releaseAssetUrl,
  SWAP_SCRIPT,
} from '../src/main/services/updater/mac-self-update'

// The real latest-mac.yml from v1.0.2, as the merged release publishes it.
const FILES = [
  { url: 'Kairo-1.0.2-arm64-mac.zip', sha512: 'a', size: 1 },
  { url: 'Kairo-1.0.2-arm64.dmg', sha512: 'b', size: 1 },
  { url: 'Kairo-1.0.2-mac.zip', sha512: 'c', size: 1 },
  { url: 'Kairo-1.0.2.dmg', sha512: 'd', size: 1 },
]

test('picks the zip for this architecture, never a dmg', () => {
  assert.equal(pickMacZip(FILES, 'arm64')?.url, 'Kairo-1.0.2-arm64-mac.zip')
  assert.equal(pickMacZip(FILES, 'x64')?.url, 'Kairo-1.0.2-mac.zip')
  assert.equal(pickMacZip(FILES.filter((f) => !f.url.endsWith('.zip')), 'arm64'), null)
})

test('builds release URLs and refuses anything else', () => {
  assert.equal(
    releaseAssetUrl('1.0.3', 'Kairo-1.0.3-arm64-mac.zip'),
    'https://github.com/CodeLawd/kairo-presenter/releases/download/v1.0.3/Kairo-1.0.3-arm64-mac.zip',
  )
  const absolute = 'https://github.com/CodeLawd/kairo-presenter/releases/download/v1.0.3/Kairo.zip'
  assert.equal(releaseAssetUrl('1.0.3', absolute), absolute)
  assert.throws(() => releaseAssetUrl('1.0.3', 'https://evil.example/Kairo.zip'), /unexpected address/)
  assert.throws(() => releaseAssetUrl('1.0.3', '../secrets.zip'), /Unexpected update file/)
  assert.throws(() => releaseAssetUrl('1.0.3/../x', 'a.zip'), /Unexpected version/)
})

test('reads an ad-hoc signature from codesign output', () => {
  assert.equal(isAdhocSignature('Executable=/Applications/Kairo.app\nSignature=adhoc\nTeamIdentifier=not set'), true)
  assert.equal(
    isAdhocSignature('Authority=Developer ID Application: Kairo (ABCDE12345)\nTeamIdentifier=ABCDE12345'),
    false,
  )
})

test('finds the bundle from the executable path', () => {
  assert.equal(bundleFromExecutable('/Applications/Kairo.app/Contents/MacOS/Kairo'), '/Applications/Kairo.app')
  assert.equal(bundleFromExecutable('/usr/local/bin/node'), null)
})

test('the swap script replaces the bundle, and puts the old one back if the move fails', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'kairo-swap-'))
  const script = join(root, 'swap.sh')
  writeFileSync(script, SWAP_SCRIPT)

  const installed = join(root, 'Applications', 'Kairo.app')
  mkdirSync(installed, { recursive: true })
  writeFileSync(join(installed, 'version'), 'old')
  const staging = join(root, 'staging')
  const fresh = join(staging, 'Kairo.app')
  mkdirSync(fresh, { recursive: true })
  writeFileSync(join(fresh, 'version'), 'new')

  // PID 999999 is not running, so it swaps straight away; "0" = no relaunch.
  const ok = spawnSync('/bin/bash', [script, '999999', installed, fresh, '0'])
  assert.equal(ok.status, 0)
  assert.equal(readFileSync(join(installed, 'version'), 'utf8'), 'new')
  assert.equal(existsSync(staging), false, 'staging folder is cleaned up')
  assert.equal(execFileSync('ls', [join(root, 'Applications')]).toString().trim(), 'Kairo.app', 'no backup left behind')

  // A new bundle that does not exist: the old one must survive.
  spawnSync('/bin/bash', [script, '999999', installed, join(root, 'missing', 'Kairo.app'), '0'])
  assert.equal(readFileSync(join(installed, 'version'), 'utf8'), 'new')
})
