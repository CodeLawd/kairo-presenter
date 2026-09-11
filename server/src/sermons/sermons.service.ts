import { randomBytes } from 'crypto'
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, PipelineStage, Types } from 'mongoose'
import type {
  SermonDetail,
  SermonListItem,
  SermonStats,
  SermonStatsRange,
  SermonSummary,
  SermonListPage,
  SermonTranscriptSegment,
  SermonUploadSegment,
} from '@contracts/contracts'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig } from '../config/env'
import { Sermon, SermonDocument, SermonSummaryDoc } from './schemas/sermon.schema'
import { decryptTranscript, encryptTranscript, transcriptKeyFromSecret } from './transcript-crypto'
import { UploadSermonDto } from './dto/sermon.dto'
import {
  countTranscriptWords,
  MAX_TRANSCRIPT_WORDS,
  readableTranscript,
  transcriptDurationMs,
  transcriptTooLongMessage,
} from './sermon-transcript'
import {
  assembleStats,
  emptyPeriod,
  mondayOfIsoWeek,
  parseDay,
  previousWindow,
  resolveWindow,
  speakerNameFilter,
  TOP_SPEAKERS,
} from './sermon-stats'

function requireDayPair(from?: string, to?: string): void {
  if (!from && !to) return
  if (!from || !to) throw new BadRequestException('from and to are both required.')
  if (!parseDay(from) || !parseDay(to)) throw new BadRequestException('Invalid from or to.')
}

function dateMatch(from: Date | null, toExclusive: Date | null): PipelineStage.FacetPipelineStage[] {
  if (!from && !toExclusive) return []
  const preachedAt: Record<string, Date> = {}
  if (from) preachedAt.$gte = from
  if (toExclusive) preachedAt.$lt = toExclusive
  return [{ $match: { preachedAt } }]
}

function speakerMatch(speaker?: string): PipelineStage.Match['$match'] | null {
  const name = speakerNameFilter(speaker)
  if (name === null) return null
  return {
    $expr: { $eq: [{ $trim: { input: { $ifNull: ['$speaker', ''] } } }, name] },
  }
}

function withSpeaker(
  stages: PipelineStage.FacetPipelineStage[],
  speaker?: string,
): PipelineStage.FacetPipelineStage[] {
  const match = speakerMatch(speaker)
  return match ? [{ $match: match }, ...stages] : stages
}

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

/**
 * The encrypted transcript is ~1MB and almost nothing reads it. Excluding it by
 * default keeps a detail poll — which the dashboard runs every 5s while a recap
 * is being written — from dragging a megabyte out of Mongo to render a few KB.
 */
const WITHOUT_TRANSCRIPT = '-transcriptCiphertext -transcriptIv -transcriptAuthTag'

/** Keep only the four fields we store, so an unvalidated array cannot smuggle anything in. */
function normalizeWords(words: unknown[] | undefined): SermonUploadSegment['words'] {
  if (!Array.isArray(words)) return []
  const clean: SermonUploadSegment['words'] = []
  for (const entry of words) {
    if (!entry || typeof entry !== 'object') continue
    const word = entry as Record<string, unknown>
    clean.push({
      word: typeof word.word === 'string' ? word.word.slice(0, 200) : '',
      start: Number(word.start) || 0,
      end: Number(word.end) || 0,
      confidence: Number(word.confidence) || 0,
    })
  }
  return clean
}

@Injectable()
export class SermonsService {
  private readonly log = new Logger(SermonsService.name)
  private readonly key: Buffer

  constructor(
    @InjectModel(Sermon.name) private readonly model: Model<SermonDocument>,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.key = transcriptKeyFromSecret(config.vaultEncryptionKey)
  }

  /**
   * Store an uploaded service, replacing any earlier upload of the same
   * `localId`. Returns the sermon with `status: 'pending'` — generation is
   * kicked off by the controller so a slow model never holds the booth's
   * request open.
   */
  async upload(
    orgId: string,
    userId: string,
    dto: UploadSermonDto,
  ): Promise<SermonDocument> {
    const segments: SermonUploadSegment[] = dto.transcript.map((segment) => ({
      id: segment.id,
      text: segment.text,
      timestamp: segment.timestamp,
      duration: segment.duration,
      words: normalizeWords(segment.words),
    }))

    const wordCount = countTranscriptWords(segments)
    if (wordCount > MAX_TRANSCRIPT_WORDS) {
      throw new BadRequestException(transcriptTooLongMessage(wordCount))
    }
    if (wordCount === 0) {
      throw new BadRequestException('That service has no transcript to summarize.')
    }

    const envelope = encryptTranscript(this.key, segments)
    const orgObjectId = new Types.ObjectId(orgId)

    const sermon = await this.model
      .findOneAndUpdate(
        { orgId: orgObjectId, localId: dto.localId },
        {
          $set: {
            title: dto.title.trim() || 'Untitled service',
            speaker: dto.speaker?.trim() ?? '',
            preachedAt: new Date(dto.startedAt),
            endedAt: new Date(dto.endedAt),
            durationMs: transcriptDurationMs(segments),
            wordCount,
            transcriptCiphertext: envelope.ciphertext,
            transcriptIv: envelope.iv,
            transcriptAuthTag: envelope.authTag,
            detectedScriptures: [
              ...new Set((dto.scriptures ?? []).map((item) => item.reference.trim()).filter(Boolean)),
            ],
            // A re-upload means a new recording of the same service: the old
            // summary describes a transcript that no longer exists.
            status: 'pending',
            summary: null,
            failureReason: null,
            attempts: 0,
            generatedAt: null,
          },
          $setOnInsert: {
            orgId: orgObjectId,
            localId: dto.localId,
            createdByUserId: new Types.ObjectId(userId),
            shareEnabled: false,
          },
        },
        { upsert: true, new: true },
      )
      .exec()

    // Never log transcript content — only that a service arrived.
    this.log.log(`Sermon uploaded for org ${orgId} (${wordCount} words)`)
    return sermon
  }

  /** Newest first, cursored on `preachedAt` so paging is stable as uploads land. */
  async list(
    orgId: string,
    options: {
      limit?: number
      cursor?: string
      range?: SermonStatsRange
      from?: string
      to?: string
      speaker?: string
      now?: Date
    },
  ): Promise<SermonListPage> {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    const filter: Record<string, unknown> = { orgId: new Types.ObjectId(orgId) }
    const preachedAt: Record<string, unknown> = {}
    requireDayPair(options.from, options.to)
    if (options.range || (options.from && options.to)) {
      const { from, toExclusive } = resolveWindow({
        range: options.range,
        from: options.from,
        to: options.to,
        now: options.now ?? new Date(),
      })
      if (from) preachedAt.$gte = from
      if (toExclusive) preachedAt.$lt = toExclusive
    }
    if (options.cursor) {
      const cursorDate = new Date(options.cursor)
      if (Number.isNaN(cursorDate.getTime())) throw new BadRequestException('Invalid cursor.')
      const current = preachedAt.$lt instanceof Date ? preachedAt.$lt : null
      preachedAt.$lt =
        current && current.getTime() < cursorDate.getTime() ? current : cursorDate
    }
    if (Object.keys(preachedAt).length > 0) filter.preachedAt = preachedAt
    const speaker = speakerMatch(options.speaker)
    if (speaker) Object.assign(filter, speaker)

    // One extra row tells us whether another page exists without a count query.
    const rows = await this.model
      .find(filter)
      .sort({ preachedAt: -1 })
      .limit(limit + 1)
      .select(WITHOUT_TRANSCRIPT)
      .exec()

    const page = rows.slice(0, limit)
    const nextCursor =
      rows.length > limit ? (page[page.length - 1].preachedAt?.toISOString() ?? null) : null
    return { items: page.map((row) => this.toListItem(row)), nextCursor }
  }

  /** Pass `withTranscript` only on the paths that actually decrypt it. */
  async requireInOrg(
    orgId: string,
    sermonId: string,
    options: { withTranscript?: boolean } = {},
  ): Promise<SermonDocument> {
    if (!Types.ObjectId.isValid(sermonId)) throw new NotFoundException('Sermon not found')
    const query = this.model.findOne({
      _id: new Types.ObjectId(sermonId),
      orgId: new Types.ObjectId(orgId),
    })
    if (!options.withTranscript) query.select(WITHOUT_TRANSCRIPT)
    const sermon = await query.exec()
    if (!sermon) throw new NotFoundException('Sermon not found')
    return sermon
  }

  /**
   * The public page's only lookup. `status: 'ready'` is part of the query on
   * purpose: a half-generated or failed recap must not be reachable even with a
   * valid token.
   */
  async findByShareToken(token: string): Promise<SermonDocument | null> {
    if (!token || token.length > 100) return null
    return this.model
      .findOne({ shareToken: token, shareEnabled: true, status: 'ready' })
      .select(WITHOUT_TRANSCRIPT)
      .exec()
  }

  /**
   * Turn sharing on or off. `rotate` mints a new token, which is how a church
   * un-shares a link that has already been passed around.
   */
  async setShare(
    orgId: string,
    sermonId: string,
    input: { enabled: boolean; rotate?: boolean },
  ): Promise<SermonDocument> {
    const sermon = await this.requireInOrg(orgId, sermonId)
    if (!input.enabled) {
      // Clearing rather than parking the token means a link that was already
      // passed around can never be revived by flipping the boolean back.
      // `$unset`, not null: a stored null would collide with every other
      // unshared sermon on the unique index.
      return this.apply(sermon, { $set: { shareEnabled: false }, $unset: { shareToken: 1 } })
    }
    const shareToken =
      input.rotate || !sermon.shareToken
        ? randomBytes(24).toString('base64url')
        : sermon.shareToken
    return this.apply(sermon, { $set: { shareEnabled: true, shareToken } })
  }

  /**
   * Put a sermon back in the queue.
   *
   * A failed regeneration must not destroy a recap that already reads well, so
   * the existing summary stays put until a new one replaces it — the dashboard
   * shows the old recap alongside "regenerating".
   */
  async resetForRegeneration(orgId: string, sermonId: string): Promise<SermonDocument> {
    const sermon = await this.requireInOrg(orgId, sermonId)
    return this.apply(sermon, {
      $set: {
        status: 'pending',
        attempts: 0,
        failureReason: null,
        failureCode: null,
        claimedAt: null,
      },
    })
  }

  /**
   * Stop an in-flight rewrite and keep the recap that is already on the page.
   *
   * First generation (no summary yet) cannot be cancelled this way — there is
   * nothing to fall back to.
   */
  async cancelRegeneration(orgId: string, sermonId: string): Promise<SermonDocument> {
    const sermon = await this.requireInOrg(orgId, sermonId)
    if (sermon.status !== 'pending') return sermon
    if (!sermon.summary) {
      throw new BadRequestException('The first recap has to finish before it can be stopped.')
    }
    return this.apply(sermon, {
      $set: {
        status: 'ready',
        claimedAt: null,
        failureReason: null,
        failureCode: null,
      },
    })
  }

  async updateMeta(
    orgId: string,
    sermonId: string,
    input: { title?: string; speaker?: string; headline?: string },
  ): Promise<SermonDocument> {
    const sermon = await this.requireInOrg(orgId, sermonId)
    const $set: Record<string, unknown> = {}
    if (input.title !== undefined) {
      const title = input.title.trim()
      if (!title) throw new BadRequestException('Give the service a name.')
      $set.title = title
    }
    if (input.speaker !== undefined) $set.speaker = input.speaker.trim()
    if (input.headline !== undefined) {
      if (!sermon.summary) {
        throw new BadRequestException('There is no recap to rename yet.')
      }
      const headline = input.headline.trim()
      if (!headline) throw new BadRequestException('Give the recap a title.')
      $set['summary.headline'] = headline
    }
    if (Object.keys($set).length === 0) return sermon
    return this.apply(sermon, { $set })
  }

  async remove(orgId: string, sermonId: string): Promise<void> {
    if (!Types.ObjectId.isValid(sermonId)) throw new NotFoundException('Sermon not found')
    // Deleted by query rather than by loading the document first — there is no
    // reason to pull a megabyte of ciphertext across the wire to throw it away.
    const result = await this.model
      .deleteOne({ _id: new Types.ObjectId(sermonId), orgId: new Types.ObjectId(orgId) })
      .exec()
    if (result.deletedCount === 0) throw new NotFoundException('Sermon not found')
  }

  /**
   * Write a change and return the updated document.
   *
   * `updateOne` rather than `doc.save()`: these documents are loaded without
   * the transcript fields, and saving a partially-projected document invites
   * validation errors on paths that were never loaded.
   */
  private async apply(
    sermon: SermonDocument,
    update: Record<string, unknown>,
  ): Promise<SermonDocument> {
    await this.model.updateOne({ _id: sermon._id }, update).exec()
    const fresh = await this.model.findById(sermon._id).select(WITHOUT_TRANSCRIPT).exec()
    if (!fresh) throw new NotFoundException('Sermon not found')
    return fresh
  }

  /** Decrypts the stored transcript. Throws if the envelope was tampered with. */
  transcriptOf(sermon: SermonDocument): SermonUploadSegment[] {
    try {
      return decryptTranscript(this.key, {
        ciphertext: sermon.transcriptCiphertext,
        iv: sermon.transcriptIv,
        authTag: sermon.transcriptAuthTag,
      })
    } catch {
      this.log.error(`Failed to decrypt transcript for sermon ${sermon._id.toString()}`)
      throw new BadRequestException('That transcript could not be read.')
    }
  }

  /** The transcript as the website shows it. Its own route, its own role. */
  readableTranscriptOf(sermon: SermonDocument): SermonTranscriptSegment[] {
    return readableTranscript(this.transcriptOf(sermon))
  }

  toListItem(sermon: SermonDocument): SermonListItem {
    return {
      id: sermon._id.toString(),
      title: sermon.title,
      speaker: sermon.speaker,
      preachedAt: sermon.preachedAt.toISOString(),
      durationMs: sermon.durationMs,
      wordCount: sermon.wordCount,
      status: sermon.status,
      headline: sermon.summary?.headline ?? null,
      shareEnabled: sermon.shareEnabled,
    }
  }

  /** The recap on its own — all the public share page is allowed to see. */
  toSummary(summary: SermonSummaryDoc): SermonSummary {
    return {
      headline: summary.headline,
      bigIdea: summary.bigIdea,
      keyPoints: summary.keyPoints.map((point) => ({
        title: point.title,
        explanation: point.explanation,
      })),
      memorableQuotes: summary.memorableQuotes,
      takeaways: summary.takeaways,
      keyScriptures: summary.keyScriptures.map((item) => ({
        reference: item.reference,
        connection: item.connection,
      })),
      ...(summary.callToAction ? { callToAction: summary.callToAction } : {}),
    }
  }

  toDetail(sermon: SermonDocument): SermonDetail {
    return {
      ...this.toListItem(sermon),
      summary: sermon.summary ? this.toSummary(sermon.summary) : null,
      failureReason: sermon.failureReason,
      failureCode: sermon.failureCode,
      shareToken: sermon.shareEnabled ? (sermon.shareToken ?? null) : null,
    }
  }

  /**
   * Org-wide totals and series for the dashboard.
   *
   * One aggregation over the org's sermons — no transcript touched. An org
   * with no sermons yet matches nothing and gets honest zeros rather than a null.
   */
  async stats(
    orgId: string,
    options: {
      range?: SermonStatsRange
      from?: string
      to?: string
      speaker?: string
      now?: Date
    } = {},
  ): Promise<SermonStats> {
    const now = options.now ?? new Date()
    requireDayPair(options.from, options.to)
    const { from, toExclusive, bucketCount, chartFrom, granularity } = resolveWindow({
      range: options.range,
      from: options.from,
      to: options.to,
      now,
    })
    const previous = from && toExclusive ? previousWindow(from, toExclusive) : null
    const speaker = options.speaker
    const inRange = dateMatch(from, toExclusive)
    const chartMatch = dateMatch(chartFrom, toExclusive)
    const weeklyGroup: PipelineStage.FacetPipelineStage[] =
      granularity === 'day'
        ? [
            ...chartMatch,
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$preachedAt' } },
                services: { $sum: 1 },
                durationMs: { $sum: '$durationMs' },
              },
            },
          ]
        : [
            ...chartMatch,
            {
              $group: {
                _id: {
                  y: { $isoWeekYear: '$preachedAt' },
                  w: { $isoWeek: '$preachedAt' },
                },
                services: { $sum: 1 },
                durationMs: { $sum: '$durationMs' },
              },
            },
          ]

    const [facet] = await this.model
      .aggregate<{
        totals: {
          services: number
          recapsReady: number
          recapsFailed: number
          recapsPending: number
          totalDurationMs: number
          totalWords: number
          scripturePassages: number
          sharedLinks: number
        }[]
        previous: { services: number; durationMs: number }[]
        weekly: { _id: string | { y: number; w: number }; services: number; durationMs: number }[]
        speakers: { _id: string; services: number; durationMs: number }[]
        scriptures: { _id: string; count: number }[]
        speakerNames: { _id: string }[]
      }>([
        { $match: { orgId: new Types.ObjectId(orgId) } },
        {
          $facet: {
            totals: withSpeaker(
              [
                ...inRange,
                {
                  $group: {
                    _id: null,
                    services: { $sum: 1 },
                    recapsReady: { $sum: { $cond: [{ $eq: ['$status', 'ready'] }, 1, 0] } },
                    recapsFailed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
                    recapsPending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
                    totalDurationMs: { $sum: '$durationMs' },
                    totalWords: { $sum: '$wordCount' },
                    scripturePassages: { $sum: { $size: { $ifNull: ['$summary.keyScriptures', []] } } },
                    sharedLinks: { $sum: { $cond: ['$shareEnabled', 1, 0] } },
                  },
                },
              ],
              speaker,
            ),
            previous: previous
              ? withSpeaker(
                  [
                    {
                      $match: {
                        preachedAt: { $gte: previous.from, $lt: previous.to },
                      },
                    },
                    {
                      $group: {
                        _id: null,
                        services: { $sum: 1 },
                        durationMs: { $sum: '$durationMs' },
                      },
                    },
                  ],
                  speaker,
                )
              : [{ $match: { _id: null } }],
            weekly: withSpeaker(weeklyGroup, speaker),
            speakers: withSpeaker(
              [
                ...inRange,
                {
                  $group: {
                    _id: { $trim: { input: { $ifNull: ['$speaker', ''] } } },
                    services: { $sum: 1 },
                    durationMs: { $sum: '$durationMs' },
                  },
                },
                { $sort: { services: -1, durationMs: -1 } },
                { $limit: TOP_SPEAKERS },
              ],
              speaker,
            ),
            scriptures: withSpeaker(
              [
                ...inRange,
                {
                  $project: {
                    refs: {
                      $cond: [
                        { $gt: [{ $size: { $ifNull: ['$summary.keyScriptures', []] } }, 0] },
                        {
                          $map: {
                            input: '$summary.keyScriptures',
                            as: 'item',
                            in: '$$item.reference',
                          },
                        },
                        { $ifNull: ['$detectedScriptures', []] },
                      ],
                    },
                  },
                },
                { $unwind: '$refs' },
                { $group: { _id: '$refs', count: { $sum: 1 } } },
              ],
              speaker,
            ),
            speakerNames: [
              ...inRange,
              {
                $group: {
                  _id: { $trim: { input: { $ifNull: ['$speaker', ''] } } },
                },
              },
            ],
          },
        },
      ])
      .exec()

    const previousRow = facet?.previous[0]
    const references = (facet?.scriptures ?? []).flatMap((row) =>
      Array.from({ length: row.count }, () => row._id),
    )

    return assembleStats({
      totals: facet?.totals[0],
      previous: previousRow
        ? { services: previousRow.services, durationMs: previousRow.durationMs }
        : emptyPeriod(),
      weekly: (facet?.weekly ?? []).map((row) => ({
        start:
          typeof row._id === 'string' ? row._id : mondayOfIsoWeek(row._id.y, row._id.w),
        services: row.services,
        durationMs: row.durationMs,
      })),
      weekCount: bucketCount,
      chartFrom,
      granularity,
      speakers: (facet?.speakers ?? []).map((row) => ({
        name: row._id,
        services: row.services,
        durationMs: row.durationMs,
      })),
      speakerNames: (facet?.speakerNames ?? []).map((row) => row._id),
      references,
      now,
    })
  }
}
