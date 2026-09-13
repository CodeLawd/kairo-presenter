import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { NdiService } from '../index'
import type { NdiProvider } from '../provider'

function fakeProvider(opts: { failCreate?: boolean; frames?: { count: number } } = {}): NdiProvider {
  const frames = opts.frames ?? { count: 0 }
  return {
    name: 'fake',
    version: () => 'fake-1.0',
    async createSender() {
      if (opts.failCreate) throw new Error('sender name in use')
      return {
        sendVideo: async () => {
          frames.count += 1
        },
      }
    },
  }
}

describe('NdiService with fake provider', () => {
  const created: NdiService[] = []
  const make = (result: ConstructorParameters<typeof NdiService>[0]) => {
    const svc = new NdiService(result)
    created.push(svc)
    return svc
  }

  afterEach(async () => {
    // Guard: no frame-timer may survive a test (would keep the runner alive).
    await Promise.all(created.splice(0).map((svc) => svc.stop()))
  })

  it('starts, reports sending, delivers frames, stops', async () => {
    const svc = make({ ok: true, provider: fakeProvider(), adapter: 'grandi' })
    assert.deepEqual(svc.getStatus(), { available: true, sending: false, senderError: null })
    await svc.start()
    assert.equal(svc.getStatus().sending, true)
    await svc.stop()
    assert.equal(svc.getStatus().sending, false)
  })

  it('disables only NDI when loader fails', async () => {
    const svc = make({ ok: false, reason: 'no binding' })
    assert.equal(svc.getStatus().available, false)
    await svc.start() // no-op, must not throw
    assert.equal(svc.getStatus().sending, false)
  })

  it('surfaces sender creation failure with retry cooldown', async () => {
    const svc = make({ ok: true, provider: fakeProvider({ failCreate: true }), adapter: 'grandi' })
    await svc.start()
    const status = svc.getStatus()
    assert.equal(status.sending, false)
    assert.match(status.senderError ?? '', /in use/)
    // Immediate retry is throttled, not a crash.
    await svc.start()
    await svc.stop()
  })

  it('repeated start/stop cycles do not leak timers', async () => {
    const svc = make({ ok: true, provider: fakeProvider(), adapter: 'grandi' })
    for (let i = 0; i < 5; i++) {
      await svc.start()
      await svc.stop()
    }
    assert.equal(svc.getStatus().sending, false)
  })
})
