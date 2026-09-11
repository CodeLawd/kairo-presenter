import type { ServiceArchiveStorage } from '../src/lib/service-archive'
import type { ServiceSnapshot } from '../src/lib/service-records'
import type { TranscriptResult } from '../src/lib/ipc'

/** The archive store, in memory. Clones on every access, as electron-store does. */
export class MemoryStorage implements ServiceArchiveStorage {
  private value: ServiceSnapshot = { activeId: null, services: [] }
  get store(): ServiceSnapshot { return structuredClone(this.value) }
  set store(value: ServiceSnapshot) { this.value = structuredClone(value) }
  get<K extends keyof ServiceSnapshot>(key: K): ServiceSnapshot[K] {
    return structuredClone(this.value[key])
  }
  set<K extends keyof ServiceSnapshot>(key: K, value: ServiceSnapshot[K]): void {
    this.value[key] = structuredClone(value)
  }
}

/** One final transcript segment. Word timings are included by default. */
export function transcriptSegment(
  id: string,
  text: string,
  overrides: Partial<TranscriptResult> = {},
): TranscriptResult {
  return {
    id,
    text,
    isFinal: true,
    timestamp: Date.now(),
    duration: 3,
    words: [{ word: text.split(' ')[0] ?? '', start: 1, end: 1.5, confidence: 0.9 }],
    ...overrides,
  }
}
