import assert from 'node:assert/strict'
import test from 'node:test'

import { cleanIpcError } from '../src/lib/ipc-error'

// Electron's wrapper is plumbing; what the service said is the useful part,
// and mid-service is the worst time to read a channel name.

test('the remote-method wrapper is stripped back to the real message', () => {
  const error = new Error(
    "Error invoking remote method 'lyrics:pushSlide': Error: ProPresenter is not connected. Connect in Settings first.",
  )
  assert.equal(cleanIpcError(error), 'ProPresenter is not connected. Connect in Settings first.')
})

test('a nested error prefix is unwrapped too', () => {
  const error = new Error("Error invoking remote method 'x:y': Error: Error: Deep down it failed.")
  assert.equal(cleanIpcError(error), 'Deep down it failed.')
})

test('a plain message is left alone', () => {
  assert.equal(cleanIpcError(new Error('Song has no sections to present.')), 'Song has no sections to present.')
})

test('typed errors keep their message, not their class name', () => {
  assert.equal(cleanIpcError(new TypeError('Not a function.')), 'Not a function.')
})

test('a string or an unknown throw still produces something readable', () => {
  assert.equal(cleanIpcError('Just a string'), 'Just a string')
  assert.equal(cleanIpcError(null), 'Something went wrong.')
  assert.equal(cleanIpcError(new Error('')), 'Something went wrong.')
})
