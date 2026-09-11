'use client'

import { useEffect, useState } from 'react'
import { LogOutIcon } from 'lucide-react'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'

function initialsOf(value: string): string {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'K'
  )
}

export default function AccountPage(): React.ReactElement {
  const { session, request, refresh, signOut } = useDashboard()
  const orgId = session.orgId
  const churchName = session.orgs.find((org) => org.id === orgId)?.name ?? ''
  const [name, setName] = useState(churchName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setName(churchName)
  }, [churchName])

  const dirty = name.trim() !== churchName.trim()

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!orgId) {
      setError('No church is linked to this account yet.')
      return
    }
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await request(`/v1/orgs/${orgId}`, {
        method: 'PATCH',
        body: { name: name.trim() },
      })
      await refresh()
      setSaved(true)
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h2 className="font-display text-[28px] font-semibold tracking-tight">Account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your profile, church name, and this browser session.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>How you appear to other operators in this church.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Avatar size="lg">
              <AvatarFallback>{initialsOf(session.user.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{session.user.name}</p>
              <p className="truncate text-sm text-muted-foreground">{session.user.email}</p>
            </div>
            <Badge variant={session.user.emailVerified ? 'secondary' : 'outline'}>
              {session.user.emailVerified ? 'Verified' : 'Unverified'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Church</CardTitle>
          <CardDescription>Shown in the sidebar and on shared recaps.</CardDescription>
        </CardHeader>
        <form onSubmit={(event) => void save(event)}>
          <CardContent>
            <div className="flex max-w-md flex-col gap-1.5">
              <Label htmlFor="church-name">Church name</Label>
              <Input
                id="church-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setSaved(false)
                }}
                placeholder="Grace Chapel"
                required
              />
            </div>
            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {saved ? 'Saved.' : dirty ? 'Unsaved changes' : 'Matches what’s on the booth.'}
            </p>
            <Button type="submit" disabled={busy || !orgId || !dirty}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sign out</CardTitle>
          <CardDescription>
            Ends this browser session. Booth machines stay signed in until you remove them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={() => void signOut()}>
            <LogOutIcon data-icon="inline-start" />
            Log out
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
