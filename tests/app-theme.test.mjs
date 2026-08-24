import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('the app hydrates the saved display theme at startup', async () => {
  const source = await readFile(new URL('../src/renderer/src/App.tsx', import.meta.url), 'utf8')
  assert.match(source, /applyAppTheme\(settings\.display\.theme\)/)
})

test('settings applies appearance changes immediately', async () => {
  const source = await readFile(
    new URL('../src/renderer/src/components/settings/Settings.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /const theme = partial\.theme[\s\S]*?applyAppTheme\(theme\)/)
  assert.match(source, /window\.api\.settings\.set\('display', nextSection/)
})

test('the stylesheet defines complete light surface and text tokens', async () => {
  const source = await readFile(new URL('../src/renderer/src/index.css', import.meta.url), 'utf8')
  assert.match(source, /\[data-theme='light'\]/)
  assert.match(source, /--surface: 250 250 250/)
  assert.match(source, /--text-primary: 24 24 27/)
})

test('light mode raises muted and semantic text to readable contrast', async () => {
  const source = await readFile(new URL('../src/renderer/src/index.css', import.meta.url), 'utf8')

  assert.match(source, /\[data-theme='light'\] \.text-slate-500[\s\S]*?color: #62626b/)
  assert.match(source, /\[data-theme='light'\] \.text-slate-600[\s\S]*?color: #52525b/)
  assert.match(source, /\[data-theme='light'\] \.text-yellow-400[\s\S]*?color: #92400e/)
  assert.match(source, /\[data-theme='light'\] \.text-teal-400[\s\S]*?color: #b54720/)
})
