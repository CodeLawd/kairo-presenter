import assert from 'node:assert/strict'
import test from 'node:test'

import type { AppSettings } from '../src/lib/ipc'
import { EMPTY_PP_RESOURCE_BINDINGS } from '../src/lib/propresenter-resources'
import {
  DEFAULT_ONBOARDING_STATE, completeStep, finishOnboarding, isOnboardingFinished,
  isStepComplete, nextIncompleteStep, nextStep, onboardingSteps, previousStep,
  onboardingProgress, resetOnboarding, seedOnboardingFromSettings, setCurrentStep,
  shouldOfferOnboarding, skipStep, normalizeOnboardingState,
} from '../src/lib/cloud/onboarding'


function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    propresenter: { host: '', port: 57563, password: '' },
    audio: { deviceId: '' },
    stt: {
      provider: 'none',
      apiKey: '',
      anthropicApiKey: '',
      deepseekApiKey: '',
      llmProvider: 'anthropic',
      bibleApiKey: '',
      language: 'en-US',
    },
    scripture: {
      defaultTranslation: 'NKJV',
      showVerseNumbers: true,
      autoMode: false,
      confidenceThreshold: 0.7,
      debounceInterval: 8,
      contextWindowSize: 90,
      offlineDownloadBibleIds: [],
    },
    lyrics: { braveApiKey: '', googleTranslateApiKey: '', glossColor: '#D4A017' },
    display: { theme: 'dark', fontSize: 16, transcriptionFontSize: 18 },
    overlay: { outputs: [] } as never,
    themeLibrary: [],
    media: { folder: '', playlists: [] },
    church: { name: '', timezone: '', role: '', serviceTimes: [] },
    propresenterResources: { ...EMPTY_PP_RESOURCE_BINDINGS },
    ...overrides,
  } as AppSettings
}

/** A machine that has been running services since before the wizard existed. */
function configuredSettings(): AppSettings {
  return settings({
    propresenter: { host: '192.168.1.164', port: 57563, password: 'pw' },
    stt: { ...settings().stt, bibleApiKey: 'key-123' },
    overlay: { outputs: [{ enabled: true, kind: 'library' }, { enabled: false, kind: 'screen' }] } as never,
  })
}

test('first run walks from the tour to the account to this computer\'s screens', () => {
  assert.deepEqual(onboardingSteps(settings()), ['welcome', 'account', 'output'])
  assert.deepEqual(onboardingSteps(configuredSettings()), ['welcome', 'account', 'output'])
  const first = DEFAULT_ONBOARDING_STATE
  assert.equal(first.currentStep, 'welcome')
  assert.equal(nextStep(first), 'account')
  const account = setCurrentStep(first, 'account')
  assert.equal(nextStep(account), 'output')
  assert.equal(previousStep(account), 'welcome')
  assert.equal(nextStep(setCurrentStep(account, 'output')), null)
})

test('legacy saved steps resume at welcome without reopening completed onboarding', () => {
  for (const currentStep of ['church', 'propresenter', 'propresenterResources', 'apiKeys'] as const) {
    const state = normalizeOnboardingState({ ...DEFAULT_ONBOARDING_STATE, currentStep, completedAt: 123 })
    assert.equal(state.currentStep, 'welcome')
    assert.equal(state.completedAt, 123)
    assert.equal(shouldOfferOnboarding({ state, dismissedThisSession: false }), false)
  }
})

test('welcome is answered by the operator rather than derived from settings', () => {
  assert.equal(isStepComplete('welcome', configuredSettings()), false)
  const state = completeStep(DEFAULT_ONBOARDING_STATE, 'welcome')
  assert.equal(state.currentStep, 'welcome')
  assert.equal(nextIncompleteStep(state), 'account')
  assert.equal(onboardingProgress(state).resolved, 1)
})

test('screen readiness requires a bound enabled Kairo screen', () => {
  assert.equal(isStepComplete('output', configuredSettings()), false)
  assert.equal(isStepComplete('output', settings({ overlay: { outputs: [{ kind: 'screen', enabled: true, displayId: null }] } as never })), false)
  assert.equal(isStepComplete('output', settings({ overlay: { outputs: [{ kind: 'screen', enabled: true, displayId: 2 }] } as never })), true)
})

test('an existing configured standalone install does not see first-run setup', () => {
  const full = configuredSettings()
  full.overlay = { outputs: [{ kind: 'screen', enabled: true, displayId: 2 }] } as never
  full.church.name = 'Grace Chapel'
  assert.equal(isOnboardingFinished(seedOnboardingFromSettings(full, 1000)), true)
})

test('optional setup can be skipped, finished, and replayed without changing settings', () => {
  let state = completeStep(DEFAULT_ONBOARDING_STATE, 'welcome')
  state = completeStep(state, 'account')
  state = skipStep(state, 'output')
  assert.equal(nextIncompleteStep(state), null)
  assert.equal(state.completedAt, null)
  state = finishOnboarding(state, 100)
  assert.equal(finishOnboarding(state, 200).completedAt, 100)
  assert.equal(resetOnboarding(state).currentStep, 'welcome')
  assert.equal(resetOnboarding(state).completedAt, null)
})

test('invalid stored progress is normalized and valid progress survives', () => {
  assert.deepEqual(normalizeOnboardingState(null), DEFAULT_ONBOARDING_STATE)
  const state = normalizeOnboardingState({ currentStep: 'output', completedSteps: ['welcome', 'apiKeys', 'unknown'], skippedSteps: ['account', 'church'], source: 'legacy' })
  assert.deepEqual(state.completedSteps, ['welcome'])
  assert.deepEqual(state.skippedSteps, ['account'])
  assert.equal(state.currentStep, 'output')
  assert.equal(state.source, 'legacy')
})

test('migration also leaves a working legacy ProPresenter install closed', () => {
  const full = configuredSettings()
  full.church.name = 'Grace Chapel'
  assert.equal(isOnboardingFinished(seedOnboardingFromSettings(full, 1000)), true)
})

test('a fresh install begins at welcome when the first-launch migration runs', () => {
  const blank = settings({ overlay: { outputs: [{ kind: 'screen', enabled: true, displayId: null }] } as never })
  const state = seedOnboardingFromSettings(blank, 1000)
  assert.equal(state.currentStep, 'welcome')
  assert.equal(state.source, 'fresh')
  assert.equal(state.completedAt, null)
})

test('a partly set-up older install skips the tour and sign-in and resumes at screens', () => {
  const partial = settings({ church: { name: 'Grace Chapel', timezone: '', role: '', serviceTimes: [] } })
  const state = seedOnboardingFromSettings(partial, 1000)
  assert.equal(state.source, 'legacy')
  assert.deepEqual(state.skippedSteps, ['welcome', 'account'])
  assert.equal(state.currentStep, 'output')
  assert.equal(state.completedAt, null)
})
