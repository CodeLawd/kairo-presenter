import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_OVERLAY_SETTINGS, makeOverlayOutput, normalizeOverlaySettings } from '../src/lib/overlay-defaults'
import { createOutputSettingsWriter } from '../src/lib/output-settings'
import { assignThemeToOutput, createCustomTheme, syncThemeToOutputs } from '../src/lib/theme-library'

test('a later theme save keeps a newly added video output and its binding across reload', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kairo-screen-settings-'))
  try {
    const path = join(dir, 'settings.json')
    const theme = createCustomTheme('Sunday', DEFAULT_OVERLAY_SETTINGS.theme, 'scripture', 1, 'sunday')
    let overlay = normalizeOverlaySettings({ ...DEFAULT_OVERLAY_SETTINGS, outputs: [assignThemeToOutput(makeOverlayOutput('screen', 'screen'), theme)] })
    writeFileSync(path, JSON.stringify(overlay))
    const write = createOutputSettingsWriter({
      read: () => overlay,
      publish: (next) => { overlay = normalizeOverlaySettings(next) },
      persist: async (patch) => { writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), ...patch })) },
    })
    const card = makeOverlayOutput('card', 'device', { name: 'Video hub', enabled: true, devicePortId: 'decklink:123:3', deviceModeId: 'decklink:1080', devicePortLabel: 'Duo 2 (4)' })
    await write((outputs) => [...outputs, card])
    // A theme edit scheduled before the screen modal opened must read at save time.
    const edited = { ...theme, theme: { ...theme.theme, verse: { ...theme.theme.verse, color: '#123456' } } }
    await write((outputs) => syncThemeToOutputs(outputs, edited))
    const restored = normalizeOverlaySettings(JSON.parse(readFileSync(path, 'utf8')))
    assert.equal(restored.outputs.length, 2)
    assert.equal(restored.outputs.find((o) => o.id === 'card')?.devicePortId, 'decklink:123:3')
    assert.equal(restored.outputs.find((o) => o.id === 'card')?.deviceModeId, 'decklink:1080')
    assert.equal(restored.outputs.find((o) => o.id === 'card')?.name, 'Video hub')
    assert.equal(restored.outputs.find((o) => o.id === 'screen')?.theme.verse.color, '#123456')
    await write((outputs) => outputs.filter((o) => o.id !== 'card'))
    await write((outputs) => syncThemeToOutputs(outputs, theme))
    assert.equal(normalizeOverlaySettings(JSON.parse(readFileSync(path, 'utf8'))).outputs.some((o) => o.id === 'card'), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('deleting the final screen stays deleted after repeated normalization and reload', () => {
  const saved = { ...DEFAULT_OVERLAY_SETTINGS, outputs: [] }
  assert.deepEqual(normalizeOverlaySettings(saved).outputs, [])
  const feedOnly = { ...saved, outputs: [makeOverlayOutput('feed', 'ndi')] }
  assert.deepEqual(normalizeOverlaySettings(JSON.parse(JSON.stringify(feedOnly))).outputs.map((o) => o.id), ['feed'])
})

test('a failed screen save is rejected and rolls back its optimistic list', async () => {
  let overlay = normalizeOverlaySettings(DEFAULT_OVERLAY_SETTINGS)
  const before = structuredClone(overlay.outputs)
  const write = createOutputSettingsWriter({ read: () => overlay, publish: (next) => { overlay = next }, persist: async () => { throw new Error('Disk full') } })
  await assert.rejects(write((outputs) => [...outputs, makeOverlayOutput('card', 'device')]), /Disk full/)
  assert.deepEqual(overlay.outputs, before)
})

test('two overlapping failed saves restore the last confirmed screen list', async () => {
  let overlay = normalizeOverlaySettings({ ...DEFAULT_OVERLAY_SETTINGS, outputs: [makeOverlayOutput('a', 'screen')] })
  const reject: Array<(error: Error) => void> = []
  const write = createOutputSettingsWriter({ read: () => overlay, publish: (next) => { overlay = next }, persist: () => new Promise((_, fail) => { reject.push(fail) }) })
  const first = write((outputs) => [...outputs, makeOverlayOutput('b', 'device')])
  const second = write((outputs) => [...outputs, makeOverlayOutput('c', 'device')])
  const settled = Promise.allSettled([first, second])
  reject[0](new Error('Disk full'))
  reject[1](new Error('Disk full'))
  await settled
  assert.deepEqual(overlay.outputs.map((o) => o.id), ['a'])
})
