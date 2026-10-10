import type { UsageDayReport, UsageErrorKind, UsageFeature } from './cloud/usage'

/**
 * Local daily counters for usage statistics, kept until the API has them.
 *
 * Pure (storage injected) so it is unit-tested without Electron. Each report
 * carries a day's full totals, not deltas: today stays in the ledger after it
 * is sent and keeps counting, and the API replaces the day on every report, so
 * a re-send after a lost response can never double anything.
 */

export interface LedgerState {
  days: Record<string, { counts: Partial<Record<UsageFeature, number>>; errors: Partial<Record<UsageErrorKind, number>> }>
}

export interface LedgerStorage {
  read(): LedgerState
  write(state: LedgerState): void
}

/** Days kept locally while offline; older ones are dropped unsent. */
export const LEDGER_MAX_DAYS = 30

export class UsageLedger {
  constructor(
    private readonly storage: LedgerStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  track(feature: UsageFeature, n = 1): void {
    if (!(n > 0)) return
    this.update((day) => {
      day.counts[feature] = (day.counts[feature] ?? 0) + Math.round(n)
    })
  }

  error(kind: UsageErrorKind): void {
    this.update((day) => {
      day.errors[kind] = (day.errors[kind] ?? 0) + 1
    })
  }

  /** Every day still held, oldest first. */
  pending(): UsageDayReport[] {
    const { days } = this.storage.read()
    return Object.keys(days)
      .sort()
      .map((day) => ({ day, counts: { ...days[day].counts }, errors: { ...days[day].errors } }))
  }

  /** Forget days the API stored — except today, which is still counting. */
  markAccepted(accepted: readonly string[]): void {
    const today = localDay(this.now())
    const state = this.storage.read()
    for (const day of accepted) if (day !== today) delete state.days[day]
    this.storage.write(state)
  }

  clear(): void {
    this.storage.write({ days: {} })
  }

  private update(apply: (day: LedgerState['days'][string]) => void): void {
    const state = this.storage.read()
    const key = localDay(this.now())
    const day = (state.days[key] ??= { counts: {}, errors: {} })
    apply(day)
    const keys = Object.keys(state.days).sort()
    for (const old of keys.slice(0, Math.max(0, keys.length - LEDGER_MAX_DAYS))) delete state.days[old]
    this.storage.write(state)
  }
}

/** The machine's local calendar day — a Sunday service counts on Sunday. */
export function localDay(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
