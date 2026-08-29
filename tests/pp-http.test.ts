import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PP_LOCAL_TIMEOUT_MS,
  PP_REMOTE_CONNECT_ATTEMPTS,
  PP_REMOTE_TIMEOUT_MS,
  isLocalProPresenterHost,
  proPresenterConnectAttempts,
  proPresenterHttpTimeoutMs,
} from '../src/lib/pp-http'

test('localhost keeps the short timeout so a down local PP fails fast', () => {
  for (const host of ['localhost', '127.0.0.1', '::1', '[::1]', '  LocalHost  ']) {
    assert.equal(isLocalProPresenterHost(host), true)
    assert.equal(proPresenterHttpTimeoutMs(host), PP_LOCAL_TIMEOUT_MS)
    assert.equal(proPresenterConnectAttempts(host), 1)
  }
})

test('a LAN IP gets a longer timeout and a second handshake try', () => {
  assert.equal(isLocalProPresenterHost('192.168.1.164'), false)
  assert.equal(proPresenterHttpTimeoutMs('192.168.1.164'), PP_REMOTE_TIMEOUT_MS)
  assert.equal(proPresenterConnectAttempts('192.168.1.164'), PP_REMOTE_CONNECT_ATTEMPTS)
  assert.ok(PP_REMOTE_TIMEOUT_MS > PP_LOCAL_TIMEOUT_MS)
})
