'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { Divider } from '@/components/pdf/divider/divider'
import { Heading } from '@/components/pdf/heading/heading'
import { Section } from '@/components/pdf/section/section'
import { Text } from '@/components/pdf/text/text'
import { PdfcnThemeProvider } from '@/components/pdf/theme-provider'
import { recapTheme } from '@/components/pdf/theme-recap'
import { Document, Page, View, pointToCssPixel } from '@/lib/pdf-primitives'
import type { SermonDetail, SermonSummary } from '@/lib/sermons'

export type NotesEdit = {
  title: string
  speaker: string
  notes: SermonSummary
}

const pt = (value: number): number => pointToCssPixel(value)

const SANS = recapTheme.typography.body.fontFamily
const FG = recapTheme.colors.foreground
const MUTED = recapTheme.colors.mutedForeground
const PRIMARY = recapTheme.colors.primary

const FIELD_CLASS =
  'w-full rounded px-1.5 py-0.5 -mx-1.5 bg-transparent transition-colors hover:bg-black/[0.03] focus:bg-black/[0.03] focus:outline-none focus:ring-1 focus:ring-black/20 placeholder:text-[#747267]/50'

const INLINE_FIELD_CLASS =
  'min-w-0 rounded px-1.5 py-0.5 bg-transparent transition-colors hover:bg-black/[0.03] focus:bg-black/[0.03] focus:outline-none focus:ring-1 focus:ring-black/20 placeholder:text-[#747267]/50'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function AutoTextarea({
  value,
  onChange,
  style,
  className = '',
  ...props
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & {
  value: string
  onChange: (value: string) => void
}): React.ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={style}
      className={`${FIELD_CLASS} block resize-none overflow-hidden ${className}`}
      {...props}
    />
  )
}

function RemoveRowButton({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="mt-0.5 shrink-0 rounded p-1 text-[#747267]/60 transition-colors hover:bg-black/[0.06] hover:text-[#181913] focus:outline-none focus:ring-1 focus:ring-black/20"
    >
      <XIcon className="size-3.5" />
    </button>
  )
}

function AddRowButton({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="mt-1 inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-[12px] font-medium text-[#747267] transition-colors hover:bg-black/[0.04] hover:text-[#181913] disabled:opacity-40"
    >
      <PlusIcon className="size-3" />
      {label}
    </button>
  )
}

/**
 * Inline editor rendered directly on the white pdfcn document page.
 *
 * Uses the same pdfcn primitives and `recapTheme` as `SermonRecapDocument` so
 * admins edit the document in place rather than through a separate modal form.
 */
export function SermonRecapEditor({
  formId,
  sermon,
  churchName,
  onSave,
}: {
  formId: string
  sermon: Pick<SermonDetail, 'title' | 'speaker' | 'preachedAt' | 'summary'>
  churchName: string
  onSave: (edit: NotesEdit) => void
}): React.ReactElement {
  const s = sermon.summary
  const [title, setTitle] = useState(sermon.title)
  const [speaker, setSpeaker] = useState(sermon.speaker)
  const [headline, setHeadline] = useState(s?.headline ?? '')
  const [bigIdea, setBigIdea] = useState(s?.bigIdea ?? '')
  const [points, setPoints] = useState<SermonSummary['keyPoints']>(() =>
    (s?.keyPoints ?? []).map((p) => ({ ...p })),
  )
  const [quotes, setQuotes] = useState<string[]>(() => [...(s?.memorableQuotes ?? [])])
  const [takeaways, setTakeaways] = useState<string[]>(() => [...(s?.takeaways ?? [])])
  const [scriptures, setScriptures] = useState<SermonSummary['keyScriptures']>(() =>
    (s?.keyScriptures ?? []).map((k) => ({ ...k })),
  )
  const [callToAction, setCallToAction] = useState(s?.callToAction ?? '')
  const formRef = useRef<HTMLFormElement>(null)

  // Cmd/Ctrl+S saves directly from anywhere inside the document.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        formRef.current?.requestSubmit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const setPoint = (index: number, field: 'title' | 'explanation', value: string): void =>
    setPoints((all) => all.map((p, i) => (i === index ? { ...p, [field]: value } : p)))
  const setScripture = (index: number, field: 'reference' | 'connection', value: string): void =>
    setScriptures((all) => all.map((k, i) => (i === index ? { ...k, [field]: value } : k)))

  const bodyStyle: React.CSSProperties = {
    fontFamily: SANS,
    fontSize: pt(recapTheme.typography.body.fontSize),
    lineHeight: recapTheme.typography.body.lineHeight,
    color: FG,
  }

  const h1Style: React.CSSProperties = {
    fontFamily: SANS,
    fontSize: pt(recapTheme.typography.heading.fontSize.h1),
    fontWeight: recapTheme.primitives.fontWeights.bold,
    lineHeight: recapTheme.typography.heading.lineHeight,
    color: FG,
    marginBottom: pt(recapTheme.spacing.paragraphGap),
  }

  const h3Style: React.CSSProperties = {
    fontFamily: SANS,
    fontSize: pt(recapTheme.typography.heading.fontSize.h3),
    fontWeight: recapTheme.primitives.fontWeights.bold,
    lineHeight: recapTheme.typography.heading.lineHeight,
    color: FG,
  }

  const bylineStyle: React.CSSProperties = {
    fontFamily: SANS,
    fontSize: pt(recapTheme.primitives.typography.sm),
    lineHeight: recapTheme.typography.body.lineHeight,
    color: MUTED,
  }

  const scriptureRefStyle: React.CSSProperties = {
    ...bodyStyle,
    fontWeight: recapTheme.primitives.fontWeights.semibold,
  }

  const scriptureDescStyle: React.CSSProperties = {
    fontFamily: SANS,
    fontSize: pt(recapTheme.primitives.typography.sm),
    lineHeight: recapTheme.typography.body.lineHeight,
    color: MUTED,
  }

  return (
    <article className="relative w-full overflow-hidden rounded-xl bg-white ring-1 ring-accent/40 shadow-[0_24px_60px_-32px_rgba(17,18,13,0.9)]">
      <form
        ref={formRef}
        id={formId}
        className="px-8 py-10 md:px-12 md:py-12"
        onSubmit={(event) => {
          event.preventDefault()
          onSave({
            title,
            speaker,
            notes: {
              headline,
              bigIdea,
              keyPoints: points,
              memorableQuotes: quotes.map((q) => q.trim()).filter(Boolean),
              takeaways: takeaways.map((t) => t.trim()).filter(Boolean),
              keyScriptures: scriptures,
              callToAction,
            },
          })
        }}
      >
        <PdfcnThemeProvider theme={recapTheme}>
          <Document title={headline || title}>
            <Page size="a4">
              <Section spacing="none">
                {churchName ? (
                  <Text variant="xs" transform="uppercase" color="mutedForeground">
                    {churchName}
                  </Text>
                ) : null}

                <AutoTextarea
                  aria-label="Sermon title"
                  value={headline}
                  onChange={setHeadline}
                  maxLength={200}
                  required
                  placeholder="Sermon title"
                  style={h1Style}
                />

                <div
                  className="flex flex-wrap items-center gap-x-1 gap-y-1 -mx-1.5"
                  style={bylineStyle}
                >
                  <input
                    type="text"
                    aria-label="Service name"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={300}
                    required
                    placeholder="Service name"
                    size={Math.max(title.length, 12)}
                    className={`${INLINE_FIELD_CLASS} max-w-full`}
                  />
                  <span aria-hidden>·</span>
                  <input
                    type="text"
                    aria-label="Preacher"
                    value={speaker}
                    onChange={(e) => setSpeaker(e.target.value)}
                    maxLength={200}
                    placeholder="Preacher"
                    size={Math.max(speaker.length, 10)}
                    className={`${INLINE_FIELD_CLASS} max-w-full`}
                  />
                  <span aria-hidden>·</span>
                  <span className="px-1">{formatDate(sermon.preachedAt)}</span>
                </div>
              </Section>

              <Divider spacing="sm" />

              <Section spacing="none">
                <Heading level={2}>The big idea</Heading>
                <AutoTextarea
                  aria-label="The big idea"
                  value={bigIdea}
                  onChange={setBigIdea}
                  maxLength={2000}
                  required
                  placeholder="Summary of the main message…"
                  style={bodyStyle}
                />
              </Section>

              <Section spacing="none">
                <Heading level={2}>Key points</Heading>
                {points.map((point, index) => (
                  <View key={index} style={{ marginBottom: 10 }}>
                    <div
                      className="flex items-start gap-1"
                      style={{
                        marginTop: pt(recapTheme.spacing.componentGap),
                        marginBottom: pt(recapTheme.spacing.paragraphGap),
                      }}
                    >
                      <span style={h3Style} className="shrink-0 py-0.5 select-none">
                        {`${index + 1}.`}
                      </span>
                      <input
                        type="text"
                        aria-label={`Point ${index + 1} title`}
                        value={point.title}
                        onChange={(e) => setPoint(index, 'title', e.target.value)}
                        maxLength={200}
                        placeholder="Point title"
                        style={h3Style}
                        className={`${INLINE_FIELD_CLASS} flex-1`}
                      />
                      <RemoveRowButton
                        label={`Remove point ${index + 1}`}
                        onClick={() => setPoints((all) => all.filter((_, i) => i !== index))}
                      />
                    </div>
                    <AutoTextarea
                      aria-label={`Point ${index + 1} explanation`}
                      value={point.explanation}
                      onChange={(value) => setPoint(index, 'explanation', value)}
                      maxLength={2000}
                      placeholder="What was said about it…"
                      style={bodyStyle}
                    />
                  </View>
                ))}
                <AddRowButton
                  label="Add point"
                  disabled={points.length >= 20}
                  onClick={() => setPoints((all) => [...all, { title: '', explanation: '' }])}
                />
              </Section>

              <Section spacing="none">
                <Heading level={2}>In their words</Heading>
                <div className="flex flex-col gap-2">
                  {quotes.map((quote, index) => (
                    <Section
                      key={index}
                      variant="callout"
                      accentColor="primary"
                      spacing="none"
                    >
                      <div className="flex items-start gap-2">
                        <AutoTextarea
                          aria-label={`Quote ${index + 1}`}
                          value={quote}
                          onChange={(value) =>
                            setQuotes((all) => all.map((q, i) => (i === index ? value : q)))
                          }
                          maxLength={700}
                          placeholder="Memorable quote from the sermon…"
                          style={{ ...bodyStyle, fontStyle: 'italic' }}
                          className="flex-1"
                        />
                        <RemoveRowButton
                          label={`Remove quote ${index + 1}`}
                          onClick={() => setQuotes((all) => all.filter((_, i) => i !== index))}
                        />
                      </div>
                    </Section>
                  ))}
                </div>
                <AddRowButton
                  label="Add quote"
                  onClick={() => setQuotes((all) => [...all, ''])}
                />
              </Section>

              <Section spacing="none">
                <Heading level={2}>This week</Heading>
                <div className="flex flex-col gap-2">
                  {takeaways.map((takeaway, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <span
                        aria-hidden
                        className="mt-2.5 shrink-0 rounded-full"
                        style={{
                          width: pt(5),
                          height: pt(5),
                          backgroundColor: PRIMARY,
                        }}
                      />
                      <AutoTextarea
                        aria-label={`Takeaway ${index + 1}`}
                        value={takeaway}
                        onChange={(value) =>
                          setTakeaways((all) => all.map((t, i) => (i === index ? value : t)))
                        }
                        maxLength={500}
                        placeholder="Practical takeaway for the week…"
                        style={bodyStyle}
                        className="flex-1"
                      />
                      <RemoveRowButton
                        label={`Remove takeaway ${index + 1}`}
                        onClick={() => setTakeaways((all) => all.filter((_, i) => i !== index))}
                      />
                    </div>
                  ))}
                </div>
                <AddRowButton
                  label="Add takeaway"
                  onClick={() => setTakeaways((all) => [...all, ''])}
                />
              </Section>

              <Section spacing="none">
                <Heading level={2}>Key scriptures</Heading>
                <div className="flex flex-col gap-2.5">
                  {scriptures.map((item, index) => (
                    <div key={index} className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className="mt-1 self-stretch shrink-0 rounded-xs"
                        style={{
                          width: pt(3),
                          minHeight: pt(16),
                          backgroundColor: PRIMARY,
                        }}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <input
                          type="text"
                          aria-label={`Scripture ${index + 1} reference`}
                          value={item.reference}
                          onChange={(e) => setScripture(index, 'reference', e.target.value)}
                          maxLength={100}
                          placeholder="John 3:16"
                          style={scriptureRefStyle}
                          className={FIELD_CLASS}
                        />
                        <AutoTextarea
                          aria-label={`Scripture ${index + 1} connection`}
                          value={item.connection}
                          onChange={(value) => setScripture(index, 'connection', value)}
                          maxLength={1000}
                          placeholder="How it was used…"
                          style={scriptureDescStyle}
                        />
                      </div>
                      <RemoveRowButton
                        label={`Remove scripture ${index + 1}`}
                        onClick={() => setScriptures((all) => all.filter((_, i) => i !== index))}
                      />
                    </div>
                  ))}
                </div>
                <AddRowButton
                  label="Add scripture"
                  disabled={scriptures.length >= 30}
                  onClick={() =>
                    setScriptures((all) => [...all, { reference: '', connection: '' }])
                  }
                />
              </Section>

              <Section
                variant="callout"
                accentColor="primary"
                spacing="none"
                style={{ marginTop: recapTheme.spacing.sectionGap }}
              >
                <Heading level={2} style={{ marginTop: 0 }}>
                  Call to action
                </Heading>
                <AutoTextarea
                  aria-label="Call to action"
                  value={callToAction}
                  onChange={setCallToAction}
                  maxLength={2000}
                  placeholder="Optional closing challenge or invitation…"
                  style={bodyStyle}
                />
              </Section>
            </Page>
          </Document>
        </PdfcnThemeProvider>
      </form>
    </article>
  )
}
