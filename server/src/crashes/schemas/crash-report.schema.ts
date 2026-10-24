import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose'

export type CrashReportDocument = HydratedDocument<CrashReport>

/** Kept 90 days: long enough to follow a bad release, short for logs that name songs. */
const RETENTION_SECONDS = 90 * 24 * 60 * 60

/**
 * One crash (or one burst of the same crash) on one install, as the desktop
 * summarised it: what died, the machine, the window's last errors and the end
 * of the log. Re-sent reports replace themselves by `(installId, reportId)`.
 */
@Schema({ timestamps: true, collection: 'crash_reports' })
export class CrashReport {
  @Prop({ required: true })
  installId!: string

  /** The desktop's id for the report. */
  @Prop({ required: true })
  reportId!: string

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', default: null, index: true })
  orgId!: Types.ObjectId | null

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId

  @Prop({ type: String, enum: ['renderer', 'child_process'], required: true })
  kind!: 'renderer' | 'child_process'

  @Prop({ default: '' })
  process!: string

  @Prop({ default: '' })
  reason!: string

  @Prop({ default: 0 })
  exitCode!: number

  @Prop({ required: true, index: true })
  firstAt!: Date

  @Prop({ required: true })
  lastAt!: Date

  @Prop({ default: 1 })
  count!: number

  @Prop({ default: '', index: true })
  appVersion!: string

  @Prop({ default: '' })
  os!: string

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  system!: Record<string, unknown> | null

  /** The errors the window printed before it died (`errors` is reserved by Mongoose). */
  @Prop({ type: [String], default: [] })
  windowErrors!: string[]

  @Prop({ default: '' })
  log!: string

  createdAt?: Date
  updatedAt?: Date
}

export const CrashReportSchema = SchemaFactory.createForClass(CrashReport)
CrashReportSchema.index({ installId: 1, reportId: 1 }, { unique: true })
CrashReportSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS })
