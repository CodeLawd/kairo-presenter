import { Inject, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig } from '../config/env'
import { User, UserDocument } from '../users/schemas/user.schema'
import { decryptJson, encryptJson, vaultKeyFromSecret } from '../orgs/vault-crypto'

/** The person's own OpenAI key for Imagine, encrypted at rest. */
@Injectable()
export class ImagineKeyService {
  private readonly key: Buffer

  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.key = vaultKeyFromSecret(config.vaultEncryptionKey)
  }

  async get(userId: string): Promise<string | null> {
    const user = await this.users.findById(userId).select('+imagineKey').lean().exec()
    if (!user?.imagineKey) return null
    try {
      return decryptJson<{ key: string }>(this.key, user.imagineKey).key || null
    } catch {
      // A rotated vault key: the device asks for the key again.
      return null
    }
  }

  async set(userId: string, key: string): Promise<void> {
    const imagineKey = encryptJson(this.key, { key: key.trim() })
    await this.users.updateOne({ _id: userId }, { $set: { imagineKey } }).exec()
  }

  async clear(userId: string): Promise<void> {
    await this.users.updateOne({ _id: userId }, { $unset: { imagineKey: 1 } }).exec()
  }
}
