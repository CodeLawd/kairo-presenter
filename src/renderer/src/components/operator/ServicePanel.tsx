import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { Dialog } from 'radix-ui'
import { X } from '@/icons'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { cn, downloadFile } from '@/lib/utils'
import { serviceTextExport, type ServiceRecord, type ServiceSnapshot } from '@shared/service-records'

export const useServiceRecords = create<ServiceSnapshot & { loaded: boolean; set: (value: ServiceSnapshot) => void }>(set => ({
  activeId: null, services: [], loaded: false, set: value => set({ ...value, loaded: true }),
}))

function formatServiceDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return [h, m, s].map(part => String(part).padStart(2, '0')).join(':')
}

function serviceDurationMs(record: Pick<ServiceRecord, 'createdAt' | 'endedAt'>, now = Date.now()): number {
  return (record.endedAt ?? now) - record.createdAt
}

type ReviewTab = 'nuggets' | 'transcript' | 'notes' | 'scriptures'

/**
 * Where an ended service is on its way to the church's website.
 *
 * `failed` reads as "not yet" rather than "gone" on purpose — the booth is
 * often offline, the local record is never at risk, and the upload retries by
 * itself. The operator only has to act if they want it to happen sooner.
 */
function RecapStatus({ record, onRetry }: {
  record: ServiceRecord
  onRetry: () => void
}): React.JSX.Element | null {
  const upload = record.upload
  if (record.status !== 'ended' || upload.status === 'idle') return null

  if (upload.status === 'uploaded') {
    return (
      <button
        type="button"
        className="rounded-md px-2 py-1.5 text-[11px] text-teal-400 hover:bg-surface-tertiary hover:text-teal-300"
        onClick={() => void window.api.account.openWeb(
          upload.sermonId ? `/dashboard/sermons/${upload.sermonId}` : '/dashboard/sermons',
        )}
      >
        Recap published
      </button>
    )
  }

  if (upload.status === 'failed') {
    return (
      <button
        type="button"
        title={upload.error ?? undefined}
        className="rounded-md px-2 py-1.5 text-[11px] text-amber-400 hover:bg-surface-tertiary hover:text-amber-300"
        onClick={onRetry}
      >
        Recap not sent — Retry
      </button>
    )
  }

  return (
    <span className="px-2 py-1.5 text-[11px] text-zinc-500">
      {upload.status === 'uploading' ? 'Publishing recap…' : 'Recap queued'}
    </span>
  )
}

export function ServicePanel(): React.ReactElement {
  const snapshot = useServiceRecords()
  const active = snapshot.services.find(s => s.id === snapshot.activeId)
  const plans = useBootstrapStore(s => s.sermonPlans)
  const [title, setTitle] = useState('')
  const [speaker, setSpeaker] = useState('')
  const [planId, setPlanId] = useState('')
  const [viewId, setViewId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [elapsedLabel, setElapsedLabel] = useState('00:00:00')
  const record = snapshot.services.find(s => s.id === viewId)
  const [tab, setTab] = useState<ReviewTab>('nuggets')
  useEffect(() => {
    let received = false
    const unsub = window.api.services.onChanged(value => { received = true; useServiceRecords.getState().set(value) })
    void window.api.services.command({ action: 'list' }).then(value => { if (!received) useServiceRecords.getState().set(value) }).catch(e => setError(String(e)))
    return unsub
  }, [])
  useEffect(() => {
    if (!active) {
      setElapsedLabel('00:00:00')
      return
    }
    const createdAt = active.createdAt
    const endedAt = active.endedAt
    const tick = (): void => setElapsedLabel(formatServiceDuration(serviceDurationMs({ createdAt, endedAt })))
    tick()
    if (endedAt != null) return
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [active?.id, active?.createdAt, active?.endedAt])
  // The save form opens blank for an unnamed service and pre-filled when the
  // operator already gave the service a name in an earlier end attempt.
  useEffect(() => {
    if (!confirmEnd || !active) return
    setError('')
    setTitle(active.title)
    setSpeaker(active.speaker)
    setPlanId(active.notes[0]?.id ?? '')
  }, [confirmEnd, active?.id])
  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setError('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const liveLabel = active ? (active.title || 'Unnamed service') : ''

  return <>
    {active || error ? (
      <div className="shrink-0 bg-surface-secondary px-3 py-1.5">
        {active ? (
          <div className="flex min-w-0 items-center gap-2">
            {/* The elapsed clock leads: mid-service it is the number the booth
                glances at, and the name is often still a placeholder. */}
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-300" title="Service duration">{elapsedLabel}</span>
            <span className="text-zinc-700" aria-hidden>·</span>
            <p
              className={cn('min-w-0 flex-1 truncate text-[11px] leading-tight', active.title ? 'text-zinc-400' : 'italic text-zinc-600')}
              title={active.speaker ? `${liveLabel} · ${active.speaker}` : liveLabel}
            >
              {liveLabel}
              {active.speaker ? <span className="text-zinc-600"> · {active.speaker}</span> : null}
            </p>
            <div className="flex shrink-0 items-center gap-0.5 text-[10px]">
              <button type="button" className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-surface-tertiary hover:text-zinc-200" onClick={() => setViewId(active.id)}>Review</button>
              <button type="button" disabled={busy} className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-surface-tertiary hover:text-zinc-200 disabled:opacity-40" onClick={() => setConfirmEnd(true)}>End</button>
            </div>
          </div>
        ) : null}
        {active?.analysisError && <p role="status" className="mt-1.5 text-[10px] text-amber-400">Nugget selection: {active.analysisError}</p>}
        {error && <p role="alert" className="mt-1.5 text-[10px] text-red-400">{error}</p>}
      </div>
    ) : null}
    <Dialog.Root open={confirmEnd && Boolean(active)} onOpenChange={open => { if (!open && !busy) setConfirmEnd(false) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80" />
        {active && (
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-zinc-950 p-5 text-white shadow-2xl">
            <Dialog.Title className="text-base font-semibold tracking-tight text-zinc-50">Save service</Dialog.Title>
            <Dialog.Description className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">
              Transcription stops and this message is saved. Name it now — leave the name blank and it is filed by date.
            </Dialog.Description>
            <form
              className="mt-5 grid gap-4"
              onSubmit={event => {
                event.preventDefault()
                void run(async () => {
                  const value = await window.api.services.command({ action: 'end', title, speaker, planId: planId || null })
                  useServiceRecords.getState().set(value)
                  setConfirmEnd(false)
                })
              }}
            >
              <fieldset disabled={busy} className="grid gap-4">
                <label className="text-xs text-zinc-400">Service name<input maxLength={200} className="input mt-1" placeholder="Sunday morning service" value={title} onChange={e => setTitle(e.target.value)} /></label>
                <label className="text-xs text-zinc-400">Speaker (optional)<input maxLength={200} className="input mt-1" value={speaker} onChange={e => setSpeaker(e.target.value)} /></label>
                <label className="text-xs text-zinc-400">Sermon notes<select className="input mt-1" value={planId} onChange={e => setPlanId(e.target.value)}><option value="">No notes</option>{plans.map(plan => <option value={plan.id} key={plan.id}>{plan.title}</option>)}</select></label>
              </fieldset>
              {error && <p role="alert" className="text-[11px] text-red-400">{error}</p>}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="text-[11px] text-zinc-600 transition-colors hover:text-rose-400 disabled:opacity-40"
                  onClick={() => { setConfirmEnd(false); setConfirmDiscard(true) }}
                >
                  Discard service
                </button>
                <div className="flex gap-2">
                  <Dialog.Close type="button" disabled={busy} className="btn-secondary text-xs">Keep recording</Dialog.Close>
                  <button type="submit" disabled={busy} className="btn-primary text-xs">{busy ? 'Saving…' : 'End and save'}</button>
                </div>
              </div>
            </form>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
    <Dialog.Root open={confirmDiscard && Boolean(active)} onOpenChange={open => { if (!open && !busy) setConfirmDiscard(false) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80" />
        {active && (
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl bg-zinc-950 p-5 text-white shadow-2xl">
            <Dialog.Title className="text-base font-semibold tracking-tight text-zinc-50">Discard this service?</Dialog.Title>
            <Dialog.Description className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">
              The transcript, nuggets and detected scriptures from this service are deleted. This cannot be undone.
            </Dialog.Description>
            {error && <p role="alert" className="mt-3 text-[11px] text-red-400">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close type="button" disabled={busy} className="btn-secondary text-xs">Cancel</Dialog.Close>
              <button
                type="button"
                disabled={busy}
                className="btn-primary text-xs !bg-rose-500 hover:!bg-rose-400"
                onClick={() => void run(async () => {
                  const value = await window.api.services.command({ action: 'discard' })
                  useServiceRecords.getState().set(value)
                  setConfirmDiscard(false)
                })}
              >
                {busy ? 'Discarding…' : 'Discard'}
              </button>
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
    <Dialog.Root open={Boolean(record)} onOpenChange={open => { if (!open) setViewId(null) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80" />
        {record && (
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(85vh,720px)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-zinc-950 text-white shadow-2xl"
          >
            <header className="shrink-0 px-5 pb-4 pt-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Dialog.Title className="truncate text-base font-semibold tracking-tight text-zinc-50">{record.title || 'Unnamed service'}</Dialog.Title>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
                    {record.speaker ? <span>{record.speaker}</span> : null}
                    {record.speaker ? <span className="text-zinc-700" aria-hidden>·</span> : null}
                    <span>{new Date(record.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    <span className="text-zinc-700" aria-hidden>·</span>
                    <span className="font-mono tabular-nums text-zinc-400">{formatServiceDuration(serviceDurationMs(record))}</span>
                    <span className="text-zinc-700" aria-hidden>·</span>
                    <span>{record.status === 'ended' ? 'Ended' : 'In progress'}</span>
                  </p>
                </div>
                <Dialog.Close className="grid size-7 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-surface-tertiary hover:text-zinc-200" aria-label="Close">
                  <X size={14} />
                </Dialog.Close>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-0.5 rounded-lg bg-surface-tertiary p-0.5" role="tablist" aria-label="Service sections">
                  {([
                    ['nuggets', record.nuggets.length],
                    ['transcript', record.transcript.length],
                    ['notes', record.notes.length],
                    ['scriptures', record.scriptures.length],
                  ] as const).map(([value, count]) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={tab === value}
                      onClick={() => setTab(value)}
                      className={cn(
                        'rounded-md px-2.5 py-1.5 text-[11px] font-medium capitalize transition-colors',
                        tab === value ? 'bg-surface-elevated text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
                      )}
                    >
                      {value}
                      <span className={cn('ml-1.5 tabular-nums', tab === value ? 'text-zinc-400' : 'text-zinc-600')}>{count}</span>
                    </button>
                  ))}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <RecapStatus
                    record={record}
                    onRetry={() => void run(() => window.api.services.command({ action: 'upload', serviceId: record.id }))}
                  />
                  <button
                    type="button"
                    className="rounded-md px-2 py-1.5 text-[11px] text-zinc-500 hover:bg-surface-tertiary hover:text-zinc-200"
                    onClick={() => downloadFile(serviceTextExport(record), `${record.title.replace(/[^a-z0-9]+/gi, '-')}.txt`, 'text/plain')}
                  >
                    Export
                  </button>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1.5 text-[11px] text-zinc-500 hover:bg-surface-tertiary hover:text-zinc-200"
                    onClick={() => downloadFile(JSON.stringify(record, null, 2), `service-${record.id}.json`, 'application/json')}
                    title="Download full JSON archive"
                  >
                    JSON
                  </button>
                </div>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {error && <p role="alert" className="mb-3 text-[11px] text-red-400">{error}</p>}

              {tab === 'nuggets' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] text-zinc-500">
                      {record.analysisError ?? 'Quotes selected from the message.'}
                    </p>
                    <button
                      type="button"
                      disabled={busy || !record.transcript.length}
                      className="shrink-0 text-[11px] font-medium text-teal-400 hover:text-teal-300 disabled:opacity-40"
                      onClick={() => void run(() => window.api.services.command({ action: 'analyze', serviceId: record.id }))}
                    >
                      Scan speech
                    </button>
                  </div>
                  {record.nuggets.length === 0 ? (
                    <p className="py-10 text-center text-[12px] text-zinc-600">No nuggets yet.</p>
                  ) : (
                    record.nuggets.map(n => (
                      <article key={n.id} className="rounded-lg bg-surface-secondary px-3.5 py-3">
                        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-200">{n.text}</p>
                        <div className="mt-2.5 flex items-center gap-3 text-[10px] text-zinc-500">
                          <span className="capitalize">{n.origin}</span>
                          <span className="text-zinc-700" aria-hidden>·</span>
                          <span>{new Date(n.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          <div className="ml-auto flex items-center gap-2">
                            <button type="button" className="hover:text-zinc-200" onClick={() => void run(() => navigator.clipboard.writeText(n.text))}>Copy</button>
                            <button type="button" className="hover:text-rose-400" onClick={() => void run(() => window.api.services.command({ action: 'removeNugget', serviceId: record.id, nuggetId: n.id }))}>Remove</button>
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              )}

              {tab === 'transcript' && (
                record.transcript.length === 0 ? (
                  <p className="py-10 text-center text-[12px] text-zinc-600">No transcript recorded.</p>
                ) : (
                  <div className="space-y-3">
                    {record.transcript.map(s => (
                      <p key={s.id} className="text-[13px] leading-relaxed text-zinc-300">
                        <span className="mr-2 font-mono text-[10px] tabular-nums text-zinc-600">
                          {new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                        {s.text}
                      </p>
                    ))}
                  </div>
                )
              )}

              {tab === 'notes' && (
                record.notes.length === 0 ? (
                  <p className="py-10 text-center text-[12px] text-zinc-600">No sermon notes attached.</p>
                ) : (
                  <div className="space-y-5">
                    {record.notes.map(n => (
                      <div key={n.id}>
                        <h3 className="text-[13px] font-semibold text-zinc-100">{n.title}</h3>
                        {n.sourceText ? <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-400">{n.sourceText}</p> : null}
                        {n.items.length > 0 && (
                          <ul className="mt-3 space-y-2">
                            {n.items.map(item => (
                              <li key={item.id} className="text-[12px] text-zinc-300">
                                <span className="font-medium text-zinc-200">{item.reference}</span>
                                <span className="text-zinc-600"> · {item.translation}</span>
                                <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-500">{item.verses.map(v => v.text).join(' ')}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )
              )}

              {tab === 'scriptures' && (
                record.scriptures.length === 0 ? (
                  <p className="py-10 text-center text-[12px] text-zinc-600">No scriptures detected.</p>
                ) : (
                  <ul className="space-y-3">
                    {record.scriptures.map(s => (
                      <li key={s.id} className="rounded-lg bg-surface-secondary px-3.5 py-3">
                        <p className="text-[13px] font-medium text-zinc-100">
                          {s.reference}
                          <span className="ml-2 text-[11px] font-normal text-zinc-500">{s.translation}</span>
                        </p>
                        <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">{s.verses.map(v => v.text).join(' ')}</p>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  </>
}
