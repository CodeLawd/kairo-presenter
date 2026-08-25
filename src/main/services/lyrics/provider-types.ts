import type { LyricsOnlineResult } from '@shared/ipc'

/**
 * What a provider hands the aggregator, before ranking.
 *
 * The extra fields are ranking inputs and never cross the IPC boundary — the
 * aggregator strips them once it has ordered the list.
 */
export interface ProviderResult extends LyricsOnlineResult {
  /**
   * Full lyric text, when the provider returns it inline with search results.
   * Lets the aggregator confirm a snippet match without a second request.
   */
  lyrics?: string
  /** Provider-reported popularity, used only to break ties between close hits. */
  popularity?: number
}
