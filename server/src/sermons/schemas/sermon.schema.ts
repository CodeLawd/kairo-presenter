import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose'
import type { SermonStatus } from '@contracts/contracts'
import type { SummaryErrorCode } from '../sermon-summary.service'

export type SermonDocument = HydratedDocument<Sermon>

@Schema({ _id: false })
export class SermonMainPoint {
  @Prop({ required: true })
  title!: string

  @Prop({ required: true })
  explanation!: string
}
export const SermonMainPointSchema = SchemaFactory.createForClass(SermonMainPoint)

@Schema({ _id: false })
export class SermonScripture {
  @Prop({ required: true })
  reference!: string

  @Prop({ default: '' })
  connection!: string
}
export const SermonScriptureSchema = SchemaFactory.createForClass(SermonScripture)

@Schema({ _id: false })
export class SermonSummaryDoc {
  @Prop({ required: true })
  headline!: string

  @Prop({ required: true })
  bigIdea!: string

  @Prop({ type: [SermonMainPointSchema], default: [] })
  keyPoints!: SermonMainPoint[]

  @Prop({ type: [String], default: [] })
  memorableQuotes!: string[]

  @Prop({ type: [String], default: [] })
  takeaways!: string[]

  @Prop({ type: [SermonScriptureSchema], default: [] })
  keyScriptures!: SermonScripture[]

  @Prop({ default: '' })
  callToAction!: string
}
export const SermonSummaryDocSchema = SchemaFactory.createForClass(SermonSummaryDoc)

/**
 * One preached service, uploaded from the booth.
 *
 * Two different storage decisions live here on purpose. The **summary** is
 * plaintext: it exists to be read, and on a shared sermon it is served to
 * strangers, so encrypting it would mean a decrypt on every page view and buy
 * nothing. The **transcript** is encrypted with an AES-256-GCM envelope under
 * its own key (see `transcript-crypto.ts`) — it is the raw thing, full of
 * offhand remarks and speech-to-text mistakes, and it never leaves the
 * members-only side.
 */
@Schema({ timestamps: true, collection: 'sermons' })
export class Sermon {
  // No `index: true` — {orgId} is a prefix of both compound indexes below.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', required: true })
  orgId!: Types.ObjectId

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdByUserId!: Types.ObjectId

  /**
   * The desktop's own `ServiceRecord.id`. A booth that was offline retries the
   * same upload later; keying on this makes that an update, not a duplicate.
   */
  @Prop({ required: true })
  localId!: string

  @Prop({ required: true })
  title!: string

  @Prop({ default: '' })
  speaker!: string

  @Prop({ required: true })
  preachedAt!: Date

  @Prop({ required: true })
  endedAt!: Date

  @Prop({ default: 0 })
  durationMs!: number

  @Prop({ default: 0 })
  wordCount!: number

  // No `index: true` — {status} is a prefix of the sweeper index below, and
  // status is rewritten several times per sermon.
  @Prop({ required: true, default: 'pending' })
  status!: SermonStatus

  @Prop({ type: String, default: null })
  failureReason!: string | null

  /** Machine-readable reason, so the dashboard can offer the right next step. */
  @Prop({ type: String, default: null })
  failureCode!: SummaryErrorCode | null

  /** Generation attempts so far. Three strikes and the sermon is `failed`. */
  @Prop({ default: 0 })
  attempts!: number

  /**
   * When a worker took ownership of generating this recap. A claim older than
   * the stale window means the process holding it died, and the sweeper is free
   * to take it back.
   */
  @Prop({ type: Date, default: null })
  claimedAt!: Date | null

  @Prop({ type: Date, default: null })
  generatedAt!: Date | null

  @Prop({ type: String, default: null })
  model!: string | null

  @Prop({ type: SermonSummaryDocSchema, default: null })
  summary!: SermonSummaryDoc | null

  /** Base64 ciphertext of the full `SermonUploadSegment[]`. */
  @Prop({ required: true })
  transcriptCiphertext!: string

  /** Base64 12-byte IV. */
  @Prop({ required: true })
  transcriptIv!: string

  /** Base64 GCM auth tag. */
  @Prop({ required: true })
  transcriptAuthTag!: string

  /** References the desktop's scripture detector already found, as hints. */
  @Prop({ type: [String], default: [] })
  detectedScriptures!: string[]

  /**
   * Unguessable share id, absent until the sermon is shared.
   *
   * Deliberately has no `default: null`. A unique+sparse index only skips
   * documents where the field is *missing*, so a stored `null` counts as a
   * value and the second unshared sermon would collide with the first. The
   * partial index below is the belt to that braces.
   */
  @Prop({ type: String })
  shareToken?: string | null

  @Prop({ default: false })
  shareEnabled!: boolean

  createdAt?: Date
  updatedAt?: Date
}

export const SermonSchema = SchemaFactory.createForClass(Sermon)

/** The generation sweeper's query: pending work, oldest claim first. */
SermonSchema.index({ status: 1, claimedAt: 1 })
/** The list query: one org's sermons, newest first. */
SermonSchema.index({ orgId: 1, preachedAt: -1 })
/** Idempotent upload. */
SermonSchema.index({ orgId: 1, localId: 1 }, { unique: true })
/**
 * Share tokens are unique among sermons that actually have one. A partial
 * filter rather than `sparse`, so an explicitly-null token can never collide.
 */
SermonSchema.index(
  { shareToken: 1 },
  { unique: true, partialFilterExpression: { shareToken: { $type: 'string' } } },
)
