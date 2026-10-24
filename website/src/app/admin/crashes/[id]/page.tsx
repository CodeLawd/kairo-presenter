'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { OS_NAMES, crashProcessName, crashSystemName, formatDateTime, type AdminCrashDetail } from '@/lib/admin'

function Fact({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm tabular-nums">{children}</dd>
    </div>
  )
}

/** One crash report in full: who, what died, the machine, the window's last errors, the log, and everyone else it hit. */
export default function AdminCrashPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const { request } = useDashboard()
  const [data, setData] = useState<AdminCrashDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    request<AdminCrashDetail>(`/v1/admin/crashes/${encodeURIComponent(id)}`)
      .then(setData)
      .catch((failure: Error) => setError(failure.message))
  }, [request, id])

  const system = data?.system
  const gpu = Object.entries(system?.gpu ?? {})

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <Link href="/admin/crashes" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" />
        Crashes
      </Link>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && (
        <>
          <div>
            <h2 className="text-xl font-semibold">
              {crashProcessName(data)} {data.reason}
            </h2>
            <p className="text-sm text-muted-foreground">
              {data.user.name}
              {data.user.email && ` (${data.user.email})`}
              {' · '}
              {data.church ? (
                <Link href={`/admin/churches/${data.church.id}`} className="hover:underline">
                  {data.church.name}
                </Link>
              ) : (
                'No church'
              )}
              {' · '}
              {data.count === 1 ? formatDateTime(data.firstAt) : `${data.count} times, ${formatDateTime(data.firstAt)} – ${formatDateTime(data.lastAt)}`}
            </p>
          </div>

          <Card>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Fact label="Exit code">{data.exitCode}</Fact>
                <Fact label="App">{data.appVersion || '—'}</Fact>
                <Fact label="System">
                  {OS_NAMES[data.os] ?? data.os} {String(system?.osVersion ?? '')} · {String(system?.arch ?? '')}
                </Fact>
                <Fact label="Electron">{String(system?.electronVersion ?? '—')}</Fact>
                <Fact label="Memory">{system?.memoryGb ? `${String(system.memoryGb)} GB` : '—'}</Fact>
                <Fact label="Install">{data.installId}</Fact>
              </dl>
              {gpu.length > 0 && (
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-4 sm:grid-cols-3">
                  {gpu.map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-2 text-xs">
                      <dt className="truncate text-muted-foreground">{key}</dt>
                      <dd className="shrink-0">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden p-0">
            <CardHeader className="pt-6">
              <CardTitle>Affected</CardTitle>
              <CardDescription>
                Everyone who hit this same crash ({data.reason}, exit code {data.exitCode}, {OS_NAMES[data.os] ?? data.os}), newest first.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">User</TableHead>
                    <TableHead>Church</TableHead>
                    <TableHead>System</TableHead>
                    <TableHead>App</TableHead>
                    <TableHead className="text-right">Times</TableHead>
                    <TableHead className="pr-6">Last</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.affected.map((other) => (
                    <TableRow key={other.id} className={other.id === data.id ? 'bg-muted/50' : undefined}>
                      <TableCell className="pl-6 text-sm">
                        <Link href={`/admin/crashes/${other.id}`} className="font-medium hover:underline">
                          {other.user.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">{other.user.email}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {other.church ? (
                          <Link href={`/admin/churches/${other.church.id}`} className="hover:underline">
                            {other.church.name}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{crashSystemName(other)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{other.appVersion || '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{other.count}</TableCell>
                      <TableCell className="pr-6 text-sm text-muted-foreground">{formatDateTime(other.lastAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Window errors</CardTitle>
              <CardDescription>What the window printed before it died, newest last.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.errors.length === 0 ? (
                <p className="text-sm text-muted-foreground">None — the crash happened without a script error first.</p>
              ) : (
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{data.errors.join('\n')}</pre>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Log</CardTitle>
              <CardDescription>The end of the app’s log at the latest crash. Home folders are shown as ~.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[32rem] overflow-auto rounded-md bg-muted p-3 text-xs">{data.log || 'No log was available.'}</pre>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
