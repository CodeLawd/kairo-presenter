import type { AudienceQuestion } from '../../../../src/lib/audience'
import type { Reply } from '../../../../src/lib/engage'

export function parseModeratorInvite(value: string): { code: string; token: string } | null {
  const match = /^([A-HJ-NP-Z2-9]{6})\.([a-f0-9]{64})$/.exec(value)
  return match ? { code: match[1], token: match[2] } : null
}

/** The API has already filtered these replies for the current participant. */
export function orphanReplies(replies: Reply[], questions: Pick<AudienceQuestion, 'id'>[]): Reply[] {
  const visible = new Set(questions.map(question => question.id))
  return replies.filter(reply => !visible.has(reply.questionId))
}

export function pollPercent(count: number, voters: number): number {
  return voters > 0 ? Math.min(100, Math.round(count / voters * 100)) : 0
}
