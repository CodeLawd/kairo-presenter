import { useEffect, useState } from 'react'
import { Dialog } from 'radix-ui'
import { cleanIpcError } from '@shared/ipc-error'
import type { AudienceState } from '@shared/audience'
import type { PollView } from '@shared/engage'
import { MonitorPlay, Plus, Trash2, X } from '@/icons'
import { MovableDialog } from '@/components/shared/MovableDialog'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

type Act = (action: () => Promise<AudienceState>, onError?: (message: string) => void) => void

const STATE: Record<PollView['state'], { label: string; tone: string }> = {
  draft: { label: 'Not open yet', tone: 'text-zinc-500' },
  open: { label: 'Open for votes', tone: 'text-green-400' },
  closed: { label: 'Closed', tone: 'text-zinc-500' },
}

/** Polls in the open engagement: write one, open it for votes, show the results. */
export function Polls({ state, loading = false, busy, act }: { state: AudienceState; loading?: boolean; busy: boolean; act: Act }): React.ReactElement {
  const [editing, setEditing] = useState<PollView | 'new' | null>(null)
  const polls = state.engage?.polls ?? []

  if (loading && polls.length === 0) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" role="status" aria-label="Loading polls">
        <div className="flex shrink-0 items-center justify-between px-4 pt-3">
          <div className="h-3.5 w-14 animate-pulse rounded bg-zinc-800" />
          <div className="h-8 w-24 animate-pulse rounded-md bg-zinc-800" />
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {[0, 1].map((index) => (
            <div key={index} className="rounded-lg bg-surface-secondary px-4 py-3.5">
              <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-800" />
              <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-zinc-800/70" />
              <div className="mt-4 space-y-2.5">
                <div className="h-1.5 w-full animate-pulse rounded-full bg-zinc-800" />
                <div className="h-1.5 w-full animate-pulse rounded-full bg-zinc-800" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!state.session) {
    return (
      <div className="grid flex-1 place-items-center px-8 text-center">
        <div className="max-w-xs">
          <p className="text-sm font-medium text-zinc-300">No engagement open</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">Start or open an engagement to run polls.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between px-4 pt-3">
        <p className="text-[12px] text-zinc-500">{polls.length ? `${polls.length} ${polls.length === 1 ? 'poll' : 'polls'}` : ''}</p>
        <button type="button" className="btn-primary flex h-8 items-center gap-1.5 px-3 py-0 text-xs" onClick={() => setEditing('new')}>
          <Plus size={13} aria-hidden="true" />
          New poll
        </button>
      </div>

      {polls.length === 0 ? (
        <div className="grid flex-1 place-items-center px-8 text-center">
          <div className="max-w-xs">
            <p className="text-sm font-medium text-zinc-300">No polls yet</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">Ask the room a question with a few answers to pick from.</p>
          </div>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {polls.map((poll) => (
            <PollCard key={poll.id} poll={poll} live={state.livePollId === poll.id} busy={busy} act={act} onEdit={() => setEditing(poll)} />
          ))}
        </ul>
      )}

      <PollEditor poll={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function PollCard({ poll, live, busy, act, onEdit }: { poll: PollView; live: boolean; busy: boolean; act: Act; onEdit: () => void }): React.ReactElement {
  const [error, setError] = useState('')
  const status = STATE[poll.state]
  const setPoll = (next: { state?: 'open' | 'closed'; showResults?: boolean }): void =>
    act(
      () =>
        window.api.audience.command({
          type: 'poll-state',
          id: poll.id,
          state: next.state ?? (poll.state === 'open' ? 'open' : 'closed'),
          showResults: next.showResults ?? poll.showResults,
        }),
      setError,
    )
  const most = Math.max(0, ...poll.options.map((o) => poll.totals[o.id] ?? 0))

  return (
    <li className={cn('rounded-lg px-4 py-3.5', live ? 'bg-tint-live' : 'bg-surface-secondary')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-words text-[14px] font-medium leading-snug text-white">{poll.title}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px]">
            {live && (
              <span className="flex items-center gap-1 font-semibold text-live">
                <span className="size-1.5 rounded-full bg-live" aria-hidden="true" />
                On screens
                <span className="text-zinc-600">·</span>
              </span>
            )}
            <span className={status.tone}>{status.label}</span>
            <span className="text-zinc-600">·</span>
            <span className="tabular-nums text-zinc-500">
              {poll.voters} {poll.voters === 1 ? 'vote' : 'votes'}
            </span>
            {poll.multiple && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="text-zinc-500">Several answers</span>
              </>
            )}
          </p>
        </div>
        {poll.state === 'draft' && (
          <button type="button" className="text-[11px] text-zinc-500 hover:text-zinc-200" onClick={onEdit}>
            Edit
          </button>
        )}
      </div>

      <ul className="mt-3 space-y-2">
        {poll.options.map((option) => {
          const count = poll.totals[option.id] ?? 0
          const percent = poll.voters ? Math.round((100 * count) / poll.voters) : 0
          return (
            <li key={option.id}>
              <div className="flex justify-between gap-3 text-[12px]">
                <span className={cn('min-w-0 break-words', count > 0 && count === most ? 'text-white' : 'text-zinc-300')}>{option.text}</span>
                <span className="shrink-0 tabular-nums text-zinc-500">
                  {count} · {percent}%
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-elevated">
                <div className="h-full rounded-full bg-teal-500 transition-[width] duration-300" style={{ width: `${percent}%` }} />
              </div>
            </li>
          )
        })}
      </ul>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {poll.state === 'open' ? (
          <button type="button" className="btn-secondary h-8 px-3 py-0 text-xs" disabled={busy} onClick={() => setPoll({ state: 'closed' })}>
            Close voting
          </button>
        ) : (
          <button type="button" className="btn-primary h-8 px-3 py-0 text-xs" disabled={busy} onClick={() => setPoll({ state: 'open' })}>
            {poll.state === 'draft' ? 'Open voting' : 'Reopen voting'}
          </button>
        )}
        <button
          type="button"
          className="btn-secondary flex h-8 items-center gap-1.5 px-3 py-0 text-xs"
          disabled={busy}
          onClick={() => act(() => (live ? window.api.audience.clearPoll() : window.api.audience.showPoll(poll.id)), setError)}
        >
          {live ? <X size={13} aria-hidden="true" /> : <MonitorPlay size={13} aria-hidden="true" />}
          {live ? 'Clear from screen' : 'Show on screen'}
        </button>
        {poll.state !== 'draft' && (
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12px] text-zinc-400">
            Results visible to everyone
            <Switch size="sm" checked={poll.showResults} disabled={busy} onCheckedChange={(on) => setPoll({ showResults: on })} aria-label="Results visible to everyone" />
          </label>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-[11px] text-red-400">{error}</p>}
    </li>
  )
}

/** Write or edit a poll. A poll can be edited until it opens for votes. */
function PollEditor({ poll, onClose }: { poll: PollView | 'new' | null; onClose: () => void }): React.ReactElement {
  const [title, setTitle] = useState('')
  const [options, setOptions] = useState<Array<{ id?: string; text: string }>>([])
  const [multiple, setMultiple] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!poll) return
    setError('')
    if (poll === 'new') {
      setTitle('')
      setOptions([{ text: '' }, { text: '' }])
      setMultiple(false)
    } else {
      setTitle(poll.title)
      setOptions(poll.options.map((o) => ({ id: o.id, text: o.text })))
      setMultiple(poll.multiple)
    }
  }, [poll])

  const filled = options.filter((o) => o.text.trim())
  const save = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      await window.api.audience.command({
        type: 'poll-save',
        poll: { ...(poll && poll !== 'new' ? { id: poll.id } : {}), title: title.trim(), options: filled.map((o) => ({ ...(o.id ? { id: o.id } : {}), text: o.text.trim() })), multiple },
      })
      onClose()
    } catch (e) {
      setError(cleanIpcError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open={!!poll} onOpenChange={(open) => { if (!open && !saving) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/35 animate-fade-in motion-reduce:animate-none" />
        <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
          <MovableDialog className="w-full max-w-[460px]">
          <Dialog.Content className="w-full overflow-hidden rounded-2xl modal-glass text-white outline-none animate-spring-in motion-reduce:animate-none">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <div className="max-h-[70vh] overflow-y-auto px-6 pb-5 pt-6">
              <div data-modal-drag className="flex items-start justify-between gap-3">
                <Dialog.Title className="text-[18px] font-semibold tracking-tight">{poll === 'new' ? 'New poll' : 'Edit poll'}</Dialog.Title>
                <Dialog.Close asChild>
                  <button type="button" className="grid size-7 place-items-center rounded-md text-zinc-500 hover:bg-surface-tertiary hover:text-white" aria-label="Close">
                    <X size={14} aria-hidden="true" />
                  </button>
                </Dialog.Close>
              </div>
              <Dialog.Description className="sr-only">Write a question and the answers people can pick from.</Dialog.Description>

              <label className="mt-4 block text-[12px] font-medium text-zinc-300" htmlFor="poll-title">
                Question
              </label>
              <input id="poll-title" autoFocus required maxLength={200} className="input mt-1.5" placeholder="Which song should we sing next week?" value={title} onChange={(event) => setTitle(event.target.value)} />

              <p className="mt-4 text-[12px] font-medium text-zinc-300">Answers</p>
              <ul className="mt-1.5 space-y-1.5">
                {options.map((option, index) => (
                  <li key={index} className="flex items-center gap-1.5">
                    <input
                      aria-label={`Answer ${index + 1}`}
                      maxLength={120}
                      className="input h-9 py-0"
                      placeholder={`Answer ${index + 1}`}
                      value={option.text}
                      onChange={(event) => setOptions((list) => list.map((o, i) => (i === index ? { ...o, text: event.target.value } : o)))}
                    />
                    <button
                      type="button"
                      className="grid size-8 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-surface-tertiary hover:text-white disabled:opacity-30"
                      aria-label={`Remove answer ${index + 1}`}
                      disabled={options.length <= 2}
                      onClick={() => setOptions((list) => list.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
              {options.length < 12 && (
                <button type="button" className="mt-2 flex items-center gap-1.5 text-[12px] text-zinc-400 hover:text-white" onClick={() => setOptions((list) => [...list, { text: '' }])}>
                  <Plus size={12} aria-hidden="true" />
                  Add an answer
                </button>
              )}

              <label className="mt-4 flex cursor-pointer items-center justify-between gap-3">
                <span className="text-[13px] text-zinc-200">People can pick more than one</span>
                <Switch size="sm" checked={multiple} onCheckedChange={setMultiple} aria-label="People can pick more than one" />
              </label>
              {error && (
                <p role="alert" className="mt-3 text-[13px] text-red-400">
                  {error}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 bg-surface-tertiary px-6 py-4">
              <Dialog.Close asChild>
                <button type="button" className="btn-secondary min-h-9" disabled={saving}>
                  Cancel
                </button>
              </Dialog.Close>
              <button type="submit" className="btn-primary min-h-9 min-w-24" disabled={saving || !title.trim() || filled.length < 2}>
                {saving ? 'Saving…' : 'Save poll'}
              </button>
            </div>
          </form>
          </Dialog.Content>
          </MovableDialog>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
