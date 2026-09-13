import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProPresenterPort } from '../src/renderer/src/lib/propresenter-port'

test('an empty port remains an editable draft instead of becoming a default', () => {
  assert.equal(parseProPresenterPort(''), null)
  assert.equal(parseProPresenterPort('   '), null)
})

test('a complete port is accepted only within the TCP port range', () => {
  assert.equal(parseProPresenterPort('57563'), 57563)
  assert.equal(parseProPresenterPort('0'), null)
  assert.equal(parseProPresenterPort('65536'), null)
  assert.equal(parseProPresenterPort('57x63'), null)
})
