'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
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
import {
  CalendarClockIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  MessageCircleQuestionIcon,
  MonitorPlayIcon,
  PlusIcon,
  QrCodeIcon,
  SparklesIcon,
} from 'lucide-react'
import { ApiError } from '@/lib/api'
import { engageApiBase } from '@/app/engage/client-api'

/** Mirrors `EngagementIndex` in src/lib/engage.ts — the org's list, nothing private. */
type EngagementRow = {
  id: string
  code: string
  name: string
  status: 'draft' | 'open' | 'closed'
  startsAt: number | null
  endsAt: number | null
}

const STATUS: Record<EngagementRow['status'], { label: string; dot: string; badge: string }> = {
  open: { label: 'Live now', dot: 'bg-emerald-500 animate-pulse', badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  draft: { label: 'Scheduled', dot: 'bg-amber-400', badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
  closed: { label: 'Ended', dot: 'bg-muted-foreground/40', badge: 'bg-muted/50 text-muted-foreground border-border' },
}

function formatDateRange(row: EngagementRow): string {
  const day = (time: number): string =>
    new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  if (row.startsAt && row.endsAt) {
    if (day(row.startsAt) === day(row.endsAt)) return day(row.startsAt)
    return `${day(row.startsAt)} – ${day(row.endsAt)}`
  }
  if (row.startsAt) return `From ${day(row.startsAt)}`
  if (row.endsAt) return `Until ${day(row.endsAt)}`
  return 'Anytime'
}

export default function EngagePage(): React.ReactElement {
  const { session, request, getAccessToken } = useDashboard()
  const orgId = session.orgId
  const canView = session.role === 'owner' || session.role === 'admin'
  const [rows, setRows] = useState<EngagementRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [togglingLive, setTogglingLive] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId || !canView) return
    try {
      setRows(await request<EngagementRow[]>(`/v1/orgs/${orgId}/engagements`))
      setError(null)
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not load engagements.')
    }
  }, [orgId, canView, request])

  useEffect(() => {
    void load()
  }, [load])

  const toggleLive = async (code: string, makeLive: boolean): Promise<void> => {
    setTogglingLive(code)
    try {
      const response = await fetch(`${engageApiBase()}/v1/engage/${encodeURIComponent(code)}/live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getAccessToken()}` },
        body: JSON.stringify({ live: makeLive }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        const text = await response.text()
        let msg = text
        try {
          msg = (JSON.parse(text) as { message?: string }).message ?? text
        } catch {
          /* plain text */
        }
        throw new Error(msg.slice(0, 300) || 'Could not update status.')
      }
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not update live status.')
    } finally {
      setTogglingLive(null)
    }
  }

  const copyLink = (code: string): void => {
    const url = `${window.location.origin}/q/${code}`
    void navigator.clipboard.writeText(url)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 pb-12">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-[28px] leading-[1.1] font-medium tracking-[-.045em] text-foreground">
              Engage
            </h1>
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              Audience Q&amp;A &amp; Polls
            </span>
          </div>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Live interaction from the room. Congregation members scan a QR code to ask questions, upvote, and respond to polls — no app download or sign-in needed.
          </p>
        </div>
        {canView && (
          <Button onClick={() => setCreating(true)} className="shrink-0 gap-2">
            <PlusIcon className="size-4" />
            New engagement
          </Button>
        )}
      </div>

      {/* Main Content */}
      {!canView ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Only church owners and admins can view and create engagements.
          </CardContent>
        </Card>
      ) : error && !rows ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-10 text-center">
            <p className="text-sm font-medium text-destructive">{error}</p>
            <Button className="mt-4" variant="outline" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : !rows ? (
        <div className="grid gap-3">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col gap-8">
          {/* Empty State Hero */}
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/40 p-8 text-center sm:p-12">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <MessageCircleQuestionIcon className="size-7" />
            </div>
            <h2 className="mt-4 font-display text-xl font-medium tracking-tight text-foreground">
              No engagements yet
            </h2>
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
              Plan your first Q&amp;A or poll session for Sunday. Engagements you create here appear automatically in the Kairo presenter app.
            </p>
            <Button onClick={() => setCreating(true)} className="mt-6 gap-2">
              <PlusIcon className="size-4" />
              Create your first engagement
            </Button>
          </div>

          {/* How it works guidance */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-border/60 bg-card p-5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <CalendarClockIcon className="size-4.5" />
              </div>
              <h3 className="mt-3 text-[15px] font-semibold text-foreground">1. Schedule ahead</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Create an engagement for Sunday service or youth night. The join code is reserved and stays the same.
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-card p-5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <MonitorPlayIcon className="size-4.5" />
              </div>
              <h3 className="mt-3 text-[15px] font-semibold text-foreground">2. Open in Kairo</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Open Kairo on the presenter machine and click Engage. Beam the QR code straight to your main screens.
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-card p-5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <QrCodeIcon className="size-4.5" />
              </div>
              <h3 className="mt-3 text-[15px] font-semibold text-foreground">3. Audience joins</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                People scan with their phone camera to ask, vote, and answer polls. Moderators approve questions before they go live.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Your Engagements ({rows.length})</span>
            <span className="text-[11px] font-normal lowercase">Managed via Kairo app</span>
          </div>

          <div className="grid gap-3">
            {rows.map((row) => {
              const statusCfg = STATUS[row.status]
              const isCopied = copiedCode === row.code
              const isLive = row.status === 'open'
              const isBusy = togglingLive === row.code
              return (
                <div
                  key={row.id}
                  className="group flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-xs transition-all hover:border-primary/40 hover:shadow-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <Link
                    href={`/dashboard/engage/${row.code}`}
                    className="min-w-0 flex-1 no-underline"
                  >
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 className="truncate text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                        {row.name}
                      </h2>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusCfg.badge}`}>
                        <span className={`size-1.5 rounded-full ${statusCfg.dot}`} aria-hidden="true" />
                        {statusCfg.label}
                      </span>
                    </div>
                    <p className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatDateRange(row)}</span>
                      <span>·</span>
                      <span className="font-mono text-foreground/80">Code: {row.code}</span>
                      <span>·</span>
                      <span className="text-primary hover:underline">Click to view Q&amp;A and Polls →</span>
                    </p>
                  </Link>

                  <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                    {/* Make Live / End Live Toggle Button */}
                    <Button
                      variant={isLive ? 'secondary' : 'default'}
                      size="sm"
                      disabled={isBusy}
                      onClick={() => void toggleLive(row.code, !isLive)}
                      className={`gap-1.5 text-xs font-medium ${isLive ? 'hover:bg-destructive/10 hover:text-destructive' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}
                      title={isLive ? 'End live session' : 'Make this engagement live now'}
                    >
                      <span className={`size-1.5 rounded-full ${isLive ? 'bg-emerald-500' : 'bg-white'}`} />
                      {isBusy ? 'Updating…' : isLive ? 'End Live' : 'Go Live'}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      render={<Link href={`/dashboard/engage/${row.code}`} />}
                      className="gap-1.5 text-xs"
                      title="Open presenter view"
                    >
                      <MonitorPlayIcon className="size-3.5" />
                      Open View
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyLink(row.code)}
                      className="gap-1.5 text-xs"
                      title="Copy audience page link"
                    >
                      {isCopied ? <CheckIcon className="size-3.5 text-emerald-500" /> : <CopyIcon className="size-3.5" />}
                      {isCopied ? 'Copied' : 'Link'}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-4 rounded-xl border border-border/50 bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="flex items-center gap-1.5 font-medium text-foreground">
              <SparklesIcon className="size-3.5 text-primary" /> Presenting tips
            </p>
            <p className="mt-1">
              To start taking questions on your room screens, launch the Kairo desktop app on your sanctuary Mac or PC, navigate to the <strong>Engage</strong> workspace, and click open on this engagement.
            </p>
          </div>
        </div>
      )}

      {/* New Engagement Modal */}
      <NewEngagementDialog
        open={creating}
        onOpenChange={setCreating}
        getAccessToken={getAccessToken}
        onCreated={() => void load()}
      />
    </div>
  )
}

function dayToTime(value: string, endOfDay: boolean): number | null {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59).getTime() : new Date(y, m - 1, d).getTime()
}

function NewEngagementDialog({
  open,
  onOpenChange,
  getAccessToken,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  getAccessToken: () => Promise<string>
  onCreated: () => void
}): React.ReactElement {
  const [title, setTitle] = useState('')
  const [starts, setStarts] = useState('')
  const [ends, setEnds] = useState('')
  const [review, setReview] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setTitle('')
    setStarts('')
    setEnds('')
    setReview(true)
    setError('')
  }, [open])

  const startsAt = dayToTime(starts, false)
  const endsAt = dayToTime(ends, true)
  const datesInvalid = startsAt !== null && endsAt !== null && endsAt < startsAt

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (pending || datesInvalid || !title.trim()) return
    setPending(true)
    setError('')
    try {
      const response = await fetch(`${engageApiBase()}/v1/engage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getAccessToken()}` },
        body: JSON.stringify({ title: title.trim(), startsAt, endsAt, status: 'draft', settings: { review } }),
        signal: AbortSignal.timeout(90_000),
      })
      if (!response.ok) {
        const text = await response.text()
        let message = text
        try {
          message = (JSON.parse(text) as { message?: string }).message ?? text
        } catch {
          /* plain text */
        }
        throw new Error(message.slice(0, 300) || 'Could not create the engagement.')
      }
      onCreated()
      onOpenChange(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not create the engagement.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>New engagement</DialogTitle>
            <DialogDescription>
              Set up a session ahead of time. It will appear in the Kairo presenter app ready to project on screen with the same join code.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="engagement-title">Title</Label>
            <Input
              id="engagement-title"
              autoFocus
              required
              maxLength={100}
              placeholder="e.g. Sunday Morning Q&A"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="engagement-start">Start date (optional)</Label>
              <Input id="engagement-start" type="date" value={starts} onChange={(e) => setStarts(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="engagement-end">End date (optional)</Label>
              <Input id="engagement-end" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />
            </div>
          </div>
          {datesInvalid ? <p className="text-xs font-medium text-destructive">The end date must be after the start date.</p> : null}
          <div className="rounded-xl border border-border bg-muted/30 p-3.5">
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 rounded border-border"
                checked={review}
                onChange={(e) => setReview(e.target.checked)}
              />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-foreground">Review questions before they appear</span>
                <span className="block text-xs leading-normal text-muted-foreground">
                  Questions wait in your queue for approval before anyone in the room or on screens can see them.
                </span>
              </span>
            </label>
          </div>
          {error ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || datesInvalid || !title.trim()}>
              {pending ? 'Creating…' : 'Create engagement'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
