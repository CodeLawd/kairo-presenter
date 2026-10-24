'use client'

import { useEffect, useState } from 'react'
import { DownloadIcon, LogOutIcon, Trash2Icon } from 'lucide-react'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { DeleteAccountDialog } from '@/components/dashboard/delete-account-dialog'
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
import { Separator } from '@/components/ui/separator'
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
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

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

  const downloadData = async (): Promise<void> => {
    setExporting(true)
    setExportError(null)
    let url: string | null = null
    try {
      const data = await request<unknown>('/v1/account/export')
      url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = `kairo-data-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
    } catch (failure) {
      setExportError(failure instanceof ApiError ? failure.message : 'Could not prepare your data.')
    } finally {
      if (url) URL.revokeObjectURL(url)
      setExporting(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h2 className="font-display text-[clamp(30px,3vw,40px)] leading-[1.05] font-medium tracking-[-.05em]">Account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your profile, your church, and the data Kairo holds about you.
        </p>
      </div>

      <Card>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Avatar size="lg">
              <AvatarFallback>{initialsOf(session.user.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium">{session.user.name}</p>
                <Badge variant={session.user.emailVerified ? 'secondary' : 'outline'}>
                  {session.user.emailVerified ? 'Verified' : 'Unverified'}
                </Badge>
              </div>
              <p className="truncate text-sm text-muted-foreground">{session.user.email}</p>
            </div>
            {/* Ends this browser session only; Kairo computers stay signed in. */}
            <Button type="button" variant="outline" onClick={() => void signOut()}>
              <LogOutIcon data-icon="inline-start" />
              Log out
            </Button>
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
              {saved ? 'Saved.' : dirty ? 'Unsaved changes' : 'Matches your Kairo computers.'}
            </p>
            <Button type="submit" disabled={busy || !orgId || !dirty}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your data</CardTitle>
          <CardDescription>
            Take a copy of everything Kairo holds about you, or delete it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">Download my data</p>
              <p className="text-sm text-muted-foreground">
                Your profile, sign-ins, church details, sermons with full transcripts, crash reports
                and usage statistics, as a JSON file. API keys are listed by name, never their values.
              </p>
              {exportError ? <p className="mt-1 text-sm text-destructive">{exportError}</p> : null}
            </div>
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              disabled={exporting}
              onClick={() => void downloadData()}
            >
              <DownloadIcon data-icon="inline-start" />
              {exporting ? 'Preparing…' : 'Download'}
            </Button>
          </div>
          <Separator />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">Delete account</p>
              <p className="text-sm text-muted-foreground">
                Permanently deletes your account. A church only you use is deleted with it, sermons
                included. You&apos;ll see exactly what goes before anything is removed.
              </p>
            </div>
            <Button
              type="button"
              variant="destructive"
              className="shrink-0"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2Icon data-icon="inline-start" />
              Delete account
            </Button>
          </div>
        </CardContent>
      </Card>

      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
    </div>
  )
}
