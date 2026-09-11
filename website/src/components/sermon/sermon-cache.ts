import type { SermonDetail, SermonListItem } from '@/lib/sermons'

/**
 * Recaps already fetched this session.
 *
 * Switching sermons remounts the route child; this map is what lets the
 * reader land on a recap it has already seen without a loading flash.
 */
const cache = new Map<string, SermonDetail>()

type SermonChange =
  | { type: 'upsert'; detail: SermonDetail }
  | { type: 'forget'; id: string }

type Listener = (change: SermonChange) => void
const listeners = new Set<Listener>()

function emit(change: SermonChange): void {
  for (const listener of listeners) listener(change)
}

export function peekSermon(id: string): SermonDetail | undefined {
  return cache.get(id)
}

export function rememberSermon(detail: SermonDetail): void {
  cache.set(detail.id, detail)
  emit({ type: 'upsert', detail })
}

export function forgetSermon(id: string): void {
  cache.delete(id)
  emit({ type: 'forget', id })
}

/** The recap list lives in the layout; this is how the open recap tells it to update. */
export function onSermonsChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function listItemFrom(detail: SermonDetail): SermonListItem {
  return {
    id: detail.id,
    title: detail.title,
    speaker: detail.speaker,
    preachedAt: detail.preachedAt,
    durationMs: detail.durationMs,
    wordCount: detail.wordCount,
    status: detail.status,
    headline: detail.summary?.headline ?? detail.headline,
    shareEnabled: detail.shareEnabled,
  }
}
