import type { ApiBibleDownloadProgress, ApiBibleOfflineTranslation } from '@shared/ipc'

export type OfflineBibleAction = 'download' | 'resume' | 'pause' | 'refresh' | 'retry' | 'remove'

/**
 * Actions an operator may take on a cached API.Bible translation. Anything that
 * would fetch new licensed content is gated on the confirmed offline licence.
 */
export function getOfflineBibleActions(row: ApiBibleOfflineTranslation): OfflineBibleAction[] {
  const fetching = row.offlineDownloadEnabled
  switch (row.status) {
    case 'downloading':
      return ['pause']
    case 'downloaded':
      return ['remove']
    case 'stale':
      return fetching ? ['refresh', 'remove'] : ['remove']
    case 'paused':
    case 'partial':
      return fetching ? ['resume', 'remove'] : ['remove']
    case 'failed':
      return fetching ? ['retry', 'remove'] : ['remove']
    case 'unavailable':
      return ['remove']
    case 'not-downloaded':
    default:
      return fetching ? ['download'] : []
  }
}

export const OFFLINE_BIBLE_ACTION_LABELS: Record<OfflineBibleAction, string> = {
  download: 'Download',
  resume: 'Resume',
  pause: 'Pause',
  refresh: 'Refresh',
  retry: 'Retry',
  remove: 'Remove',
}

export function getOfflineBibleStatusLabel(row: ApiBibleOfflineTranslation): string {
  switch (row.status) {
    case 'downloading':
      return `Downloading ${row.cachedChapters} of ${row.totalChapters} chapters`
    case 'downloaded':
      return 'Downloaded'
    case 'paused':
      return `Paused at ${row.cachedChapters} of ${row.totalChapters} chapters`
    case 'partial':
      return 'Partially cached'
    case 'stale':
      return 'Refresh required'
    case 'unavailable':
      return 'No longer licensed'
    case 'failed':
      return row.error ? `Failed — ${row.error}` : 'Failed'
    case 'not-downloaded':
    default:
      return 'Not downloaded'
  }
}

export function getOfflineBibleProgressPercent(row: ApiBibleOfflineTranslation): number {
  if (row.totalChapters <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((row.cachedChapters / row.totalChapters) * 100)))
}

/** Licensed text stops being displayable at `expiresAt`, so surface the date. */
export function formatOfflineBibleExpiry(
  row: ApiBibleOfflineTranslation,
  now = Date.now(),
): string {
  if (row.expiresAt === null) return ''
  if (row.expiresAt <= now) return 'Expired'
  const date = new Date(row.expiresAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
  return `Expires ${date}`
}

/** Applies a pushed progress event to the matching row, leaving others intact. */
export function mergeOfflineDownloadProgress(
  rows: ApiBibleOfflineTranslation[],
  progress: ApiBibleDownloadProgress,
): ApiBibleOfflineTranslation[] {
  return rows.map((row) =>
    row.bibleId === progress.bibleId
      ? {
          ...row,
          status: progress.status,
          cachedChapters: progress.completedChapters,
          totalChapters: progress.totalChapters,
          cachedVerses: progress.cachedVerses,
          ...(progress.cachedVerses === 0 ? { fetchedAt: null, expiresAt: null } : {}),
          ...(progress.error ? { error: progress.error } : { error: undefined }),
        }
      : row,
  )
}
