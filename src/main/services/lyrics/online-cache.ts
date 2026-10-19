import type { LyricsOnlineResult } from '@shared/ipc'

type Source = Pick<LyricsOnlineResult, 'provider' | 'url' | 'title'>
const sourceKey = (source: Source): string => JSON.stringify([source.provider, source.url, source.title])

/** Search already fetches many lyric bodies. Keep them inside main for preview/import. */
export class OnlineLyricsTextCache {
  private readonly entries = new Map<string, { text: string; expires: number }>()

  remember(source: Source, text: string): void {
    if (!text.trim()) return
    const now = Date.now()
    for (const [key, entry] of this.entries) if (entry.expires <= now) this.entries.delete(key)
    const key = sourceKey(source)
    this.entries.delete(key)
    this.entries.set(key, { text, expires: now + 10 * 60_000 })
    while (this.entries.size > 50) this.entries.delete(this.entries.keys().next().value!)
  }

  get(source: Source): string | undefined {
    const key = sourceKey(source)
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expires <= Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry.text
  }
}

/** No queue: obsolete searches cannot build up a backlog of paid reviews. */
export class OnlinePreviewPrefetcher {
  private readonly active = new Set<string>()

  async warm(results: LyricsOnlineResult[], prepare: (source: LyricsOnlineResult) => Promise<unknown>): Promise<void> {
    const work: Promise<void>[] = []
    for (const source of results.filter((result) => !result.existingSongId).slice(0, 2)) {
      const key = sourceKey(source)
      if (this.active.has(key) || this.active.size >= 2) continue
      this.active.add(key)
      // The async body starts immediately; results never wait for these requests.
      work.push((async () => {
        try { await prepare(source) } catch { /* A selected preview can retry normally. */ }
        finally { this.active.delete(key) }
      })())
    }
    await Promise.all(work)
  }
}

export const onlineLyricsTextCache = new OnlineLyricsTextCache()
