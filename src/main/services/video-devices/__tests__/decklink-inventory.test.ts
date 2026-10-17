import { it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeckLinkProvider } from '../providers/decklink'

it('keeps all four reported channels and preserves inactive-profile explanations', { skip: process.platform !== 'darwin' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kairo-decklink-inventory-'))
  try {
    const reason = 'Inactive in the current card profile. Check connector mapping in Desktop Video Setup.'
    const ports = Array.from({ length: 4 }, (_, index) => ({
      id: `decklink:100:${index}`, provider: 'decklink', deviceName: 'DeckLink Duo 2',
      portName: `DeckLink Duo 2 (${index + 1})`, supportsKeyFill: false,
      modes: index < 2 ? [{ id: 'decklink:1', label: '1080p25', width: 1920, height: 1080, frameRateN: 25, frameRateD: 1, interlaced: false }] : [],
      unavailableReason: index < 2 ? null : reason,
    }))
    const helper = join(dir, 'helper')
    writeFileSync(helper, `#!/bin/sh\ncat <<'INVENTORY'\n${JSON.stringify({ version: '15.3.1', ports })}\nINVENTORY\n`, { mode: 0o755 })
    const provider = new DeckLinkProvider(helper, '/unused-worker', dir)
    const inventory = await provider.listPorts()
    assert.equal(inventory.length, 4)
    assert.equal(inventory.filter((port) => !port.unavailableReason).length, 2)
    assert.equal(inventory[2].unavailableReason, reason)
    assert.equal(inventory[3].unavailableReason, reason)
    assert.equal(provider.status().version, '15.3.1')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
