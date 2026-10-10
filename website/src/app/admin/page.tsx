'use client'

import { useEffect, useState } from 'react'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { DailyChart, StatCard } from '@/components/admin/admin-charts'
import type { AdminOverview } from '@/lib/admin'

export default function AdminOverviewPage(): React.ReactElement {
  const { request } = useDashboard()
  const [data, setData] = useState<AdminOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    request<AdminOverview>('/v1/admin/overview')
      .then(setData)
      .catch((failure: Error) => setError(failure.message))
  }, [request])

  const loading = !data
  if (error) return <p className="text-sm text-destructive">{error}</p>

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Users"
          value={data?.users.total}
          detail={data && `+${data.users.new7d} this week · ${data.users.verified} verified`}
          loading={loading}
        />
        <StatCard
          label="Churches"
          value={data?.churches.total}
          detail={data && `+${data.churches.new30d} in 30 days`}
          loading={loading}
        />
        <StatCard
          label="Desktop installs in use"
          value={data?.activeInstalls30d}
          detail={data && `${data.activeThisWeek} used this week · signed in within 30 days`}
          loading={loading}
        />
        <StatCard
          label="Downloads"
          value={data?.downloads.total}
          detail={data && `${data.downloads.last30d} in 30 days`}
          loading={loading}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <DailyChart
          title="Signups"
          description="New accounts per day, last 30 days"
          data={data?.signups ?? []}
          unit="Signups"
          loading={loading}
        />
        <div className="grid gap-4">
          <StatCard
            label="Sermon recaps"
            value={data?.sermons.total}
            detail={data && `${data.sermons.last30d} in 30 days`}
            loading={loading}
          />
          <StatCard label="Disabled accounts" value={data?.users.disabled} loading={loading} />
        </div>
      </div>
    </div>
  )
}
