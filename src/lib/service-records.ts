import type { SermonPlan, ScriptureSuggestion, TranscriptResult } from './ipc'

export interface ServiceNugget {
  id: string
  text: string
  capturedAt: number
  sourceIds: string[]
  origin: 'automatic' | 'manual'
}
/**
 * Where an ended service is on its way to the web.
 *
 * `failed` is a display state, not a terminal one: the booth may be offline
 * from Sunday to Tuesday, and the local record stays the source of truth the
 * whole time. Only a refusal from the server (a 4xx) actually stops the retry.
 */
export interface ServiceUploadState {
  status: 'idle' | 'queued' | 'uploading' | 'uploaded' | 'failed'
  sermonId: string | null
  attempts: number
  lastAttemptAt: number | null
  error: string | null
  /** False once the server has refused in a way that retrying cannot fix. */
  retryable: boolean
}

/** A fresh factory, not a shared constant — callers must not alias one object. */
export function idleUpload(): ServiceUploadState {
  return { status: 'idle', sermonId: null, attempts: 0, lastAttemptAt: null, error: null, retryable: true }
}

export interface ServiceRecord {
  id: string
  title: string
  speaker: string
  createdAt: number
  endedAt: number | null
  /** Service is open until ended. Transcription pause does not change this. */
  status: 'live' | 'ended'
  /** Time spent paused so far, so the clock shows talk time, not wall time. */
  pausedMs?: number
  /** When the current pause began; null/absent while listening. */
  pausedAt?: number | null
  transcript: TranscriptResult[]
  scriptures: ScriptureSuggestion[]
  notes: SermonPlan[]
  nuggets: ServiceNugget[]
  analysisError: string | null
  analyzedSourceIds?: string[]
  /**
   * Always present in memory. Records written before recaps existed have no
   * `upload` on disk; `ServiceRecords` fills it in as they are read, so no
   * consumer has to test for it.
   */
  upload: ServiceUploadState
}
/**
 * How long the service has been listening: wall time minus every pause,
 * including one still in progress — so the clock stands still while paused.
 */
export function serviceTalkTimeMs(
  record: Pick<ServiceRecord, 'createdAt' | 'endedAt' | 'pausedMs' | 'pausedAt'>,
  now = Date.now(),
): number {
  const end = record.endedAt ?? now
  const openPause = record.pausedAt != null && record.endedAt == null ? now - record.pausedAt : 0
  return Math.max(0, end - record.createdAt - (record.pausedMs ?? 0) - openPause)
}

export interface ServiceSnapshot { activeId: string | null; services: ServiceRecord[] }
export const SERVICE_CHANNEL = 'services:command'
export const SERVICE_CHANGED = 'services:changed'
export type ServiceCommand =
  | { action: 'list' }
  /** Open an unnamed service so transcription can start with no dialog first. */
  | { action: 'start' }
  /** Name and keep the open service. Blank title falls back to the date. */
  | { action: 'end'; title: string; speaker: string; planId: string | null }
  /** Throw the open service away — nothing about it is kept. */
  | { action: 'discard' }
  | { action: 'analyze'; serviceId: string }
  | { action: 'nugget'; text: string; sourceIds: string[] }
  | { action: 'removeNugget'; serviceId: string; nuggetId: string }
  | { action: 'upload'; serviceId: string }
export interface ServicesAPI {
  command: (command: ServiceCommand) => Promise<ServiceSnapshot>
  onChanged: (callback: (snapshot: ServiceSnapshot) => void) => () => void
}

/** Only accept quotations actually present in the supplied transcript. */
export function extractNuggetQuotes(raw: string, transcript: TranscriptResult[]): string[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  // Empty model replies (or max-token cutoffs with no closing bracket) used to
  // surface as the opaque "Unexpected end of JSON input".
  if (!cleaned) return []

  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Nugget selection returned incomplete JSON. Retry selection.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    throw new Error('Nugget selection returned invalid JSON. Retry selection.')
  }
  if (!Array.isArray(parsed)) throw new Error('Invalid nugget response')
  const source = transcript.map(segment => segment.text).join(' ').replace(/\s+/g, ' ').trim()
  return [...new Set(parsed.filter((item): item is string => typeof item === 'string')
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(item => item.length >= 35 && item.length <= 1200 && source.includes(item)))].slice(0, 3)
}

export function serviceTextExport(service: ServiceRecord): string {
  return [`${service.title}\n${service.speaker}\n${new Date(service.createdAt).toLocaleString()}`,
    'NUGGETS\n' + service.nuggets.map(n => `${n.text}\n${new Date(n.capturedAt).toLocaleTimeString()}`).join('\n\n'),
    'SERMON NOTES\n' + service.notes.map(note => `${note.title}\n${note.sourceText ?? note.items.map(item => item.reference).join('\n')}`).join('\n\n'),
    'DETECTED SCRIPTURES\n' + service.scriptures.map(s => `${s.reference} (${s.translation})`).join('\n'),
    'TRANSCRIPT\n' + service.transcript.map(s => `${new Date(s.timestamp).toLocaleTimeString()}  ${s.text}`).join('\n\n'),
  ].join('\n\n')
}
