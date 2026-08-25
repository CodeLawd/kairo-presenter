import type {
  ApiBibleAuthorizationState,
  AppBootstrapSnapshot,
  BootstrapProgress,
  BootstrapResource,
  BootstrapResourceError,
} from '@shared/ipc'

/** Keeps the loading screen from flashing on a fast machine. */
export const BOOTSTRAP_MIN_VISIBLE_MS = 500

export type BootstrapPhase = 'idle' | 'loading' | 'ready' | 'ready-with-warnings'

const RESOURCE_LABELS: Record<BootstrapResource, string> = {
  settings: 'settings',
  orchestrator: 'automation status',
  propresenter: 'ProPresenter status',
  transcription: 'transcript history',
  translations: 'Bible translations',
  sermonPlans: 'scripture playlists',
  livePlan: 'live playlist',
  lyrics: 'song library',
}

/** A failed resource opens the app with a warning; it never blocks entry. */
export function getBootstrapPhase(errors: BootstrapResourceError[]): BootstrapPhase {
  return errors.length > 0 ? 'ready-with-warnings' : 'ready'
}

export function describeBootstrapWarning(errors: BootstrapResourceError[]): string {
  if (errors.length === 0) return ''
  const names = errors.map((error) => RESOURCE_LABELS[error.resource] ?? error.resource)
  return `Some data could not be loaded at startup: ${names.join(', ')}.`
}

export function getBootstrapPercent(progress: BootstrapProgress): number {
  if (progress.total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((progress.completed / progress.total) * 100)))
}

/**
 * Scripture must stay quiet about the API.Bible key until authorization is
 * actually known — a warning during startup or an offline service is noise.
 */
export function shouldShowApiBibleWarning(
  state: ApiBibleAuthorizationState,
  hasKey: boolean,
  settingsKnown = true,
): boolean {
  // Before startup delivers settings, "no key" is an assumption, not a fact.
  if (!settingsKnown) return false
  if (!hasKey) return true
  return state === 'unauthorized'
}

export interface BootstrapRunOptions {
  /** Discards the memoized result so a failed bootstrap can be retried. */
  force?: boolean
}

/**
 * Memoizes the bootstrap call for the renderer session. React Strict Mode
 * mounts effects twice in development, which must not mean two bootstraps.
 */
export function createBootstrapRunner(
  invoke: () => Promise<AppBootstrapSnapshot>,
): (options?: BootstrapRunOptions) => Promise<AppBootstrapSnapshot> {
  let pending: Promise<AppBootstrapSnapshot> | null = null
  return (options = {}) => {
    if (options.force) pending = null
    if (!pending) {
      pending = invoke().catch((error: unknown) => {
        pending = null // a failure must not be cached as the session's result
        throw error
      })
    }
    return pending
  }
}
