import test from 'node:test'
import assert from 'node:assert/strict'
import { ProPresenterClient } from '../client'
import type { PPVersionResponse } from '../types'

const VERSION: PPVersionResponse = {
  major: 19,
  minor: 0,
  patch: 1,
  build_number: '1',
}

/**
 * Client with a scripted `getVersion`, so a connect can be made to hang or fail
 * on demand without any network.
 */
class ScriptedClient extends ProPresenterClient {
  responders: Record<string, () => Promise<PPVersionResponse>> = {}
  /** Host of the request currently being answered, for assertions. */
  seen: string[] = []

  async getVersion(): Promise<PPVersionResponse> {
    const host = (this as unknown as { host: string }).host
    this.seen.push(host)
    const responder = this.responders[host]
    if (!responder) throw new Error(`no responder for ${host}`)
    return responder()
  }
}

function deferred(): { promise: Promise<never>; reject: (err: Error) => void } {
  let reject!: (err: Error) => void
  const promise = new Promise<never>((_resolve, rejectFn) => {
    reject = rejectFn
  })
  return { promise, reject }
}

test('a superseded connect does not connect a second time behind the newer one', async () => {
  const client = new ScriptedClient()
  const stale = deferred()
  // A remote host gets two handshake attempts. The first is still hanging
  // against the old address when the operator corrects it; the second wakes up
  // afterwards, finds the corrected address, and would succeed all over again —
  // a duplicate `connected`, a duplicate status stream.
  client.responders['10.0.0.9'] = () => stale.promise
  client.responders['localhost'] = async () => VERSION

  const connects: unknown[] = []
  client.on('connected', (version) => connects.push(version))

  const staleConnect = client.connect('10.0.0.9', 57563)
  await client.connect('localhost', 57563)
  assert.equal(client.connectionState, 'connected')

  stale.reject(new Error('timeout of 10000ms exceeded'))
  await staleConnect

  assert.equal(client.connectionState, 'connected')
  assert.equal(connects.length, 1, 'the abandoned attempt connected a second time')
  client.disconnect()
})

test('the newest connect still reports its own failure', async () => {
  const client = new ScriptedClient()
  client.responders['localhost'] = async () => {
    throw new Error('connect ECONNREFUSED')
  }
  const errors: Error[] = []
  client.on('error', (err) => errors.push(err))

  await client.connect('localhost', 57563)

  assert.equal(client.connectionState, 'error')
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /ECONNREFUSED/)
  client.disconnect()
})
