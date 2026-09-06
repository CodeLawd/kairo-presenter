import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose'

export type OrgSecretsDocument = HydratedDocument<OrgSecrets>

/**
 * One encrypted vault per org. Plaintext never sits in Mongo — only the
 * AES-256-GCM envelope below. The decrypted payload is a map of optional
 * third-party API keys used by the desktop app.
 */
@Schema({ timestamps: true, collection: 'org_secrets' })
export class OrgSecrets {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    unique: true,
    index: true,
  })
  orgId!: Types.ObjectId

  /** Base64 ciphertext of the JSON secrets map. */
  @Prop({ required: true })
  ciphertext!: string

  /** Base64 12-byte IV. */
  @Prop({ required: true })
  iv!: string

  /** Base64 GCM auth tag. */
  @Prop({ required: true })
  authTag!: string

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  updatedByUserId!: Types.ObjectId

  createdAt?: Date
  updatedAt?: Date
}

export const OrgSecretsSchema = SchemaFactory.createForClass(OrgSecrets)
