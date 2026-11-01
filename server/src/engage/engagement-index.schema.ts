import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'

/** Discoverability only. All audience and moderator records remain in the DO. */
@Schema({ collection: 'engagements', versionKey: false })
export class EngagementIndex {
  @Prop({ required: true }) orgId!: string
  @Prop({ required: true }) id!: string
  @Prop({ required: true }) code!: string
  @Prop({ required: true }) name!: string
  @Prop({ required: true, enum: ['draft', 'open', 'closed'] }) status!: string
  @Prop({ type: Number, default: null }) startsAt!: number | null
  @Prop({ type: Number, default: null }) endsAt!: number | null
}
export const EngagementIndexSchema = SchemaFactory.createForClass(EngagementIndex)
EngagementIndexSchema.index({ orgId: 1, id: 1 }, { unique: true })
