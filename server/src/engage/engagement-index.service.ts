import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { EngagementIndex } from './engagement-index.schema'
import { EngagementIndexDto } from './engage.dto'

@Injectable()
export class EngagementIndexService {
  constructor(@InjectModel(EngagementIndex.name) private readonly index: Model<EngagementIndex>) {}

  async write(dto: EngagementIndexDto): Promise<void> {
    const { orgId, id, code, name, status } = dto
    if (dto.deleted) {
      await this.index.deleteOne({ orgId, id })
      return
    }
    // Explicit allowlist: no capability tokens, moderator addresses or payloads.
    await this.index.updateOne({ orgId, id }, { $set: {
      orgId, id, code, name, status, startsAt: dto.startsAt ?? null, endsAt: dto.endsAt ?? null,
    } }, { upsert: true, runValidators: true })
  }

  async list(orgId: string): Promise<EngagementIndex[]> {
    return this.index.find({ orgId }).select('-_id').sort({ startsAt: -1, id: 1 }).lean().exec()
  }
}
