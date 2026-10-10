import os from 'node:os'
import { app } from 'electron'
import Store from 'electron-store'
import log from 'electron-log/main'
import type { UsageErrorKind, UsageFeature, UsageSystem } from '@shared/cloud/usage'
import { UsageLedger, type LedgerState } from '@shared/usage-ledger'
import { store as settings } from '../../db'
import { cloudSession } from '../cloud/session'

const FIRST_FLUSH_MS = 30_000
const FLUSH_EVERY_MS = 6 * 60 * 60 * 1000
const WAKE_MIN_INTERVAL_MS = 10 * 60 * 1000

/**
 * Usage statistics: counts of features used and the machine's setup, sent to
 * the church's Kairo account so the admin console can see what is used, where
 * and on which versions. Never content — see `src/lib/cloud/usage.ts`.
 *
 * Counting is synchronous and local; sending happens on its own schedule and
 * only when signed in, so a booth offline all Sunday loses nothing. Switching
 * "Share usage statistics" off stops counting and discards anything unsent.
 */
class UsageService {
  private readonly ledger: UsageLedger
  private timer: ReturnType<typeof setInterval> | null = null
  private lastWakeAt = 0
  private flushing = false

  constructor() {
    const store = new Store<LedgerState>({ name: 'kairo-usage', defaults: { days: {} } })
    this.ledger = new UsageLedger({
      read: () => ({ days: { ...store.get('days') } }),
      write: (state) => store.set('days', state.days),
    })
  }

  private get enabled(): boolean {
    return settings.get('usage')?.shareStats !== false
  }

  /** Count one use of a feature. Never throws — statistics must not break a service. */
  track(feature: UsageFeature, n = 1): void {
    if (!this.enabled) return
    try {
      this.ledger.track(feature, n)
    } catch (err) {
      log.warn('[Usage] track failed', (err as Error).message)
    }
  }

  trackError(kind: UsageErrorKind): void {
    if (!this.enabled) return
    try {
      this.ledger.error(kind)
    } catch {
      // Already handling an error; never add another.
    }
  }

  start(): void {
    setTimeout(() => void this.flush(), FIRST_FLUSH_MS).unref?.()
    this.timer = setInterval(() => void this.flush(), FLUSH_EVERY_MS)
    this.timer.unref?.()
  }

  /** The window regained focus — a good moment, at most every 10 minutes. */
  wake(): void {
    if (Date.now() - this.lastWakeAt < WAKE_MIN_INTERVAL_MS) return
    this.lastWakeAt = Date.now()
    void this.flush()
  }

  async flush(): Promise<void> {
    if (!this.enabled) {
      this.ledger.clear()
      return
    }
    if (this.flushing || !cloudSession.canUpload()) return
    const days = this.ledger.pending()
    if (days.length === 0) return
    this.flushing = true
    try {
      const { installId, ...device } = cloudSession.usageDevice()
      const result = await cloudSession.reportUsage({ installId, days, system: { ...device, ...this.setup() } })
      this.ledger.markAccepted(result.accepted)
    } catch (err) {
      // Next flush tries again; the ledger keeps everything until then.
      log.info('[Usage] report not sent:', (err as Error).message)
    } finally {
      this.flushing = false
    }
  }

  private setup(): Omit<UsageSystem, 'os' | 'osVersion' | 'arch' | 'appVersion' | 'electronVersion'> {
    const outputs = settings.get('overlay')?.outputs ?? []
    const stt = settings.get('stt')
    const scripture = settings.get('scripture')
    return {
      locale: app.getLocale(),
      cpuCount: os.cpus().length,
      memoryGb: Math.round(os.totalmem() / 1024 ** 3),
      screens: outputs.filter((o) => o.enabled && o.kind === 'screen').length,
      ndiOutputs: outputs.filter((o) => o.enabled && o.kind === 'ndi').length,
      propresenter: settings.get('propresenter')?.enabled === true,
      transcription: Boolean(stt?.apiKey),
      automation: scripture?.autoMode === true,
      defaultTranslation: scripture?.defaultTranslation ?? '',
      theme: settings.get('display')?.theme ?? 'dark',
    }
  }
}

export const usageService = new UsageService()
