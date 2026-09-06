import { Inject, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig } from '../config/env'
import { OrgSecrets, OrgSecretsDocument } from './schemas/org-secrets.schema'
import { decryptJson, encryptJson, vaultKeyFromSecret } from './vault-crypto'

/** Plaintext map stored inside the AES envelope. Empty string = not set. */
export interface OrgSecretsPayload {
  deepgramApiKey: string
  anthropicApiKey: string
  deepseekApiKey: string
  bibleApiKey: string
  braveApiKey: string
  googleTranslateApiKey: string
}

export type OrgSecretsPatch = {
  [K in keyof OrgSecretsPayload]?: string | null
}

const EMPTY: OrgSecretsPayload = {
  deepgramApiKey: '',
  anthropicApiKey: '',
  deepseekApiKey: '',
  bibleApiKey: '',
  braveApiKey: '',
  googleTranslateApiKey: '',
}

const KEYS = Object.keys(EMPTY) as (keyof OrgSecretsPayload)[]

export function mergeSecretsPatch(
  current: OrgSecretsPayload,
  patch: OrgSecretsPatch,
): OrgSecretsPayload {
  const next = { ...current }
  for (const key of KEYS) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (value === null) next[key] = ''
    else if (typeof value === 'string') next[key] = value.trim()
  }
  return next
}

export function secretsResponse(
  payload: OrgSecretsPayload,
  updatedAt: Date | null,
): OrgSecretsPayload & { updatedAt: string | null } {
  return {
    deepgramApiKey: payload.deepgramApiKey || '',
    anthropicApiKey: payload.anthropicApiKey || '',
    deepseekApiKey: payload.deepseekApiKey || '',
    bibleApiKey: payload.bibleApiKey || '',
    braveApiKey: payload.braveApiKey || '',
    googleTranslateApiKey: payload.googleTranslateApiKey || '',
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
  }
}

@Injectable()
export class OrgSecretsService {
  private readonly log = new Logger(OrgSecretsService.name)
  private readonly key: Buffer

  constructor(
    @InjectModel(OrgSecrets.name)
    private readonly model: Model<OrgSecretsDocument>,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.key = vaultKeyFromSecret(config.vaultEncryptionKey)
  }

  async get(orgId: string): Promise<ReturnType<typeof secretsResponse>> {
    const doc = await this.model.findOne({ orgId: new Types.ObjectId(orgId) }).exec()
    if (!doc) return secretsResponse(EMPTY, null)
    const payload = this.decryptDoc(doc)
    return secretsResponse(payload, doc.updatedAt ?? null)
  }

  async put(
    orgId: string,
    userId: string,
    patch: OrgSecretsPatch,
  ): Promise<ReturnType<typeof secretsResponse>> {
    const orgObjectId = new Types.ObjectId(orgId)
    const existing = await this.model.findOne({ orgId: orgObjectId }).exec()
    const current = existing ? this.decryptDoc(existing) : { ...EMPTY }
    const merged = mergeSecretsPatch(current, patch)
    const envelope = encryptJson(this.key, merged)

    const doc = await this.model
      .findOneAndUpdate(
        { orgId: orgObjectId },
        {
          $set: {
            ...envelope,
            updatedByUserId: new Types.ObjectId(userId),
          },
          $setOnInsert: { orgId: orgObjectId },
        },
        { upsert: true, new: true },
      )
      .exec()

    // Never log key material — only that a write happened.
    this.log.debug(`Org secrets updated for ${orgId}`)
    return secretsResponse(merged, doc?.updatedAt ?? new Date())
  }

  private decryptDoc(doc: OrgSecretsDocument): OrgSecretsPayload {
    try {
      const raw = decryptJson<Partial<OrgSecretsPayload>>(this.key, {
        ciphertext: doc.ciphertext,
        iv: doc.iv,
        authTag: doc.authTag,
      })
      return mergeSecretsPatch(EMPTY, {
        deepgramApiKey: raw.deepgramApiKey ?? '',
        anthropicApiKey: raw.anthropicApiKey ?? '',
        deepseekApiKey: raw.deepseekApiKey ?? '',
        bibleApiKey: raw.bibleApiKey ?? '',
        braveApiKey: raw.braveApiKey ?? '',
        googleTranslateApiKey: raw.googleTranslateApiKey ?? '',
      })
    } catch (error) {
      this.log.error(`Failed to decrypt org secrets for ${doc.orgId.toString()}`)
      throw error
    }
  }
}
