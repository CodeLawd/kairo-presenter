import { test } from 'node:test'
import assert from 'node:assert/strict'
import { updateErrorMessage } from '../src/main/services/updater/errors'

test('updater failures show a helpful message instead of raw server details', () => {
  const error = new Error('504 "method: GET url: https://github.com/example/latest-mac.yml\\n Data: <html>Gateway Time-out</html> Headers: secret"')
  assert.equal(updateErrorMessage(error, 'check'), 'Could not check for updates. Please check your connection and try again.')
  assert.equal(updateErrorMessage(error, 'download'), 'Could not download the update. Please check your connection and try again.')
  assert.equal(updateErrorMessage(new Error('unexpected failure'), 'check'), 'Could not check for updates. Please try again.')
})
