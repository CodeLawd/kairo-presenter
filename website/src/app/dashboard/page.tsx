'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { OrgMember } from '@contracts/contracts'
import {
  ArrowUpRightIcon,
  BookOpenTextIcon,
  ClockIcon,
  DownloadIcon,
  KeyRoundIcon,
  MicIcon,
  MonitorSmartphoneIcon,
  TimerIcon,
} from 'lucide-react'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import {
  ActivityChart,
  averageDuration,
  BooksChart,
  SpeakersCard,
} from '@/components/dashboard/overview-charts'
import { OverviewFilters, type OverviewFilterValue } from '@/components/dashboard/overview-filters'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  formatCompactCount,
  formatCountDelta,
  formatDuration,
  formatHours,
  formatServiceDate,
  statsQuery,
  statsRangeLabel,
  type SermonListItem,
  type SermonListPage,
  type SermonStats,
} from '@/lib/sermons'
import { cn } from '@/lib/utils'

const RECENT_LIMIT = 6

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'there'
}

function greetingFor(date: Date): string {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function StatusBadge({ status }: { status: SermonListItem['status'] }): React.ReactElement {
  if (status === 'pending') return <Badge variant="outline">Writing</Badge>
  if (status === 'failed') return <Badge variant="destructive">Failed</Badge>
  return <Badge variant="secondary">Ready</Badge>
}

function MetricValue({
  loading,
  failed,
  children,
}: {
  loading: boolean
  failed: boolean
  children: React.ReactNode
}): React.ReactElement {
  if (loading) return <Skeleton className="mt-1 h-8 w-16" />
  return <p className="mt-1 font-display text-[28px] font-semibold tracking-tight">{failed ? '—' : children}</p>
}

export default function DashboardPage(): React.ReactElement {
  const { session, request } = useDashboard()
  const org = session.orgs.find((item) => item.id === session.orgId)
  const orgId = session.orgId
  const now = new Date()
  const seats = org ? 1 : 0
  const [filter, setFilter] = useState<OverviewFilterValue>({ range: '7d', speaker: '' })
  const [stats, setStats] = useState<SermonStats | null>(null)
  const [recent, setRecent] = useState<SermonListItem[]>([])
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsFailed, setStatsFailed] = useState(false)
  const [recentLoading, setRecentLoading] = useState(true)
  const [recentFailed, setRecentFailed] = useState(false)
  const params = statsQuery(filter)
  const narrowed =
    Boolean(filter.speaker) || filter.range === 'today' || filter.range === 'custom'

  const load = useCallback(async () => {
    if (!orgId) {
      setStatsLoading(false)
      setRecentLoading(false)
      return
    }
    try {
      setStatsFailed(false)
      setRecentFailed(false)
      const [numbers, sermons] = await Promise.allSettled([
        request<SermonStats>(`/v1/orgs/${orgId}/sermons/stats?${params}`),
        request<SermonListPage>(`/v1/orgs/${orgId}/sermons?limit=${RECENT_LIMIT}&${params}`),
      ])
      if (numbers.status === 'fulfilled') {
        setStats(numbers.value)
      } else {
        setStatsFailed(true)
      }
      if (sermons.status === 'fulfilled') {
        setRecent(sermons.value.items)
      } else {
        setRecentFailed(true)
      }
    } finally {
      setStatsLoading(false)
      setRecentLoading(false)
    }
  }, [orgId, params, request])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!orgId) {
      setMemberCount(1)
      return
    }
    void request<OrgMember[]>(`/v1/orgs/${orgId}/members`)
      .then((members) => setMemberCount(members.length))
      .catch(() => setMemberCount(1))
  }, [orgId, request])

  useEffect(() => {
    const names = stats?.speakerNames ?? []
    if (filter.speaker && names.length > 0 && !names.includes(filter.speaker)) {
      setFilter((current) => ({ ...current, speaker: '' }))
    }
  }, [filter.speaker, stats?.speakerNames])

  const previous = stats?.previous ?? { services: 0, durationMs: 0 }
  const weekly = stats?.weekly ?? []
  const speakers = stats?.speakers ?? []
  const scriptureBooks = stats?.scriptureBooks ?? []
  const speakerNames = stats?.speakerNames ?? []

  const metrics = [
    {
      label: 'Services recorded',
      icon: MicIcon,
      value: stats?.services ?? 0,
      hint:
        stats && !statsFailed
          ? filter.range === 'all' && !filter.speaker
            ? 'All recorded services'
            : formatCountDelta(stats.services, previous.services)
          : 'From the booth',
    },
    {
      label: 'Hours transcribed',
      icon: ClockIcon,
      value: formatHours(stats?.totalDurationMs ?? 0),
      hint:
        stats && !statsFailed
          ? filter.range === 'all' && !filter.speaker
            ? 'All recorded time'
            : `${formatHours(previous.durationMs)} previous`
          : 'Spoken in services',
    },
    {
      label: 'Average length',
      icon: TimerIcon,
      value: formatDuration(stats ? averageDuration(stats) : 0),
      hint: stats && !statsFailed ? `${stats.recapsReady} recaps ready` : 'Typical service',
    },
    {
      label: 'Scripture passages',
      icon: BookOpenTextIcon,
      value: formatCompactCount(stats?.scripturePassages ?? 0),
      hint:
        stats && !statsFailed
          ? `${stats.sharedLinks} ${stats.sharedLinks === 1 ? 'link' : 'links'} shared`
          : 'Matched live',
    },
  ] as const

  const shortcuts = [
    {
      href: '/dashboard/keys',
      icon: KeyRoundIcon,
      title: 'API keys',
      description: 'Sync keys to every booth machine',
    },
    {
      href: '/dashboard/devices',
      icon: MonitorSmartphoneIcon,
      title: 'Devices',
      description: 'See which computers are signed in',
    },
    {
      href: '/dashboard/download',
      icon: DownloadIcon,
      title: 'Desktop app',
      description: 'Live transcript next to ProPresenter',
    },
  ] as const

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="font-display text-[28px] font-semibold tracking-tight text-foreground">
            {greetingFor(now)}, {firstName(session.user.name)}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {org?.name ?? 'Your church'}
            <span className="mx-1.5 text-muted-foreground">·</span>
            {now.toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OverviewFilters
            value={filter}
            speakerNames={speakerNames}
            onChange={(next) => {
              setStatsLoading(true)
              setRecentLoading(true)
              setFilter(next)
            }}
          />
          <Button render={<Link href="/dashboard/download" />} nativeButton={false} variant="outline">
            <DownloadIcon data-icon="inline-start" />
            Desktop app
          </Button>
          <Button render={<Link href="/dashboard/sermons" />} nativeButton={false}>
            View recaps
            <ArrowUpRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label} size="sm">
            <CardHeader>
              <CardDescription>{metric.label}</CardDescription>
              <CardAction>
                <metric.icon className="size-4 text-muted-foreground" />
              </CardAction>
            </CardHeader>
            <CardContent>
              <MetricValue loading={statsLoading} failed={statsFailed}>
                {metric.value}
              </MetricValue>
              <p className="mt-1 text-xs text-muted-foreground">{metric.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ActivityChart
          weekly={weekly}
          loading={statsLoading}
          granularity={stats?.granularity ?? 'week'}
          description={
            stats?.granularity === 'day'
              ? 'Hours captured each day in this range.'
              : filter.range === 'all'
                ? 'Recent weeks. Totals cover every recap.'
                : `Hours captured over ${statsRangeLabel(filter.range, filter.from, filter.to).toLowerCase()}.`
          }
        />
        <BooksChart books={scriptureBooks} loading={statsLoading} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Recent recaps</CardTitle>
            <CardDescription>Latest services written up from the booth.</CardDescription>
            <CardAction>
              <Button render={<Link href="/dashboard/sermons" />} nativeButton={false} variant="ghost" size="sm">
                View all
                <ArrowUpRightIcon data-icon="inline-end" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {recentLoading ? (
              <div className="flex flex-col gap-3 py-2">
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                    <Skeleton className="h-5 w-14" />
                  </div>
                ))}
              </div>
            ) : recentFailed ? (
              <p className="py-6 text-sm text-muted-foreground">Could not load recaps right now.</p>
            ) : recent.length === 0 ? (
              <div className="flex flex-col items-start gap-3 py-8">
                <p className="text-sm font-medium">{narrowed ? 'No recaps in this range' : 'No recaps yet'}</p>
                <p className="max-w-[42ch] text-sm text-muted-foreground">
                  {narrowed
                    ? 'Try a wider date range, or end a service in the desktop app.'
                    : 'End a service in the Kairo desktop app and its recap appears here.'}
                </p>
                <Button render={<Link href="/dashboard/download" />} nativeButton={false} size="sm">
                  <DownloadIcon data-icon="inline-start" />
                  Get the desktop app
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b text-xs text-muted-foreground">
                    <tr>
                      <th className="pb-2.5 pr-4 font-medium">Sermon</th>
                      <th className="hidden pb-2.5 pr-4 font-medium sm:table-cell">Speaker</th>
                      <th className="hidden pb-2.5 pr-4 font-medium md:table-cell">Date</th>
                      <th className="hidden pb-2.5 pr-4 font-medium lg:table-cell">Length</th>
                      <th className="pb-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((item, index) => (
                      <tr
                        key={item.id}
                        className={cn(index < recent.length - 1 && 'border-b')}
                      >
                        <td className="py-3 pr-4">
                          <Link href={`/dashboard/sermons/${item.id}`} className="block min-w-0 hover:text-foreground">
                            <span className="block truncate font-medium text-foreground">
                              {item.headline ?? item.title}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground sm:hidden">
                              {[item.speaker, formatDuration(item.durationMs)].filter(Boolean).join(' · ')}
                            </span>
                          </Link>
                        </td>
                        <td className="hidden max-w-40 truncate py-3 pr-4 text-muted-foreground sm:table-cell">
                          {item.speaker || '—'}
                        </td>
                        <td className="hidden whitespace-nowrap py-3 pr-4 text-muted-foreground md:table-cell">
                          {formatServiceDate(item.preachedAt)}
                        </td>
                        <td className="hidden whitespace-nowrap py-3 pr-4 text-muted-foreground lg:table-cell">
                          {formatDuration(item.durationMs)}
                        </td>
                        <td className="py-3">
                          <StatusBadge status={item.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <SpeakersCard speakers={speakers} loading={statsLoading} />
          <Card size="sm">
            <CardHeader>
              <CardTitle>Plan</CardTitle>
              <CardAction>
                <Badge variant="secondary">Free</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Devices</span>
                <span className="font-medium">{seats} of 1</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Members</span>
                {memberCount === null ? (
                  <Skeleton className="h-4 w-8" />
                ) : (
                  <span className="font-medium">{memberCount}</span>
                )}
              </div>
            </CardContent>
            <CardFooter>
              <Button
                render={<Link href="/dashboard/billing" />}
                nativeButton={false}
                variant="outline"
                className="w-full"
              >
                Upgrade to Plus
                <ArrowUpRightIcon data-icon="inline-end" />
              </Button>
            </CardFooter>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Shortcuts</CardTitle>
              <CardDescription>Keep the booth in sync.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {shortcuts.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 rounded-lg py-2 transition-colors hover:bg-muted"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <item.icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{item.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                  </span>
                  <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
