'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import type { DayCount, KeyCount } from '@/lib/admin'

const dayLabel = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** A bar per day — signups, downloads. */
export function DailyChart({
  title,
  description,
  data,
  unit,
  loading,
}: {
  title: string
  description: string
  data: DayCount[]
  unit: string
  loading: boolean
}): React.ReactElement {
  const config = { count: { label: unit, color: 'var(--chart-1)' } } satisfies ChartConfig
  const rows = data.map((row) => ({ label: dayLabel.format(new Date(`${row.date}T00:00:00Z`)), count: row.count }))
  const tickEvery = rows.length > 16 ? Math.ceil(rows.length / 10) : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : (
          <ChartContainer config={config} className="h-64 w-full">
            <BarChart accessibilityLayer data={rows}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} tickMargin={8} axisLine={false} interval={tickEvery} />
              <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="count" fill="var(--color-count)" radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

/** Ranked rows with a proportional bar — platform, source, version, country. */
export function BreakdownCard({
  title,
  rows,
  names,
  loading,
}: {
  title: string
  rows: KeyCount[]
  names?: Record<string, string>
  loading: boolean
}): React.ReactElement {
  const max = Math.max(1, ...rows.map((row) => row.count))
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-32 w-full rounded-lg" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.key} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate">{names?.[row.key] ?? row.key}</span>
                  <span className="tabular-nums text-muted-foreground">{row.count.toLocaleString()}</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(row.count / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/** One headline number. */
export function StatCard({
  label,
  value,
  detail,
  loading,
}: {
  label: string
  value: number | undefined
  detail?: string | null
  loading: boolean
}): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        {loading || value === undefined ? (
          <Skeleton className="mt-1 h-8 w-20" />
        ) : (
          <CardTitle className="text-3xl font-semibold tabular-nums">{value.toLocaleString()}</CardTitle>
        )}
        {detail && !loading && <p className="text-xs text-muted-foreground">{detail}</p>}
      </CardHeader>
    </Card>
  )
}
