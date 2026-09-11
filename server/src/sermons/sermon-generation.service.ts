import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Sermon, SermonDocument } from './schemas/sermon.schema'
import { SermonsService } from './sermons.service'
import { SermonSummaryService, SummaryError } from './sermon-summary.service'
import { transcriptToText } from './sermon-transcript'

/** A sermon claimed this long ago was being generated when a process died. */
const STALE_AFTER_MS = 10 * 60_000
/** While work is in flight. */
const SWEEP_INTERVAL_MS = 60_000
/**
 * While nothing is pending. A church records a handful of services a week, so
 * the busy cadence would otherwise be ~1,400 pointless queries a day per replica.
 */
const IDLE_SWEEP_INTERVAL_MS = 10 * 60_000
const MAX_ATTEMPTS = 3
const MAX_CONCURRENT = 2

/**
 * Runs recap generation in the background.
 *
 * There is no Redis and no job queue here, which is the right size for a few
 * services a week — but "no queue" still has to survive a deploy landing
 * mid-generation. Two things make that work: claiming is a single atomic
 * findOneAndUpdate (so two replicas never generate the same recap), and a
 * sweeper re-queues anything left claimed but unfinished.
 */
@Injectable()
export class SermonGenerationService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SermonGenerationService.name)
  private readonly queue: string[] = []
  private readonly running = new Set<string>()
  private sweeper: ReturnType<typeof setInterval> | null = null
  private sweepIntervalMs = 0
  private stopped = false

  constructor(
    @InjectModel(Sermon.name) private readonly model: Model<SermonDocument>,
    private readonly sermons: SermonsService,
    private readonly summaries: SermonSummaryService,
  ) {}

  onModuleInit(): void {
    void this.recover()
    this.armSweeper(IDLE_SWEEP_INTERVAL_MS)
  }

  /** Re-arms at the given cadence, unless it is already running at that rate. */
  private armSweeper(intervalMs: number): void {
    if (this.stopped || this.sweepIntervalMs === intervalMs) return
    if (this.sweeper) clearInterval(this.sweeper)
    this.sweepIntervalMs = intervalMs
    this.sweeper = setInterval(() => void this.recover(), intervalMs)
    // Never hold the process open for a sweep.
    this.sweeper.unref?.()
  }

  onModuleDestroy(): void {
    this.stopped = true
    if (this.sweeper) clearInterval(this.sweeper)
    this.sweeper = null
    this.sweepIntervalMs = 0
  }

  /** Fire and forget: the upload response must not wait on a model. */
  enqueue(sermonId: string): void {
    if (this.queue.includes(sermonId) || this.running.has(sermonId)) return
    this.queue.push(sermonId)
    // Work in flight: sweep often enough to notice a claim going stale.
    this.armSweeper(SWEEP_INTERVAL_MS)
    void this.drain()
  }

  /**
   * Drop a sermon from the in-memory queue.
   *
   * A job already running will still finish the model call, but its write is
   * gated on `status: 'pending'`, so a cancel that restored `ready` is not
   * overwritten.
   */
  cancel(sermonId: string): void {
    const index = this.queue.indexOf(sermonId)
    if (index >= 0) this.queue.splice(index, 1)
  }

  private async drain(): Promise<void> {
    while (!this.stopped && this.queue.length > 0 && this.running.size < MAX_CONCURRENT) {
      const sermonId = this.queue.shift()
      if (!sermonId) return
      this.running.add(sermonId)
      void this.run(sermonId).finally(() => {
        this.running.delete(sermonId)
        void this.drain()
      })
    }
  }

  /**
   * Take ownership of a sermon, or return null if someone else has it.
   *
   * One atomic write does the whole thing: it only matches a sermon that is
   * still pending and either unclaimed or claimed long enough ago to be
   * abandoned, and it stamps the claim and bumps the attempt in the same
   * operation. This is what makes two API instances safe without a lock server.
   */
  private async claim(sermonId: string): Promise<SermonDocument | null> {
    const staleCutoff = new Date(Date.now() - STALE_AFTER_MS)
    return this.model
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(sermonId),
          status: 'pending',
          attempts: { $lt: MAX_ATTEMPTS },
          $or: [{ claimedAt: null }, { claimedAt: { $lt: staleCutoff } }],
        },
        { $set: { claimedAt: new Date() }, $inc: { attempts: 1 } },
        { new: true },
      )
      .exec()
  }

  private async run(sermonId: string): Promise<void> {
    const sermon = await this.claim(sermonId)
    if (!sermon) return

    try {
      const segments = this.sermons.transcriptOf(sermon)
      const result = await this.summaries.generate({
        orgId: sermon.orgId.toString(),
        title: sermon.title,
        speaker: sermon.speaker,
        preachedAt: sermon.preachedAt,
        transcriptText: transcriptToText(segments),
        detectedScriptures: sermon.detectedScriptures,
      })

      await this.model
        .updateOne(
          { _id: sermon._id, status: 'pending' },
          {
            $set: {
              status: 'ready',
              summary: result.summary,
              model: result.model,
              generatedAt: new Date(),
              failureReason: null,
              claimedAt: null,
            },
          },
        )
        .exec()
      this.log.log(`Recap generated for sermon ${sermonId}`)
    } catch (error) {
      await this.fail(sermon, error)
    }
  }

  private async fail(sermon: SermonDocument, error: unknown): Promise<void> {
    const summaryError =
      error instanceof SummaryError
        ? error
        : new SummaryError('provider', 'The recap could not be generated.', true)

    const canRetry = summaryError.retryable && sermon.attempts < MAX_ATTEMPTS
    await this.model
      .updateOne(
        { _id: sermon._id, status: 'pending' },
        {
          $set: {
            // Staying `pending` lets the sweeper pick it up again; the operator
            // sees "still working" rather than a failure that will fix itself.
            status: canRetry ? 'pending' : 'failed',
            failureReason: summaryError.message,
            failureCode: summaryError.code,
            claimedAt: null,
          },
        },
      )
      .exec()

    this.log.warn(
      `Recap generation ${canRetry ? 'failed, will retry' : 'failed'} for ` +
        `sermon ${sermon._id.toString()} [${summaryError.code}]: ${summaryError.message}`,
    )
  }

  /** Re-queue anything a dead process left half-generated. */
  private async recover(): Promise<void> {
    if (this.stopped) return
    const staleCutoff = new Date(Date.now() - STALE_AFTER_MS)
    try {
      const stuck = await this.model
        .find({
          status: 'pending',
          $or: [{ claimedAt: null }, { claimedAt: { $lt: staleCutoff } }],
        })
        .select('_id attempts')
        .limit(20)
        .exec()

      // Nothing waiting anywhere: drop back to the quiet cadence.
      if (stuck.length === 0 && this.queue.length === 0 && this.running.size === 0) {
        this.armSweeper(IDLE_SWEEP_INTERVAL_MS)
        return
      }

      for (const sermon of stuck) {
        if (sermon.attempts >= MAX_ATTEMPTS) {
          await this.model
            .updateOne(
              { _id: sermon._id },
              {
                $set: {
                  status: 'failed',
                  failureCode: 'stalled',
                  failureReason: 'Generation was interrupted. Try again.',
                  claimedAt: null,
                },
              },
            )
            .exec()
          continue
        }
        this.enqueue(sermon._id.toString())
      }
    } catch (error) {
      this.log.warn(`Recap sweep failed: ${(error as Error).message}`)
    }
  }
}
