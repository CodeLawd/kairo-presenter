import log from 'electron-log/main'
import {
  nextUploadBackoffMs,
  shouldRetryUpload,
  toSermonUpload,
  TranscriptTooLongError,
} from '@shared/sermon-upload'
import type { ServiceRecords } from '@shared/service-archive'
import type { ServiceRecord } from '@shared/service-records'
import type { SermonUploadInput, SermonUploadResult } from '@shared/cloud/contracts'
import { toApiError } from './api-client'

/**
 * The slice of the cloud session this uploader needs.
 *
 * Injected rather than imported so the uploader can be tested on its own — the
 * real `cloudSession` reaches the settings store and the whole auth stack, none
 * of which a queue-draining test should have to boot.
 */
export interface SermonUploadSession {
  canUpload(): boolean
  uploadSermon(payload: SermonUploadInput): Promise<SermonUploadResult>
}

/** A pump reads the whole archive; alt-tabbing should not trigger one each time. */
const WAKE_MIN_INTERVAL_MS = 10_000

/**
 * Gets ended services to the church's account, eventually.
 *
 * The booth is the machine most likely to be offline — a wifi drop mid-service
 * is normal, and nobody is sitting at it afterwards to notice a failure. So the
 * local record stays the source of truth, the upload retries on its own
 * schedule, and `failed` in the UI means "not yet", not "gone".
 */
export class SermonUploader {
  private timer: ReturnType<typeof setTimeout> | null = null
  private pumping = false
  private lastWakeAt = 0
  /** Delay of the pending timer, so a sooner request can replace it. */
  private scheduledDelayMs = Infinity

  constructor(
    private readonly records: ServiceRecords,
    private readonly session: SermonUploadSession,
  ) {}

  /** On launch: everything that was still waiting when the app last closed. */
  start(): void {
    this.schedule(2_000)
  }

  queue(serviceId: string): void {
    this.records.markUpload(serviceId, { status: 'queued', error: null })
    this.schedule(1_000)
  }

  /**
   * Something changed that might let a stalled upload through — the window
   * regained focus, or the session just signed in.
   *
   * Throttled, because a pump reads the whole archive off disk and alt-tabbing
   * is not a reason to do that.
   */
  wake(): void {
    if (Date.now() - this.lastWakeAt < WAKE_MIN_INTERVAL_MS) return
    this.lastWakeAt = Date.now()
    this.schedule(0)
  }

  /**
   * Arrange a pump.
   *
   * A sooner request wins: the retry path may have armed a 60s timer, and a
   * window regaining focus must not have to wait it out. Without this, `wake()`
   * is silently a no-op whenever any timer is already pending.
   */
  private schedule(delayMs: number): void {
    if (this.timer) {
      if (delayMs >= this.scheduledDelayMs) return
      clearTimeout(this.timer)
    }
    this.scheduledDelayMs = delayMs
    this.timer = setTimeout(() => {
      this.timer = null
      this.scheduledDelayMs = Infinity
      void this.pump()
    }, delayMs)
    this.timer.unref?.()
  }

  private async pump(): Promise<void> {
    if (this.pumping) return
    const waiting = this.records.queuedForUpload()
    if (waiting.length === 0) return

    // Signed out or unverified: stay queued and say nothing. This is not a
    // failure the operator can do anything about mid-service.
    if (!this.session.canUpload()) {
      this.schedule(60_000)
      return
    }

    this.pumping = true
    try {
      for (const record of waiting) {
        const state = record.upload
        // Respect the backoff for anything that has already failed.
        if (state.status === 'failed' && state.lastAttemptAt) {
          const waitMs = nextUploadBackoffMs(state.attempts)
          if (Date.now() - state.lastAttemptAt < waitMs) continue
        }
        await this.uploadOne(record)
      }
    } finally {
      this.pumping = false
      if (this.records.queuedForUpload().length > 0) this.schedule(60_000)
    }
  }

  /** Takes the record `pump` already read rather than re-reading the archive. */
  private async uploadOne(record: ServiceRecord): Promise<void> {
    const serviceId = record.id
    this.records.markUpload(serviceId, { status: 'uploading', lastAttemptAt: Date.now() })
    try {
      const result = await this.session.uploadSermon(toSermonUpload(record))
      this.records.markUpload(serviceId, {
        status: 'uploaded',
        sermonId: result.id,
        error: null,
        attempts: 0,
      })
      log.info('[Cloud] Sermon published', { serviceId })
    } catch (error) {
      if (error instanceof TranscriptTooLongError) {
        // No amount of retrying shortens the service.
        this.records.markUpload(serviceId, {
          status: 'failed',
          error: error.message,
          retryable: false,
        })
        return
      }
      const { status, message } = toApiError(error)
      const retryable = shouldRetryUpload(status)
      this.records.markUpload(serviceId, {
        status: 'failed',
        error: retryable ? message : `${message} This will not be retried.`,
        attempts: record.upload.attempts + 1,
        lastAttemptAt: Date.now(),
        retryable,
      })
      log.warn('[Cloud] Sermon upload failed', { serviceId, status, reason: message })
    }
  }
}
