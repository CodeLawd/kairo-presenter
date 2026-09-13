import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import type { AppSettings, OnboardingState } from '../src/lib/ipc'
import { EMPTY_PP_RESOURCE_BINDINGS } from '../src/lib/propresenter-resources'
import {
  DEFAULT_ONBOARDING_STATE,
  ONBOARDING_STEPS,
  completeStep,
  deriveCompletedSteps,
  finishOnboarding,
  isOnboardingFinished,
  isStepComplete,
  nextIncompleteStep,
  nextStep,
  previousStep,
  onboardingProgress,
  onboardingSummary,
  resetOnboarding,
  seedOnboardingFromSettings,
  setCurrentStep,
  shouldOfferOnboarding,
  skipStep,
} from '../src/lib/cloud/onboarding'

const ROOT = path.resolve(import.meta.dirname, '..')

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
    overlay: { outputs: [{ enabled: true }, { enabled: false }] } as never,
  })
}

test('a blank install has nothing done', () => {
  assert.deepEqual(deriveCompletedSteps(settings()), [])
  assert.equal(nextIncompleteStep(DEFAULT_ONBOARDING_STATE), 'account')
  assert.equal(isOnboardingFinished(DEFAULT_ONBOARDING_STATE), false)
})

test('account is never derived from settings — only answered', () => {
  assert.equal(isStepComplete('account', configuredSettings()), false)
})

test('the account step uses the same entry gate as the app for restored offline sessions', () => {
  const wizard = fs.readFileSync(
    path.join(ROOT, 'src/renderer/src/components/onboarding/OnboardingWizard.tsx'),
    'utf8',
  )

  assert.match(wizard, /canEnterApp\(s\.session\)/)
})

test('an output step needs an ENABLED output, not merely a configured one', () => {
  assert.equal(
    isStepComplete('output', settings({ overlay: { outputs: [{ enabled: false }] } as never })),
    false,
  )
  assert.equal(
    isStepComplete('output', settings({ overlay: { outputs: [{ enabled: true }] } as never })),
    true,
  )
})

test('either a Bible key or a transcription key satisfies the API-key step', () => {
  const bible = settings({ stt: { ...settings().stt, bibleApiKey: 'k' } })
  const deepgram = settings({ stt: { ...settings().stt, apiKey: 'k' } })
  assert.equal(isStepComplete('apiKeys', bible), true)
  assert.equal(isStepComplete('apiKeys', deepgram), true)
})

test('ProPresenter resources step sits directly after the connection step', () => {
  assert.deepEqual([...ONBOARDING_STEPS], [
    'account',
    'propresenter',
    'propresenterResources',
    'output',
    'apiKeys',
    'church',
  ])
})

test('ProPresenter resources step is complete when any binding is configured', () => {
  const configured = settings({
    propresenterResources: { ...EMPTY_PP_RESOURCE_BINDINGS, scriptureThemeId: 'theme-1' },
  })
  assert.equal(isStepComplete('propresenterResources', configured), true)
  assert.equal(isStepComplete('propresenterResources', settings()), false)
})

test('ProPresenter resources step can be skipped when discovery is unavailable', () => {
  let atResources = completeStep(DEFAULT_ONBOARDING_STATE, 'account')
  atResources = completeStep(atResources, 'propresenter')
  atResources = setCurrentStep(atResources, 'propresenterResources')
  const skipped = skipStep(atResources, 'propresenterResources')
  assert.deepEqual(skipped.skippedSteps, ['propresenterResources'])
  assert.equal(nextIncompleteStep(skipped), 'output')
})

test('a fully configured existing install never sees the wizard', () => {
  const full = configuredSettings()
  full.church = { name: 'Grace Chapel', timezone: 'Africa/Lagos', role: 'Operator', serviceTimes: [] }

  const state = seedOnboardingFromSettings(full, 1_000)
  assert.equal(state.source, 'legacy')
  assert.equal(isOnboardingFinished(state), true)
  assert.equal(shouldOfferOnboarding({ state, dismissedThisSession: false }), false)
})

test('a partly configured install resumes at the one step it is missing', () => {
  const state = seedOnboardingFromSettings(configuredSettings(), 1_000)
  assert.deepEqual(state.completedSteps, ['propresenter', 'output', 'apiKeys'])
  // Account cannot be derived, so it is answered as skipped rather than left
  // holding a working setup open.
  assert.deepEqual(state.skippedSteps, ['account', 'propresenterResources'])
  assert.equal(state.currentStep, 'church')
  assert.equal(isOnboardingFinished(state), false)
})

test('answering every step leaves nothing outstanding — but only Finish ends the wizard', () => {
  let state: OnboardingState = DEFAULT_ONBOARDING_STATE
  for (const step of ONBOARDING_STEPS) state = completeStep(state, step)
  assert.equal(nextIncompleteStep(state), null)
  // Recording answers never closes the wizard on the operator's behalf.
  assert.equal(state.completedAt, null)
  assert.equal(finishOnboarding(state, 2_000).completedAt, 2_000)
})

test('answering a step never moves the operator off it', () => {
  const answered = completeStep(DEFAULT_ONBOARDING_STATE, 'account')
  assert.equal(answered.currentStep, 'account')
  assert.equal(skipStep(answered, 'account').currentStep, 'account')
})

test('walking back and continuing goes one step along, not to the first gap', () => {
  // Steps 2-4 answered, operator walks back to step 1: Continue must show step
  // 2, not skip past everything answered and land on step 5.
  let state: OnboardingState = DEFAULT_ONBOARDING_STATE
  state = completeStep(state, 'propresenter')
  state = completeStep(state, 'propresenterResources')
  state = completeStep(state, 'output')
  state = skipStep(state, 'apiKeys')
  state = setCurrentStep(state, 'account')

  assert.equal(nextStep(state), 'propresenter')
  assert.equal(previousStep(state), null)

  state = setCurrentStep(state, nextStep(state)!)
  assert.equal(state.currentStep, 'propresenter')
  assert.equal(nextStep(state), 'propresenterResources')
  assert.equal(previousStep(state), 'account')

  state = setCurrentStep(state, nextStep(state)!)
  assert.equal(state.currentStep, 'propresenterResources')
  assert.equal(nextStep(state), 'output')
  assert.equal(previousStep(state), 'propresenter')
})

test('the last step has nowhere further to go', () => {
  const last = setCurrentStep(DEFAULT_ONBOARDING_STATE, 'church')
  assert.equal(nextStep(last), null)
  assert.equal(previousStep(last), 'apiKeys')
})

test('skipping counts as resolved but not as done', () => {
  const state = skipStep(DEFAULT_ONBOARDING_STATE, 'apiKeys')
  assert.deepEqual(state.skippedSteps, ['apiKeys'])
  assert.equal(state.completedSteps.includes('apiKeys'), false)
  assert.equal(onboardingProgress(state).resolved, 1)
  assert.equal(state.currentStep, 'account')
})

test('completing a step that was skipped earlier clears the skip', () => {
  const skipped = skipStep(DEFAULT_ONBOARDING_STATE, 'apiKeys')
  const done = completeStep(skipped, 'apiKeys')
  assert.deepEqual(done.skippedSteps, [])
  assert.deepEqual(done.completedSteps, ['apiKeys'])
})

test('finishing twice keeps the first completion time', () => {
  const first = finishOnboarding(DEFAULT_ONBOARDING_STATE, 100)
  assert.equal(finishOnboarding(first, 900).completedAt, 100)
})

test('a dismissed wizard stays down for the session', () => {
  assert.equal(
    shouldOfferOnboarding({ state: DEFAULT_ONBOARDING_STATE, dismissedThisSession: true }),
    false,
  )
  assert.equal(
    shouldOfferOnboarding({ state: DEFAULT_ONBOARDING_STATE, dismissedThisSession: false }),
    true,
  )
})

test('running setup again reopens the wizard without forgetting the install is legacy', () => {
  const finished = seedOnboardingFromSettings(configuredSettings(), 1_000)
  const reset = resetOnboarding(finished)
  assert.equal(reset.completedAt, null)
  assert.equal(reset.source, 'legacy')
  assert.deepEqual(reset.completedSteps, [])
})

test('the closing summary reports what the machine will actually do', () => {
  const configured = configuredSettings()
  configured.overlay = {
    outputs: [
      { enabled: true, name: 'Main screen' },
      { enabled: false, name: 'Lobby' },
    ],
  } as never
  configured.church = { name: 'Grace Chapel', timezone: 'Africa/Lagos', role: '', serviceTimes: [] }

  const summary = onboardingSummary(configured)
  assert.deepEqual(summary.map((line) => line.step), ['propresenter', 'output', 'apiKeys', 'church'])
  assert.equal(summary[0].detail, '192.168.1.164:57563')
  // Counted, not listed: output names overflow any layout they are put in.
  assert.equal(summary[1].detail, '1 turned on')
  assert.equal(summary[2].detail, 'API.Bible')
  assert.equal(summary[3].detail, 'Grace Chapel')
  assert.ok(summary.every((line) => line.done))
})

test('an untouched install summarises as unset rather than as blank', () => {
  const summary = onboardingSummary(settings())
  assert.deepEqual(summary.map((line) => line.done), [false, false, false, false])
  assert.equal(summary[0].detail, 'Not connected yet')
  assert.equal(summary[1].detail, 'None turned on')
  assert.equal(summary[2].detail, 'None — offline Bibles only')
  assert.equal(summary[3].detail, 'Not named')
})
