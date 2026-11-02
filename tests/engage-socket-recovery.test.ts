import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { KairoAudienceSource } from '../src/main/services/audience/sources/kairo'
import type { AudienceRoomCreated } from '../src/lib/audience-protocol'

const room = (token: string): AudienceRoomCreated => ({
  roomId: 'room', code: '75XNMW', operatorToken: token, title: 'Test',
  url: 'https://kairopresenter.com/q/75XNMW',
  settings: { review: false, showQuestions: true, names: 'optional' },
})

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(predicate(), 'socket did not become live')
}

test('a rejected operator socket renews its credential and becomes live', async () => {
  const server = createServer()
  const sockets = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => {
    if (request.headers.authorization !== 'Bearer new-token') {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
      return
    }
    sockets.handleUpgrade(request, socket, head, ws => {
      ws.send(JSON.stringify({ type: 'snapshot', joined: 0, questions: [], settings: room('new-token').settings }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  let renewals = 0
  const source = new KairoAudienceSource(
    `http://127.0.0.1:${address.port}`,
    async () => room('old-token'),
    undefined,
    async () => { renewals += 1; return room('new-token') },
  )
  let live = false
  source.onUpdate(update => { if (update.status?.state === 'live') live = true })
  try {
    await source.start()
    await waitFor(() => live)
    assert.equal(renewals, 1)
  } finally {
    source.dispose()
    sockets.close()
    server.close()
  }
})
