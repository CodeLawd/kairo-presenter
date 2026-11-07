import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { isValidObjectId, Model, Types } from 'mongoose'
import type { FeedbackKind, FeedbackStatus } from '@contracts/feedback'
import { Feedback, type FeedbackDocument } from '../feedback/schemas/feedback.schema'
import { Organization, type OrganizationDocument } from '../orgs/schemas/organization.schema'
import { User, type UserDocument } from '../users/schemas/user.schema'

const PAGE_SIZE = 25
const DAY_MS = 24 * 60 * 60 * 1000

type Row = Feedback & { _id: Types.ObjectId }

/**
 * The staff view of feedback sent from the app: newest first, filterable by
 * kind and status, each with who sent it (name, email, church) so staff can
 * write back.
 */
@Injectable()
export class FeedbackAdminService {
  constructor(
    @InjectModel(Feedback.name) private readonly feedback: Model<FeedbackDocument>,
    @InjectModel(Organization.name) private readonly orgs: Model<OrganizationDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {}

  async list(query: { page?: number; kind?: FeedbackKind; status?: FeedbackStatus; q?: string }): Promise<unknown> {
    const page = Math.max(1, query.page ?? 1)
    const match: Record<string, unknown> = {}
    if (query.kind) match.kind = query.kind
    if (query.status) match.status = query.status
    if (query.q) match.message = { $regex: query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }

    const now = new Date()
    const weekStart = new Date(now.getTime() - 6 * DAY_MS)
    weekStart.setUTCHours(0, 0, 0, 0)
    const [rows, total, counts, kinds, week] = await Promise.all([
      this.feedback.find(match).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean<Row[]>(),
      this.feedback.countDocuments(match),
      this.feedback.aggregate<{ _id: FeedbackStatus; count: number }>([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      this.feedback.aggregate<{ _id: FeedbackKind; count: number }>([{ $group: { _id: '$kind', count: { $sum: 1 } } }]),
      this.feedback.aggregate<{ _id: string; count: number }>([
        { $match: { createdAt: { $gte: weekStart } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      ]),
    ])
    const perDay = new Map(week.map((d) => [d._id, d.count]))
    const byDay = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStart.getTime() + i * DAY_MS).toISOString().slice(0, 10)
      return { date, count: perDay.get(date) ?? 0 }
    })

    const ids = (values: (Types.ObjectId | null)[]): Types.ObjectId[] =>
      [...new Set(values.filter(Boolean).map(String))].map((id) => new Types.ObjectId(id))
    const [orgs, users] = await Promise.all([
      this.orgs.find({ _id: { $in: ids(rows.map((r) => r.orgId)) } }, { name: 1 }).lean(),
      this.users.find({ _id: { $in: ids(rows.map((r) => r.userId)) } }, { name: 1, email: 1 }).lean(),
    ])
    const churches = new Map(orgs.map((o) => [String(o._id), { id: String(o._id), name: o.name }]))
    const people = new Map(users.map((u) => [String(u._id), { id: String(u._id), name: u.name, email: u.email }]))

    return {
      counts: Object.fromEntries(counts.map((c) => [c._id, c.count])),
      kinds: Object.fromEntries(kinds.map((c) => [c._id, c.count])),
      byDay,
      items: rows.map((r) => ({
        id: String(r._id),
        kind: r.kind,
        status: r.status,
        message: r.message,
        context: r.context,
        appVersion: r.appVersion,
        os: r.os,
        osVersion: r.osVersion,
        createdAt: r.createdAt,
        user: people.get(String(r.userId)) ?? { id: String(r.userId), name: '', email: '' },
        church: r.orgId ? (churches.get(String(r.orgId)) ?? null) : null,
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    }
  }

  async setStatus(id: string, status: FeedbackStatus): Promise<void> {
    if (!isValidObjectId(id)) throw new NotFoundException('No such feedback')
    const result = await this.feedback.updateOne({ _id: id }, { $set: { status } })
    if (!result.matchedCount) throw new NotFoundException('No such feedback')
  }
}
