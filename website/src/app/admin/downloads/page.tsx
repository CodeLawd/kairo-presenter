'use client'

import { useEffect, useState } from 'react'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { BreakdownCard, DailyChart, StatCard } from '@/components/admin/admin-charts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RangePicker } from '@/components/admin/list-controls'
import { PLATFORM_NAMES, SOURCE_NAMES, type AdminDownloads } from '@/lib/admin'

export default function AdminDownloadsPage(): React.ReactElement {
  const { request } = useDashboard()
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<AdminDownloads | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    request<AdminDownloads>(`/v1/admin/downloads?days=${days}`)
      .then(setData)
      .catch((failure: Error) => setError(failure.message))
  }, [request, days])

  const loading = !data
  const githubTotal = data?.github?.reduce((sum, asset) => sum + asset.count, 0)

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <RangePicker value={days} onChange={setDays} />
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Downloads from the website" value={data?.total} loading={loading} />
        <StatCard
          label="No installer available"
          value={data?.unavailable}
          detail="Visitors who found no file for their computer"
          loading={loading}
        />
        <StatCard
          label="GitHub file downloads, all time"
          value={githubTotal}
          detail={data && data.github === null ? 'GitHub unavailable right now' : 'Includes in-app updates'}
          loading={loading}
        />
      </div>

      <DailyChart
        title="Downloads per day"
        description={`Installer downloads started from the website, last ${days} days`}
        data={data?.byDay ?? []}
        unit="Downloads"
        loading={loading}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <BreakdownCard title="Computer" rows={data?.byPlatform ?? []} names={PLATFORM_NAMES} loading={loading} />
        <BreakdownCard title="From" rows={data?.bySource ?? []} names={SOURCE_NAMES} loading={loading} />
        <BreakdownCard title="Version" rows={data?.byVersion ?? []} loading={loading} />
        <BreakdownCard title="Country" rows={data?.byCountry ?? []} loading={loading} />
      </div>

      {data?.github && data.github.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>GitHub release files</CardTitle>
            <CardDescription>
              GitHub’s own counters. Windows and Mac update files are also fetched by the in-app updater.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Version</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead className="pr-6 text-right">Downloads</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.github.map((asset) => (
                  <TableRow key={`${asset.version}-${asset.file}`}>
                    <TableCell className="pl-6">{asset.version}</TableCell>
                    <TableCell className="font-mono text-xs">{asset.file}</TableCell>
                    <TableCell className="pr-6 text-right tabular-nums">{asset.count.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
