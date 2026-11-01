import { useEffect, useState } from 'react'
import type { AudienceSourceStatus, AudienceState } from '@shared/audience'
import { Check, Download, ExternalLink, Loader2, MessageSquare, LogOut, MonitorPlay, Plus, RotateCcw, Settings, X } from '@/icons'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { Engagements } from './Engagements'
import { downloadQrCode, EngagementSettingsModal } from './EngagementSettingsModal'
import { NewEngagementModal } from './NewEngagementModal'

type Act = (action: () => Promise<AudienceState>, onError?: (message: string) => void) => void

const HEADING = 'flex h-7 items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500'
const CARD = 'rounded-lg bg-surface-tertiary p-3'
const CARD_TITLE = 'flex items-center text-[13px] font-semibold text-white'
const SMALL = 'text-[11px] leading-relaxed text-zinc-400'
const LINK = 'flex items-center gap-1.5 px-1 text-[12px] text-zinc-400 transition-colors hover:text-white disabled:opacity-50'
const ICON_BUTTON = 'grid size-6 place-items-center rounded text-zinc-500 hover:bg-surface-tertiary hover:text-white disabled:opacity-40'

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

function updated(at: number | undefined, now: number): string {
  if (!at) return 'no questions yet'
  const seconds = Math.max(0, Math.floor((now - at) / 1000))
  if (seconds < 15) return 'updated just now'
  if (seconds < 60) return `updated ${seconds}s ago`
  return `updated ${Math.floor(seconds / 60)} min ago`
}

function Beta(): React.ReactElement {
  return <span className="ml-1.5 rounded-full border border-zinc-600 px-1.5 py-px text-[10px] font-normal text-zinc-400">Beta</span>
}

function Dot({ state }: { state: AudienceSourceStatus['state'] }): React.ReactElement {
  return <span className={cn('size-1.5 shrink-0 rounded-full', state === 'live' ? 'bg-green-500' : state === 'error' ? 'bg-red-500' : 'bg-zinc-500')} aria-hidden="true" />
}

function ErrorLine({ message }: { message: string }): React.ReactElement | null {
  return message ? <p role="alert" className="mt-2 text-[11px] leading-relaxed text-red-400">{message}</p> : null
}

/** A row of steps: done, working, or still to come. */
function Steps({ steps }: { steps: Array<{ label: string; state: 'done' | 'active' | 'todo' }> }): React.ReactElement {
  return (
    <ul className="mt-3 space-y-1.5 text-[12px]">
      {steps.map((step) => (
        <li key={step.label} className={cn('flex items-center gap-2', step.state === 'todo' ? 'text-zinc-600' : 'text-zinc-300')}>
          <span className="grid size-4 place-items-center">
            {step.state === 'done' && <Check size={13} className="text-green-500" aria-hidden="true" />}
            {step.state === 'active' && <Loader2 size={13} className="animate-spin text-zinc-400" aria-hidden="true" />}
            {step.state === 'todo' && <span className="size-1 rounded-full bg-zinc-600" aria-hidden="true" />}
          </span>
          {step.label}
        </li>
      ))}
    </ul>
  )
}

/**
 * Engage sidebar: native Kairo engagements are the primary section at the top,
 * while third-party integrations (like Slido) sit below in their own section.
 */
export function AudienceSidebar({
  state,
  activeSourceId = null,
  busy,
  act,
  onState,
  onSelectSource,
}: {
  state: AudienceState
  activeSourceId?: string | null
  busy: boolean
  act: Act
  /** A started engagement hands its state straight back. */
  onState: (state: AudienceState) => void
  onSelectSource?: (sourceId: string) => void
}): React.ReactElement {
  const [creating, setCreating] = useState(false)
  const [addingSlido, setAddingSlido] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const kairo = state.sources.find((s) => s.id === 'kairo' && s.state !== 'stopped')
  const slido = state.sources.filter((s) => s.kind === 'slido' && s.state !== 'stopped')
  const sample = state.sources.find((s) => s.id === 'sample' && s.state !== 'stopped')
  const runningCount = (kairo ? 1 : 0) + slido.length + (sample ? 1 : 0)
  const nothingRunning = runningCount === 0

  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
      <Engagements
        state={state}
        busy={busy}
        act={act}
        reloadKey={reloadKey}
        onNew={() => setCreating(true)}
        selected={!activeSourceId || activeSourceId === 'kairo'}
        onSelect={() => onSelectSource?.('kairo')}
        activeCard={
          kairo ? (
            <KairoCard
              state={state}
              source={kairo}
              selected={activeSourceId === 'kairo'}
              showSelection={runningCount > 1}
              busy={busy}
              act={act}
              onSelect={() => onSelectSource?.('kairo')}
              onStatusChanged={() => setReloadKey((key) => key + 1)}
            />
          ) : null
        }
      />

      <section aria-label="Integrations" className="space-y-2 border-t border-white/[0.06] pt-3">
        <div className={HEADING}>
          <span>Integrations</span>
          {slido.length > 0 && !addingSlido && (
            <button
              type="button"
              className={ICON_BUTTON}
              aria-label="Connect Slido event"
              title="Connect Slido event"
              onClick={() => setAddingSlido(true)}
            >
              <Plus size={13} aria-hidden="true" />
            </button>
          )}
        </div>

        {slido.map((source) => (
          <SlidoCard
            key={source.id}
            source={source}
            questions={state.questions.filter((q) => q.sourceId === source.id).length}
            selected={activeSourceId === source.id}
            showSelection={runningCount > 1}
            busy={busy}
            act={act}
            onSelect={() => onSelectSource?.(source.id)}
          />
        ))}

        {addingSlido ? (
          <ConnectSlido
            busy={busy}
            act={act}
            connecting={slido.find((s) => s.state === 'connecting' && !s.updatedAt)}
            onDone={(startedState) => {
              setAddingSlido(false)
              const newestSlido = [...startedState.sources]
                .reverse()
                .find((s) => s.kind === 'slido' && s.state !== 'stopped')
              if (newestSlido) onSelectSource?.(newestSlido.id)
            }}
            onCancel={() => setAddingSlido(false)}
          />
        ) : (
          slido.length === 0 && (
            <button
              type="button"
              className="group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/5"
              onClick={() => setAddingSlido(true)}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded bg-surface-tertiary text-zinc-400 transition-colors group-hover:text-zinc-200">
                <MessageSquare size={13} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center text-[12px] font-medium text-zinc-300 group-hover:text-white">
                  Connect Slido event
                  <Beta />
                </span>
                <span className="block truncate text-[11px] text-zinc-500">Import questions from a Slido Q&amp;A</span>
              </span>
              <Plus size={12} className="shrink-0 text-zinc-500 group-hover:text-zinc-300" aria-hidden="true" />
            </button>
          )
        )}

        {sample && (
          <div
            className={cn(
              CARD,
              'flex cursor-pointer items-center justify-between',
              runningCount > 1 && activeSourceId === sample.id && 'ring-1 ring-white/15',
            )}
            onClick={() => onSelectSource?.(sample.id)}
          >
            <span className="text-[13px] text-zinc-200">Sample questions</span>
            <button
              type="button"
              className={ICON_BUTTON}
              aria-label="Remove sample questions"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation()
                act(() => window.api.audience.stopSource(sample.id))
              }}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        )}
      </section>

      {nothingRunning && state.sampleAvailable && (
        <button
          type="button"
          className={LINK}
          disabled={busy}
          onClick={() =>
            act(async () => {
              const next = await window.api.audience.startSource('sample')
              onSelectSource?.('sample')
              return next
            })
          }
        >
          <Plus size={12} aria-hidden="true" />
          Load sample questions
        </button>
      )}

      <NewEngagementModal
        open={creating}
        onOpenChange={setCreating}
        onSaved={() => setReloadKey((key) => key + 1)}
        onStarted={(next) => {
          onState(next)
          onSelectSource?.('kairo')
          setReloadKey((key) => key + 1)}
        }
      />
    </div>
  )
}

function ConnectSlido({
  busy,
  act,
  connecting,
  onDone,
  onCancel,
}: {
  busy: boolean
  act: Act
  connecting: AudienceSourceStatus | undefined
  onDone: (next: AudienceState) => void
  onCancel: () => void
}): React.ReactElement {
  const [input, setInput] = useState('')
  const [skipReview, setSkipReview] = useState(false)
  const [error, setError] = useState('')
  return (
    <form
      className={CARD}
      onSubmit={(event) => {
        event.preventDefault()
        setError('')
        act(async () => {
          const next = await window.api.audience.startSource('slido', { code: input, skipReview })
          onDone(next)
          return next
        }, setError)
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-md bg-surface-elevated text-zinc-300">
            <MessageSquare size={15} aria-hidden="true" />
          </span>
          <span className={CARD_TITLE}>
            Questions from Slido
            <Beta />
          </span>
        </span>
        <button type="button" className={ICON_BUTTON} aria-label="Cancel" onClick={onCancel}>
          <X size={12} aria-hidden="true" />
        </button>
      </div>
      <p className={cn(SMALL, 'mt-2')}>Use an event you already run in Slido. Nothing is sent back to Slido.</p>
      <label className="mt-3 block text-[11px] text-zinc-400" htmlFor="slido-code">
        Event code or link
      </label>
      <input
        id="slido-code"
        autoFocus
        className="input mt-1 h-8 bg-surface-secondary py-0 text-[13px]"
        placeholder="#1234567"
        maxLength={200}
        value={input}
        disabled={busy}
        onChange={(event) => setInput(event.target.value)}
      />
      <label className="mt-3 flex cursor-pointer items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[12px] text-zinc-200">Skip approval</span>
          <span className="block text-[11px] text-zinc-500">Slido questions go straight to Open.</span>
        </span>
        <Switch size="sm" checked={skipReview} disabled={busy} onCheckedChange={setSkipReview} aria-label="Skip approval for Slido questions" />
      </label>
      {busy || connecting ? (
        <Steps steps={[{ label: 'Finding the event', state: 'active' }, { label: 'Reading questions', state: 'todo' }]} />
      ) : (
        <button className="btn-primary mt-3 h-8 w-full py-0 text-xs" disabled={!input.trim()}>
          Connect
        </button>
      )}
      <ErrorLine message={error} />
    </form>
  )
}

function KairoCard({
  state,
  source,
  selected = true,
  showSelection = false,
  busy,
  act,
  onSelect,
  onStatusChanged,
}: {
  state: AudienceState
  source: AudienceSourceStatus
  selected?: boolean
  showSelection?: boolean
  busy: boolean
  act: Act
  onSelect?: () => void
  onStatusChanged?: () => void
}): React.ReactElement {
  const session = state.session
  const [error, setError] = useState('')
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  // Until the code has been on screen once, it's the obvious next step.
  const [codeShown, setCodeShown] = useState(false)
  const joinOnScreens = state.liveId === 'join'
  useEffect(() => {
    if (joinOnScreens) setCodeShown(true)
  }, [joinOnScreens])

  if (!session) {
    // Between "join code ready" and the session arriving, keep the progress up.
    return (
      <div className={CARD} onClick={onSelect}>
        <p className={CARD_TITLE}>Starting your Q&amp;A</p>
        <Steps steps={[{ label: 'Getting a join code', state: source.step === 'reserving' ? 'active' : 'done' }, { label: 'Opening the room', state: source.step === 'reserving' ? 'todo' : 'active' }]} />
      </div>
    )
  }
  const isClosed = state.engage?.engagement.status === 'closed'
  const firstConnect = source.state === 'connecting' && !source.error
  const status = isClosed
    ? 'Closed'
    : source.state === 'live'
      ? 'Live'
      : firstConnect
        ? 'Opening…'
        : source.state === 'error'
          ? 'Connection problem'
          : 'Reconnecting…'
  const ICON = 'grid size-8 shrink-0 place-items-center rounded-md bg-surface-secondary text-zinc-400 transition-colors hover:bg-surface-elevated hover:text-white disabled:opacity-40'

  return (
    <div
      className={cn(CARD, showSelection && !selected && 'cursor-pointer opacity-80 transition-opacity hover:opacity-100', showSelection && selected && 'ring-1 ring-white/15')}
      onClick={onSelect}
    >
      {/* 1. Which engagement, and is it live. */}
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white" title={session.title}>
          {session.title}
        </p>
        <span className={cn('flex shrink-0 items-center gap-1.5 text-[11px]', isClosed ? 'text-zinc-500' : source.state === 'live' ? 'text-zinc-300' : source.state === 'error' ? 'text-red-400' : 'text-zinc-500')}>
          <Dot state={isClosed ? 'stopped' : source.state} />
          {status}
        </span>
      </div>
      {source.error && !firstConnect && <p className={cn('mt-1 text-[11px]', source.state === 'error' ? 'text-red-400' : 'text-zinc-500')}>{source.error}</p>}

      {/* 2. How people join: the code, with the QR and link beside it. */}
      <div className="mt-3 flex items-center gap-3 rounded-lg bg-surface-secondary p-2.5">
        <button
          type="button"
          className="group/qr relative size-14 shrink-0 overflow-hidden rounded bg-white p-1"
          title="Download QR code"
          aria-label="Download QR code"
          onClick={() => downloadQrCode(session.qrDataUrl, session.code)}
        >
          <img src={session.qrDataUrl} alt="Scan to join" className="size-full object-contain" />
          <span className="absolute inset-0 grid place-items-center bg-black/60 text-white opacity-0 transition-opacity group-hover/qr:opacity-100 group-focus-visible/qr:opacity-100">
            <Download size={16} aria-hidden="true" />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[22px] font-semibold leading-none tracking-[0.12em] text-white">{session.code}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              className="min-w-0 truncate text-left text-[11px] text-zinc-500 hover:text-zinc-300"
              title="Copy the join link"
              onClick={() => {
                void navigator.clipboard?.writeText(session.url).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
              }}
            >
              {copied ? 'Link copied' : session.url.replace(/^https?:\/\//, '')}
            </button>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-surface-elevated hover:text-zinc-200"
              title="Download QR code"
              aria-label="Download QR code"
              onClick={() => downloadQrCode(session.qrDataUrl, session.code)}
            >
              <Download size={11} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* 3. One row of actions. */}
      {isClosed ? (
        <div className="mt-3 flex items-center gap-1.5">
          <button
            type="button"
            className="btn-primary flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-2 py-0 text-xs"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const next = await window.api.audience.reopenEngagement()
                onStatusChanged?.()
                return next
              }, setError)
            }
          >
            <RotateCcw size={13} aria-hidden="true" />
            Reopen engagement
          </button>
          <button type="button" className={cn(ICON, settingsOpen && 'bg-surface-elevated text-white')} aria-label="Settings and collaboration" title="Settings & collaboration" onClick={() => setSettingsOpen(true)}>
            <Settings size={14} aria-hidden="true" />
          </button>
        </div>
      ) : confirmEnd ? (
        <div className="mt-3">
          <p className="text-[12px] text-zinc-200">End this engagement for everyone?</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-secondary h-8 flex-1 py-0 text-xs" onClick={() => setConfirmEnd(false)}>
              Keep going
            </button>
            <button
              type="button"
              className="h-8 flex-1 rounded-md bg-red-600 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              disabled={busy}
              onClick={() =>
                act(
                  async () => {
                    const next = await window.api.audience.stopSource('kairo')
                    setConfirmEnd(false)
                    onStatusChanged?.()
                    return next
                  },
                  (message) => {
                    setError(message)
                    setConfirmEnd(false)
                  },
                )
              }
            >
              End
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-1.5">
          <button
            type="button"
            className={cn(codeShown ? 'btn-secondary' : 'btn-primary', 'flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-2 py-0 text-xs')}
            disabled={busy}
            onClick={() => act(() => (joinOnScreens ? window.api.audience.clear() : window.api.audience.showJoinCode()), setError)}
          >
            {joinOnScreens ? <X size={13} aria-hidden="true" /> : <MonitorPlay size={13} aria-hidden="true" />}
            {joinOnScreens ? 'Hide code' : 'Show code'}
          </button>
          <button type="button" className={ICON} aria-label="Open the audience page" title="Open the audience page" onClick={() => void window.api.audience.openAudiencePage().catch(() => undefined)}>
            <ExternalLink size={14} aria-hidden="true" />
          </button>
          <button type="button" className={cn(ICON, settingsOpen && 'bg-surface-elevated text-white')} aria-label="Settings and collaboration" title="Settings & collaboration" onClick={() => setSettingsOpen(true)}>
            <Settings size={14} aria-hidden="true" />
          </button>
          <button type="button" className={cn(ICON, 'hover:text-red-300')} aria-label="End engagement" title="End engagement" disabled={busy} onClick={() => setConfirmEnd(true)}>
            <LogOut size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      <ErrorLine message={error} />

      <EngagementSettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        state={state}
        live={source.state === 'live'}
        busy={busy}
        act={act}
      />
    </div>
  )
}

function SlidoCard({
  source,
  questions,
  selected = true,
  showSelection = false,
  busy,
  act,
  onSelect,
}: {
  source: AudienceSourceStatus
  questions: number
  selected?: boolean
  showSelection?: boolean
  busy: boolean
  act: Act
  onSelect?: () => void
}): React.ReactElement {
  const now = useNow(5000)
  const [error, setError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const restart = (options: { moderator?: boolean; skipReview?: boolean }): void =>
    act(async () => {
      await window.api.audience.stopSource(source.id)
      return window.api.audience.startSource('slido', {
        code: source.code ?? `https://app.sli.do/event/${source.eventId}`,
        moderator: options.moderator ?? source.moderator,
        skipReview: options.skipReview ?? source.skipReview,
      })
    }, setError)

  const signInStep = source.state === 'connecting' && (source.step === 'sign-in' || source.step === 'open-event')
  const statusLabel =
    source.state === 'live'
      ? 'Live'
      : source.state === 'error'
        ? 'Connection problem'
        : signInStep
          ? 'Sign in'
          : 'Connecting…'

  const detail =
    source.state === 'error'
      ? source.error || 'Not getting questions'
      : signInStep
        ? source.step === 'sign-in'
          ? 'Sign in to Slido in the window that opened.'
          : 'In that window, open your event’s Q&A.'
        : source.state === 'connecting'
          ? source.eventName
            ? `Found ${source.eventName} · reading questions…`
            : 'Finding the event…'
          : `${questions} ${questions === 1 ? 'question' : 'questions'} · ${updated(source.updatedAt, now)}`

  const codeDisplay = source.code ? `#${source.code}` : source.eventId ?? 'Slido'
  const copyValue = source.code ? `https://app.sli.do/?search=${source.code}` : `https://app.sli.do/event/${source.eventId}`
  const ICON = 'grid size-7 shrink-0 place-items-center rounded-md bg-surface-secondary text-zinc-400 transition-colors hover:bg-surface-elevated hover:text-white disabled:opacity-40'

  return (
    <div
      className={cn('rounded-lg bg-surface-tertiary p-2.5', showSelection && !selected && 'cursor-pointer opacity-80 transition-opacity hover:opacity-100', showSelection && selected && 'ring-1 ring-white/15')}
      onClick={onSelect}
    >
      {/* 1. Which Slido event, and its connection status. */}
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded bg-surface-secondary text-zinc-400">
          <MessageSquare size={11} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="flex min-w-0 items-center text-[12px] font-semibold text-white" title={source.eventName ?? 'Slido event'}>
              <span className="truncate">{source.eventName ?? 'Slido event'}</span>
              <Beta />
            </p>
            <span className={cn('flex shrink-0 items-center gap-1.5 text-[11px]', source.state === 'live' ? 'text-zinc-300' : source.state === 'error' ? 'text-red-400' : 'text-zinc-500')}>
              <Dot state={source.state} />
              {statusLabel}
            </span>
          </div>
          <p className={cn('mt-0.5 flex items-center gap-1.5 text-[11px]', source.state === 'error' ? 'text-red-400' : 'text-zinc-500')}>
            <span className="font-mono text-zinc-300">{codeDisplay}</span>
            <span>·</span>
            {source.state === 'connecting' && <Loader2 size={10} className="shrink-0 animate-spin text-zinc-400" aria-hidden="true" />}
            <span className="min-w-0 truncate">{detail}</span>
          </p>
        </div>
      </div>

      {/* 2. Compact action bar: link/window, settings gear, and disconnect. */}
      <div className="mt-2.5 flex items-center gap-1.5">
        {signInStep || source.moderator ? (
          <button
            type="button"
            className={cn(signInStep ? 'btn-primary' : 'btn-secondary', 'flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-2 py-0 text-[11px]')}
            disabled={busy}
            onClick={() => act(() => window.api.audience.openSource(source.id), setError)}
          >
            <ExternalLink size={12} aria-hidden="true" />
            {signInStep ? 'Sign in to Slido' : 'Slido window'}
          </button>
        ) : (
          <button
            type="button"
            className="btn-secondary flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-2 py-0 text-[11px]"
            onClick={() => {
              void navigator.clipboard?.writeText(copyValue).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }}
          >
            {copied ? <Check size={12} className="text-green-400" aria-hidden="true" /> : <ExternalLink size={12} aria-hidden="true" />}
            {copied ? 'Link copied' : 'Copy Slido link'}
          </button>
        )}
        <button
          type="button"
          className={cn(ICON, settingsOpen && 'bg-surface-elevated text-white')}
          aria-label="Slido settings"
          aria-expanded={settingsOpen}
          title="Slido settings"
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <Settings size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={cn(ICON, 'hover:text-red-300')}
          aria-label="Disconnect Slido"
          title="Disconnect Slido"
          disabled={busy}
          onClick={() => act(() => window.api.audience.stopSource(source.id), setError)}
        >
          <LogOut size={13} aria-hidden="true" />
        </button>
      </div>

      {settingsOpen && (
        <div className="pref-group pref-group-dim mt-2.5 rounded-lg bg-surface-secondary">
          <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0">
              <span className="block text-[12px] text-zinc-200">Skip approval</span>
              <span className="block text-[11px] text-zinc-500">New questions go straight to Open.</span>
            </span>
            <Switch size="sm" checked={source.skipReview === true} disabled={busy} onCheckedChange={(on) => restart({ skipReview: on })} aria-label="Skip approval for Slido questions" />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0">
              <span className="block text-[12px] text-zinc-200">Include pending</span>
              <span className="block text-[11px] text-zinc-500">{source.moderator ? 'Signed in as a Slido moderator.' : 'Needs a Slido moderator sign-in.'}</span>
            </span>
            <Switch size="sm" checked={source.moderator === true} disabled={busy} onCheckedChange={(on) => restart({ moderator: on })} aria-label="Include pending Slido questions" />
          </label>
        </div>
      )}

      <ErrorLine message={error} />
    </div>
  )
}
