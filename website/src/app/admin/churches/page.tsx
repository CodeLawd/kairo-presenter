'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SearchIcon } from 'lucide-react'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate, formatDay, type AdminChurch, type Page } from '@/lib/admin'
import { Pager, useDebounced } from '@/components/admin/list-controls'

export default function AdminChurchesPage(): React.ReactElement {
  const { request } = useDashboard()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page<AdminChurch> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const q = useDebounced(query)

  useEffect(() => {
    request<Page<AdminChurch>>(`/v1/admin/churches?q=${encodeURIComponent(q)}&page=${page}`)
      .then((result) => {
        setData(result)
        setError(null)
      })
      .catch((failure: Error) => setError(failure.message))
  }, [request, q, page])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <div className="relative max-w-sm">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search churches"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(1)
          }}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Church</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead className="text-right">Recaps</TableHead>
              <TableHead>Last active</TableHead>
              <TableHead>App</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((church) => (
              <TableRow key={church.id}>
                <TableCell>
                  <Link href={`/admin/churches/${church.id}`} className="font-medium hover:underline">
                    {church.name}
                  </Link>
                  {church.timezone && <div className="text-xs text-muted-foreground">{church.timezone}</div>}
                </TableCell>
                <TableCell className="text-sm">
                  {church.owner ? (
                    <>
                      <div>{church.owner.name}</div>
                      <div className="text-xs text-muted-foreground">{church.owner.email}</div>
                    </>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{church.members}</TableCell>
                <TableCell className="text-right tabular-nums">{church.sermons}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{formatDay(church.lastActive)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{church.appVersion ?? '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{formatDate(church.createdAt)}</TableCell>
              </TableRow>
            ))}
            {data && data.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No churches match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  )
}
