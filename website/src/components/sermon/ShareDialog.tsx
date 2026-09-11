'use client'

import { CheckIcon, CopyIcon, Link2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { shareUrl, type SermonDetail } from '@/lib/sermons'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function ShareDialog({
  sermon,
  open,
  copied,
  busy,
  onOpenChange,
  onCopy,
  onPublish,
  onStop,
  onReplace,
}: {
  sermon: SermonDetail
  open: boolean
  copied: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onCopy: () => void
  onPublish: () => void
  onStop: () => void
  onReplace: () => void
}): React.ReactElement {
  const live = Boolean(sermon.shareEnabled && sermon.shareToken)
  const title = sermon.summary?.headline || sermon.title
  const byline = [sermon.speaker, formatDate(sermon.preachedAt)].filter(Boolean).join(' · ')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 gap-6 overflow-hidden p-6 sm:max-w-md">
        <DialogHeader className="min-w-0 gap-3 pr-6">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
            {live ? 'Live link' : 'Not shared'}
          </p>
          <DialogTitle className="font-display text-[22px] leading-snug font-semibold tracking-[-0.03em]">
            {title}
          </DialogTitle>
          {byline ? (
            <p className="text-[13px] text-mute">{byline}</p>
          ) : null}
          <DialogDescription className="text-[13px] leading-relaxed">
            {live
              ? 'Anyone with this address can read the recap. The transcript stays private.'
              : 'Create a private address for this recap. Anyone with the link can read it — the transcript is never included.'}
          </DialogDescription>
        </DialogHeader>

        {live ? (
          <div className="flex min-w-0 flex-col gap-5">
            <button
              type="button"
              onClick={onCopy}
              className="group flex min-w-0 w-full items-center gap-3 overflow-hidden rounded-lg bg-ink px-3.5 py-3 text-left ring-1 ring-white/[0.08] transition-colors hover:ring-white/[0.14]"
            >
              <Link2Icon className="size-3.5 shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-paper">
                {shareUrl(sermon.shareToken!)}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-mute group-hover:text-paper">
                {copied ? <CheckIcon className="size-3.5 text-accent" /> : <CopyIcon className="size-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </span>
            </button>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
              <button
                type="button"
                disabled={busy}
                onClick={onReplace}
                className="text-mute transition-colors hover:text-paper disabled:opacity-40"
                title="Creates a new link and breaks the old one"
              >
                Replace link
              </button>
              <span aria-hidden className="text-faint">
                /
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={onStop}
                className="text-mute transition-colors hover:text-paper disabled:opacity-40"
              >
                Stop sharing
              </button>
            </div>
          </div>
        ) : (
          <Button type="button" className="w-fit" disabled={busy} onClick={onPublish}>
            {busy ? 'Creating…' : 'Create a private link'}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
