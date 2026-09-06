import { randomUUID } from 'node:crypto'
import type { SermonPlan, ScriptureSuggestion, TranscriptResult } from './ipc'
import { extractNuggetQuotes, type ServiceSnapshot, type ServiceRecord } from './service-records'

export interface ServiceArchiveStorage {
  store: ServiceSnapshot
  get<K extends keyof ServiceSnapshot>(key: K): ServiceSnapshot[K]
  set<K extends keyof ServiceSnapshot>(key: K, value: ServiceSnapshot[K]): void
}

export class ServiceRecords {
  constructor(private readonly db: ServiceArchiveStorage, private readonly selectQuotes: (text: string) => Promise<string>) {}
  private listeners: Array<(snapshot: ServiceSnapshot) => void> = []
  private pending = new Map<string, TranscriptResult[]>()
  private processing = false
  private timer: ReturnType<typeof setInterval> | null = null

  init(): void {
    // Legacy stores used 'paused' when transcription stopped; that meant the
    // service was still open. Normalize so pause never looks like service state.
    for (const record of this.db.get('services')) {
      if ((record.status as string) === 'paused') {
        this.update(record.id, item => { item.status = 'live' })
      }
    }
    const active = this.active()
    if (active) this.queueAnalysis(active.id)
    this.timer ??= setInterval(() => { void this.analyze() }, 45000)
    this.timer.unref()
  }
  snapshot(): ServiceSnapshot { return this.db.store }
  active(): ServiceRecord | undefined {
    const state = this.snapshot()
    return state.services.find(record => record.id === state.activeId)
  }
  onChanged(callback: (snapshot: ServiceSnapshot) => void): void { this.listeners.push(callback) }
  private publish(): void { this.listeners.forEach(callback => callback(this.snapshot())) }
  private update(id: string, edit: (record: ServiceRecord) => void): void {
    const records = this.db.get('services')
    const record = records.find(item => item.id === id)
    if (!record) return
    edit(record)
    this.db.set('services', records)
    this.publish()
  }
  create(title: string, speaker: string, note: SermonPlan | null): void {
    if (this.active()) throw new Error('End the current service before creating another.')
    if (typeof title !== 'string' || !title.trim()) throw new Error('Enter a service name.')
    const record: ServiceRecord = {
      id: randomUUID(), title: title.trim().slice(0, 200), speaker: String(speaker ?? '').trim().slice(0, 200),
      createdAt: Date.now(), endedAt: null, status: 'live', transcript: [], scriptures: [],
      notes: note ? [note] : [], nuggets: [], analysisError: null,
    }
    this.db.store = { activeId: record.id, services: [record, ...this.db.get('services')] }
    this.publish()
  }
  /** Transcription start/stop — does not pause or resume the service itself. */
  setRunning(running: boolean): void {
    if (!running) void this.analyze()
  }
  end(): void {
    const record = this.active()
    if (!record) return
    this.update(record.id, item => { item.status = 'ended'; item.endedAt = Date.now() })
    this.db.set('activeId', null)
    this.publish()
    void this.analyze()
  }
  attach(note: SermonPlan): void {
    const record = this.active()
    if (record) this.update(record.id, item => {
      item.notes = [...item.notes.filter(n => n.id !== note.id), structuredClone(note)]
    })
  }
  transcript(segment: TranscriptResult): void {
    const record = this.active()
    if (!record || record.status === 'ended' || record.transcript.some(s => s.id === segment.id)) return
    this.update(record.id, item => { item.transcript.push(segment) })
    const batch = [...(this.pending.get(record.id) ?? []), segment]
    this.pending.set(record.id, batch)
    if (batch.map(s => s.text).join(' ').split(/\s+/).length >= 180) void this.analyze()
  }
  scripture(suggestion: ScriptureSuggestion): void {
    const record = this.active()
    if (!record || record.status === 'ended') return
    this.update(record.id, item => {
      if (!item.scriptures.some(s => s.reference === suggestion.reference && s.translation === suggestion.translation)) item.scriptures.push(suggestion)
    })
  }
  nugget(text: string, sourceIds: string[]): void {
    const record = this.active()
    if (!record || typeof text !== 'string' || !text.trim()) throw new Error('Create a service before saving nuggets.')
    const ids = Array.isArray(sourceIds) ? sourceIds.filter(id => record.transcript.some(s => s.id === id)) : []
    this.update(record.id, item => {
      if (!item.nuggets.some(n => n.text === text.trim())) item.nuggets.push({ id: randomUUID(), text: text.trim().slice(0, 10000), sourceIds: ids, capturedAt: Date.now(), origin: 'manual' })
    })
  }
  removeNugget(id: string, nuggetId: string): void {
    this.update(id, item => { item.nuggets = item.nuggets.filter(n => n.id !== nuggetId) })
  }
  queueAnalysis(id: string): void {
    const record = this.db.get('services').find(item => item.id === id)
    if (!record) throw new Error('Service not found.')
    const remaining = record.transcript.filter(s => !record.analyzedSourceIds?.includes(s.id))
    this.pending.set(id, remaining)
  }
  retryAnalysis(id: string): void { this.queueAnalysis(id); void this.analyze() }
  private async analyze(): Promise<void> {
    if (this.processing) return
    const entry = [...this.pending.entries()].find(([, segments]) => segments.length)
    if (!entry) return
    const [id, waiting] = entry
    const segments: TranscriptResult[] = []
    let length = 0
    for (const segment of waiting) {
      segments.push(segment); length += segment.text.length
      if (length >= 6000) break
    }
    if (segments.length < waiting.length) this.pending.set(id, waiting.slice(segments.length))
    else this.pending.delete(id)
    this.processing = true
    try {
      const raw = await this.selectQuotes(segments.map(s => s.text).join(' '))
      const quotes = extractNuggetQuotes(raw, segments)
      this.update(id, record => {
        record.analysisError = null
        record.analyzedSourceIds = [...new Set([...(record.analyzedSourceIds ?? []), ...segments.map(s => s.id)])]
        for (const text of quotes) {
          if (record.nuggets.some(n => n.text.toLowerCase() === text.toLowerCase())) continue
          record.nuggets.push({ id: randomUUID(), text, capturedAt: segments[0].timestamp, sourceIds: segments.map(s => s.id), origin: 'automatic' })
        }
      })
    } catch (error) {
      this.update(id, record => { record.analysisError = error instanceof Error ? error.message : 'Automatic nugget selection failed. Transcript saved.' })
    } finally {
      this.processing = false
      if (this.pending.size) void this.analyze()
    }
  }
}

