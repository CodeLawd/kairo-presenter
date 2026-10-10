'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { BreakdownCard, DailyChart } from '@/components/admin/admin-charts'
import { RangePicker } from '@/components/admin/list-controls'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ERROR_NAMES, FEATURE_NAMES, OS_NAMES, formatDay, type AdminUsageChurchDetail } from '@/lib/admin'

/** One church: the computers it runs Kairo on, how often, and what it uses. */
export default function AdminChurchPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const { request } = useDashboard()
  const [days, setDays] = useState(30)
  const [data, setData] = useState<AdminUsageChurchDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    request<AdminUsageChurchDetail>(`/v1/admin/usage/churches/${encodeURIComponent(id)}?days=${days}`)
      .then(setData)
      .catch((failure: Error) => setError(failure.message))
  }, [request, id, days])

  const loading = !data

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <Link href="/admin/churches" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" />
        Churches
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{data?.name ?? ' '}</h2>
        <RangePicker value={days} onChange={setDays} ranges={[7, 30, 90]} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card className="overflow-hidden p-0">
        <CardHeader className="pt-6">
          <CardTitle>Computers</CardTitle>
          <CardDescription>Each install of Kairo that has reported (version 1.0.5 and later).</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">System</TableHead>
                <TableHead>App</TableHead>
                <TableHead>Setup</TableHead>
                <TableHead className="pr-6">Last active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.installs.map((install) => {
                const s = install.system
                const setup = [
                  Number(s.screens) > 0 && `${s.screens} screen${Number(s.screens) === 1 ? '' : 's'}`,
                  Number(s.ndiOutputs) > 0 && 'NDI',
                  s.propresenter === true && 'ProPresenter',
                  s.transcription === true && 'Transcription',
                  s.automation === true && 'Automation',
                ].filter(Boolean) as string[]
                return (
                  <TableRow key={install.installId}>
                    <TableCell className="pl-6">
                      <div className="font-medium">
                        {OS_NAMES[String(s.os)] ?? String(s.os || 'Unknown')} {String(s.osVersion ?? '')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {String(s.arch ?? '')}
                        {s.memoryGb ? ` · ${s.memoryGb} GB` : ''}
                        {s.defaultTranslation ? ` · ${s.defaultTranslation}` : ''}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">{String(s.appVersion || '—')}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {setup.length === 0 ? '—' : setup.map((item) => <Badge key={item} variant="secondary">{item}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell className="pr-6 text-sm text-muted-foreground">{formatDay(install.lastActive)}</TableCell>
                  </TableRow>
                )
              })}
              {data && data.installs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                    No computer from this church has reported yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <DailyChart
        title="Activity"
        description={`Everything this church did in Kairo each day, last ${days} days`}
        data={data?.activity ?? []}
        unit="Actions"
        loading={loading}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <BreakdownCard title="Features used" rows={data?.features ?? []} names={FEATURE_NAMES} loading={loading} />
        <BreakdownCard title="Errors" rows={data?.errors ?? []} names={ERROR_NAMES} loading={loading} />
      </div>
    </div>
  )
}
