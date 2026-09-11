'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { SermonListItem } from '@/lib/sermons'

export function EditRecapDialog({
  sermon,
  open,
  busy,
  error,
  onOpenChange,
  onSave,
}: {
  sermon: Pick<SermonListItem, 'title' | 'speaker' | 'headline' | 'status'>
  open: boolean
  busy: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onSave: (input: { headline: string; speaker: string; title: string }) => void
}): React.ReactElement {
  const [headline, setHeadline] = useState('')
  const [speaker, setSpeaker] = useState('')
  const [title, setTitle] = useState('')
  const hasRecap = sermon.status === 'ready' || Boolean(sermon.headline)

  useEffect(() => {
    if (!open) return
    setHeadline(sermon.headline ?? '')
    setSpeaker(sermon.speaker)
    setTitle(sermon.title)
  }, [open, sermon])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 gap-6 overflow-hidden p-6 sm:max-w-md">
        <DialogHeader className="min-w-0 gap-3 pr-6">
          <DialogTitle>Rename recap</DialogTitle>
          <DialogDescription>
            {hasRecap
              ? 'The recap title is what readers see first. Preacher and service name sit in the byline.'
              : 'Preacher and service name sit in the byline.'}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            onSave({ headline, speaker, title })
          }}
        >
          {hasRecap ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="recap-headline">Recap title</Label>
              <Input
                id="recap-headline"
                value={headline}
                onChange={(event) => setHeadline(event.target.value)}
                maxLength={200}
                required
              />
            </div>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="recap-speaker">Preacher</Label>
            <Input
              id="recap-speaker"
              value={speaker}
              onChange={(event) => setSpeaker(event.target.value)}
              maxLength={200}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="recap-title">Service name</Label>
            <Input
              id="recap-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={300}
              required
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" className="mt-1 w-fit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
