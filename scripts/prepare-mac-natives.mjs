#!/usr/bin/env node
/**
 * Native pieces every macOS build bundles (see package.json mac.extraResources):
 *
 * - gpu-frames addon (plan 008) — built every time; needs only Xcode.
 * - DeckLink helper (plan 007) — compiling it needs the Blackmagic DeckLink
 *   SDK, which may not be committed or put on CI. So the compiled, universal
 *   helper is committed in native/decklink/prebuilt/ with a hash of the
 *   sources it came from:
 *     · DECKLINK_SDK_PATH set → build it and refresh prebuilt/ (commit that).
 *     · otherwise → use prebuilt/, but only if the sources still match it.
 *   A build never ships without the helper, or with one older than its code.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const BUILT = 'native/decklink/build/decklink-helper'
const PREBUILT = 'native/decklink/prebuilt/decklink-helper'
const PREBUILT_SOURCE = 'native/decklink/prebuilt/SOURCE_SHA256'
/** Everything compiled into the helper that lives in this repo. */
const SOURCES = [
  'native/decklink/helper.cpp',
  'native/decklink/compatibility.h',
  'native/decklink/sdk-compatibility.h',
  'native/decklink/frame-input.h',
  'native/decklink/uyvy.h',
  'native/gpu-frames/ring.h',
  'native/decklink/build.mjs',
]

const run = (args) => {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const fail = (lines) => { console.error(['prepare-mac-natives:', ...lines].join('\n')); process.exit(1) }
const sourceHash = () => {
  const hash = createHash('sha256')
  // Normalise line endings so a Windows checkout of the sources hashes the same.
  for (const file of SOURCES) hash.update(file).update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
  return hash.digest('hex')
}

if (process.platform !== 'darwin') {
  console.log('prepare-mac-natives: not macOS — nothing to do')
  process.exit(0)
}

run(['native/gpu-frames/build.mjs'])

if (process.env.DECKLINK_SDK_PATH) {
  run(['native/decklink/build.mjs'])
  mkdirSync('native/decklink/prebuilt', { recursive: true })
  copyFileSync(BUILT, PREBUILT)
  writeFileSync(PREBUILT_SOURCE, `${sourceHash()}\n`)
  console.log(`prepare-mac-natives: refreshed ${PREBUILT} — commit it so release builds use this helper.`)
} else {
  if (!existsSync(PREBUILT) || !existsSync(PREBUILT_SOURCE)) {
    fail([
      'no prebuilt DeckLink helper, so this build would ship without video card outputs.',
      'Build it once with the Blackmagic DeckLink SDK (free from Blackmagic), then commit native/decklink/prebuilt/:',
      '',
      "  DECKLINK_SDK_PATH='/path/to/Blackmagic DeckLink SDK 16.0' npm run prepare:mac-natives",
    ])
  }
  if (readFileSync(PREBUILT_SOURCE, 'utf8').trim() !== sourceHash()) {
    fail([
      'the DeckLink helper source changed since native/decklink/prebuilt/ was built.',
      'Rebuild it on a Mac with the SDK and commit the result:',
      '',
      "  DECKLINK_SDK_PATH='/path/to/Blackmagic DeckLink SDK 16.0' npm run prepare:mac-natives",
    ])
  }
  mkdirSync('native/decklink/build', { recursive: true })
  copyFileSync(PREBUILT, BUILT)
  console.log(`prepare-mac-natives: using ${PREBUILT} (matches the current helper source)`)
}

// The helper must run on both Apple Silicon and Intel builds.
const lipo = spawnSync('lipo', ['-archs', BUILT], { encoding: 'utf8' })
const archs = lipo.stdout.trim().split(/\s+/)
if (!archs.includes('arm64') || !archs.includes('x86_64')) {
  fail([`${BUILT} is ${archs.join(', ') || 'unreadable'}; rebuild it universal with DECKLINK_SDK_PATH set.`])
}
