// ─── Onboarding — first-run wizard state (phase 1) ─────────────────────────────
// Pure — no Node/DOM APIs — importable from main, preload, and renderer alike.
//
// The wizard is a guided path from a blank install to a first slide on the wall.
// Every predicate below answers "has the operator already done this?" from the
// settings they ALREADY have, which is what lets an existing install skip the
// wizard entirely instead of being marched through five screens it has no need
// for (see `deriveCompletedSteps`).

import type { AppSettings, OnboardingState, OnboardingStepId } from '../ipc'
import { setupUsesPropresenter } from '../pp-connect-gate'

/**
 * First run, once per install: the tour, then the account (signed-out
 * operators create or sign into one here), then this computer's screens.
 * The church name comes from sign-up; integrations stay in Settings.
 */
export const ONBOARDING_STEPS: readonly OnboardingStepId[] = ['welcome', 'account', 'output']

export function onboardingSteps(
  _settings: Pick<AppSettings, 'overlay'> & Partial<Pick<AppSettings, 'propresenterResources'>>,
): OnboardingStepId[] {
  return [...ONBOARDING_STEPS]
}

/** Heal old saved positions while preserving the operator's completion decision. */
export function normalizeOnboardingState(raw: unknown): OnboardingState {
  const value = raw && typeof raw === 'object' ? raw as Partial<OnboardingState> : {}
  const steps = (list: unknown): OnboardingStepId[] => Array.isArray(list)
    ? ONBOARDING_STEPS.filter((step) => list.includes(step)) : []
  return {
    completedSteps: steps(value.completedSteps),
    skippedSteps: steps(value.skippedSteps),
    currentStep: ONBOARDING_STEPS.includes(value.currentStep as OnboardingStepId)
      ? value.currentStep as OnboardingStepId : 'welcome',
    completedAt: typeof value.completedAt === 'number' && Number.isFinite(value.completedAt)
      ? value.completedAt : null,
    source: value.source === 'legacy' ? 'legacy' : 'fresh',
  }
}

export function onboardingStepLabel(step: OnboardingStepId): string {
  if (step === 'welcome') return 'Welcome'
  if (step === 'account') return 'Account'
  if (step === 'propresenter') return 'ProPresenter'
  if (step === 'propresenterResources') return 'ProPresenter resources'
  if (step === 'output') return 'Output'
  if (step === 'apiKeys') return 'API keys'
  return 'Church profile'
}

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  completedSteps: [],
  skippedSteps: [],
  currentStep: 'welcome',
  completedAt: null,
  source: 'fresh',
}

/**
 * Whether `step` is already satisfied by what is configured.
 *
 * `account` still answers false here: whether someone is signed in lives in the
 * encrypted token vault, not in `AppSettings`, and this module may not read it.
 * The wizard marks that step complete itself when a sign-in succeeds.
 */
export function isStepComplete(step: OnboardingStepId, settings: AppSettings): boolean {
  if (step === 'propresenter') return settings.propresenter.host.trim() !== ''
  if (step === 'propresenterResources') {
    return Object.values(settings.propresenterResources ?? {}).some(
      (value) => typeof value === 'string' && value.trim() !== '',
    )
  }
  if (step === 'output') return settings.overlay.outputs.some((output) =>
    output.enabled && output.kind === 'screen' && typeof output.displayId === 'number')
  if (step === 'apiKeys') {
    const configured = (settings as AppSettings & {
      secretsConfigured?: { bible?: boolean; deepgram?: boolean }
    }).secretsConfigured
    if (configured) {
      return Boolean(configured.bible || configured.deepgram)
    }
    return settings.stt.bibleApiKey.trim() !== '' || settings.stt.apiKey.trim() !== ''
  }
  if (step === 'church') return settings.church.name.trim() !== ''
  return false
}

/**
 * The steps an existing install has effectively already done.
 *
 * This is the whole migration story: someone who has been running services for
 * months has a ProPresenter host, an enabled output and an API key, so the
 * wizard must not appear in front of them on the Sunday they update.
 */
export function deriveCompletedSteps(settings: AppSettings): OnboardingStepId[] {
  return ONBOARDING_STEPS.filter((step) => isStepComplete(step, settings))
}

/** Steps neither completed nor deliberately skipped, in wizard order. */
export function remainingSteps(state: OnboardingState): OnboardingStepId[] {
  return ONBOARDING_STEPS.filter(
    (step) => !state.completedSteps.includes(step) && !state.skippedSteps.includes(step),
  )
}

export function nextIncompleteStep(state: OnboardingState): OnboardingStepId | null {
  return remainingSteps(state)[0] ?? null
}

/** Skipped counts as resolved — the operator answered, they answered "not now". */
export function onboardingProgress(state: OnboardingState): {
  resolved: number
  total: number
  ratio: number
} {
  const total = ONBOARDING_STEPS.length
  const resolved = total - remainingSteps(state).length
  return { resolved, total, ratio: total === 0 ? 1 : resolved / total }
}

export function isOnboardingFinished(state: OnboardingState): boolean {
  return state.completedAt !== null
}

// ─── Reducers ─────────────────────────────────────────────────────────────────
// Kept pure so the main-process service is a thin persistence shell and every
// transition is testable under `tsx --test`.

/**
 * Recording an answer never moves the operator.
 *
 * Which steps are answered is a SET; where the operator is standing is a
 * POSITION, and the two must not be wired together. Jumping to the first
 * unanswered step on every answer means going back to step 1 with steps 2-4
 * already answered lands you on step 5 — the wizard skipping past the very
 * screens you walked back to see. Navigation is `nextStep`/`previousStep`,
 * one step at a time, always.
 */
export function completeStep(state: OnboardingState, step: OnboardingStepId): OnboardingState {
  return {
    ...state,
    completedSteps: state.completedSteps.includes(step)
      ? state.completedSteps
      : [...state.completedSteps, step],
    // Completing a step the operator skipped earlier clears the skip.
    skippedSteps: state.skippedSteps.filter((id) => id !== step),
  }
}

export function skipStep(state: OnboardingState, step: OnboardingStepId): OnboardingState {
  if (state.completedSteps.includes(step)) return state
  return {
    ...state,
    skippedSteps: state.skippedSteps.includes(step)
      ? state.skippedSteps
      : [...state.skippedSteps, step],
  }
}

export function setCurrentStep(state: OnboardingState, step: OnboardingStepId): OnboardingState {
  return { ...state, currentStep: step }
}

/** The step one position along, or null at the end of the wizard. */
export function nextStep(state: OnboardingState): OnboardingStepId | null {
  return ONBOARDING_STEPS[stepIndex(state.currentStep) + 1] ?? null
}

/** The step one position back, or null on the first screen. */
export function previousStep(state: OnboardingState): OnboardingStepId | null {
  const index = stepIndex(state.currentStep)
  return index <= 0 ? null : ONBOARDING_STEPS[index - 1]
}

export function stepIndex(step: OnboardingStepId): number {
  return Math.max(0, ONBOARDING_STEPS.indexOf(step))
}

/** Ends the wizard wherever it stands — the "Skip setup" / "Done" exit. */
export function finishOnboarding(state: OnboardingState, now = Date.now()): OnboardingState {
  return { ...state, completedAt: state.completedAt ?? now }
}

/** "Run setup again" from Settings — reopens the wizard without losing settings. */
export function resetOnboarding(state: OnboardingState): OnboardingState {
  return { ...DEFAULT_ONBOARDING_STATE, source: state.source }
}

/** Seed older installs without making a working setup repeat the introduction. */
export function seedOnboardingFromSettings(
  settings: AppSettings,
  now = Date.now(),
): OnboardingState {
  const completedSteps = deriveCompletedSteps(settings)
  if (completedSteps.length === 0 && !settings.propresenter.host.trim() &&
      !isStepComplete('apiKeys', settings) && !isStepComplete('church', settings)) {
    return { ...DEFAULT_ONBOARDING_STATE, completedSteps: [], skippedSteps: [] }
  }
  // Someone already running services skips the tour, and their sign-in is the
  // launch gate's job, not setup's.
  const state: OnboardingState = {
    ...DEFAULT_ONBOARDING_STATE,
    source: 'legacy',
    completedSteps,
    skippedSteps: ['welcome', 'account'],
  }
  // Pre-wizard installs with a working integration should not be interrupted.
  if (!state.completedSteps.includes('output') && settings.propresenter.host.trim() &&
      settings.overlay.outputs.some((output) => output.enabled && output.kind !== 'screen')) {
    state.completedSteps.push('output')
  }
  const resume = nextIncompleteStep(state)
  // Nothing left to answer: the install is already set up, so the wizard is
  // finished rather than opened on a screen with nothing to do.
  if (!resume) return finishOnboarding(state, now)
  return { ...state, currentStep: resume }
}

/** Whether the wizard should sit in front of the operator. */
export function shouldOfferOnboarding(input: {
  state: OnboardingState
  dismissedThisSession: boolean
}): boolean {
  if (input.dismissedThisSession) return false
  return !isOnboardingFinished(input.state)
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export interface OnboardingSummaryLine {
  step: OnboardingStepId
  label: string
  /** What was actually configured, or why the line is unset. */
  detail: string
  done: boolean
}

/** One line for the closing screen: what this machine will do on Sunday. */
export interface OnboardingReadiness {
  /** Chips, in the order the wizard asked for them. */
  lines: OnboardingSummaryLine[]
  /** Steps still unset — what "Finish in Settings" would be for. */
  outstanding: OnboardingSummaryLine[]
  ready: boolean
}

export function onboardingReadiness(settings: AppSettings): OnboardingReadiness {
  const lines = onboardingSummary(settings)
  const outstanding = lines.filter((line) => !line.done)
  // "Ready" means a verse can actually reach a screen: somewhere to send to,
  // and a ProPresenter host when the setup goes through ProPresenter. A church name and an API key are conveniences.
  const ready = lines.every((line) => line.done || line.step === 'apiKeys' || line.step === 'church')
  return { lines, outstanding, ready }
}

/**
 * What the operator just set up, for the closing screen.
 *
 * Reads settings rather than the answered-set: a step can be marked complete and
 * then edited, and what matters at the end is what the machine will actually do
 * on Sunday — not which buttons were pressed to get there.
 */
export function onboardingSummary(settings: AppSettings): OnboardingSummaryLine[] {
  const enabledOutputs = settings.overlay.outputs.filter((output) => output.enabled)
  // Keys are write-only in the renderer: once saved, `stt.bibleApiKey` /
  // `stt.apiKey` are redacted to '' and only `secretsConfigured` proves they
  // exist. The API-keys step already reads the vault flags — the summary must
  // too, or it reports "None" right after a successful save.
  const configured = (
    settings as AppSettings & {
      secretsConfigured?: { bible?: boolean; deepgram?: boolean }
    }
  ).secretsConfigured
  const hasBible = configured
    ? Boolean(configured.bible)
    : settings.stt.bibleApiKey.trim() !== ''
  const hasDeepgram = configured
    ? Boolean(configured.deepgram)
    : settings.stt.apiKey.trim() !== ''
  const keys = [
    hasBible ? 'API.Bible' : null,
    hasDeepgram ? 'Deepgram' : null,
  ].filter((key): key is string => key !== null)

  const lines: OnboardingSummaryLine[] = [
    {
      step: 'output',
      label: 'Outputs',
      // A count, not a list of names — four output names overflow every layout
      // they are put in, and the names are one click away in Theme.
      detail:
        enabledOutputs.length > 0
          ? `${enabledOutputs.length} turned on`
          : 'None turned on',
      done: enabledOutputs.length > 0,
    },
    {
      step: 'apiKeys',
      label: 'API keys',
      detail: keys.length > 0 ? keys.join(', ') : 'None — offline Bibles only',
      done: keys.length > 0,
    },
    {
      step: 'church',
      label: 'Church',
      detail: settings.church.name.trim() || 'Not named',
      done: settings.church.name.trim() !== '',
    },
  ]
  if (!setupUsesPropresenter(settings.overlay, settings.propresenterResources?.ndiVideoInputId)) return lines
  return [
    {
      step: 'propresenter',
      label: 'ProPresenter',
      detail: settings.propresenter.host.trim()
        ? `${settings.propresenter.host}:${settings.propresenter.port}`
        : 'Not connected yet',
      done: settings.propresenter.host.trim() !== '',
    },
    ...lines,
  ]
}
