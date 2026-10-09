'use client'

import { useCallback, useEffect, useState } from 'react'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ROLE_NAMES, type AdminTeamMember } from '@/lib/admin'

/**
 * Who can open the admin console. Superadmins (set on the server in
 * SUPERADMIN_EMAILS) add and remove admins here; admins can only look.
 */
export default function AdminTeamPage(): React.ReactElement {
  const { request, session } = useDashboard()
  const isSuperadmin = session.user.platformRole === 'superadmin'
  const [team, setTeam] = useState<AdminTeamMember[] | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setTeam(await request<AdminTeamMember[]>('/v1/admin/admins'))
    } catch (failure) {
      setError((failure as Error).message)
    }
  }, [request])

  useEffect(() => {
    void load()
  }, [load])

  const add = async (): Promise<void> => {
    if (!email.trim()) return
    setBusy('add')
    setError(null)
    try {
      await request('/v1/admin/admins', { method: 'POST', body: { email: email.trim() } })
      setEmail('')
      await load()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const remove = async (member: AdminTeamMember): Promise<void> => {
    if (!member.id) return
    setBusy(member.id)
    setError(null)
    try {
      await request(`/v1/admin/admins/${member.id}`, { method: 'DELETE' })
      await load()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      {isSuperadmin && (
        <Card>
          <CardHeader>
            <CardTitle>Add an admin</CardTitle>
            <CardDescription>
              They need a Kairo account first. Admins can see everything here and manage users, but can’t add admins.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault()
                void add()
              }}
            >
              <Input
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="sm:max-w-sm"
              />
              <Button type="submit" disabled={busy === 'add' || !email.trim()}>
                {busy === 'add' ? 'Adding…' : 'Add admin'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Person</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="pr-6 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {team?.map((member) => (
              <TableRow key={member.email}>
                <TableCell className="pl-6">
                  <div className="font-medium">{member.name || member.email}</div>
                  {member.name && <div className="text-xs text-muted-foreground">{member.email}</div>}
                  {member.status === 'no account' && (
                    <div className="text-xs text-muted-foreground">No account yet</div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={member.role === 'superadmin' ? 'default' : 'secondary'}>{ROLE_NAMES[member.role]}</Badge>
                </TableCell>
                <TableCell className="pr-6 text-right">
                  {isSuperadmin && member.role === 'admin' && (
                    <Button size="sm" variant="ghost" disabled={busy === member.id} onClick={() => void remove(member)}>
                      Remove
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">
        Superadmins are set on the server in SUPERADMIN_EMAILS and can’t be removed here.
      </p>
    </div>
  )
}
