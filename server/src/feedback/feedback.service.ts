import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { isValidObjectId, Model, Types } from 'mongoose'
import type { FeedbackUploadResult } from '@contracts/feedback'
import type { Reporter } from '../usage/usage.service'
import { Feedback, type FeedbackDocument } from './schemas/feedback.schema'
import type { FeedbackDto } from './feedback.controller'

@Injectable()
export class FeedbackService {
  constructor(@InjectModel(Feedback.name) private readonly feedback: Model<FeedbackDocument>) {}

  async create(who: Reporter, body: FeedbackDto): Promise<FeedbackUploadResult> {
    const doc = await this.feedback.create({
      userId: new Types.ObjectId(who.userId),
      orgId: who.orgId && isValidObjectId(who.orgId) ? new Types.ObjectId(who.orgId) : null,
      installId: who.deviceId ?? '',
      kind: body.kind,
      message: body.message,
      context: body.context ?? '',
      appVersion: body.appVersion ?? '',
      os: body.os ?? '',
      osVersion: body.osVersion ?? '',
    })
    return { id: String(doc._id) }
  }
}
