import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose'

export type UserDocument = HydratedDocument<User>

@Schema({ timestamps: true, collection: 'users' })
export class User {
  /** Always stored lower-cased — the unique index is the account identity. */
  @Prop({ required: true, unique: true, lowercase: true, trim: true, index: true })
  email!: string

  /**
   * Absent for an account created purely through Google. Such a user can still
   * add a password later via the reset flow, which is why this is optional
   * rather than a second account type.
   */
  @Prop({ required: false, select: false })
  passwordHash?: string

  @Prop({ required: false, index: true, sparse: true })
  googleId?: string

  @Prop({ required: true, trim: true })
  name!: string

  @Prop({ required: false })
  avatarUrl?: string

  /** Null until the address is proven. Never blocks sign-in — it gates invites. */
  @Prop({ type: Date, default: null })
  emailVerifiedAt!: Date | null

  /** The org a session lands in when none is named. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', default: null })
  defaultOrgId!: Types.ObjectId | null

  @Prop({ type: String, enum: ['active', 'disabled'], default: 'active' })
  status!: 'active' | 'disabled'

  @Prop({ type: Date, default: null })
  lastLoginAt!: Date | null

  /**
   * Kairo staff access to the admin console, granted by a superadmin. Unrelated
   * to a church role. Superadmins are not stored here — they come from config.
   */
  @Prop({ type: String, enum: ['admin'], default: null })
  platformRole!: 'admin' | null
}

export const UserSchema = SchemaFactory.createForClass(User)
