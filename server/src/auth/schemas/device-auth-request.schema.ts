import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose'

export type DeviceAuthRequestDocument = HydratedDocument<DeviceAuthRequest>

/**
 * One in-flight pairing attempt.
 *
 * The desktop holds the long `deviceCode`; the person holds the short
 * `userCode` they read off the screen. Only the long one can be exchanged for
 * tokens, so the short one being shoulder-surfed is worth little on its own —
 * an attacker would also have to be the one polling.
 */
@Schema({ timestamps: true, collection: 'deviceauthrequests' })
export class DeviceAuthRequest {
  /** Hashed, like every other bearer secret here. */
  @Prop({ required: true, unique: true, index: true })
  deviceCodeHash!: string

  /** Short, human-typed, unique only while pending. */
  @Prop({ required: true, index: true })
  userCode!: string

  @Prop({ required: true })
  deviceId!: string

  @Prop({ default: '' })
  deviceName!: string

  @Prop({ type: String, enum: ['pending', 'approved', 'denied'], default: 'pending', index: true })
  status!: 'pending' | 'approved' | 'denied'

  /** Set on approval — who granted it, and into which org. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  userId!: Types.ObjectId | null

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', default: null })
  orgId!: Types.ObjectId | null

  /** Set once the tokens have been collected — a code is good for one exchange. */
  @Prop({ type: Date, default: null })
  redeemedAt!: Date | null

  /** Rate-limits polling without a separate store. */
  @Prop({ type: Date, default: null })
  lastPolledAt!: Date | null

  @Prop({ type: Date, required: true })
  expiresAt!: Date
}

export const DeviceAuthRequestSchema = SchemaFactory.createForClass(DeviceAuthRequest)
DeviceAuthRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
