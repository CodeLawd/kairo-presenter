import type { EngageCommand, EngageSnapshot, EngagementIndex, EngagementInput } from './engage'
/** Shared by the operator queue and audience sources; no Electron dependencies. */
import type { AudienceRoomSettings } from './audience-protocol'

export type AudienceQuestionState = 'review' | 'approved' | 'answered' | 'hidden'

export interface AudienceQuestion {
  /** Source-prefixed identifier: `${sourceId}:${externalId}`. */
  id: string
  sourceId: string
  text: string
  author: string | null
  votes: number
  state: AudienceQuestionState
  originalText?: string
  editedBy?: string
  sentBy?: string
  sentAt?: number
  createdAt: number
}

export interface AudienceSourceStatus {
  id: string
  kind: 'kairo' | 'slido'
  label: string
  state: 'connecting' | 'live' | 'error' | 'stopped'
  /** While connecting: which step it's on, so a slow start doesn't look frozen. */
  step?: 'reserving' | 'connecting' | 'finding' | 'sign-in' | 'open-event'
  error?: string
  joined?: number
  /** A source with a sign-in window the operator can bring back up. */
  canOpen?: boolean
  /** Slido: the event code and name, whether it reads the moderator view, and
   *  whether its questions skip Review (Slido already moderated them). */
  code?: string
  /** Slido's own event id, when the event was added from a link. */
  eventId?: string
  eventName?: string
  moderator?: boolean
  skipReview?: boolean
  /** When the source last read questions successfully (ms since epoch). */
  updatedAt?: number
}

export type AudienceQuestionSort = 'votes' | 'newest'

/** Count Unicode code points so truncation never splits a surrogate pair. */
export function normalizeAudienceText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = Array.from(value.trim()).slice(0, 280).join('').trim()
  return text || null
}

export function sortAudienceQuestions(
  questions: readonly AudienceQuestion[],
  sort: AudienceQuestionSort = 'votes',
): AudienceQuestion[] {
  return [...questions].sort((a, b) =>
    (b.sentAt ?? 0) - (a.sentAt ?? 0)
    || (sort === 'votes' ? b.votes - a.votes : 0)
    || b.createdAt - a.createdAt
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/**
 * How a source's question states are taken:
 * - `review` (default): Kairo owns moderation; new questions enter review.
 * - `trusted`: the source moderated them already (Slido "Skip approval"), so a new
 *   question keeps its state, but Kairo's later choices still win.
 * - `authoritative`: the source is the record (a Kairo engagement, where moderators
 *   change states on the website too), so its state always wins.
 */
export type AudienceMergeMode = 'review' | 'trusted' | 'authoritative'

/** Source updates are incremental: absent questions stay in the queue. */
export function mergeAudienceQuestions(
  questions: readonly AudienceQuestion[],
  updates: readonly AudienceQuestion[],
  mode: AudienceMergeMode = 'review',
): AudienceQuestion[] {
  const merged = new Map(questions.map(question => [question.id, question]))
  for (const update of updates) {
    const existing = merged.get(update.id)
    const state = mode === 'authoritative' ? update.state : existing?.state ?? (mode === 'trusted' ? update.state : 'review')
    merged.set(update.id, { ...update, state })
  }
  return [...merged.values()]
}

/** Explicit operator actions can restore questions from any moderation tab. */
export function setAudienceQuestionState(
  questions: readonly AudienceQuestion[],
  id: string,
  state: AudienceQuestionState,
): AudienceQuestion[] {
  return questions.map(question => question.id === id ? { ...question, state } : question)
}

export interface AudienceSession {
  roomId: string
  code: string
  url: string
  title: string
  qrDataUrl: string
  settings: AudienceRoomSettings
}

export interface AudienceState {
  engage?: EngageSnapshot
  livePollId?: string | null
  sampleAvailable: boolean
  questions: AudienceQuestion[]
  sources: AudienceSourceStatus[]
  liveId: string | null
  session: AudienceSession | null
}

export type AudienceSourceKind = 'kairo' | 'slido' | 'sample'
export interface AudienceSourceOptions {
  title?: string
  startsAt?: number | null
  endsAt?: number | null
  settings?: AudienceRoomSettings
  /** Slido: a code, `#code`, or a pasted Slido link. */
  code?: string
  moderator?: boolean
  skipReview?: boolean
}

/**
 * What someone typed or pasted for a Slido event: `1234567`, `#1234567`,
 * `slido.com/1234567`, `sli.do/1234567` or an `app.sli.do/event/<id>` link.
 */
export function parseSlidoEvent(input: string): { code: string } | { eventId: string } | null {
  const value = input.trim()
  const plain = /^#?([a-zA-Z0-9-]{1,32})$/.exec(value)
  if (plain) return { code: plain[1] }
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    if (!/(^|\.)(sli\.do|slido\.com)$/i.test(url.hostname)) return null
    const event = /^\/event\/([a-zA-Z0-9]{6,64})/.exec(url.pathname)
    if (event) return { eventId: event[1] }
    const code = /^\/#?([a-zA-Z0-9-]{1,32})\/?$/.exec(decodeURIComponent(url.pathname + url.hash).replace(/^\/#/, '/'))
    return code ? { code: code[1] } : null
  } catch { return null }
}

export interface AudienceAPI {
  listEngagements(): Promise<EngagementIndex[]>
  createEngagement(input: EngagementInput): Promise<void>
  resumeEngagement(code: string, reopen?: boolean): Promise<AudienceState>
  reopenEngagement(): Promise<AudienceState>
  deleteEngagement(code: string): Promise<void>
  inviteModerator(email: string, name: string): Promise<AudienceState>
  revokeModerator(id: string): Promise<AudienceState>
  command(command: EngageCommand): Promise<AudienceState>
  showPoll(id: string): Promise<AudienceState>
  clearPoll(): Promise<AudienceState>
  getState(): Promise<AudienceState>
  startSource(kind: AudienceSourceKind, options?: AudienceSourceOptions): Promise<AudienceState>
  openSource(id: string): Promise<AudienceState>
  stopSource(id: string): Promise<AudienceState>
  /** Change how the running Kairo room behaves (review, visible list, names). */
  setRoomSettings(settings: AudienceRoomSettings): Promise<AudienceState>
  /** Open the audience page in the browser. */
  openAudiencePage(): Promise<void>
  setQuestionState(id: string, state: AudienceQuestionState): Promise<AudienceState>
  show(id: string): Promise<AudienceState>
  clear(): Promise<AudienceState>
  showJoinCode(): Promise<AudienceState>
  onChanged(callback: (state: AudienceState) => void): () => void
}

export const AUDIENCE = {
  ENGAGEMENTS: 'audience:engagements', CREATE_ENGAGEMENT: 'audience:create-engagement', RESUME: 'audience:resume', REOPEN_ENGAGEMENT: 'audience:reopen-engagement', DELETE_ENGAGEMENT: 'audience:delete-engagement', INVITE: 'audience:invite', REVOKE: 'audience:revoke', COMMAND: 'audience:command', SHOW_POLL: 'audience:show-poll', CLEAR_POLL: 'audience:clear-poll',
  OPEN: 'audience:open', GET: 'audience:get', START: 'audience:start', STOP: 'audience:stop',
  MODERATE: 'audience:moderate', SHOW: 'audience:show', CLEAR: 'audience:clear',
  JOIN: 'audience:join', CHANGED: 'audience:changed', ROOM_SETTINGS: 'audience:room-settings', PAGE: 'audience:page',
} as const
