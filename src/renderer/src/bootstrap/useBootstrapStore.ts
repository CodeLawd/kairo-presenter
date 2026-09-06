import { create } from 'zustand'
import type {
  ApiBibleAuthorizationState,
  AppBootstrapSnapshot,
  AppSettings,
  AudioDevice,
  BootstrapProgress,
  BootstrapResourceError,
  LivePlanState,
  LyricsSong,
  NdiStatus,
  OnboardingState,
  OrchestratorStatus,
  ScriptureTranslationOption,
  SermonPlan,
  SettingsWithSecretsStatus,
  TranscriptResult,
} from '@shared/ipc'
import { normalizeOverlaySettings } from '@shared/overlay-defaults'
import { useAppStore } from '@/stores/useAppStore'
import { useAccountStore } from '@/stores/useAccountStore'
import { applyAppTheme } from '@/lib/appTheme'
import { DEFAULT_SETTINGS } from '@/lib/defaultSettings'
import { DEFAULT_ONBOARDING_STATE } from '@shared/cloud/onboarding'
import {
  createBootstrapRunner,
  getBootstrapPhase,
  type BootstrapPhase,
} from './bootstrap-state'

const INITIAL_PROGRESS: BootstrapProgress = {
  completed: 0,
  total: 1,
  step: 'Getting everything ready…',
}

interface BootstrapStore {
  phase: BootstrapPhase
  progress: BootstrapProgress
  errors: BootstrapResourceError[]
  warningDismissed: boolean
  startedAt: number | null

  // ── Shared startup data, kept current as screens mutate it ────────────────
  settings: SettingsWithSecretsStatus
  translations: ScriptureTranslationOption[]
  sermonPlans: SermonPlan[]
  livePlan: LivePlanState | null
  lyrics: LyricsSong[]
  transcription: TranscriptResult[]
  orchestrator: OrchestratorStatus | null
  onboarding: OnboardingState

  // ── Background integration state ──────────────────────────────────────────
  apiBibleAuth: ApiBibleAuthorizationState
  audioDevices: AudioDevice[]
  ndiStatus: NdiStatus | null

  start: () => Promise<void>
  retry: () => Promise<void>
  dismissWarning: () => void

  setSettings: (settings: SettingsWithSecretsStatus) => void
  patchSettings: <K extends keyof AppSettings>(section: K, value: AppSettings[K]) => void
  setTranslations: (options: ScriptureTranslationOption[]) => void
  setSermonPlans: (plans: SermonPlan[]) => void
  setLivePlan: (state: LivePlanState | null) => void
  setLyrics: (songs: LyricsSong[]) => void
  setApiBibleAuth: (state: ApiBibleAuthorizationState) => void
  setAudioDevices: (devices: AudioDevice[]) => void
  setNdiStatus: (status: NdiStatus | null) => void
  setOnboarding: (state: OnboardingState) => void
}

/**
 * Module-level so React Strict Mode's double effect invocation cannot start two
 * bootstraps. The renderer session gets exactly one.
 */
const runBootstrapOnce = createBootstrapRunner(() => window.api.app.bootstrap())

export const useBootstrapStore = create<BootstrapStore>((set, get) => ({
  phase: 'idle',
  progress: INITIAL_PROGRESS,
  errors: [],
  warningDismissed: false,
  startedAt: null,

  settings: DEFAULT_SETTINGS,
  translations: [],
  sermonPlans: [],
  livePlan: null,
  lyrics: [],
  transcription: [],
  orchestrator: null,
  onboarding: DEFAULT_ONBOARDING_STATE,

  apiBibleAuth: 'unchecked',
  audioDevices: [],
  ndiStatus: null,

  async start(): Promise<void> {
    if (get().phase !== 'idle') return
    set({ phase: 'loading', startedAt: Date.now() })
    await load(set, {})
  },

  async retry(): Promise<void> {
    set({ phase: 'loading', errors: [], warningDismissed: false, progress: INITIAL_PROGRESS })
    await load(set, { force: true })
  },

  dismissWarning: () => set({ warningDismissed: true }),

  setSettings: (settings) => set({ settings: withNormalizedOverlay(settings) }),
  patchSettings: (section, value) =>
    set((state) => ({
      settings: withNormalizedOverlay({ ...state.settings, [section]: value }),
    })),
  setTranslations: (translations) => set({ translations }),
  setSermonPlans: (sermonPlans) => set({ sermonPlans }),
  setLivePlan: (livePlan) => set({ livePlan }),
  setLyrics: (lyrics) => set({ lyrics }),
  setApiBibleAuth: (apiBibleAuth) => set({ apiBibleAuth }),
  setAudioDevices: (audioDevices) => set({ audioDevices }),
  setNdiStatus: (ndiStatus) => set({ ndiStatus }),
  setOnboarding: (onboarding) => set({ onboarding }),
}))

type SetState = (partial: Partial<BootstrapStore>) => void

async function load(set: SetState, options: { force?: boolean }): Promise<void> {
  // Subscribe before invoking so no progress event is missed.
  const unsubscribe = window.api.app.onBootstrapProgress((progress) => set({ progress }))
  try {
    applySnapshot(set, await runBootstrapOnce(options))
  } catch (error) {
    // The IPC call itself failed: open the app on defaults rather than trap the
    // operator on a loading screen they cannot leave.
    set({
      phase: 'ready-with-warnings',
      errors: [{ resource: 'settings', message: (error as Error).message }],
    })
  } finally {
    unsubscribe()
  }
}

function applySnapshot(set: SetState, snapshot: AppBootstrapSnapshot): void {
  const settings = snapshot.settings ? withNormalizedOverlay(snapshot.settings) : DEFAULT_SETTINGS
  applyAppTheme(settings.display.theme)
  hydrateRuntimeStore(snapshot, settings)

  set({
    phase: getBootstrapPhase(snapshot.errors),
    errors: snapshot.errors,
    settings,
    translations: snapshot.translations,
    sermonPlans: snapshot.sermonPlans,
    livePlan: snapshot.livePlan,
    lyrics: snapshot.lyrics,
    transcription: snapshot.transcription,
    orchestrator: snapshot.orchestrator,
    onboarding: snapshot.onboarding ?? DEFAULT_ONBOARDING_STATE,
  })
}

/** Fills the existing Zustand runtime fields the screens already read. */
function hydrateRuntimeStore(snapshot: AppBootstrapSnapshot, settings: AppSettings): void {
  const store = useAppStore.getState()
  if (snapshot.orchestrator) {
    store.setIsTranscribing(snapshot.orchestrator.running)
    store.setAudioCapturing(snapshot.orchestrator.running)
    useAppStore.setState({ scriptureProjectedCount: snapshot.orchestrator.totalPresentations })
  }
  if (snapshot.propresenter) store.setPPStatus(snapshot.propresenter)
  // Read from the local token vault at launch, so the account is known before
  // the first paint and no screen ever waits on the network for it.
  if (snapshot.account) useAccountStore.getState().setSession(snapshot.account)
  store.setAutoMode(settings.scripture.autoMode, settings.scripture.confidenceThreshold)
  store.setCaptureDeviceId(settings.audio.deviceId || '')
}

function withNormalizedOverlay(settings: SettingsWithSecretsStatus): SettingsWithSecretsStatus {
  return {
    ...settings,
    overlay: normalizeOverlaySettings(settings.overlay),
    secretsConfigured: settings.secretsConfigured ?? DEFAULT_SETTINGS.secretsConfigured,
  }
}

let settingsChangedBound = false

/**
 * Non-blocking integration hydration, started once the interface is open.
 * Nothing here may prevent or delay startup.
 */
export async function hydrateIntegrations(): Promise<void> {
  // Keep write-only secret status in sync after vault pull / key save.
  // Subscribed here (not at module load) so `window.api` is definitely ready.
  if (!settingsChangedBound) {
    settingsChangedBound = true
    window.api.settings.onChanged((next) => {
      useBootstrapStore.getState().setSettings(next)
      if (next.secretsConfigured.bible) {
        void window.api.scripture
          .getTranslations()
          .then((translations) => {
            useBootstrapStore.getState().setTranslations(translations)
            useBootstrapStore.getState().setApiBibleAuth('authorized')
          })
          .catch(() => {
            /* network blip — leave auth as-is */
          })
      }
    })
  }

  const { setApiBibleAuth, setAudioDevices, setNdiStatus, setTranslations } =
    useBootstrapStore.getState()
  const bibleConfigured = useBootstrapStore.getState().settings.secretsConfigured.bible

  const validateApiBible = async (): Promise<void> => {
    if (!bibleConfigured) {
      setApiBibleAuth('unauthorized')
      return
    }
    setApiBibleAuth('checking')
    try {
      // No key in the renderer — main uses the stored value.
      setTranslations(await window.api.scripture.getTranslations())
      setApiBibleAuth('authorized')
    } catch (error) {
      // A refusal is definitive; anything else (no network, DNS) is not.
      setApiBibleAuth(isAuthorizationFailure(error) ? 'unauthorized' : 'offline')
    }
  }

  await Promise.allSettled([
    validateApiBible(),
    // Device labels only — never prompts for microphone permission.
    window.api.audio.getDevices().then(setAudioDevices),
    window.api.ndi.getStatus().then(setNdiStatus),
  ])
}

function isAuthorizationFailure(error: unknown): boolean {
  const message = (error as Error)?.message ?? ''
  return /401|403|unauthor|not authorized|invalid api key/i.test(message)
}
