import { useEffect, useState } from 'react'
import type { AudienceState } from '@shared/audience'
import type { EngagementIndex } from '@shared/engage'
import { cleanIpcError } from '@shared/ipc-error'
import { Loader2, Plus, RefreshCw, Trash2 } from '@/icons'
import { cn } from '@/lib/utils'
import { isSignedIn, useAccountStore } from '@/stores/useAccountStore'

type Act = (action: () => Promise<AudienceState>, onError?: (message: string) => void) => void

const HEADING = 'flex h-7 items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500'
const ICON_BUTTON = 'grid size-6 place-items-center rounded text-zinc-500 hover:bg-surface-tertiary hover:text-white disabled:opacity-40'
const CACHE_KEY = 'kairo:engagements-cache:v1'

let memoryCache: EngagementIndex[] | null = null

function readCache(): EngagementIndex[] | null {
  if (memoryCache) return memoryCache
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      memoryCache = parsed as EngagementIndex[]
      return memoryCache
    }
  } catch {
    // Ignore storage read errors
  }
  return null
}

function writeCache(items: EngagementIndex[] | null): void {
  memoryCache = items
  try {
    if (items) localStorage.setItem(CACHE_KEY, JSON.stringify(items))
    else localStorage.removeItem(CACHE_KEY)
  } catch {
    // Ignore storage write errors
  }
}

const STATUS: Record<EngagementIndex['status'], { label: string; dot: string }> = {
  open: { label: 'Open', dot: 'bg-green-500' },
  draft: { label: 'Not started', dot: 'bg-zinc-500' },
  closed: { label: 'Closed', dot: 'bg-zinc-700' },
}

function dates(item: EngagementIndex): string | null {
  const day = (time: number): string => new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  if (item.startsAt && item.endsAt && day(item.startsAt) !== day(item.endsAt)) return `${day(item.startsAt)} – ${day(item.endsAt)}`
  if (item.startsAt) return day(item.startsAt)
  return null
}

/** Every engagement the church has, newest first. Click one to open it. */
export function Engagements({
  state,
  busy,
  act,
  reloadKey,
  onNew,
  activeCard,
  selected = true,
  onSelect,
}: {
  state: AudienceState
  busy: boolean
  act: Act
  /** Bumped when an engagement was saved elsewhere, so the list reloads. */
  reloadKey: number
  onNew: () => void
  /** The active Q&A card rendered inside its engagement section. */
  activeCard?: React.ReactNode
  /** Whether the Kairo engagement is the currently viewed question source. */
  selected?: boolean
  onSelect?: () => void
}): React.ReactElement {
  const session = useAccountStore((s) => s.session)
  const signedIn = isSignedIn(session)
  const online = session.state === 'active'
  const [items, setItems] = useState<EngagementIndex[] | null>(() => (signedIn ? readCache() : null))
  const [loading, setLoading] = useState(false)
  const [openingCode, setOpeningCode] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const current = state.session?.code
  const refresh = (): void => {
    if (!signedIn) return
    if (!online) {
      setLoading(true)
      void window.api.account.syncOrgSecrets().catch(() => setLoading(false))
      return
    }
    setLoading(true)
    void window.api.audience
      .listEngagements()
      .then((next) => {
        writeCache(next)
        setItems(next)
        setError('')
      })
      .catch((e) => {
        const msg = cleanIpcError(e)
        if (/sign in/i.test(msg)) {
          void window.api.account.syncOrgSecrets().catch(() => undefined)
        } else {
          setError(msg)
        }
      })
      .finally(() => setLoading(false))
  }
  useEffect(refresh, [current, reloadKey, signedIn, online])

  useEffect(() => {
    if (!signedIn) {
      writeCache(null)
      setItems(null)
      setError('')
    }
  }, [signedIn])

  const currentInList = Boolean(current && items?.some((item) => item.code === current))
  const hasEngagements = Boolean(activeCard || (items && items.length > 0))

  return (
    <section aria-label="Engagements" className="space-y-2">
      <div className={HEADING}>
        Engagements
        <span className="flex items-center gap-0.5">
          <button type="button" className={ICON_BUTTON} aria-label="Reload" title="Reload" onClick={refresh} disabled={!signedIn || loading}>
            <RefreshCw size={11} className={cn(loading && 'animate-spin')} aria-hidden="true" />
          </button>
          <button type="button" className={ICON_BUTTON} aria-label="New engagement" title="New engagement" onClick={onNew}>
            <Plus size={13} aria-hidden="true" />
          </button>
        </span>
      </div>
      {activeCard && !currentInList && activeCard}
      {!signedIn && (
        <div className="rounded-lg bg-surface-tertiary p-3">
          <p className="text-[12px] font-medium text-zinc-200">Host live Q&amp;A and polls</p>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
            People join with a code to ask questions, vote, and answer polls. Sign in to Kairo to see your saved engagements.
          </p>
          <button type="button" className="btn-primary mt-2.5 flex h-8 w-full items-center justify-center gap-1.5 py-0 text-xs" onClick={onNew}>
            <Plus size={13} aria-hidden="true" />
            New engagement
          </button>
        </div>
      )}
      {signedIn && !items && !error && (
        <div className="space-y-1.5 py-1" role="status" aria-label="Loading engagements">
          {[0, 1].map((index) => (
            <div key={index} className="flex items-start gap-2 rounded-md px-2 py-1.5">
              <div className="mt-1.5 size-1.5 shrink-0 animate-pulse rounded-full bg-zinc-700" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-zinc-800" />
                <div className="h-2.5 w-1/2 animate-pulse rounded bg-zinc-800/70" />
              </div>
            </div>
          ))}
        </div>
      )}
      {signedIn && error && <p role="alert" className="px-1 py-1 text-[11px] text-zinc-500">{/sign in/i.test(error) ? 'Could not load engagements. Try again.' : error}</p>}
      {signedIn && items && !hasEngagements && (
        <div className="rounded-lg bg-surface-tertiary p-3">
          <p className="text-[12px] font-medium text-zinc-200">Start your first engagement</p>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
            People join with a code or QR to ask questions, upvote, and answer live polls.
          </p>
          <button type="button" className="btn-primary mt-2.5 flex h-8 w-full items-center justify-center gap-1.5 py-0 text-xs" onClick={onNew}>
            <Plus size={13} aria-hidden="true" />
            New engagement
          </button>
        </div>
      )}
      <ul className="space-y-1">
        {items?.map((item) => {
          const status = STATUS[item.status]
          const when = dates(item)
          const isCurrent = item.code === current
          const isOpening = openingCode === item.code
          return (
            <li key={item.code} className="space-y-1.5">
              <div className={cn('group rounded-md', isCurrent && selected ? 'row-selected' : 'hover:bg-white/5')}>
                {deleting === item.code ? (
                  <div className="px-2 py-1.5">
                    <p className="text-[12px] text-zinc-200">Delete “{item.name}” and its questions?</p>
                    <div className="mt-1.5 flex gap-2">
                      <button type="button" className="btn-secondary h-7 flex-1 py-0 text-xs" onClick={() => setDeleting(null)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="h-7 flex-1 rounded-md bg-red-600 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                        disabled={busy}
                        onClick={() =>
                          act(async () => {
                            await window.api.audience.deleteEngagement(item.code)
                            setDeleting(null)
                            refresh()
                            return window.api.audience.getState()
                          }, setError)
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left disabled:cursor-default"
                      disabled={busy || (isCurrent && selected)}
                      title={isCurrent && selected ? 'Open now' : 'Open this engagement'}
                      onClick={() => {
                        onSelect?.()
                        if (isCurrent) return
                        setOpeningCode(item.code)
                        act(
                          () => window.api.audience.resumeEngagement(item.code).finally(() => setOpeningCode(null)),
                          setError,
                        )
                      }}
                    >
                      {isOpening ? (
                        <Loader2 size={11} className="mt-[4px] shrink-0 animate-spin text-zinc-400" aria-hidden="true" />
                      ) : (
                        <span className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', status.dot)} aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-zinc-100">{item.name}</span>
                        <span className="block truncate text-[11px] text-zinc-500">
                          <span className="font-mono">{item.code}</span> · {isOpening ? 'Opening…' : status.label}
                          {when && !isOpening && ` · ${when}`}
                        </span>
                      </span>
                    </button>
                    {!isCurrent && (
                      <button
                        type="button"
                        className={cn(ICON_BUTTON, 'mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
                        aria-label={`Delete ${item.name}`}
                        title="Delete"
                        onClick={() => setDeleting(item.code)}
                      >
                        <Trash2 size={11} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )}
              </div>
              {isCurrent && activeCard}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
