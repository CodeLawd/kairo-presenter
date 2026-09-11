import { assembleStats, fillWeekly, mondayOfIsoWeek, parseDay, resolveRange, resolveWindow, WEEK_WINDOW } from './sermon-stats'

describe('mondayOfIsoWeek', () => {
  it('puts ISO week 1 of 2026 on 29 Dec 2025', () => {
    expect(mondayOfIsoWeek(2026, 1)).toBe('2025-12-29')
  })

  it('puts ISO week 37 of 2026 on 7 Sep', () => {
    expect(mondayOfIsoWeek(2026, 37)).toBe('2026-09-07')
  })
})

describe('fillWeekly', () => {
  it('always returns twelve weeks, filling gaps with zeros', () => {
    const now = new Date('2026-09-11T12:00:00.000Z')
    const weeks = fillWeekly(now, [{ year: 2026, week: 37, services: 2, durationMs: 3_600_000 }])
    expect(weeks).toHaveLength(WEEK_WINDOW)
    expect(weeks.at(-1)?.weekStart).toBe('2026-09-07')
    expect(weeks.at(-1)).toEqual({ weekStart: '2026-09-07', services: 2, durationMs: 3_600_000 })
    expect(weeks[0]?.services).toBe(0)
  })

  it('can shorten the window', () => {
    const now = new Date('2026-09-11T12:00:00.000Z')
    expect(fillWeekly(now, [], 4)).toHaveLength(4)
  })
})

describe('resolveRange', () => {
  const now = new Date('2026-09-11T12:00:00.000Z')

  it('starts four weeks on this Monday', () => {
    const resolved = resolveRange('4w', now)
    expect(resolved.from?.toISOString().slice(0, 10)).toBe('2026-08-17')
    expect(resolved.weekCount).toBe(4)
  })

  it('has no from-date for all time', () => {
    expect(resolveRange('all', now).from).toBeNull()
    expect(resolveRange('all', now).weekCount).toBe(12)
  })
})

describe('resolveWindow', () => {
  const now = new Date('2026-09-11T12:00:00.000Z')

  it('treats today as a single UTC day', () => {
    const resolved = resolveWindow({ range: 'today', now })
    expect(resolved.from?.toISOString()).toBe('2026-09-11T00:00:00.000Z')
    expect(resolved.toExclusive?.toISOString()).toBe('2026-09-12T00:00:00.000Z')
    expect(resolved.granularity).toBe('day')
    expect(resolved.bucketCount).toBe(1)
  })

  it('counts seven rolling days', () => {
    const resolved = resolveWindow({ range: '7d', now })
    expect(resolved.from?.toISOString().slice(0, 10)).toBe('2026-09-05')
    expect(resolved.granularity).toBe('day')
    expect(resolved.bucketCount).toBe(7)
  })

  it('uses from/to as an inclusive custom range, even if swapped', () => {
    const resolved = resolveWindow({ range: 'custom', from: '2026-09-11', to: '2026-09-01', now })
    expect(resolved.from?.toISOString().slice(0, 10)).toBe('2026-09-01')
    expect(resolved.toExclusive?.toISOString().slice(0, 10)).toBe('2026-09-12')
    expect(resolved.granularity).toBe('day')
    expect(resolved.bucketCount).toBe(11)
  })

  it('rejects impossible calendar days', () => {
    expect(parseDay('2026-13-40')).toBeNull()
    expect(parseDay('2026-09-11')).toEqual(new Date('2026-09-11T00:00:00.000Z'))
  })
})

describe('assembleStats', () => {
  it('returns honest zeros when the org has never uploaded', () => {
    const stats = assembleStats({
      weekly: [],
      speakers: [],
      references: [],
      now: new Date('2026-09-11T12:00:00.000Z'),
    })
    expect(stats.services).toBe(0)
    expect(stats.averageDurationMs).toBe(0)
    expect(stats.weekly).toHaveLength(WEEK_WINDOW)
    expect(stats.scriptureBooks).toEqual([])
    expect(stats.speakerNames).toEqual([])
  })

  it('averages duration and names a blank speaker', () => {
    const stats = assembleStats({
      totals: {
        services: 2,
        recapsReady: 2,
        recapsFailed: 0,
        recapsPending: 0,
        totalDurationMs: 90 * 60_000,
        totalWords: 8000,
        scripturePassages: 3,
        sharedLinks: 1,
      },
      weekly: [],
      speakers: [{ name: '  ', services: 2, durationMs: 90 * 60_000 }],
      speakerNames: ['', 'Pastor Dara'],
      references: ['Romans 8:1', 'John 1:1'],
      now: new Date('2026-09-11T12:00:00.000Z'),
    })
    expect(stats.averageDurationMs).toBe(45 * 60_000)
    expect(stats.speakers[0]?.name).toBe('Unnamed')
    expect(stats.speakerNames).toEqual(['Pastor Dara', 'Unnamed'])
    expect(stats.scriptureBooks.map((row) => row.book)).toEqual(['John', 'Romans'])
  })
})
