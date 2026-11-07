import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose'
import { FEEDBACK_KINDS, FEEDBACK_STATUSES, type FeedbackKind, type FeedbackStatus } from '@contracts/feedback'

export type FeedbackDocument = HydratedDocument<Feedback>

/**
 * One note sent from the app's Feedback button. The sender comes from their
 * token — user, church, install — so staff can follow up with them.
 */
@Schema({ timestamps: true, collection: 'feedback' })
export class Feedback {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', default: null })
  orgId!: Types.ObjectId | null

  @Prop({ default: '' })
  installId!: string

  @Prop({ type: String, enum: FEEDBACK_KINDS, required: true, index: true })
  kind!: FeedbackKind

  @Prop({ required: true })
  message!: string

  @Prop({ default: '' })
  context!: string

  @Prop({ default: '' })
  appVersion!: string

  @Prop({ default: '' })
  os!: string

  @Prop({ default: '' })
  osVersion!: string

  @Prop({ type: String, enum: FEEDBACK_STATUSES, default: 'new', index: true })
  status!: FeedbackStatus

  createdAt?: Date
  updatedAt?: Date
}

export const FeedbackSchema = SchemaFactory.createForClass(Feedback)
FeedbackSchema.index({ createdAt: -1 })
