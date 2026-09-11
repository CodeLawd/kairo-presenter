'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeftIcon,
  DownloadIcon,
  FileTextIcon,
  RefreshCwIcon,
  Share2Icon,
  SquareIcon,
} from 'lucide-react'
import { useVisibleInterval } from '@/hooks/use-refresh'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SermonRecapPreview } from '@/components/pdf/SermonRecapDocument'
import { onSermonsChanged, peekSermon, rememberSermon } from '@/components/sermon/sermon-cache'
import { ShareDialog } from '@/components/sermon/ShareDialog'
import { ApiError } from '@/lib/api'
import {
  shareUrl,
  type SermonDetail,
  type SermonTranscriptPayload,
  type SummaryErrorCode,
} from '@/lib/sermons'

const POLL_MS = 5_000
/** Stop polling after this long — something is wrong, and a spinner won't fix it. */
const POLL_CEILING_MS = 5 * 60_000

/**
 * What to offer for each way generation can fail.
 *
 * Exhaustive over `SummaryErrorCode` on purpose: adding a code to the server
 * now fails this build until someone decides what the page should do about it,
 * rather than silently inheriting a "Try again" that cannot help. The server
 * already knows `refusal` and `format` are not retryable, so the page stops
 * offering a retry it has been told is pointless.
 */
const FAILURE_ACTIONS: Record<SummaryErrorCode, { label: string; href?: string }> = {
  'no-api-key': { label: 'Add an API key', href: '/dashboard/keys' },
  provider: { label: 'Try again' },
  timeout: { label: 'Try again' },
  stalled: { label: 'Try again' },
  // Retrying these reruns the same transcript through the same model.
  refusal: { label: 'Write the recap by hand' },
  format: { label: 'Try again' },
}

/** Quiet document chrome — no nested pills inside a bar. */
const TOOL =
  'inline-flex items-center gap-1.5 text-[13px] text-mute transition-colors hover:text-paper disabled:opacity-40 disabled:hover:text-mute'

function loadErrorMessage(failure: unknown): string {
  if (!(failure instanceof ApiError)) return 'Could not load this recap.'
  return failure.status === 404 ? 'This recap was deleted, or never existed.' : failure.message
}

/**
 * The open recap.
 *
 * Lives in the sermons layout rather than the `[id]` page so switching
 * recaps updates this component instead of remounting it — that is what
 * used to flash a skeleton between two sermons that were already loaded.
 */
export function SermonReader({ sermonId }: { sermonId: string }): React.ReactElement {
  const { session, request, getAccessToken } = useDashboard()
  const orgId = session.orgId

  const [sermon, setSermon] = useState<SermonDetail | null>(() => peekSermon(sermonId) ?? null)
  const [loading, setLoading] = useState(() => !peekSermon(sermonId))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [transcript, setTranscript] = useState<SermonTranscriptPayload | null>(null)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [pollingStalled, setPollingStalled] = useState(false)
  const pollStartedAt = useRef(Date.now())
  const loadSeq = useRef(0)

  const base = orgId ? `/v1/orgs/${orgId}/sermons/${sermonId}` : null

  const applySermon = useCallback((detail: SermonDetail): void => {
    rememberSermon(detail)
    setSermon(detail)
    setError(null)
  }, [])

  const load = useCallback(
    async (seq: number): Promise<void> => {
      if (!base) {
        setLoading(false)
        return
      }
      try {
        const detail = await request<SermonDetail>(base)
        if (seq !== loadSeq.current) return
        applySermon(detail)
      } catch (failure) {
        if (seq !== loadSeq.current) return
        if (!peekSermon(sermonId)) setError(loadErrorMessage(failure))
      } finally {
        if (seq === loadSeq.current) setLoading(false)
      }
    },
    [applySermon, base, request, sermonId],
  )

  useEffect(() => {
    const seq = ++loadSeq.current
    const cached = peekSermon(sermonId)
    if (cached) {
      setSermon(cached)
      setLoading(false)
    }
    setTranscript(null)
    setTranscriptOpen(false)
    setShareOpen(false)
    setCopied(false)
    setDownloading(false)
    setBusy(false)
    setCancelling(false)
    setPollingStalled(false)
    pollStartedAt.current = Date.now()
    void load(seq)
  }, [load, sermonId])

  useEffect(() => {
    return onSermonsChanged((change) => {
      if (change.type === 'upsert' && change.detail.id === sermonId) {
        setSermon(change.detail)
      }
    })
  }, [sermonId])

  // Poll while the recap is being written, and give up after the ceiling —
  // past that something is wrong and another request will not fix it.
  useVisibleInterval(
    () => {
      if (Date.now() - pollStartedAt.current > POLL_CEILING_MS) {
        setPollingStalled(true)
        return
      }
      void load(loadSeq.current)
    },
    POLL_MS,
    sermon?.id === sermonId && sermon.status === 'pending' && !pollingStalled,
  )

  const act = async (run: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await run()
      pollStartedAt.current = Date.now()
      setPollingStalled(false)
      await load(loadSeq.current)
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const regenerate = async (): Promise<void> => {
    const snapshot = shown && shown.id === sermonId ? shown : null
    if (snapshot) applySermon({ ...snapshot, status: 'pending' })
    setBusy(true)
    setError(null)
    try {
      await request(`${base}/summary`, { method: 'POST' })
      pollStartedAt.current = Date.now()
      setPollingStalled(false)
      await load(loadSeq.current)
    } catch (failure) {
      if (snapshot) applySermon(snapshot)
      setError(failure instanceof ApiError ? failure.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const cancelRewrite = async (): Promise<void> => {
    const snapshot = shown && shown.id === sermonId ? shown : null
    if (snapshot?.summary) applySermon({ ...snapshot, status: 'ready' })
    setCancelling(true)
    setError(null)
    try {
      const detail = await request<SermonDetail>(`${base}/summary/cancel`, { method: 'POST' })
      applySermon(detail)
    } catch (failure) {
      if (snapshot) applySermon({ ...snapshot, status: 'pending' })
      setError(failure instanceof ApiError ? failure.message : 'That did not work.')
      await load(loadSeq.current)
    } finally {
      setCancelling(false)
    }
  }

  const setShare = (enabled: boolean, rotate = false): Promise<void> =>
    act(() => request(`${base}/share`, { method: 'PUT', body: { enabled, rotate } }))

  const loadTranscript = async (): Promise<void> => {
    setTranscriptOpen((open) => !open)
    if (transcript || !base) return
    try {
      setTranscript(await request<SermonTranscriptPayload>(`${base}/transcript`))
    } catch {
      setTranscript({ segments: [] })
    }
  }

  /**
   * A download cannot be a plain link: the PDF route needs the access token in
   * an Authorization header, and an `<a href>` cannot send one. So fetch the
   * bytes, hand the browser an object URL, and revoke it once it has been
   * taken.
   */
  const downloadPdf = async (): Promise<void> => {
    if (!orgId) return
    setDownloading(true)
    setError(null)
    let url: string | null = null
    try {
      const response = await fetch(`/api/sermons/${sermonId}/pdf?orgId=${orgId}`, {
        headers: { Authorization: `Bearer ${await getAccessToken()}` },
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null
        throw new ApiError(payload?.message ?? 'Could not build the PDF.', response.status)
      }
      url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download =
        response.headers
          .get('content-disposition')
          ?.match(/filename="([^"]+)"/)?.[1] ?? 'recap.pdf'
      link.click()
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not build the PDF.')
    } finally {
      if (url) URL.revokeObjectURL(url)
      setDownloading(false)
    }
  }

  const copyLink = async (): Promise<void> => {
    if (!sermon?.shareToken) return
    await navigator.clipboard.writeText(shareUrl(sermon.shareToken))
    setCopied(true)
    setTimeout(() => setCopied(false), 2_000)
  }

  const shown = peekSermon(sermonId) ?? sermon
  const switching = Boolean(shown && shown.id !== sermonId)

  if (loading && !shown) {
    return (
      <article className="min-h-80 w-full overflow-hidden rounded-xl bg-white shadow-[0_24px_60px_-32px_rgba(0,0,0,0.9)]">
        <div className="px-8 py-10 md:px-12 md:py-12">
          <div className="h-3 w-40 rounded bg-black/[0.06]" />
          <div className="mt-4 h-8 w-3/4 rounded bg-black/[0.07]" />
          <div className="mt-6 h-3 w-full rounded bg-black/[0.05]" />
          <div className="mt-2 h-3 w-5/6 rounded bg-black/[0.05]" />
        </div>
      </article>
    )
  }
  if (error && !shown) {
    return (
      <Card className="px-5 py-8 text-center">
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button
            render={<Link href="/dashboard/sermons" />}
            nativeButton={false}
            variant="link"
            className="mt-3 lg:hidden"
          >
            Back to recaps
          </Button>
        </CardContent>
      </Card>
    )
  }
  if (!shown) return <div />

  const action = FAILURE_ACTIONS[shown.failureCode ?? 'provider']
  const churchName = session.orgs.find((org) => org.id === session.orgId)?.name ?? ''
  const rewriting = Boolean(shown.summary && shown.status === 'pending' && shown.id === sermonId)

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div className="sticky top-0 z-10 shrink-0 bg-ink pb-3 lg:static">
        <Link
          href="/dashboard/sermons"
          className="mb-3 inline-flex w-fit items-center gap-1.5 text-[12.5px] text-mute transition-colors hover:text-paper lg:hidden"
        >
          <ArrowLeftIcon className="size-3.5" />
          All recaps
        </Link>

        {error ? <p className="mb-3 text-[13px] text-[#fb7185]">{error}</p> : null}

        {shown.summary ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {rewriting ? (
              <button
                type="button"
                disabled={switching || cancelling}
                onClick={() => void cancelRewrite()}
                className={TOOL}
              >
                <SquareIcon className="size-3.5" />
                {cancelling ? 'Stopping…' : 'Stop'}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || switching}
                onClick={() => void regenerate()}
                className={TOOL}
              >
                <RefreshCwIcon className="size-3.5" />
                Rewrite
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadTranscript()}
              aria-pressed={transcriptOpen}
              className={`${TOOL} ${transcriptOpen ? 'text-paper' : ''}`}
            >
              <FileTextIcon className="size-3.5" />
              {transcriptOpen ? 'Hide transcript' : 'Transcript'}
            </button>
            <button
              type="button"
              disabled={downloading}
              onClick={() => void downloadPdf()}
              className={TOOL}
            >
              <DownloadIcon className="size-3.5" />
              {downloading ? 'Building…' : 'PDF'}
            </button>
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className={`${TOOL} ${shown.shareEnabled ? 'text-paper' : ''}`}
            >
              <Share2Icon className={`size-3.5 ${shown.shareEnabled ? 'text-accent' : ''}`} />
              Share
            </button>
          </div>
        ) : null}

        <ShareDialog
          sermon={shown}
          open={shareOpen}
          copied={copied}
          busy={busy}
          onOpenChange={setShareOpen}
          onCopy={() => void copyLink()}
          onPublish={() => void setShare(true)}
          onStop={() => void setShare(false)}
          onReplace={() => void setShare(true, true)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {shown.status === 'pending' && !shown.summary ? (
          <Card className="py-10 text-center">
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Writing the recap. This usually takes under a minute.
              </p>
            </CardContent>
          </Card>
        ) : shown.status === 'failed' && !shown.summary ? (
          <Card className="py-10 text-center">
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {shown.failureReason ?? 'The recap could not be written.'}
              </p>
              {action.href ? (
                <Button
                  render={<Link href={action.href} />}
                  nativeButton={false}
                  className="mt-3"
                >
                  {action.label}
                </Button>
              ) : action.label === 'Try again' ? (
                <Button type="button" className="mt-3" disabled={busy} onClick={() => void regenerate()}>
                  {busy ? 'Starting…' : action.label}
                </Button>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">{action.label}.</p>
              )}
            </CardContent>
          </Card>
        ) : shown.summary ? (
          <SermonRecapPreview
            title={shown.title}
            speaker={shown.speaker}
            preachedAt={shown.preachedAt}
            churchName={churchName}
            summary={shown.summary}
            generating={rewriting}
          />
        ) : null}

        {transcriptOpen ? (
          <Card className="mt-3">
            <CardHeader className="border-b">
              <CardTitle>Transcript</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[420px] overflow-y-auto">
              {!transcript ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : transcript.segments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No transcript was stored for this service.</p>
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {transcript.segments.map((segment) => segment.text).join(' ')}
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  )
}
