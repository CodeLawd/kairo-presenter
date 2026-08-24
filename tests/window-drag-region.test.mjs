import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('the application shell exposes a draggable top bar', async () => {
  const appSource = await readFile(
    new URL('../src/renderer/src/App.tsx', import.meta.url),
    'utf8',
  )

  assert.match(appSource, /<AppShell/)
})

test('operator is the default workspace', async () => {
  const appSource = await readFile(
    new URL('../src/renderer/src/App.tsx', import.meta.url),
    'utf8',
  )

  assert.match(appSource, /useState<NavRoute>\('operator'\)/)
})

test('the shell keeps workspaces, health, and output safety visible', async () => {
  const shellSource = await readFile(
    new URL('../src/renderer/src/components/layout/AppShell.tsx', import.meta.url),
    'utf8',
  ).catch(() => '')

  for (const label of ['Operator', 'Scripture', 'Lyrics', 'Theme', 'ProPresenter', 'Audio', 'Automation', 'Clear output']) {
    assert.match(shellSource, new RegExp(label))
  }
})
