'use client'

import { useEffect, useMemo, useState } from 'react'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { BreakdownCard, DailyChart, StatCard } from '@/components/admin/admin-charts'
import { RangePicker } from '@/components/admin/list-controls'
import {
  ADOPTION_NAMES,
  ERROR_NAMES,
  FEATURE_NAMES,
  OS_NAMES,
  type AdminUsage,
  type DayCount,
} from '@/lib/admin'

/** Counters that are not "something the operator did" — kept off the actions chart. */
const NOT_ACTIONS = new Set(['listening_minutes', 'service_started', 'service_ended'])

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

/**
 * Usage statistics from the desktop app (v1.0.5+) and the website dashboard.
 * Counts and system facts only — see src/lib/cloud/usage.ts for what is sent.
 */
export default function AdminUsagePage(): React.ReactElement {
  const { request } = useDashboard()
  const [days, setDays] = useState(30)
  const [data, setData] = useState<AdminUsage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    request<AdminUsage>(`/v1/admin/usage?days=${days}`)
      .then(setData)
      .catch((failure: Error) => setError(failure.message))
  }, [request, days])

  const loading = !data
  const actionsByDay = useMemo<DayCount[]>(() => {
    if (!data) return []
    const totals = new Map<string, number>()
    for (const row of data.featureByDay) {
      if (!NOT_ACTIONS.has(row.key)) totals.set(row.day, (totals.get(row.day) ?? 0) + row.count)
    }
    return data.activeByDay.map(({ date }) => ({ date, count: totals.get(date) ?? 0 }))
  }, [data])
  const feature = (key: string): number => data?.features.find((f) => f.key === key)?.count ?? 0
  const installs = data?.systems.installs ?? 0

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangePicker value={days} onChange={setDays} ranges={[7, 30, 90]} />
        <p className="text-xs text-muted-foreground">Desktop figures come from Kairo 1.0.5 and later.</p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Section title="Activity">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Active today" value={data?.active.today} detail="Desktop installs" loading={loading} />
          <StatCard label="Active this week" value={data?.active.week} loading={loading} />
          <StatCard label="Active this month" value={data?.active.month} loading={loading} />
          <StatCard label="Churches active" value={data?.active.churches} detail={`In the last ${days} days`} loading={loading} />
        </div>
        <DailyChart
          title="Active installs"
          description={`Desktop installs used each day, last ${days} days`}
          data={data?.activeByDay ?? []}
          unit="Installs"
          loading={loading}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Services run" value={feature('service_ended')} loading={loading} />
          <StatCard label="Minutes transcribed" value={feature('listening_minutes')} loading={loading} />
          <StatCard label="Recaps published" value={feature('recap_uploaded')} loading={loading} />
        </div>
      </Section>

      <Section title="Features">
        <DailyChart
          title="Actions per day"
          description="Verses, lyrics, media, documents, timers and messages sent to screens"
          data={actionsByDay}
          unit="Actions"
          loading={loading}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <BreakdownCard
            title="What churches use"
            rows={(data?.features ?? []).filter((f) => !NOT_ACTIONS.has(f.key))}
            names={FEATURE_NAMES}
            loading={loading}
          />
          <BreakdownCard
            title={`Setup (of ${installs} install${installs === 1 ? '' : 's'})`}
            rows={data?.systems.adoption ?? []}
            names={ADOPTION_NAMES}
            loading={loading}
          />
        </div>
      </Section>

      <Section title="Systems">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <BreakdownCard title="Operating system" rows={data?.systems.os ?? []} names={OS_NAMES} loading={loading} />
          <BreakdownCard title="App version" rows={data?.systems.appVersion ?? []} loading={loading} />
          <BreakdownCard title="OS version" rows={(data?.systems.osVersion ?? []).slice(0, 8)} loading={loading} />
          <BreakdownCard title="Chip" rows={data?.systems.arch ?? []} names={{ arm64: 'Apple silicon / ARM', x64: 'Intel / x64' }} loading={loading} />
          <BreakdownCard title="Memory" rows={data?.systems.memoryGb ?? []} loading={loading} />
          <BreakdownCard title="Default Bible" rows={(data?.systems.bible ?? []).slice(0, 8)} loading={loading} />
        </div>
      </Section>

      <Section title="Errors">
        <div className="grid gap-4 md:grid-cols-2">
          <BreakdownCard title="By kind" rows={data?.errors ?? []} names={ERROR_NAMES} loading={loading} />
          <BreakdownCard title="By app version" rows={data?.errorsByVersion ?? []} loading={loading} />
        </div>
      </Section>

      <Section title="Website dashboard">
        <DailyChart
          title="Page views"
          description={`Dashboard and admin pages opened, last ${days} days`}
          data={data?.web.viewsByDay ?? []}
          unit="Views"
          loading={loading}
        />
        <BreakdownCard title="Most visited" rows={data?.web.pages ?? []} loading={loading} />
      </Section>
    </div>
  )
}
