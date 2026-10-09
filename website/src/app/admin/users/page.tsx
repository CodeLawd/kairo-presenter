'use client'

import { useCallback, useEffect, useState } from 'react'
import { SearchIcon } from 'lucide-react'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate, formatRelative, ROLE_NAMES, type AdminUser, type Page } from '@/lib/admin'
import { Pager, useDebounced } from '@/components/admin/list-controls'

export default function AdminUsersPage(): React.ReactElement {
  const { request, session } = useDashboard()
  const isSuperadmin = session.user.platformRole === 'superadmin'
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page<AdminUser> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const q = useDebounced(query)

  const load = useCallback(async (): Promise<void> => {
    try {
      setData(await request<Page<AdminUser>>(`/v1/admin/users?q=${encodeURIComponent(q)}&page=${page}`))
      setError(null)
    } catch (failure) {
      setError((failure as Error).message)
    }
  }, [request, q, page])

  useEffect(() => {
    void load()
  }, [load])

  const setStatus = async (user: AdminUser, status: AdminUser['status']): Promise<void> => {
    setBusyId(user.id)
    try {
      await request(`/v1/admin/users/${user.id}`, { method: 'PATCH', body: { status } })
      await load()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const makeAdmin = async (user: AdminUser): Promise<void> => {
    setBusyId(user.id)
    try {
      if (user.platformRole === 'admin') {
        await request(`/v1/admin/admins/${user.id}`, { method: 'DELETE' })
      } else {
        await request('/v1/admin/admins', { method: 'POST', body: { email: user.email } })
      }
      await load()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  // Superadmins are config-held and untouchable; admins only by a superadmin.
  const canDisable = (user: AdminUser): boolean =>
    user.id !== session.user.id &&
    user.platformRole !== 'superadmin' &&
    (user.platformRole !== 'admin' || isSuperadmin)

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <div className="relative max-w-sm">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search name or email"
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
              <TableHead>User</TableHead>
              <TableHead>Church</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="font-medium">{user.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {user.email} · {user.signIn === 'google' ? 'Google' : 'Email'}
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {user.churches.length === 0
                    ? '—'
                    : user.churches.map((church) => `${church.name} (${church.role})`).join(', ')}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{formatDate(user.createdAt)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{formatRelative(user.lastLoginAt)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {user.status === 'disabled' ? (
                      <Badge variant="destructive">Disabled</Badge>
                    ) : user.verified ? (
                      <Badge variant="secondary">Active</Badge>
                    ) : (
                      <Badge variant="outline">Unverified</Badge>
                    )}
                    {user.platformRole && <Badge variant="outline">{ROLE_NAMES[user.platformRole]}</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {isSuperadmin && user.platformRole !== 'superadmin' && user.status === 'active' && (
                      <Button size="sm" variant="ghost" disabled={busyId === user.id} onClick={() => void makeAdmin(user)}>
                        {user.platformRole === 'admin' ? 'Remove admin' : 'Make admin'}
                      </Button>
                    )}
                    {canDisable(user) && (
                      <Button
                        size="sm"
                        variant={user.status === 'disabled' ? 'outline' : 'ghost'}
                        disabled={busyId === user.id}
                        onClick={() => void setStatus(user, user.status === 'disabled' ? 'active' : 'disabled')}
                      >
                        {user.status === 'disabled' ? 'Enable' : 'Disable'}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {data && data.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  No users match.
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
