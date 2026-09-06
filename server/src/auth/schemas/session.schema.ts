import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose'

export type SessionDocument = HydratedDocument<Session>

/**
 * One refresh token, stored as a SHA-256 hash.
 *
 * Never the token itself: a database dump must not be a set of working
 * credentials. `familyId` chains every rotation of one device's token together,
 * so replaying a consumed token can revoke the whole chain rather than just the
 * copy that was replayed — the standard answer to a stolen refresh token.
 */
@Schema({ timestamps: true, collection: 'sessions' })
export class Session {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', required: true })
  orgId!: Types.ObjectId

  /** Client-generated, stable per install. */
  @Prop({ required: true, index: true })
  deviceId!: string

  @Prop({ required: true, unique: true, index: true })
  tokenHash!: string

  /** Shared by every token in one device's rotation chain. */
  @Prop({ required: true, index: true })
  familyId!: string

  @Prop({ type: String, enum: ['web', 'desktop'], required: true })
  clientKind!: 'web' | 'desktop'

  @Prop({ default: '' })
  userAgent!: string

  @Prop({ default: '' })
  ip!: string

  /** Set when rotated. A second use of a consumed token is a replay. */
  @Prop({ type: Date, default: null })
  consumedAt!: Date | null

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null

  @Prop({ type: Date, required: true })
  expiresAt!: Date
}

export const SessionSchema = SchemaFactory.createForClass(Session)
// Mongo reaps expired refresh tokens on its own — nothing to sweep in app code.
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
