import test from 'node:test'
import assert from 'node:assert/strict'
import type { BootstrapProgress } from '@shared/ipc'
import { BOOTSTRAP_STEPS, BOOTSTRAP_TIMEOUT_MS, runBootstrap, type BootstrapLoaders } from '../bootstrap'

const SETTINGS = { display: { theme: 'dark' } } as never
const ORCH = { running: true, totalPresentations: 4 } as never
const PP = { state: 'connected' } as never
const LIVE_PLAN = { planId: 'plan-1', title: 'Sunday', itemCount: 3, unavailableCount: 0 }

function loaders(overrides: Partial<BootstrapLoaders> = {}): BootstrapLoaders {
  return {
    settings: async () => SETTINGS,
    orchestrator: async () => ORCH,
    propresenter: async () => PP,
    transcription: async () => [{ id: 't1' } as never],
    translations: async () => [{ id: 'KJV' } as never],
    sermonPlans: async () => [{ id: 'plan-1' } as never],
    livePlan: async () => LIVE_PLAN,
    lyrics: async () => [{ id: 'song-1' } as never],
    ...overrides,
  }
}

test('returns every successful local resource in one snapshot', async () => {
  const snapshot = await runBootstrap(loaders())

  assert.equal(snapshot.settings, SETTINGS)
  assert.equal(snapshot.orchestrator, ORCH)
  assert.equal(snapshot.propresenter, PP)
  assert.equal(snapshot.transcription.length, 1)
  assert.equal(snapshot.translations.length, 1)
  assert.equal(snapshot.sermonPlans.length, 1)
  assert.deepEqual(snapshot.livePlan, LIVE_PLAN)
  assert.equal(snapshot.lyrics.length, 1)
  assert.deepEqual(snapshot.errors, [])
  assert.ok(snapshot.completedAt > 0)
})

test('one failed resource keeps every other result', async () => {
  const snapshot = await runBootstrap(
    loaders({ lyrics: async () => { throw new Error('library locked') } }),
  )

  assert.deepEqual(snapshot.errors, [{ resource: 'lyrics', message: 'library locked' }])
  assert.deepEqual(snapshot.lyrics, [])
  assert.equal(snapshot.settings, SETTINGS)
  assert.equal(snapshot.sermonPlans.length, 1)
})

test('a failed resource falls back to a neutral empty value', async () => {
  const snapshot = await runBootstrap(
    loaders({
      settings: async () => { throw new Error('store unreadable') },
      livePlan: async () => { throw new Error('no plan') },
      orchestrator: async () => { throw new Error('not started') },
    }),
  )

  assert.equal(snapshot.settings, null)
  assert.equal(snapshot.livePlan, null)
  assert.equal(snapshot.orchestrator, null)
  assert.equal(snapshot.errors.length, 3)
})

test('the timeout returns partial data and marks the unfinished resources failed', async () => {
  const snapshot = await runBootstrap(
    loaders({ lyrics: () => new Promise(() => {}) }),
    { timeoutMs: 20 },
  )

  assert.equal(snapshot.sermonPlans.length, 1)
  assert.deepEqual(snapshot.lyrics, [])
  assert.deepEqual(snapshot.errors.map((e) => e.resource), ['lyrics'])
  assert.match(snapshot.errors[0].message, /timed out/i)
})

test('the blocking budget is eight seconds', () => {
  assert.equal(BOOTSTRAP_TIMEOUT_MS, 8_000)
})

test('progress is monotonic, labelled, and reaches completion', async () => {
  const events: BootstrapProgress[] = []
  const snapshot = await runBootstrap(loaders(), { onProgress: (p) => events.push(p) })

  assert.ok(events.length >= BOOTSTRAP_STEPS.length)
  for (const event of events) {
    assert.equal(event.total, BOOTSTRAP_STEPS.length)
    assert.ok(event.step.length > 0)
  }
  for (let i = 1; i < events.length; i += 1) {
    assert.ok(events[i].completed >= events[i - 1].completed, 'progress went backwards')
  }
  assert.equal(events[0].completed, 0)
  assert.equal(events.at(-1)!.completed, BOOTSTRAP_STEPS.length)
  assert.equal(events.at(-1)!.step, 'Ready')
  assert.equal(snapshot.errors.length, 0)
})

test('progress labels name work that is genuinely still running', async () => {
  const events: BootstrapProgress[] = []
  await runBootstrap(loaders(), { onProgress: (p) => events.push(p) })

  const labels = new Set(BOOTSTRAP_STEPS.map((step) => `Loading ${step.label}…`))
  for (const event of events.slice(0, -1)) {
    assert.ok(
      labels.has(event.step) || event.step === 'Starting ProAutomate…',
      `unexpected step label: ${event.step}`,
    )
  }
})

test('progress still completes when a resource times out', async () => {
  const events: BootstrapProgress[] = []
  await runBootstrap(loaders({ lyrics: () => new Promise(() => {}) }), {
    timeoutMs: 20,
    onProgress: (p) => events.push(p),
  })
  assert.equal(events.at(-1)!.completed, BOOTSTRAP_STEPS.length)
  assert.equal(events.at(-1)!.step, 'Ready')
})

test('a slow resource does not delay the ones that already resolved', async () => {
  const started = Date.now()
  const snapshot = await runBootstrap(
    loaders({ transcription: () => new Promise(() => {}) }),
    { timeoutMs: 30 },
  )
  assert.ok(Date.now() - started < 1_000)
  assert.equal(snapshot.translations.length, 1)
})

test('every resource has a user-facing label', () => {
  for (const step of BOOTSTRAP_STEPS) {
    assert.ok(step.label.length > 0)
  }
  assert.deepEqual(
    BOOTSTRAP_STEPS.map((s) => s.resource).sort(),
    ['livePlan', 'lyrics', 'orchestrator', 'propresenter', 'sermonPlans', 'settings', 'transcription', 'translations'],
  )
})
