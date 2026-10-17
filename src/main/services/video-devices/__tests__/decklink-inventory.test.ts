import { it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeckLinkProvider, driverTooOld } from '../providers/decklink'

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

it('compares Desktop Video versions against the 15.3.1 floor', () => {
  for (const old of ['12.9', '14.4.1', '15.3', '15.2.9']) assert.equal(driverTooOld(old), true, old)
  for (const ok of ['15.3.1', '15.4', '16.4', '', undefined, 'unknown']) assert.equal(driverTooOld(ok), false, String(ok))
})

const withHelper = async (script: string, test: (provider: DeckLinkProvider) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'kairo-decklink-inventory-'))
  try {
    const helper = join(dir, 'helper')
    writeFileSync(helper, `#!/bin/sh\n${script}\n`, { mode: 0o755 })
    await test(new DeckLinkProvider(helper, '/unused-worker', dir))
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

it('names the driver version when Desktop Video is too old for the helper', { skip: process.platform !== 'darwin' }, () =>
  withHelper(`echo '${JSON.stringify({ version: '12.9', ports: [] })}'`, async (provider) => {
    await assert.rejects(provider.listPorts(), /Desktop Video 12\.9 is too old.*15\.3\.1/)
  }))

it('reports the helper message rather than the command line when listing fails', { skip: process.platform !== 'darwin' }, () =>
  withHelper(`echo 'Read card profile (requires Desktop Video 15.3.1 or newer): SDK error -1' >&2; exit 1`, async (provider) => {
    await assert.rejects(provider.listPorts(), (error: Error) =>
      error.message === 'Read card profile (requires Desktop Video 15.3.1 or newer): SDK error -1')
  }))

it('reports compatibility mode for a supported older runtime without requiring an update', { skip: process.platform !== 'darwin' }, () =>
  withHelper(`echo '${JSON.stringify({ version: '15.3.1', compatibilityMode: true, ports: [] })}'`, async (provider) => {
    await provider.listPorts()
    assert.equal(provider.status().driver?.state, 'compatibility')
    assert.match(provider.status().driver?.message ?? '', /15\.3\.1.*compatibility mode/)
  }))

it('retains the unsupported version and update advice even when enumeration fails', { skip: process.platform !== 'darwin' }, () =>
  withHelper(`if [ "$1" = '--version' ]; then echo '{"version":"14.4"}'; else echo 'Read card profile: SDK error -1' >&2; exit 1; fi`, async (provider) => {
    await assert.rejects(provider.listPorts(), /Desktop Video 14\.4.*Update/)
    assert.equal(provider.status().version, '14.4')
    assert.equal(provider.status().driver?.state, 'unsupported')
  }))

it('does not recommend updating a current driver because no cards were found', { skip: process.platform !== 'darwin' }, () =>
  withHelper(`echo '{"version":"16.4","compatibilityMode":false,"ports":[]}'`, async (provider) => {
    await provider.listPorts()
    assert.equal(provider.status().driver?.state, 'current')
    assert.doesNotMatch(provider.status().driver?.message ?? '', /[Uu]pdate/)
  }))

it('preserves a supported-driver scan failure without recommending an update', { skip: process.platform !== 'darwin' }, async () => {
  for (const version of ['15.3.1', '16.4']) {
    await withHelper(`if [ "$1" = '--version' ]; then echo '{"version":"${version}"}'; else echo 'Read modes: SDK error -1' >&2; exit 1; fi`, async (provider) => {
      await assert.rejects(provider.listPorts(), (error: Error) => error.message === 'Read modes: SDK error -1')
      assert.equal(provider.status().version, version)
      assert.equal(provider.status().driver?.state, 'current')
      assert.doesNotMatch(provider.status().driver?.message ?? '', /[Uu]pdate|compatibility mode/)
    })
  }
})
