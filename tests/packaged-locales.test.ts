import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { build } = require('../package.json')
const { Platform } = require('app-builder-lib')
const { createElectronFrameworkSupport } = require('app-builder-lib/out/electron/ElectronFramework')
const afterPack = require('../scripts/after-pack.cjs').default

test('Windows packaging retains the English locale needed by Blink text layout', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kairo-locales-'))
  try {
    await mkdir(path.join(dir, 'locales'))
    await writeFile(path.join(dir, 'electron.exe'), '')
    for (const locale of ['en-US', 'en-GB', 'fr']) {
      await writeFile(path.join(dir, 'locales', `${locale}.pak`), 'locale fixture')
    }
    const framework = await createElectronFrameworkSupport({ electronVersion: '33.4.11' }, {})
    // Run the actual packager's rename/pruning step with Kairo's configuration.
    await framework.beforeCopyExtraFiles({
      appOutDir: dir,
      packager: {
        config: build,
        platformSpecificBuildOptions: build.win,
        platform: Platform.WINDOWS,
        appInfo: { productFilename: 'Kairo' },
        getResourcesDir: () => path.join(dir, 'resources'),
      },
    })
    assert.ok((await stat(path.join(dir, 'locales', 'en-US.pak'))).size > 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

for (const platform of ['win32', 'linux']) {
  test(`${platform} package hook rejects missing or empty English locale resources`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kairo-locale-guard-'))
    try {
      // Satisfy the existing native payload check so this isolates locale validation.
      await mkdir(path.join(dir, 'resources', 'app.asar.unpacked', 'node_modules', '@grandi', `${platform}-x64`), { recursive: true })
      const context = { electronPlatformName: platform, arch: 1, appOutDir: dir }
      await assert.rejects(afterPack(context), /en-US\.pak/)
      await mkdir(path.join(dir, 'locales'))
      await writeFile(path.join(dir, 'locales', 'en-US.pak'), '')
      await assert.rejects(afterPack(context), /en-US\.pak/)
      await writeFile(path.join(dir, 'locales', 'en-US.pak'), 'locale fixture')
      await afterPack(context)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}
