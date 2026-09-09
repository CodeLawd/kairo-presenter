import test from 'node:test'
import assert from 'node:assert/strict'
import type { AppBootstrapSnapshot, BootstrapProgress } from '../src/lib/ipc'

// The store talks to the preload bridge and applies the saved theme, so both
// browser globals are stubbed before it is imported.
const themeApplied: string[] = []
const calls = { bootstrap: 0 }
let bootstrapResult: () => Promise<AppBootstrapSnapshot>
let translationsResult: () => Promise<unknown>
let progressListener: ((progress: BootstrapProgress) => void) | null = null
let unsubscribed = 0

// Renderer-side device enumeration. IDs here are MediaDeviceInfo.deviceId
// values, the only kind getUserMedia's `exact` constraint accepts.
// Node defines its own read-only `navigator`, so this must be redefined.
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    mediaDevices: {
      enumerateDevices: async () => [
        { kind: 'audioinput', deviceId: 'default', label: 'Built-in Microphone' },
        { kind: 'audiooutput', deviceId: 'out-1', label: 'Speakers' },
      ],
    },
  },
})

Object.assign(globalThis, {
  document: {
    documentElement: {
      dataset: new Proxy({} as Record<string, string>, {
        set(target, key: string, value: string) {
          themeApplied.push(value)
          target[key] = value
          return true
        },
      }),
      style: {} as Record<string, string>,
    },
  },
  window: {
    api: {
      app: {
        bootstrap: () => {
          calls.bootstrap += 1
          return bootstrapResult()
        },
        onBootstrapProgress: (callback: (progress: BootstrapProgress) => void) => {
          progressListener = callback
          return () => {
            unsubscribed += 1
            progressListener = null
          }
        },
      },
      // audio.getDevices is gone; enumeration is renderer-side (see the
      // navigator.mediaDevices stub below).
      ndi: {
        getStatus: async () => ({ available: true, sending: false, ppInputConfigured: false }),
      },
      scripture: { getTranslations: () => translationsResult() },
    },
  },
})

interface Modules {
  useBootstrapStore: typeof import('@/bootstrap/useBootstrapStore')['useBootstrapStore']
  hydrateIntegrations: typeof import('@/bootstrap/useBootstrapStore')['hydrateIntegrations']
  useAppStore: typeof import('@/stores/useAppStore')['useAppStore']
  defaults: typeof import('@/lib/defaultSettings')['DEFAULT_SETTINGS']
}

// Loaded lazily so the browser-global stubs above are in place first.
let loaded: Promise<Modules> | null = null
function load(): Promise<Modules> {
  loaded ??= (async () => {
    const bootstrap = await import('@/bootstrap/useBootstrapStore')
    return {
      useBootstrapStore: bootstrap.useBootstrapStore,
      hydrateIntegrations: bootstrap.hydrateIntegrations,
      useAppStore: (await import('@/stores/useAppStore')).useAppStore,
      defaults: (await import('@/lib/defaultSettings')).DEFAULT_SETTINGS,
    }
  })()
  return loaded
}

function snapshot(m: Modules, overrides: Partial<AppBootstrapSnapshot> = {}): AppBootstrapSnapshot {
  return {
    settings: {
      ...m.defaults,
      display: { ...m.defaults.display, theme: 'light' },
      audio: { deviceId: 'mic-7' },
      scripture: { ...m.defaults.scripture, autoMode: true, confidenceThreshold: 0.9 },
    },
    orchestrator: { running: true, autoMode: true, ppConnected: true, health: [], totalPresentations: 12 },
    propresenter: { state: 'connected' } as never,
    transcription: [{ id: 't1' } as never],
    translations: [{ id: 'KJV' } as never],
    sermonPlans: [{ id: 'plan-1' } as never],
    livePlan: { planId: 'plan-1', title: 'Sunday', itemCount: 2, unavailableCount: 0 },
    lyrics: [{ id: 'song-1' } as never],
    errors: [],
    completedAt: 1,
    ...overrides,
  }
}

function resetStore(m: Modules): void {
  m.useBootstrapStore.setState({
    phase: 'idle',
    errors: [],
    warningDismissed: false,
    settings: m.defaults,
    translations: [],
    sermonPlans: [],
    livePlan: null,
    lyrics: [],
    transcription: [],
    orchestrator: null,
    apiBibleAuth: 'unchecked',
    audioDevices: [],
    ndiStatus: null,
  })
}

function withKey(m: Modules): void {
  m.useBootstrapStore.setState({
    apiBibleAuth: 'unchecked',
    settings: { ...m.defaults, stt: { ...m.defaults.stt, bibleApiKey: 'key' } },
  })
}

test('a clean bootstrap becomes ready and exposes every resource', async () => {
  const m = await load()
  resetStore(m)
  bootstrapResult = async () => snapshot(m)

  await m.useBootstrapStore.getState().start()
  const state = m.useBootstrapStore.getState()

  assert.equal(state.phase, 'ready')
  assert.equal(state.sermonPlans.length, 1)
  assert.equal(state.lyrics.length, 1)
  assert.equal(state.translations.length, 1)
  assert.equal(state.livePlan?.title, 'Sunday')
  assert.equal(state.transcription.length, 1)
  assert.equal(state.settings.audio.deviceId, 'mic-7')
})

test('the saved theme is applied as soon as settings arrive', () => {
  assert.equal(themeApplied.at(-1), 'light')
})

test('bootstrap hydrates the existing runtime store', async () => {
  const m = await load()
  const runtime = m.useAppStore.getState()
  assert.equal(runtime.isTranscribing, true)
  assert.equal(runtime.ppState, 'connected')
  assert.equal(runtime.autoModeEnabled, true)
  assert.equal(runtime.confidenceThreshold, 0.9)
  assert.equal(runtime.captureDeviceId, 'mic-7')
  assert.equal(runtime.scriptureProjectedCount, 12)
})

test('bootstrap is invoked once per renderer session', async () => {
  const m = await load()
  const before = calls.bootstrap
  await m.useBootstrapStore.getState().start()
  await m.useBootstrapStore.getState().start()
  assert.equal(calls.bootstrap, before, 'a second start must not re-invoke the IPC')
})

test('progress is subscribed before invoking and torn down afterwards', async () => {
  const m = await load()
  resetStore(m)
  const seen: BootstrapProgress[] = []
  bootstrapResult = async () => {
    progressListener?.({ completed: 1, total: 8, step: 'Loading settings…' })
    return snapshot(m)
  }
  const unsubscribedBefore = unsubscribed
  const stop = m.useBootstrapStore.subscribe((state) => seen.push(state.progress))

  await m.useBootstrapStore.getState().retry()
  stop()

  assert.ok(seen.some((p) => p.step === 'Loading settings…'))
  assert.equal(unsubscribed, unsubscribedBefore + 1)
})

test('a failed resource opens the app with warnings and keeps the rest', async () => {
  const m = await load()
  resetStore(m)
  bootstrapResult = async () =>
    snapshot(m, { lyrics: [], errors: [{ resource: 'lyrics', message: 'library locked' }] })

  await m.useBootstrapStore.getState().retry()
  const state = m.useBootstrapStore.getState()

  assert.equal(state.phase, 'ready-with-warnings')
  assert.deepEqual(state.lyrics, [])
  assert.equal(state.sermonPlans.length, 1)
  assert.equal(state.warningDismissed, false)
})

test('missing settings fall back to defaults rather than blocking startup', async () => {
  const m = await load()
  resetStore(m)
  bootstrapResult = async () =>
    snapshot(m, { settings: null, errors: [{ resource: 'settings', message: 'store unreadable' }] })

  await m.useBootstrapStore.getState().retry()

  assert.equal(m.useBootstrapStore.getState().phase, 'ready-with-warnings')
  assert.equal(m.useBootstrapStore.getState().settings.display.theme, m.defaults.display.theme)
})

test('a bootstrap IPC failure still opens the app', async () => {
  const m = await load()
  resetStore(m)
  bootstrapResult = async () => { throw new Error('No handler registered') }

  await m.useBootstrapStore.getState().retry()

  assert.equal(m.useBootstrapStore.getState().phase, 'ready-with-warnings')
  assert.match(m.useBootstrapStore.getState().errors[0].message, /No handler registered/)
})

test('mutations from screens update the shared snapshot', async () => {
  const m = await load()
  const store = m.useBootstrapStore.getState()
  store.setSermonPlans([{ id: 'plan-2' } as never])
  store.setLyrics([{ id: 'song-9' } as never])
  store.patchSettings('scripture', { ...m.defaults.scripture, defaultTranslation: 'KJV' })

  const state = m.useBootstrapStore.getState()
  assert.equal(state.sermonPlans[0].id, 'plan-2')
  assert.equal(state.lyrics[0].id, 'song-9')
  assert.equal(state.settings.scripture.defaultTranslation, 'KJV')
  assert.ok(state.settings.overlay, 'overlay stays normalized after a patch')
})

test('integration hydration authorizes a working API.Bible key', async () => {
  const m = await load()
  resetStore(m)
  withKey(m)
  translationsResult = async () => [{ id: 'NKJV', available: true }]

  await m.hydrateIntegrations()

  const state = m.useBootstrapStore.getState()
  assert.equal(state.apiBibleAuth, 'authorized')
  assert.equal(state.translations.length, 1)
  assert.equal(state.audioDevices.length, 1)
  assert.equal(state.ndiStatus?.available, true)
})

test('a network failure leaves API.Bible offline, not unauthorized', async () => {
  const m = await load()
  withKey(m)
  translationsResult = async () => { throw new Error('getaddrinfo ENOTFOUND rest.api.bible') }

  await m.hydrateIntegrations()

  assert.equal(m.useBootstrapStore.getState().apiBibleAuth, 'offline')
})

test('a refused key is reported as unauthorized', async () => {
  const m = await load()
  withKey(m)
  translationsResult = async () => { throw new Error('Request failed with status code 401') }

  await m.hydrateIntegrations()

  assert.equal(m.useBootstrapStore.getState().apiBibleAuth, 'unauthorized')
})

test('integration failures never change the ready phase', async () => {
  const m = await load()
  m.useBootstrapStore.setState({ phase: 'ready' })
  translationsResult = async () => { throw new Error('offline') }

  await m.hydrateIntegrations()

  assert.equal(m.useBootstrapStore.getState().phase, 'ready')
})
