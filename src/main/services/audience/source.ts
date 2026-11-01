import type { EngageSnapshot, EngageCommand } from '../../../lib/engage'
import type { AudienceQuestion, AudienceQuestionState, AudienceSession, AudienceSourceStatus } from '../../../lib/audience'
import type { AudienceRoomSettings } from '../../../lib/audience-protocol'

export interface AudienceUpdate {
  engage?: EngageSnapshot
  questions?: AudienceQuestion[]
  /** New questions keep the state the source gives them instead of entering review. */
  moderation?: import('../../../lib/audience').AudienceMergeMode
  status?: AudienceSourceStatus
  session?: AudienceSession | null
}

export interface AudienceSource {
  readonly id: string
  start(): Promise<void>
  stop(): Promise<void>
  open?(): void
  dispose?(): void
  onUpdate(callback: (update: AudienceUpdate) => void): () => void
  command?(command: EngageCommand): Promise<void>
  manage?(action: string, body: unknown): Promise<void>
  setState?(questionId: string, state: AudienceQuestionState): Promise<void>
  setSettings?(settings: AudienceRoomSettings): Promise<void>
}
