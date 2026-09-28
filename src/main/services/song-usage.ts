import Store from 'electron-store'
import log from 'electron-log/main'
import type { LyricsSong } from '@shared/ipc'
import {
  isNewSongUse,
  normalizeSongUsageEntries,
  songUsageBetween,
  type SongUsageEntry,
} from '@shared/song-usage'

// ─── Song usage (standalone phase 3, E13) ─────────────────────────────────────
// One entry per song per service, for CCLI reporting. Its own store file —
// it grows with every service and has nothing to do with settings.

class SongUsageService {
  private store: Store<{ entries: SongUsageEntry[] }> | null = null
  /**
   * Loaded once. `store.get` re-reads and parses the whole file, which grows
   * with every service — too much for every lyric push.
   */
  private cache: SongUsageEntry[] | null = null

  private db(): Store<{ entries: SongUsageEntry[] }> {
    this.store ??= new Store<{ entries: SongUsageEntry[] }>({ name: 'song-usage', defaults: { entries: [] } })
    return this.store
  }

  private entries(): SongUsageEntry[] {
    this.cache ??= normalizeSongUsageEntries(this.db().get('entries'))
    return this.cache
  }

  private save(entries: SongUsageEntry[]): void {
    this.cache = entries
    this.db().set('entries', entries)
  }

  /** Called on every lyric slide push; records the song once per service. */
  record(song: Pick<LyricsSong, 'id' | 'title' | 'artist' | 'ccliNumber' | 'copyright'>, now = Date.now()): void {
    try {
      const entries = this.entries()
      if (!isNewSongUse(entries, song.id, now)) return
      this.save([...entries, {
        songId: song.id,
        title: song.title,
        artist: song.artist,
        ccliNumber: song.ccliNumber ?? '',
        copyright: song.copyright ?? '',
        at: now,
      }])
    } catch (err) {
      // Reporting must never get in the way of a slide going up.
      log.warn('[SongUsage] Could not record song use', (err as Error).message)
    }
  }

  list(from: number, to: number): SongUsageEntry[] {
    return songUsageBetween(this.entries(), from, to)
  }

  clearBefore(before: number): void {
    this.save(this.entries().filter((e) => e.at >= before))
  }
}

export const songUsageService = new SongUsageService()
