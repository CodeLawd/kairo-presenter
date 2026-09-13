import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BibleDatabase } from '../bible-db'
import { ScriptureService } from '../index'
import type { ApiBibleClient } from '../api-bible-client'
import { IPC } from '../../../../lib/ipc'
import {
  FIXTURE_MARKER,
  buildFixtureSource,
  buildFixtureVerses,
  markFixtureSource,
} from './local-bible-pack-fixture'
import { parseNkjvSource } from '../../../../../scripts/build-bible-pack'

const ROOT = path.resolve(__dirname, '../../../../..')
const read = (relative: string): string => fs.readFileSync(path.join(ROOT, relative), 'utf8')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function serviceWithLocalNkjv(dir: string): { service: ScriptureService; db: BibleDatabase } {
  const db = new BibleDatabase(path.join(dir, 'bible.db'))
  const source = buildFixtureSource()
  markFixtureSource(source, 43, 3, 16, `${FIXTURE_MARKER} covenant of testing`)
  const { rows } = parseNkjvSource(source)
  db.importTranslationPack('NKJV', 'Synthetic Fixture Translation', 'en', rows)
  const service = new ScriptureService()
  Object.assign(service, { db })
  return { service, db }
}

function serviceWithEmptyDb(dir: string): { service: ScriptureService; db: BibleDatabase } {
  const db = new BibleDatabase(path.join(dir, 'bible.db'))
  const service = new ScriptureService()
  Object.assign(service, { db })
  return { service, db }
}

/** A counting API.Bible stub. Any method call is recorded for assertions. */
function stubApiClient(calls: string[], searchHits: Array<Record<string, unknown>> = []) {
  return {
    async listBibles() {
      calls.push('listBibles')
      return [{ id: 'bible-nkjv-01', abbreviationLocal: 'NKJV' }]
    },
    async search() {
      calls.push('search')
      return searchHits
    },
  } as unknown as ApiBibleClient
}

// ─── Local-first routing ──────────────────────────────────────────────────────

test('local NKJV reference lookup makes zero API calls even with a key set', async () => {
  const dir = tmpDir('kairo-route-ref-')
  const { service, db } = serviceWithLocalNkjv(dir)
  try {
    const calls: string[] = []
    service.setClientFactoryForTesting(() => stubApiClient(calls))

    const results = await service.search('John 3:16', 'NKJV', 'api-key-set')
    assert.equal(results.length, 1)
    assert.equal(results[0]?.translation, 'NKJV')
    assert.match(results[0]?.verses[0]?.text ?? '', new RegExp(FIXTURE_MARKER))
    assert.deepEqual(calls, [], 'no API.Bible method may be called for a local NKJV lookup')
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('local NKJV phrase search makes zero API calls even with a key set', async () => {
  const dir = tmpDir('kairo-route-phrase-')
  const { service, db } = serviceWithLocalNkjv(dir)
  try {
    const calls: string[] = []
    service.setClientFactoryForTesting(() => stubApiClient(calls))

    const results = await service.search(`${FIXTURE_MARKER} covenant`, 'NKJV', 'api-key-set')
    assert.ok(results.length > 0)
    assert.equal(results[0]?.translation, 'NKJV')
    assert.deepEqual(calls, [], 'no API.Bible method may be called for a local NKJV phrase search')
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('local NKJV needs no API key for reference or phrase search', async () => {
  const dir = tmpDir('kairo-route-nokey-')
  const { service, db } = serviceWithLocalNkjv(dir)
  try {
    const calls: string[] = []
    service.setClientFactoryForTesting(() => stubApiClient(calls))

    const ref = await service.search('John 3:16', 'NKJV', '')
    assert.equal(ref.length, 1)
    const phrase = await service.search(`${FIXTURE_MARKER} covenant`, 'NKJV', '')
    assert.ok(phrase.length > 0)
    assert.deepEqual(calls, [])
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('API.Bible fallback still serves NKJV when no local copy exists', async () => {
  const dir = tmpDir('kairo-route-fallback-')
  const { service, db } = serviceWithEmptyDb(dir)
  try {
    const calls: string[] = []
    service.setClientFactoryForTesting(() =>
      stubApiClient(calls, [
        {
          id: 'JHN.3.16',
          reference: 'John 3:16',
          text: 'Synthetic API fallback verse text.',
          bookId: 'JHN',
          chapter: 3,
          verse: 16,
        },
      ]),
    )

    const results = await service.search('grace upon grace remembered words', 'NKJV', 'api-key-set')
    assert.equal(results.length, 1)
    assert.equal(results[0]?.translation, 'NKJV')
    assert.equal(results[0]?.verses[0]?.text, 'Synthetic API fallback verse text.')
    assert.ok(calls.includes('search'), 'absent local NKJV must fall back to API.Bible')
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('NKJV is available without a key once installed, unavailable before', async () => {
  const dir = tmpDir('kairo-route-avail-')
  const { service, db } = serviceWithEmptyDb(dir)
  try {
    const before = await service.getTranslationOptions()
    const nkjvBefore = before.find((option) => option.id === 'NKJV')
    assert.equal(nkjvBefore?.available, false)

    const source = buildFixtureSource()
    const { rows } = parseNkjvSource(source)
    db.importTranslationPack('NKJV', 'Synthetic Fixture Translation', 'en', rows)

    const after = await service.getTranslationOptions()
    const nkjvAfter = after.find((option) => option.id === 'NKJV')
    assert.equal(nkjvAfter?.available, true)
    assert.equal(nkjvAfter?.requiresApiKey, false)
    // The static catalog keeps NKJV as API-capable so fallback keeps working.
    assert.equal(nkjvAfter?.access, 'api')
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('isLocalTranslation reflects the installed NKJV', () => {
  const dir = tmpDir('kairo-route-localflag-')
  const { service, db } = serviceWithEmptyDb(dir)
  try {
    assert.equal(service.isLocalTranslation('NKJV'), false)
    db.importTranslationPack('NKJV', 'Fixture', 'en', buildFixtureVerses())
    assert.equal(service.isLocalTranslation('NKJV'), true)
    assert.equal(service.isLocalTranslation('NIV'), false)
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ─── IPC / preload / type contract ────────────────────────────────────────────

const LOCAL_PACK_OPERATIONS = [
  ['INSTALL_LOCAL_BIBLE_PACK', 'installLocalBiblePack'],
  ['GET_LOCAL_BIBLE_PACK_STATUS', 'getLocalBiblePackStatus'],
  ['REMOVE_LOCAL_BIBLE_TRANSLATION', 'removeLocalBibleTranslation'],
  ['DOWNLOAD_LOCAL_BIBLE_TRANSLATION', 'downloadLocalBibleTranslation'],
] as const

test('every local-pack operation has an IPC channel', () => {
  for (const [constant] of LOCAL_PACK_OPERATIONS) {
    const channel = (IPC.SCRIPTURE as Record<string, string>)[constant]
    assert.ok(channel, `IPC.SCRIPTURE.${constant} is missing`)
    assert.match(channel, /^scripture:/)
  }
})

test('ScriptureAPI exposes a zero-argument picker-only local-pack install', () => {
  const source = read('src/lib/ipc.ts')
  const api = source.slice(source.indexOf('export interface ScriptureAPI'))
  assert.ok(api.includes('installLocalBiblePack:'), 'ScriptureAPI.installLocalBiblePack is missing')
  assert.ok(api.includes('getLocalBiblePackStatus:'), 'ScriptureAPI.getLocalBiblePackStatus is missing')
  assert.ok(api.includes('removeLocalBibleTranslation:'), 'ScriptureAPI.removeLocalBibleTranslation is missing')
  assert.match(api, /installLocalBiblePack: \(\) => Promise<LocalBiblePackInstallResult \| null>/)
  assert.ok(!api.includes('filePath?: string'), 'renderer must not be allowed to choose an arbitrary path')
  assert.match(api, /getLocalBiblePackStatus: \(translation: string\) => Promise<LocalBiblePackStatus>/)
  assert.match(api, /removeLocalBibleTranslation: \(translation: string\) => Promise<LocalBiblePackStatus>/)
  assert.match(api, /downloadLocalBibleTranslation: \(translation: string\) => Promise<LocalBiblePackInstallResult>/)

  for (const forbidden of ['packPath', 'absolutePath', 'filePaths']) {
    assert.ok(!api.includes(forbidden), `ScriptureAPI leaks a path via ${forbidden}`)
  }
  const interfaceBody = (name: string): string => {
    const start = source.indexOf(`export interface ${name} {`)
    assert.ok(start >= 0, `${name} is missing`)
    const end = source.indexOf('\n}', start)
    return source.slice(start, end)
  }
  const status = interfaceBody('LocalBiblePackStatus')
  assert.ok(!status.includes('path'), 'LocalBiblePackStatus must not carry a filesystem path')
  const result = interfaceBody('LocalBiblePackInstallResult')
  assert.ok(!result.includes('path'), 'LocalBiblePackInstallResult must not carry a filesystem path')
})

test('the preload bridges every local-pack operation', () => {
  const preload = read('src/preload/index.ts')
  for (const [constant] of LOCAL_PACK_OPERATIONS) {
    assert.ok(preload.includes(`IPC.SCRIPTURE.${constant}`), `preload does not use ${constant}`)
  }
})

test('the main process handles every local-pack invoke channel', () => {
  const handlers = read('src/main/ipc/index.ts')
  for (const [constant] of LOCAL_PACK_OPERATIONS) {
    assert.ok(handlers.includes(`IPC.SCRIPTURE.${constant}`), `no handler for ${constant}`)
  }
  // The native picker runs in main; the renderer never picks a filesystem path.
  assert.ok(handlers.includes('dialog.showOpenDialog'), 'install must use a main-process native picker')
  assert.ok(!handlers.includes('filePath?: string'), 'install handler must not accept a renderer path')
  assert.ok(handlers.includes('if (result.canceled || !result.filePaths[0]) return null'))
  const settingsUi = read('src/renderer/src/components/settings/LocalBiblePackManager.tsx')
  assert.ok(settingsUi.includes('installLocalBiblePack()'), 'renderer installs without passing a path')
  assert.ok(!settingsUi.includes('showOpenDialog'), 'renderer must not touch the file dialog')
})

test('selecting unavailable NKJV starts the one-click download flow', () => {
  const settings = read('src/renderer/src/components/settings/Settings.tsx')
  assert.ok(settings.includes('downloadLocalBibleTranslation'), 'translation picker must download NKJV')
  assert.ok(settings.includes('Download and use NKJV'), 'user must confirm the one-time download')
})

test('NKJV keeps its API-capable catalog entry for fallback', () => {
  const service = read('src/main/services/scripture/index.ts')
  assert.ok(
    service.includes("['NKJV', 'New King James Version', 'api']"),
    'NKJV must stay api-capable in the static catalog',
  )
})

// ─── Installer / package configuration ────────────────────────────────────────

test('packaging never bundles the NKJV source or a generated pack', () => {
  const pkg = JSON.parse(read('package.json')) as {
    build: { extraResources: Array<{ from: string; to: string }>; files?: string[] }
  }

  const resourceSources = pkg.build.extraResources.map((entry) => entry.from)
  assert.deepEqual(resourceSources, ['resources/bible.db', 'resources/icon.png'])

  const buildJson = JSON.stringify(pkg.build)
  assert.ok(!/nkjv/i.test(buildJson), 'build config must not mention NKJV')
  assert.ok(!/bible-packs/i.test(buildJson), 'build config must not mention the pack output dir')

  const gitignore = read('.gitignore')
  assert.ok(gitignore.includes('bible-packs/'), 'generated packs must be gitignored')

  const resourceFiles = fs.readdirSync(path.join(ROOT, 'resources'))
  assert.ok(
    !resourceFiles.some((name) => /pack\.db$/i.test(name) || /nkjv/i.test(name)),
    `resources/ must not hold a pack: ${resourceFiles.join(', ')}`,
  )
})
