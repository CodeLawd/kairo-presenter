import type {
  AppBootstrapSnapshot,
  AppSettings,
  BootstrapProgress,
  BootstrapResource,
  BootstrapResourceError,
  LivePlanState,
  LyricsSong,
  OrchestratorStatus,
  ProPresenterStatus,
  ScriptureTranslationOption,
  SermonPlan,
  TranscriptResult,
} from '@shared/ipc'

/** Hard ceiling on how long startup may block the interface. */
export const BOOTSTRAP_TIMEOUT_MS = 8_000

export interface BootstrapLoaders {
  settings: () => Promise<AppSettings>
  orchestrator: () => Promise<OrchestratorStatus>
  propresenter: () => Promise<ProPresenterStatus>
  transcription: () => Promise<TranscriptResult[]>
  translations: () => Promise<ScriptureTranslationOption[]>
  sermonPlans: () => Promise<SermonPlan[]>
  livePlan: () => Promise<LivePlanState>
  lyrics: () => Promise<LyricsSong[]>
}

export interface BootstrapStep {
  resource: BootstrapResource
  /** Sentence fragment shown as "Loading {label}…". */
  label: string
}

/**
 * Local essentials only. Remote searches, Bible downloads, microphone
 * permission, NDI probing, and ProPresenter libraries are deliberately absent —
 * they hydrate in the background once the interface is open.
 */
export const BOOTSTRAP_STEPS: BootstrapStep[] = [
  { resource: 'settings', label: 'settings' },
  { resource: 'orchestrator', label: 'automation status' },
  { resource: 'propresenter', label: 'ProPresenter status' },
  { resource: 'transcription', label: 'transcript history' },
  { resource: 'translations', label: 'Bible translations' },
  { resource: 'sermonPlans', label: 'scripture playlists' },
  { resource: 'livePlan', label: 'live playlist' },
  { resource: 'lyrics', label: 'song library' },
]

export interface RunBootstrapOptions {
  onProgress?: (progress: BootstrapProgress) => void
  timeoutMs?: number
}

/** Neutral values so a failed resource still renders an empty state, not a crash. */
const EMPTY: Record<BootstrapResource, unknown> = {
  settings: null,
  orchestrator: null,
  propresenter: null,
  transcription: [],
  translations: [],
  sermonPlans: [],
  livePlan: null,
  lyrics: [],
}

/**
 * Loads every startup resource concurrently. One failure never discards the
 * others, and the whole run is capped so an unresponsive resource cannot keep
 * the operator on the loading screen.
 */
export async function runBootstrap(
  loaders: BootstrapLoaders,
  options: RunBootstrapOptions = {},
): Promise<AppBootstrapSnapshot> {
  const timeoutMs = options.timeoutMs ?? BOOTSTRAP_TIMEOUT_MS
  const total = BOOTSTRAP_STEPS.length
  const values = new Map<BootstrapResource, unknown>()
  const errors: BootstrapResourceError[] = []
  const settled = new Set<BootstrapResource>()

  let lastEmitted = ''
  const emit = (step: string): void => {
    // Skip repeats so the renderer sees one event per real transition.
    if (step === lastEmitted && settled.size === total) return
    lastEmitted = step
    options.onProgress?.({ completed: settled.size, total, step })
  }
  const nextLabel = (): string => {
    const pending = BOOTSTRAP_STEPS.find((step) => !settled.has(step.resource))
    return pending ? `Loading ${pending.label}…` : 'Ready'
  }

  emit('Starting ProAutomate…')

  const tasks = BOOTSTRAP_STEPS.map(async (step) => {
    try {
      values.set(step.resource, await loaders[step.resource]())
    } catch (error) {
      errors.push({ resource: step.resource, message: (error as Error).message })
    } finally {
      settled.add(step.resource)
      emit(nextLabel())
    }
  })

  let timer: NodeJS.Timeout | undefined
  await Promise.race([
    Promise.allSettled(tasks),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
    }),
  ])
  if (timer) clearTimeout(timer)

  // Whatever is still in flight is abandoned rather than awaited — its result
  // would arrive after the interface has already opened.
  for (const step of BOOTSTRAP_STEPS) {
    if (settled.has(step.resource)) continue
    settled.add(step.resource)
    errors.push({
      resource: step.resource,
      message: `Loading ${step.label} timed out after ${timeoutMs}ms.`,
    })
  }
  emit('Ready')

  const read = <T,>(resource: BootstrapResource): T =>
    (values.has(resource) ? values.get(resource) : EMPTY[resource]) as T

  return {
    settings: read('settings'),
    orchestrator: read('orchestrator'),
    propresenter: read('propresenter'),
    transcription: read('transcription'),
    translations: read('translations'),
    sermonPlans: read('sermonPlans'),
    livePlan: read('livePlan'),
    lyrics: read('lyrics'),
    errors,
    completedAt: Date.now(),
  }
}
