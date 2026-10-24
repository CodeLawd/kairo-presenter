'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { DailyChart, StatCard } from '@/components/admin/admin-charts'
import { Pager, RangePicker } from '@/components/admin/list-controls'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  OS_NAMES,
  crashProcessName,
  crashSystemName,
  formatDateTime,
  type AdminCrashes,
  type AdminCrashSummary,
} from '@/lib/admin'

/**
 * Crash summaries the desktop app sent: the last 30 days at a glance, the
 * commonest crashes with the users and systems they hit, then every report.
 */
export default function AdminCrashesPage(): React.ReactElement {
  const { request } = useDashboard()
  const [days, setDays] = useState(30)
  const [version, setVersion] = useState('')
  const [page, setPage] = useState(1)
  const [summary, setSummary] = useState<AdminCrashSummary | null>(null)
  const [data, setData] = useState<AdminCrashes | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    request<AdminCrashSummary>('/v1/admin/crashes/summary')
      .then(setSummary)
      .catch((failure: Error) => setError(failure.message))
  }, [request])

  useEffect(() => {
    request<AdminCrashes>(`/v1/admin/crashes?days=${days}&page=${page}${version ? `&version=${encodeURIComponent(version)}` : ''}`)
      .then((result) => {
        setData(result)
        setError(null)
      })
      .catch((failure: Error) => setError(failure.message))
  }, [request, days, version, page])

  const loading = !summary

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Crashes"
          value={summary?.crashes}
          detail={summary && `${summary.reports} report${summary.reports === 1 ? '' : 's'} · last 30 days`}
          loading={loading}
        />
        <StatCard label="Users affected" value={summary?.users} detail={summary && `in ${summary.churches} church${summary.churches === 1 ? '' : 'es'}`} loading={loading} />
        <StatCard label="Computers affected" value={summary?.installs} loading={loading} />
        <StatCard
          label="Top crash"
          // StatCard shows a placeholder for undefined, so "no top crash" must be 0, not missing.
          value={summary ? (summary.top?.crashes ?? 0) : undefined}
          detail={
            summary?.top
              ? `${summary.top.kind === 'renderer' ? 'Window' : 'Helper'} ${summary.top.reason} · ${OS_NAMES[summary.top.os] ?? summary.top.os} · ${summary.top.users} user${summary.top.users === 1 ? '' : 's'}`
              : summary && 'No crashes'
          }
          loading={loading}
        />
      </div>
      <DailyChart title="Crashes" description="Crashes per day, last 30 days" data={summary?.byDay ?? []} unit="Crashes" loading={loading} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={version}
          aria-label="App version"
          onChange={(event) => {
            setVersion(event.target.value)
            setPage(1)
          }}
        >
          <option value="">All versions</option>
          {data?.versions.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <RangePicker
          value={days}
          onChange={(next) => {
            setDays(next)
            setPage(1)
          }}
          ranges={[7, 30, 90]}
        />
      </div>

      <Card className="overflow-hidden p-0">
        <CardHeader className="pt-6">
          <CardTitle>Commonest crashes</CardTitle>
          <CardDescription>Grouped by how they died. Open one for everyone it hit.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Crash</TableHead>
                <TableHead className="text-right">Crashes</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead className="text-right">Computers</TableHead>
                <TableHead>Systems</TableHead>
                <TableHead>Versions</TableHead>
                <TableHead className="pr-6">Latest</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.groups.map((group) => (
                <TableRow key={`${group.kind}-${group.reason}-${group.exitCode}-${group.os}`}>
                  <TableCell className="pl-6">
                    <Link href={`/admin/crashes/${group.latestId}`} className="font-medium hover:underline">
                      {group.kind === 'renderer' ? 'Window' : 'Helper process'} {group.reason}
                    </Link>
                    <div className="text-xs tabular-nums text-muted-foreground">
                      {OS_NAMES[group.os] ?? (group.os || '—')} · exit code {group.exitCode}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{group.crashes}</TableCell>
                  <TableCell className="text-right tabular-nums">{group.users}</TableCell>
                  <TableCell className="text-right tabular-nums">{group.installs}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {group.systems.slice(0, 3).map((system) => <div key={system}>{system}</div>)}
                    {group.systems.length > 3 && <div>+{group.systems.length - 3} more</div>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{group.versions.join(', ') || '—'}</TableCell>
                  <TableCell className="pr-6 text-sm text-muted-foreground">{formatDateTime(group.lastAt)}</TableCell>
                </TableRow>
              ))}
              {data && data.groups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    No crashes reported in this period.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <CardHeader className="pt-6">
          <CardTitle>Reports</CardTitle>
          <CardDescription>Newest first. Open one for the window’s last errors and the log.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">When</TableHead>
                <TableHead>User</TableHead>
                <TableHead>What died</TableHead>
                <TableHead className="text-right">Times</TableHead>
                <TableHead>System</TableHead>
                <TableHead className="pr-6">App</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((crash) => (
                <TableRow key={crash.id}>
                  <TableCell className="pl-6">
                    <Link href={`/admin/crashes/${crash.id}`} className="font-medium hover:underline">
                      {formatDateTime(crash.lastAt)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{crash.user.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {crash.church ? (
                        <Link href={`/admin/churches/${crash.church.id}`} className="hover:underline">
                          {crash.church.name}
                        </Link>
                      ) : (
                        crash.user.email
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{crashProcessName(crash)}</div>
                    <div className="text-xs tabular-nums text-muted-foreground">
                      {crash.reason} · {crash.exitCode}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{crash.count}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{crashSystemName(crash)}</TableCell>
                  <TableCell className="pr-6 text-sm text-muted-foreground">{crash.appVersion || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {data && data.total > data.pageSize && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  )
}
