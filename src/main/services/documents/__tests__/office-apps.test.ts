import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  findAppByBundleId,
  findAppByName,
  findLibreOfficeDesktopBinary,
  isPowerPointAppName,
  parseDesktopExec,
  type OfficeProbes,
} from '../office-apps'

const IMPRESS_DESKTOP = `[Desktop Entry]
Name=LibreOffice Impress
Exec=/opt/libreoffice/program/soffice --impress %U
Type=Application
`

function probes(overrides: OfficeProbes): OfficeProbes {
  return overrides
}

describe('office-apps (darwin)', () => {
  it('finds an installed app by name', async () => {
    const found = await findAppByName(
      isPowerPointAppName,
      probes({
        platform: 'darwin',
        readdir: async (dir: string) =>
          dir === '/Applications' ? ['Microsoft PowerPoint.app', 'Safari.app'] : [],
      }),
    )
    assert.equal(found, '/Applications/Microsoft PowerPoint.app')
  })

  it('returns null when nothing matches', async () => {
    const found = await findAppByName(
      isPowerPointAppName,
      probes({ platform: 'darwin', readdir: async () => ['Safari.app'] }),
    )
    assert.equal(found, null)
  })

  it('skips inaccessible roots', async () => {
    const seen: string[] = []
    const found = await findAppByName(
      isPowerPointAppName,
      probes({
        platform: 'darwin',
        readdir: async (dir: string) => {
          seen.push(dir)
          if (dir === '/Applications') throw new Error('EACCES')
          if (dir.endsWith('Applications') && dir.startsWith('/Users')) {
            return ['Microsoft PowerPoint.app']
          }
          throw new Error('ENOENT')
        },
        homedir: () => '/Users/op',
      }),
    )
    assert.ok(seen.includes('/Applications'))
    assert.equal(found, '/Users/op/Applications/Microsoft PowerPoint.app')
  })

  it('resolves bundle ids via mdfind output', async () => {
    const found = await findAppByBundleId(
      'com.microsoft.Powerpoint',
      probes({
        platform: 'darwin',
        runMdfind: async () => '/Applications/Microsoft PowerPoint.app\n',
      }),
    )
    assert.equal(found, '/Applications/Microsoft PowerPoint.app')
  })

  it('ignores malformed mdfind output', async () => {
    const found = await findAppByBundleId(
      'com.microsoft.Powerpoint',
      probes({ platform: 'darwin', runMdfind: async () => 'not a path\n' }),
    )
    assert.equal(found, null)
  })

  it('returns null when mdfind fails', async () => {
    const found = await findAppByBundleId(
      'com.microsoft.Powerpoint',
      probes({
        platform: 'darwin',
        runMdfind: async () => {
          throw new Error('mdfind failed')
        },
      }),
    )
    assert.equal(found, null)
  })
})

describe('office-apps (non-darwin guards)', () => {
  it('findAppByName is darwin-only', async () => {
    for (const platform of ['win32', 'linux'] as const) {
      const found = await findAppByName(isPowerPointAppName, probes({ platform }))
      assert.equal(found, null)
    }
  })

  it('findAppByBundleId is darwin-only', async () => {
    for (const platform of ['win32', 'linux'] as const) {
      const found = await findAppByBundleId('com.microsoft.Powerpoint', probes({ platform }))
      assert.equal(found, null)
    }
  })

  it('desktop-binary lookup is linux-only', async () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const found = await findLibreOfficeDesktopBinary(probes({ platform }))
      assert.equal(found, null)
    }
  })
})

describe('office-apps (linux .desktop)', () => {
  const files: Record<string, string> = {
    '/usr/share/applications/libreoffice-impress.desktop': IMPRESS_DESKTOP,
    '/usr/share/applications/broken.desktop': '[Desktop Entry]\nName=LibreOffice Impress\nType=Application\n',
    '/usr/share/applications/other.desktop': '[Desktop Entry]\nName=Firefox\nExec=/usr/bin/firefox %u\n',
  }
  const base = probes({
    platform: 'linux',
    readdir: async (dir: string) => {
      if (dir === '/usr/share/applications') return Object.keys(files).map((f) => f.split('/').pop()!)
      throw new Error('ENOENT')
    },
    readFile: async (path: string) => {
      if (path in files) return files[path]
      throw new Error('ENOENT')
    },
    access: async (path: string) => {
      if (path === '/opt/libreoffice/program/soffice') return
      throw new Error('ENOENT')
    },
    homedir: () => '/home/op',
    env: {},
  })

  it('resolves an absolute Exec binary', async () => {
    assert.equal(await findLibreOfficeDesktopBinary(base), '/opt/libreoffice/program/soffice')
  })

  it('skips malformed entries without Exec=', async () => {
    // broken.desktop matches by Name but has no Exec — must not throw or match.
    assert.equal(await findLibreOfficeDesktopBinary(base), '/opt/libreoffice/program/soffice')
  })

  it('returns null when no launcher is registered', async () => {
    const found = await findLibreOfficeDesktopBinary(
      probes({
        platform: 'linux',
        readdir: async () => {
          throw new Error('ENOENT')
        },
        access: async () => {
          throw new Error('ENOENT')
        },
        homedir: () => '/home/op',
        env: {},
      }),
    )
    assert.equal(found, null)
  })

  it('returns bare commands for PATH resolution', async () => {
    const found = await findLibreOfficeDesktopBinary(
      probes({
        platform: 'linux',
        readdir: async () => ['impress.desktop'],
        readFile: async () =>
          '[Desktop Entry]\nName=LibreOffice Impress\nExec=soffice --impress %U\n',
        homedir: () => '/home/op',
        env: {},
      }),
    )
    assert.equal(found, 'soffice')
  })

  it('parses Exec lines', () => {
    assert.equal(parseDesktopExec('/usr/bin/soffice --impress %U'), '/usr/bin/soffice')
    assert.equal(
      parseDesktopExec('"/opt/LibreOffice 24/program/soffice" --impress %U'),
      '/opt/LibreOffice 24/program/soffice',
    )
    assert.equal(
      parseDesktopExec('/opt/LibreOffice\\ 24/program/soffice --impress %U'),
      '/opt/LibreOffice 24/program/soffice',
    )
    assert.equal(parseDesktopExec('soffice'), 'soffice')
    assert.equal(parseDesktopExec(''), null)
  })
})
