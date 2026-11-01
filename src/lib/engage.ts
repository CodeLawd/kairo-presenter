import type { AudienceRoomSettings } from './audience-protocol'

export interface Engagement {
  id: string
  code: string
  name: string
  orgName: string
  startsAt: number | null
  endsAt: number | null
  status: 'draft' | 'open' | 'closed'
  activities: { qa: AudienceRoomSettings & { enabled: boolean }; polls: { enabled: boolean } }
  activePollId: string | null
}
export interface Moderator { id: string; email: string; name: string | null; invitedAt: number; lastSeenAt: number | null; revoked: boolean; active?: boolean }
export interface Reply { id: string; questionId: string; text: string; by: string; audience: 'everyone' | 'asker'; at: number }
export interface Poll { id: string; title: string; options: { id: string; text: string }[]; multiple: boolean; state: 'draft' | 'open' | 'closed'; showResults: boolean }
export interface PollView extends Poll { totals: Record<string, number>; voters: number; voted: string[] }
export interface EngageSnapshot { engagement: Engagement; moderators?: Moderator[]; replies: Reply[]; polls: PollView[] }
export interface EngagementInput { title: string; startsAt?: number | null; endsAt?: number | null; status?: 'draft' | 'open'; settings?: AudienceRoomSettings }
export type EngageCommand =
  | { type: 'edit'; id: string; text: string }
  | { type: 'reply'; questionId: string; text: string; audience: 'everyone' | 'asker' }
  | { type: 'present'; id: string }
  | { type: 'poll-save'; poll: unknown }
  | { type: 'poll-state'; id: string; state: 'open' | 'closed'; showResults: boolean }
  | { type: 'poll-vote'; id: string; options: string[] }
export interface EngagementIndex { id: string; code: string; name: string; status: Engagement['status']; startsAt: number | null; endsAt: number | null }
export function engagementDeadline(room: { lastActivityAt: number; endsAt: number | null }): number {
  return Math.min(room.lastActivityAt + 30 * 86400000, room.endsAt === null ? Infinity : room.endsAt + 86400000)
}
export function normalizeEngagementInput(value: unknown): { name: string; startsAt: number | null; endsAt: number | null; status: 'draft' | 'open' } {
  const v = value as Partial<EngagementInput> | null
  const name = typeof v?.title === 'string' ? v.title.trim() : ''
  if (!name || name.length > 100) throw new Error('Give the engagement a title of up to 100 characters.')
  const date = (value: unknown): number | null => {
    if (value == null) return null
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Choose a valid date.')
    return value
  }
  const startsAt = date(v?.startsAt), endsAt = date(v?.endsAt)
  if (startsAt !== null && endsAt !== null && endsAt < startsAt) throw new Error('The end must follow the start.')
  if (v?.status !== undefined && v.status !== 'draft' && v.status !== 'open') throw new Error('Choose draft or open.')
  return { name, startsAt, endsAt, status: v?.status ?? 'open' }
}
export function normalizePoll(value: unknown): Poll {
  const p = value as Partial<Poll> | null
  const title = typeof p?.title === 'string' ? p.title.trim() : ''
  if (!title || title.length > 200 || !Array.isArray(p?.options) || p.options.length < 2 || p.options.length > 12) throw new Error('Add a title and between 2 and 12 options.')
  const options = (p.options as unknown[]).map(raw => {
    const o = raw as {id?: unknown;text?: unknown} | string
    return o
  }).map(o => {
    const text = typeof o === 'string' ? o.trim() : typeof o?.text === 'string' ? o.text.trim() : ''
    if (!text || text.length > 120) throw new Error('Each option needs up to 120 characters.')
    return { id: typeof o === 'object' && typeof o.id === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(o.id) ? o.id : crypto.randomUUID(), text }
  })
  if (new Set(options.map(o => o.text.toLowerCase())).size !== options.length || new Set(options.map(o => o.id)).size !== options.length) throw new Error('Use different options.')
  return { id: typeof p?.id === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(p.id) ? p.id : crypto.randomUUID(), title, options, multiple: p?.multiple === true, state: 'draft', showResults: false }
}
