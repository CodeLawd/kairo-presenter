import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EMPTY_PP_RESOURCE_BINDINGS,
  normalizeResourceId,
  normalizeResourceBindings,
  resourcePreviewKind,
  validateResourceBindings,
} from '../src/lib/propresenter-resources'

test('normalizes nested, flat, and string ProPresenter ids', () => {
  assert.equal(normalizeResourceId({ id: { uuid: 'theme-1', name: 'Sunday' } }), 'theme-1')
  assert.equal(normalizeResourceId({ uuid: 'theme-2' }), 'theme-2')
  assert.equal(normalizeResourceId({ id: 'theme-3' }), 'theme-3')
})

test('reports only real API-backed image previews', () => {
  assert.equal(resourcePreviewKind('theme'), 'thumbnail')
  assert.equal(resourcePreviewKind('prop'), 'thumbnail')
  assert.equal(resourcePreviewKind('message'), 'text')
  assert.equal(resourcePreviewKind('look'), 'details')
  assert.equal(resourcePreviewKind('videoInput'), 'none')
})

test('keeps a deleted binding and marks it missing', () => {
  const bindings = { ...EMPTY_PP_RESOURCE_BINDINGS, scriptureThemeId: 'gone' }
  const result = validateResourceBindings(bindings, { refreshedAt: 1, resources: [] })
  assert.equal(result.scriptureTheme.missing, true)
  assert.equal(result.scriptureTheme.id, 'gone')
})

test('heals partial resource bindings and discards unknown keys', () => {
  assert.deepEqual(normalizeResourceBindings({ scriptureThemeId: 'theme-1', stale: 'discard' }), {
    ...EMPTY_PP_RESOURCE_BINDINGS,
    scriptureThemeId: 'theme-1',
  })
})
