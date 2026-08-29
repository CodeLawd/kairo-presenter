import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_OVERLAY_THEME } from '../src/lib/overlay-defaults'
import { createCustomTheme, normalizeThemeLibrary, nextUntitledThemeName, themesForKind, updateLibraryTheme } from '../src/lib/theme-library'

test('creates a named custom theme with an independent theme snapshot', () => {
  const source = structuredClone(DEFAULT_OVERLAY_THEME)
  const saved = createCustomTheme('  Sunday Warmth  ', source, 'scripture', 1234, 'theme-1')

  assert.equal(saved.id, 'theme-1')
  assert.equal(saved.name, 'Sunday Warmth')
  assert.equal(saved.kind, 'scripture')
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

test('a theme saved for lyrics keeps that kind', () => {
  const saved = createCustomTheme('Stage lyrics', DEFAULT_OVERLAY_THEME, 'lyrics', 1234, 'theme-2')

  assert.equal(saved.kind, 'lyrics')
})

test('themes saved before the split normalize to scripture', () => {
  const library = normalizeThemeLibrary(
    [
      { id: 'legacy', name: 'Old', createdAt: 1, updatedAt: 1, theme: DEFAULT_OVERLAY_THEME },
      { id: 'lyric', name: 'New', kind: 'lyrics', createdAt: 1, updatedAt: 1, theme: DEFAULT_OVERLAY_THEME },
      { id: 'bogus', name: 'Bad', kind: 'nonsense', createdAt: 1, updatedAt: 1, theme: DEFAULT_OVERLAY_THEME },
    ],
    DEFAULT_OVERLAY_THEME,
  )

  assert.equal(library.find((item) => item.id === 'legacy')?.kind, 'scripture')
  assert.equal(library.find((item) => item.id === 'lyric')?.kind, 'lyrics')
  assert.equal(library.find((item) => item.id === 'bogus')?.kind, 'scripture')
})

test('themesForKind splits the library by what each theme is for', () => {
  const library = [
    createCustomTheme('Verse', DEFAULT_OVERLAY_THEME, 'scripture', 1, 'a'),
    createCustomTheme('Song', DEFAULT_OVERLAY_THEME, 'lyrics', 1, 'b'),
  ]

  assert.deepEqual(themesForKind(library, 'scripture').map((t) => t.id), ['a'])
  assert.deepEqual(themesForKind(library, 'lyrics').map((t) => t.id), ['b'])
})

test('saving one library theme leaves every other theme untouched', () => {
  const warm = createCustomTheme('Warm', DEFAULT_OVERLAY_THEME, 'scripture', 1, 'warm')
  const cool = createCustomTheme('Cool', DEFAULT_OVERLAY_THEME, 'scripture', 1, 'cool')
  const coolSnapshot = structuredClone(cool.theme)

  const draft = structuredClone(warm.theme)
  draft.verse.color = '#ff0000'
  draft.verse.fontSizePx = 72
  draft.layout.autoFitText = true

  const next = updateLibraryTheme([warm, cool], 'warm', { name: 'Warm', theme: draft }, 99)

  assert.equal(next[1], cool)
  assert.deepEqual(next[1].theme, coolSnapshot)
  assert.equal(next[0].theme.verse.color, '#ff0000')
  assert.equal(next[0].updatedAt, 99)
  assert.equal(next[1].theme.verse.color, DEFAULT_OVERLAY_THEME.verse.color)
  assert.equal(next[1].theme.verse.fontSizePx, DEFAULT_OVERLAY_THEME.verse.fontSizePx)

  draft.verse.color = '#00ff00'
  next[0].theme.verse.color = '#0000ff'
  assert.equal(cool.theme.verse.color, coolSnapshot.verse.color)
  assert.notEqual(next[0].theme.verse.color, draft.verse.color)
})

test('saving a scripture theme does not rewrite a lyrics theme of the same name', () => {
  const verse = createCustomTheme('Sunday', DEFAULT_OVERLAY_THEME, 'scripture', 1, 'verse')
  const song = createCustomTheme('Sunday', DEFAULT_OVERLAY_THEME, 'lyrics', 1, 'song')
  const draft = structuredClone(verse.theme)
  draft.background.color = '#111111'

  const next = updateLibraryTheme([verse, song], 'verse', { name: 'Sunday', theme: draft })

  assert.equal(next[1], song)
  assert.equal(next[1].theme.background.color, DEFAULT_OVERLAY_THEME.background.color)
  assert.equal(next[0].theme.background.color, '#111111')
})

test('plus on Themes names a blank theme without clobbering an existing Untitled', () => {
  assert.equal(nextUntitledThemeName([], 'scripture'), 'Untitled theme')
  const library = [
    createCustomTheme('Untitled theme', DEFAULT_OVERLAY_THEME, 'scripture', 1, 'a'),
    createCustomTheme('Untitled theme 2', DEFAULT_OVERLAY_THEME, 'scripture', 1, 'b'),
    createCustomTheme('Untitled theme', DEFAULT_OVERLAY_THEME, 'lyrics', 1, 'c'),
  ]
  assert.equal(nextUntitledThemeName(library, 'scripture'), 'Untitled theme 3')
  assert.equal(nextUntitledThemeName(library, 'lyrics'), 'Untitled theme 2')
})
