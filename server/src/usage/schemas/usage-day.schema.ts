import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose'

export type UsageDayDocument = HydratedDocument<UsageDay>

/** Kept roughly 13 months: enough for year-on-year, short enough to stay small. */
const RETENTION_SECONDS = 400 * 24 * 60 * 60

/**
 * One install's usage on one day — counters only, never content.
 *
 * Desktop rows are replaced on every report (the app sends full day totals),
 * so a re-sent report can never double a count. Website rows (`source: web`,
 * `installId: web:<userId>`) are incremented per page view.
 */
@Schema({ timestamps: true, collection: 'usage_days' })
export class UsageDay {
  @Prop({ required: true })
  installId!: string

  @Prop({ type: String, enum: ['desktop', 'web'], required: true })
  source!: 'desktop' | 'web'

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', default: null, index: true })
  orgId!: Types.ObjectId | null

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId

  /** YYYY-MM-DD — the machine's local day for desktop, UTC for the website. */
  @Prop({ required: true, index: true })
  day!: string

  @Prop({ type: Map, of: Number, default: {} })
  counts!: Map<string, number>

  @Prop({ type: Map, of: Number, default: {} })
  errors!: Map<string, number>

  /** Desktop only: the machine and setup at the time of the report. */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  system!: Record<string, unknown> | null

  @Prop({ default: '' })
  appVersion!: string

  @Prop({ default: '' })
  os!: string

  createdAt?: Date
  updatedAt?: Date
}

export const UsageDaySchema = SchemaFactory.createForClass(UsageDay)
UsageDaySchema.index({ installId: 1, day: 1 }, { unique: true })
UsageDaySchema.index({ source: 1, day: -1 })
UsageDaySchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS })
