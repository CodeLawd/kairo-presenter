import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose'

export type MembershipDocument = HydratedDocument<Membership>

/** Ordered weakest → strongest; `OrgRoleGuard` compares by index. */
export const ORG_ROLES = ['viewer', 'operator', 'admin', 'owner'] as const
export type OrgRole = (typeof ORG_ROLES)[number]

/**
 * The org-scoping join, read on every guarded request.
 *
 * Authorization asks one question — "is this user in this org, and as what?" —
 * so it must be one indexed lookup, never a scan of an array embedded in the
 * org document.
 */
@Schema({ timestamps: true, collection: 'memberships' })
export class Membership {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', required: true, index: true })
  orgId!: Types.ObjectId

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId

  @Prop({ type: String, enum: ORG_ROLES, required: true })
  role!: OrgRole

  @Prop({ type: String, enum: ['active', 'invited', 'removed'], default: 'active', index: true })
  status!: 'active' | 'invited' | 'removed'

  @Prop({ type: Date, default: Date.now })
  joinedAt!: Date
}

export const MembershipSchema = SchemaFactory.createForClass(Membership)
MembershipSchema.index({ orgId: 1, userId: 1 }, { unique: true })
MembershipSchema.index({ userId: 1, status: 1 })
