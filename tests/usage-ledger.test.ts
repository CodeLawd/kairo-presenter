import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LEDGER_MAX_DAYS, UsageLedger, localDay, type LedgerState } from '../src/lib/usage-ledger'
import { usagePageSection, USAGE_FEATURES } from '../src/lib/cloud/usage'

function memory(): { storage: { read: () => LedgerState; write: (s: LedgerState) => void }; state: () => LedgerState } {
  let state: LedgerState = { days: {} }
  return {
    storage: { read: () => structuredClone(state), write: (next) => { state = structuredClone(next) } },
    state: () => state,
  }
}

test('counts features and errors on the local day', () => {
  const mem = memory()
  const clock = new Date(2026, 9, 11, 10, 0)
  const ledger = new UsageLedger(mem.storage, () => clock)
  ledger.track('lyrics_slide')
  ledger.track('lyrics_slide', 2)
  ledger.track('listening_minutes', 47.6)
  ledger.track('scripture_manual', 0) // nothing to count
  ledger.error('uncaught')
  assert.deepEqual(ledger.pending(), [
    { day: '2026-10-11', counts: { lyrics_slide: 3, listening_minutes: 48 }, errors: { uncaught: 1 } },
  ])
})

test('a new day starts its own counters', () => {
  const mem = memory()
  let clock = new Date(2026, 9, 11, 23, 59)
  const ledger = new UsageLedger(mem.storage, () => clock)
  ledger.track('media_live')
  clock = new Date(2026, 9, 12, 0, 1)
  ledger.track('media_live')
  assert.deepEqual(ledger.pending().map((d) => [d.day, d.counts.media_live]), [
    ['2026-10-11', 1],
    ['2026-10-12', 1],
  ])
})

test('accepted past days are dropped, today keeps counting', () => {
  const mem = memory()
  let clock = new Date(2026, 9, 11, 9)
  const ledger = new UsageLedger(mem.storage, () => clock)
  ledger.track('service_started')
  clock = new Date(2026, 9, 12, 9)
  ledger.track('service_started')
  ledger.markAccepted(['2026-10-11', '2026-10-12'])
  // Yesterday is done; today stays so its next report carries the full total.
  assert.deepEqual(Object.keys(mem.state().days), ['2026-10-12'])
  ledger.track('service_started')
  assert.equal(ledger.pending()[0].counts.service_started, 2)
})

test('offline for weeks: only the newest days are kept', () => {
  const mem = memory()
  let clock = new Date(2026, 0, 1)
  const ledger = new UsageLedger(mem.storage, () => clock)
  for (let i = 0; i < LEDGER_MAX_DAYS + 5; i++) {
    clock = new Date(2026, 0, 1 + i)
    ledger.track('timer_start')
  }
  const days = ledger.pending().map((d) => d.day)
  assert.equal(days.length, LEDGER_MAX_DAYS)
  assert.equal(days.at(-1), localDay(clock))
})

test('clear forgets everything (switching statistics off)', () => {
  const mem = memory()
  const ledger = new UsageLedger(mem.storage)
  ledger.track('song_import')
  ledger.clear()
  assert.deepEqual(ledger.pending(), [])
})

test('a report carries counters only — no field that could hold content', () => {
  const mem = memory()
  const ledger = new UsageLedger(mem.storage)
  for (const feature of USAGE_FEATURES) ledger.track(feature)
  const [day] = ledger.pending()
  assert.deepEqual(Object.keys(day).sort(), ['counts', 'day', 'errors'])
  for (const value of Object.values(day.counts)) assert.equal(typeof value, 'number')
})

test('website pages count by section, never by id', () => {
  assert.equal(usagePageSection('/dashboard'), '/dashboard')
  assert.equal(usagePageSection('/dashboard/sermons/6612abcdef?tab=notes'), '/dashboard/sermons')
  assert.equal(usagePageSection('/admin/churches/66aa'), '/admin/churches')
  assert.equal(usagePageSection('/login'), null)
  assert.equal(usagePageSection('/'), null)
})
