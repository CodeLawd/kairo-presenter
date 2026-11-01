import type { EngageCommand, EngageSnapshot, Engagement } from './engage'
import type { AudienceQuestion, AudienceQuestionState } from './audience'

export const AUDIENCE_MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024

export const AUDIENCE_CODE = /^[A-HJ-NP-Z2-9]{6}$/
export const AUDIENCE_STATES: readonly AudienceQuestionState[] = ['review', 'approved', 'answered', 'hidden']
export interface AudienceRoomCreated { roomId: string; code: string; operatorToken: string; title: string; url: string; settings: AudienceRoomSettings; engagement?: Engagement }

/** How a Kairo room behaves. Chosen at the start; the presenter can change it any time. */
export interface AudienceRoomSettings {
  /** New questions wait for the presenter before anyone else sees them. */
  review: boolean
  /** People see the approved questions and can vote on them. Off: they can only ask. */
  showQuestions: boolean
  /** Whether the audience page offers a name field. */
  names: 'optional' | 'off'
}
/** Open by default: questions appear for everyone at once. Approval is opt-in. */
export const DEFAULT_AUDIENCE_ROOM_SETTINGS: AudienceRoomSettings = { review: false, showQuestions: true, names: 'optional' }
export function normalizeAudienceRoomSettings(value: unknown): AudienceRoomSettings {
  const r = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const d = DEFAULT_AUDIENCE_ROOM_SETTINGS
  return {
    review: typeof r.review === 'boolean' ? r.review : d.review,
    showQuestions: typeof r.showQuestions === 'boolean' ? r.showQuestions : d.showQuestions,
    names: r.names === 'off' || r.names === 'optional' ? r.names : d.names,
  }
}
export type AudienceClientEvent =
  | (EngageCommand & { requestId: string })
  | { type: 'ask'; requestId: string; text: string; author?: string }
  | { type: 'vote'; id: string; voted?: boolean; requestId?: string }
  | { type: 'state'; id: string; state: AudienceQuestionState; requestId: string }
  | { type: 'end'; requestId: string }
  | { type: 'settings'; settings: AudienceRoomSettings; requestId: string }
  | { type: 'snapshot' }
export type AudienceServerEvent =
  | ({ type: 'engage' } & EngageSnapshot)
  | { type: 'snapshot'; questions: AudienceQuestion[]; ownQuestions?: AudienceQuestion[]; title: string; orgName: string; joined: number; ended: boolean; voted: string[]; settings: AudienceRoomSettings }
  | { type: 'question'; question: AudienceQuestion }
  | { type: 'state'; id: string; state: AudienceQuestionState }
  | { type: 'joined'; joined: number }
  | { type: 'ack'; requestId: string; question?: AudienceQuestion }
  | { type: 'ended' }
  | { type: 'error'; message: string; requestId?: string }

export function parseAudienceEvent(message: string): AudienceClientEvent | null {
  if (message.length > 8192) return null
  let event: Record<string, unknown>
  try {
    const value: unknown = JSON.parse(message)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    event = value as Record<string, unknown>
  } catch { return null }
  const requestId = typeof event.requestId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(event.requestId) ? event.requestId : null
  if (requestId) {
    const id = typeof event.id === 'string' && event.id.length <= 128 ? event.id : null
    if (event.type === 'edit' && id && typeof event.text === 'string') return { type: 'edit', id, text: event.text, requestId }
    if (event.type === 'present' && id) return { type: 'present', id, requestId }
    if (event.type === 'reply' && typeof event.questionId === 'string' && event.questionId.length <= 128 && typeof event.text === 'string' && (event.audience === 'everyone' || event.audience === 'asker')) return { type: 'reply', questionId: event.questionId, text: event.text, audience: event.audience, requestId }
    if (event.type === 'poll-save' && event.poll && typeof event.poll === 'object') return { type: 'poll-save', poll: event.poll, requestId }
    if (event.type === 'poll-state' && id && (event.state === 'open' || event.state === 'closed') && typeof event.showResults === 'boolean') return { type: 'poll-state', id, state: event.state, showResults: event.showResults, requestId }
    if (event.type === 'poll-vote' && id && Array.isArray(event.options) && event.options.length <= 12 && event.options.every(o => typeof o === 'string' && o.length <= 64)) return { type: 'poll-vote', id, options: event.options as string[], requestId }
  }
  if (event.type === 'snapshot') return { type: 'snapshot' }
  if (event.type === 'ask' && requestId && typeof event.text === 'string' && (event.author === undefined || typeof event.author === 'string')) return { type: 'ask', requestId, text: event.text, author: event.author as string | undefined }
  if (event.type === 'vote' && typeof event.id === 'string' && event.id.length <= 128 && (event.voted === undefined || typeof event.voted === 'boolean')) return { type: 'vote', id: event.id, ...(typeof event.voted === 'boolean' ? { voted: event.voted } : {}), ...(requestId ? { requestId } : {}) }
  if (event.type === 'end' && requestId) return { type: 'end', requestId }
  if (event.type === 'settings' && requestId && event.settings && typeof event.settings === 'object') return { type: 'settings', requestId, settings: normalizeAudienceRoomSettings(event.settings) }
  if (event.type === 'state' && requestId && typeof event.id === 'string' && event.id.length <= 128 && AUDIENCE_STATES.includes(event.state as AudienceQuestionState)) return { type: 'state', requestId, id: event.id, state: event.state as AudienceQuestionState }
  return null
}
