'use client'

import { useEffect, useState } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import type { SermonDetail, SermonSummary } from '@/lib/sermons'

export type NotesEdit = {
  title: string
  speaker: string
  notes: SermonSummary
}

/** One item per line, blank lines dropped. */
const toLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

/**
 * An admin rewrites a recap by hand: the names in its byline and every part
 * of the notes. Lists of short lines (quotes, takeaways) are one per line;
 * points and scriptures are pairs, added and removed row by row.
 */
export function EditNotesDialog({
  sermon,
  open,
  busy,
  error,
  onOpenChange,
  onSave,
}: {
  sermon: Pick<SermonDetail, 'title' | 'speaker' | 'summary'>
  open: boolean
  busy: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onSave: (edit: NotesEdit) => void
}): React.ReactElement {
  const [title, setTitle] = useState('')
  const [speaker, setSpeaker] = useState('')
  const [headline, setHeadline] = useState('')
  const [bigIdea, setBigIdea] = useState('')
  const [points, setPoints] = useState<SermonSummary['keyPoints']>([])
  const [quotes, setQuotes] = useState('')
  const [takeaways, setTakeaways] = useState('')
  const [scriptures, setScriptures] = useState<SermonSummary['keyScriptures']>([])
  const [callToAction, setCallToAction] = useState('')

  useEffect(() => {
    if (!open || !sermon.summary) return
    const s = sermon.summary
    setTitle(sermon.title)
    setSpeaker(sermon.speaker)
    setHeadline(s.headline)
    setBigIdea(s.bigIdea)
    setPoints(s.keyPoints.map((p) => ({ ...p })))
    setQuotes(s.memorableQuotes.join('\n'))
    setTakeaways(s.takeaways.join('\n'))
    setScriptures(s.keyScriptures.map((k) => ({ ...k })))
    setCallToAction(s.callToAction ?? '')
  }, [open, sermon])

  const setPoint = (index: number, field: 'title' | 'explanation', value: string): void =>
    setPoints((all) => all.map((p, i) => (i === index ? { ...p, [field]: value } : p)))
  const setScripture = (index: number, field: 'reference' | 'connection', value: string): void =>
    setScriptures((all) => all.map((k, i) => (i === index ? { ...k, [field]: value } : k)))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] min-w-0 flex-col gap-5 overflow-hidden p-6 sm:max-w-2xl">
        <DialogHeader className="min-w-0 gap-2 pr-6">
          <DialogTitle>Edit recap</DialogTitle>
          <DialogDescription>
            Changes replace what was written. Shared links show them straight away.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 min-w-0 flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            onSave({
              title,
              speaker,
              notes: {
                headline,
                bigIdea,
                keyPoints: points,
                memorableQuotes: toLines(quotes),
                takeaways: toLines(takeaways),
                keyScriptures: scriptures,
                callToAction,
              },
            })
          }}
        >
          <div className="flex min-h-0 flex-col gap-5 overflow-y-auto pr-1">
            <Field id="notes-headline" label="Sermon title">
              <Input
                id="notes-headline"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                maxLength={200}
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="notes-speaker" label="Preacher">
                <Input
                  id="notes-speaker"
                  value={speaker}
                  onChange={(e) => setSpeaker(e.target.value)}
                  maxLength={200}
                />
              </Field>
              <Field id="notes-service" label="Service name">
                <Input
                  id="notes-service"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={300}
                  required
                />
              </Field>
            </div>
            <Field id="notes-big-idea" label="Big idea">
              <Textarea
                id="notes-big-idea"
                value={bigIdea}
                onChange={(e) => setBigIdea(e.target.value)}
                maxLength={2000}
                rows={3}
                required
              />
            </Field>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Key points</legend>
              {points.map((point, index) => (
                <div key={index} className="flex gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Input
                      aria-label={`Point ${index + 1} title`}
                      value={point.title}
                      onChange={(e) => setPoint(index, 'title', e.target.value)}
                      maxLength={200}
                      placeholder="Point"
                    />
                    <Textarea
                      aria-label={`Point ${index + 1} explanation`}
                      value={point.explanation}
                      onChange={(e) => setPoint(index, 'explanation', e.target.value)}
                      maxLength={2000}
                      rows={2}
                      placeholder="What was said about it"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove point ${index + 1}`}
                    onClick={() => setPoints((all) => all.filter((_, i) => i !== index))}
                  >
                    <XIcon className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={points.length >= 20}
                onClick={() => setPoints((all) => [...all, { title: '', explanation: '' }])}
              >
                <PlusIcon className="size-3.5" />
                Add point
              </Button>
            </fieldset>

            <Field id="notes-quotes" label="Memorable quotes" hint="One per line">
              <Textarea
                id="notes-quotes"
                value={quotes}
                onChange={(e) => setQuotes(e.target.value)}
                rows={3}
              />
            </Field>
            <Field id="notes-takeaways" label="Takeaways" hint="One per line">
              <Textarea
                id="notes-takeaways"
                value={takeaways}
                onChange={(e) => setTakeaways(e.target.value)}
                rows={3}
              />
            </Field>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Key scriptures</legend>
              {scriptures.map((item, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    aria-label={`Scripture ${index + 1} reference`}
                    className="w-40 shrink-0"
                    value={item.reference}
                    onChange={(e) => setScripture(index, 'reference', e.target.value)}
                    maxLength={100}
                    placeholder="John 3:16"
                  />
                  <Input
                    aria-label={`Scripture ${index + 1} connection`}
                    className="min-w-0 flex-1"
                    value={item.connection}
                    onChange={(e) => setScripture(index, 'connection', e.target.value)}
                    maxLength={1000}
                    placeholder="How it was used"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove scripture ${index + 1}`}
                    onClick={() => setScriptures((all) => all.filter((_, i) => i !== index))}
                  >
                    <XIcon className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={scriptures.length >= 30}
                onClick={() => setScriptures((all) => [...all, { reference: '', connection: '' }])}
              >
                <PlusIcon className="size-3.5" />
                Add scripture
              </Button>
            </fieldset>

            <Field id="notes-cta" label="Call to action">
              <Textarea
                id="notes-cta"
                value={callToAction}
                onChange={(e) => setCallToAction(e.target.value)}
                maxLength={2000}
                rows={2}
              />
            </Field>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save recap'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </div>
  )
}
