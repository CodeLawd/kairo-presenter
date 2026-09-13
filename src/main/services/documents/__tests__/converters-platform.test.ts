import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { encodePowerShellTransport, firstAvailableCommand } from '../converters'

describe('Windows PowerShell path transport', () => {
  it('round-trips paths without embedding PowerShell expressions in source', () => {
    const hostile = 'C:\\Media\\$(Start-Process calc)`whoami`.pptx'
    const encoded = encodePowerShellTransport(hostile)

    assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), hostile)
    assert.doesNotMatch(encoded, /\$\(|`|Start-Process|whoami/)
  })
})

describe('platform command fallback', () => {
  it('tries later command names after an earlier lookup misses', async () => {
    const seen: string[] = []
    const found = await firstAvailableCommand(['wpp', 'wps'], async (name) => {
      seen.push(name)
      return name === 'wps' ? '/usr/bin/wps' : null
    })

    assert.equal(found, '/usr/bin/wps')
    assert.deepEqual(seen, ['wpp', 'wps'])
  })

  it('stops after the first available command', async () => {
    const seen: string[] = []
    const found = await firstAvailableCommand(['soffice', 'libreoffice'], async (name) => {
      seen.push(name)
      return `/usr/bin/${name}`
    })

    assert.equal(found, '/usr/bin/soffice')
    assert.deepEqual(seen, ['soffice'])
  })
})
