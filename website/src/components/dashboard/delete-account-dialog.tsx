'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'

/** `GET /v1/account/deletion` — what deleting would do, decided by the server. */
interface DeletionPreview {
  confirmWith: 'password' | 'email-code'
  deleteOrgs: { id: string; name: string }[]
  leaveOrgs: { id: string; name: string }[]
  blockers: { id: string; name: string; otherMembers: number }[]
  sermonCounts: Record<string, number>
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * The one irreversible thing in the dashboard, so it says exactly what goes —
 * every church that is deleted with the account is named, and has to be
 * acknowledged, before the button does anything.
 */
export function DeleteAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.ReactElement {
  const router = useRouter()
  const { session, request } = useDashboard()
  const [preview, setPreview] = useState<DeletionPreview | null>(null)
  const [secret, setSecret] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPreview(null)
    setSecret('')
    setAcknowledged(false)
    setCodeSent(false)
    setError(null)
    request<DeletionPreview>('/v1/account/deletion')
      .then(setPreview)
      .catch((failure: unknown) =>
        setError(failure instanceof ApiError ? failure.message : 'Could not load your account.'),
      )
  }, [open, request])

  const sendCode = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await request('/v1/account/deletion/code', { method: 'POST' })
      setCodeSent(true)
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not send the code.')
    } finally {
      setBusy(false)
    }
  }

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      await request('/v1/account/delete', {
        method: 'POST',
        body: {
          ...(preview.confirmWith === 'password' ? { password: secret } : { code: secret.trim() }),
          deleteOrgIds: preview.deleteOrgs.map((org) => org.id),
        },
      })
      router.replace('/')
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not delete your account.')
      setBusy(false)
    }
  }

  const blocked = (preview?.blockers.length ?? 0) > 0
  const needsAck = (preview?.deleteOrgs.length ?? 0) > 0
  const ready =
    preview !== null &&
    !blocked &&
    secret.trim() !== '' &&
    (!needsAck || acknowledged) &&
    (preview.confirmWith === 'password' || codeSent)

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(event) => void submit(event)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes {session.user.email}. It can&apos;t be undone — download your
              data first if you want a copy.
            </DialogDescription>
          </DialogHeader>

          {!preview && !error ? (
            <p className="text-sm text-muted-foreground">Checking what will be deleted…</p>
          ) : null}

          {preview && blocked ? (
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p className="font-medium">Make someone else an owner first</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted-foreground">
                {preview.blockers.map((org) => (
                  <li key={org.id}>
                    You&apos;re the only owner of {org.name}, which{' '}
                    {plural(org.otherMembers, 'other person', 'other people')}{' '}
                    {org.otherMembers === 1 ? 'still uses' : 'still use'}.
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview && !blocked ? (
            <div className="grid gap-3 text-sm">
              <div>
                <p className="font-medium">What gets deleted</p>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted-foreground">
                  <li>Your profile and sign-ins on every device</li>
                  <li>Crash reports and usage statistics from your computers</li>
                  {preview.deleteOrgs.map((org) => {
                    const sermons = preview.sermonCounts[org.id] ?? 0
                    return (
                      <li key={org.id}>
                        <span className="text-foreground">{org.name}</span>
                        {sermons > 0
                          ? `, its ${plural(sermons, 'sermon')} with transcripts, and its saved API keys`
                          : ' and its saved API keys'}
                      </li>
                    )
                  })}
                </ul>
              </div>
              {preview.leaveOrgs.length > 0 ? (
                <p className="text-muted-foreground">
                  You&apos;ll be removed from {preview.leaveOrgs.map((org) => org.name).join(', ')}. Those
                  churches and their sermons stay.
                </p>
              ) : null}

              {needsAck ? (
                <label className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-destructive"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  <span>
                    I understand {preview.deleteOrgs.map((org) => org.name).join(', ')}{' '}
                    {preview.deleteOrgs.length === 1 ? 'is' : 'are'} deleted for good.
                  </span>
                </label>
              ) : null}

              {preview.confirmWith === 'password' ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="delete-password">Enter your password to confirm</Label>
                  <Input
                    id="delete-password"
                    type="password"
                    autoComplete="current-password"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                  />
                </div>
              ) : codeSent ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="delete-code">Code from the email we sent you</Label>
                  <Input
                    id="delete-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
                  <p className="text-muted-foreground">We&apos;ll email you a code to confirm.</p>
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void sendCode()}>
                    Send code
                  </Button>
                </div>
              )}
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || !ready}>
              {busy ? 'Deleting…' : 'Delete account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
