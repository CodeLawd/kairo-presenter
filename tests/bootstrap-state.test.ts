import test from 'node:test'
import assert from 'node:assert/strict'
import type { AppBootstrapSnapshot, BootstrapResourceError } from '../src/lib/ipc'
import {
  BOOTSTRAP_MIN_VISIBLE_MS,
  SPLASH_STAGES,
  createBootstrapRunner,
  describeBootstrapWarning,
  getBootstrapPercent,
  getBootstrapPhase,
  getSplashPercent,
  getSplashStep,
  shouldShowApiBibleWarning,
} from '../src/renderer/src/bootstrap/bootstrap-state'

const SNAPSHOT = { errors: [] } as unknown as AppBootstrapSnapshot

test('a clean bootstrap is ready', () => {
  assert.equal(getBootstrapPhase([]), 'ready')
})

test('any failed resource is ready-with-warnings, never a blocked app', () => {
  const errors: BootstrapResourceError[] = [{ resource: 'lyrics', message: 'locked' }]
  assert.equal(getBootstrapPhase(errors), 'ready-with-warnings')
})

test('the warning names the resources that failed', () => {
  const message = describeBootstrapWarning([
    { resource: 'lyrics', message: 'locked' },
    { resource: 'sermonPlans', message: 'timed out' },
  ])
  assert.match(message, /song library/)
  assert.match(message, /scripture playlists/)
})

test('progress converts to a bounded percentage', () => {
  assert.equal(getBootstrapPercent({ completed: 0, total: 8, step: 'x' }), 0)
  assert.equal(getBootstrapPercent({ completed: 4, total: 8, step: 'x' }), 50)
  assert.equal(getBootstrapPercent({ completed: 8, total: 8, step: 'x' }), 100)
  assert.equal(getBootstrapPercent({ completed: 3, total: 0, step: 'x' }), 0)
  assert.equal(getBootstrapPercent({ completed: 99, total: 8, step: 'x' }), 100)
})

test('the loading screen has a minimum visible duration', () => {
  assert.equal(BOOTSTRAP_MIN_VISIBLE_MS, 4_200)
})

test('splash stages pace through booth-facing copy', () => {
  assert.ok(SPLASH_STAGES.length >= 5)
  assert.match(SPLASH_STAGES[0], /ready/i)
  assert.ok(SPLASH_STAGES.some((step) => /scripture/i.test(step)))
  assert.ok(SPLASH_STAGES.some((step) => /lyrics/i.test(step)))
})

test('splash percent climbs with elapsed time and finishes on fade-out', () => {
  assert.equal(getSplashPercent(0, false), 0)
  assert.ok(getSplashPercent(2_100, false) >= 45)
  assert.ok(getSplashPercent(2_100, false) < 98)
  assert.equal(getSplashPercent(4_200, false), 98)
  assert.equal(getSplashPercent(0, true), 100)
})

test('splash step walks the stage list until fade-out', () => {
  assert.equal(getSplashStep(0, false), SPLASH_STAGES[0])
  assert.equal(getSplashStep(BOOTSTRAP_MIN_VISIBLE_MS - 1, false), SPLASH_STAGES.at(-1))
  assert.equal(getSplashStep(0, true), 'Ready')
})

test('bootstrap runs once no matter how many times it is started', async () => {
  let calls = 0
  const run = createBootstrapRunner(async () => {
    calls += 1
    return SNAPSHOT
  })

  const [a, b] = await Promise.all([run(), run()])
  await run()

  assert.equal(calls, 1, 'React Strict Mode must not double-invoke bootstrap')
  assert.equal(a, SNAPSHOT)
  assert.equal(b, SNAPSHOT)
})

test('a failed bootstrap can be retried explicitly', async () => {
  let calls = 0
  const run = createBootstrapRunner(async () => {
    calls += 1
    if (calls === 1) throw new Error('ipc unavailable')
    return SNAPSHOT
  })

  await assert.rejects(() => run())
  assert.equal(await run({ force: true }), SNAPSHOT)
  assert.equal(calls, 2)
})

test('no API.Bible warning appears before authorization is known', () => {
  for (const state of ['unchecked', 'checking', 'offline'] as const) {
    assert.equal(shouldShowApiBibleWarning(state, true), false)
  }
})

test('no API.Bible warning appears before startup has delivered settings', () => {
  assert.equal(shouldShowApiBibleWarning('unchecked', false, false), false)
  assert.equal(shouldShowApiBibleWarning('unauthorized', true, false), false)
})

test('the API.Bible warning appears only when there is no key or it was refused', () => {
  assert.equal(shouldShowApiBibleWarning('unauthorized', true), true)
  assert.equal(shouldShowApiBibleWarning('unchecked', false), true)
  assert.equal(shouldShowApiBibleWarning('authorized', true), false)
  assert.equal(shouldShowApiBibleWarning('offline', false), true)
})
