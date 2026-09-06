import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose'

export type EmailTokenDocument = HydratedDocument<EmailToken>

export type EmailTokenPurpose = 'verify-email' | 'reset-password'

/**
 * One confirmation, redeemable two ways: a six-digit code typed into the app,
 * or the link in the same email. Both are hashed at rest and both consume the
 * same record, so a confirmation can only ever happen once.
 *
 * The code is short enough to read aloud, which is exactly why `attempts` is
 * capped: six digits is a million guesses, and without a cap a patient attacker
 * would get there.
 */
@Schema({ timestamps: true, collection: 'emailtokens' })
export class EmailToken {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId

  @Prop({ required: true, unique: true, index: true })
  tokenHash!: string

  /** SHA-256 of the six-digit code. */
  @Prop({ required: true })
  codeHash!: string

  /** Wrong guesses so far. At the cap the record is burned, not just refused. */
  @Prop({ default: 0 })
  attempts!: number

  @Prop({ type: String, enum: ['verify-email', 'reset-password'], required: true })
  purpose!: EmailTokenPurpose

  @Prop({ type: Date, default: null })
  consumedAt!: Date | null

  @Prop({ type: Date, required: true })
  expiresAt!: Date
}

export const EmailTokenSchema = SchemaFactory.createForClass(EmailToken)
EmailTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
