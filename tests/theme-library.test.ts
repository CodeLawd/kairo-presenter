import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_OVERLAY_THEME } from '../src/lib/overlay-defaults'
import { createCustomTheme, normalizeThemeLibrary } from '../src/lib/theme-library'

test('creates a named custom theme with an independent theme snapshot', () => {
  const source = structuredClone(DEFAULT_OVERLAY_THEME)
  const saved = createCustomTheme('  Sunday Warmth  ', source, 1234, 'theme-1')

  assert.equal(saved.id, 'theme-1')
  assert.equal(saved.name, 'Sunday Warmth')
  assert.equal(saved.createdAt, 1234)
  assert.deepEqual(saved.theme, source)
  source.verse.color = '#000000'
  assert.notEqual(saved.theme.verse.color, source.verse.color)
})

test('migrates the active legacy theme into My current theme', () => {
  const active = structuredClone(DEFAULT_OVERLAY_THEME)
  active.background.color = '#123456'

  const library = normalizeThemeLibrary(undefined, active, 2000, 'legacy-theme')

  assert.equal(library.length, 1)
  assert.equal(library[0].name, 'My current theme')
  assert.equal(library[0].id, 'legacy-theme')
  assert.equal(library[0].theme.background.color, '#123456')
})

test('normalizes saved themes and removes duplicate ids', () => {
  const raw = [
    { id: 'one', name: ' First ', createdAt: 1, updatedAt: 2, theme: DEFAULT_OVERLAY_THEME },
    { id: 'one', name: 'Duplicate', createdAt: 3, updatedAt: 3, theme: DEFAULT_OVERLAY_THEME },
  ]

  const library = normalizeThemeLibrary(raw, DEFAULT_OVERLAY_THEME)

  assert.equal(library.length, 1)
  assert.equal(library[0].name, 'First')
})
