'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import {
  formatBucketLabel,
  formatHours,
  hoursNumber,
  type SermonBookStat,
  type SermonSpeakerStat,
  type SermonStatsGranularity,
  type SermonWeekBucket,
} from '@/lib/sermons'

const activityConfig = {
  hours: { label: 'Hours', color: 'var(--chart-1)' },
} satisfies ChartConfig

const booksConfig = {
  count: { label: 'Passages', color: 'var(--chart-1)' },
} satisfies ChartConfig

function ChartSkeleton(): React.ReactElement {
  return <Skeleton className="h-80 w-full rounded-lg" />
}

export function ActivityChart({
  weekly,
  loading,
  description,
  granularity = 'week',
}: {
  weekly: SermonWeekBucket[]
  loading: boolean
  description: string
  granularity?: SermonStatsGranularity
}): React.ReactElement {
  const data = weekly.map((row) => ({
    label: formatBucketLabel(row.weekStart, granularity),
    hours: hoursNumber(row.durationMs),
    services: row.services,
  }))
  const hasData = weekly.some((row) => row.services > 0)
  const tickEvery = data.length > 16 ? Math.ceil(data.length / 12) : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preaching time</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <ChartSkeleton />
        ) : !hasData ? (
          <p className="flex h-80 items-center text-sm text-muted-foreground">
            End a service in the desktop app and a bar shows up for that{' '}
            {granularity === 'day' ? 'day' : 'week'}.
          </p>
        ) : (
          <ChartContainer config={activityConfig} className="h-80 w-full">
            <BarChart accessibilityLayer data={data}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                tickMargin={8}
                axisLine={false}
                interval={tickEvery}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={32}
                tickFormatter={(value: number) => `${value}`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label, payload) => {
                      const services = payload?.[0]?.payload?.services as number | undefined
                      const count = services ?? 0
                      return `${label} · ${count} ${count === 1 ? 'service' : 'services'}`
                    }}
                  />
                }
              />
              <Bar dataKey="hours" fill="var(--color-hours)" radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

export function BooksChart({
  books,
  loading,
}: {
  books: SermonBookStat[]
  loading: boolean
}): React.ReactElement {
  const data = books.map((row) => ({ book: row.book, count: row.count }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scripture</CardTitle>
        <CardDescription>Books cited across recaps.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <ChartSkeleton />
        ) : data.length === 0 ? (
          <p className="flex h-80 items-center text-sm text-muted-foreground">
            Cited passages appear here once a recap is written.
          </p>
        ) : (
          <ChartContainer config={booksConfig} className="h-80 w-full">
            <BarChart accessibilityLayer data={data} layout="vertical">
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="book"
                tickLine={false}
                axisLine={false}
                width={96}
              />
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Bar dataKey="count" fill="var(--color-count)" radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

export function SpeakersCard({
  speakers,
  loading,
}: {
  speakers: SermonSpeakerStat[]
  loading: boolean
}): React.ReactElement {
  const max = Math.max(1, ...speakers.map((row) => row.durationMs))

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Speakers</CardTitle>
        <CardDescription>Who has been in the pulpit.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex flex-col gap-3">
            {[0, 1].map((row) => (
              <Skeleton key={row} className="h-10 w-full" />
            ))}
          </div>
        ) : speakers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Speakers show up after the first recap.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {speakers.map((row) => (
              <div key={row.name} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{row.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {row.services} · {formatHours(row.durationMs)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(8, (row.durationMs / max) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function averageDuration(stats: { services: number; totalDurationMs: number; averageDurationMs?: number }): number {
  if (typeof stats.averageDurationMs === 'number') return stats.averageDurationMs
  return stats.services > 0 ? Math.round(stats.totalDurationMs / stats.services) : 0
}
