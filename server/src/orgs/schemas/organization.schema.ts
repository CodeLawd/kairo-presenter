import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose'

export type OrganizationDocument = HydratedDocument<Organization>

@Schema({ _id: false })
export class ServiceTime {
  /** 0 = Sunday … 6 = Saturday. */
  @Prop({ required: true, min: 0, max: 6 })
  day!: number

  /** 24h 'HH:MM'. */
  @Prop({ required: true })
  time!: string

  @Prop({ default: '' })
  label!: string
}

const ServiceTimeSchema = SchemaFactory.createForClass(ServiceTime)

@Schema({ timestamps: true, collection: 'organizations' })
export class Organization {
  @Prop({ required: true, trim: true })
  name!: string

  @Prop({ required: true, unique: true, lowercase: true, trim: true, index: true })
  slug!: string

  /** IANA zone. Mirrors the desktop app's church profile. */
  @Prop({ default: '' })
  timezone!: string

  @Prop({ type: [ServiceTimeSchema], default: [] })
  serviceTimes!: ServiceTime[]

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  ownerUserId!: Types.ObjectId

  /** Denormalised active-membership count — read on every seat check. */
  @Prop({ default: 1 })
  seatsUsed!: number
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization)
