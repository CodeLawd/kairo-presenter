import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { User, UserDocument } from './schemas/user.schema'

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly users: Model<UserDocument>) {}

  /** Email is the identity, so every lookup normalises the same way. */
  async findByEmail(email: string, withPassword = false): Promise<UserDocument | null> {
    const query = this.users.findOne({ email: normalizeEmail(email) })
    return withPassword ? query.select('+passwordHash').exec() : query.exec()
  }

  async findByIds(ids: Types.ObjectId[]): Promise<UserDocument[]> {
    if (ids.length === 0) return []
    return this.users.find({ _id: { $in: ids } }).exec()
  }

  async findById(id: Types.ObjectId | string): Promise<UserDocument | null> {
    return this.users.findById(id).exec()
  }

  async findByGoogleId(googleId: string): Promise<UserDocument | null> {
    return this.users.findOne({ googleId }).exec()
  }

  async create(input: {
    email: string
    name: string
    passwordHash?: string
    googleId?: string
    avatarUrl?: string
    emailVerifiedAt?: Date | null
  }): Promise<UserDocument> {
    return this.users.create({
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      passwordHash: input.passwordHash,
      googleId: input.googleId,
      avatarUrl: input.avatarUrl,
      emailVerifiedAt: input.emailVerifiedAt ?? null,
    })
  }

  async setDefaultOrg(userId: Types.ObjectId, orgId: Types.ObjectId): Promise<void> {
    await this.users.updateOne({ _id: userId }, { $set: { defaultOrgId: orgId } })
  }

  async markSignedIn(userId: Types.ObjectId): Promise<void> {
    await this.users.updateOne({ _id: userId }, { $set: { lastLoginAt: new Date() } })
  }

  async markEmailVerified(userId: Types.ObjectId): Promise<void> {
    await this.users.updateOne({ _id: userId }, { $set: { emailVerifiedAt: new Date() } })
  }

  async setPasswordHash(userId: Types.ObjectId, passwordHash: string): Promise<void> {
    await this.users.updateOne({ _id: userId }, { $set: { passwordHash } })
  }

  /** Links a Google identity onto an account that already owns the address. */
  async attachGoogleId(userId: Types.ObjectId, googleId: string): Promise<void> {
    await this.users.updateOne({ _id: userId }, { $set: { googleId } })
  }

  async updateProfile(userId: Types.ObjectId, patch: { name?: string }): Promise<void> {
    const update: Record<string, unknown> = {}
    if (patch.name !== undefined) update.name = patch.name.trim()
    if (Object.keys(update).length === 0) return
    await this.users.updateOne({ _id: userId }, { $set: update })
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
