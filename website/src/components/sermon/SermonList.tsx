'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSelectedLayoutSegment } from 'next/navigation'
import { CheckIcon, ListFilterIcon, PencilIcon, SearchIcon, Trash2Icon, XIcon } from 'lucide-react'
import { useVisibleInterval } from '@/hooks/use-refresh'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ApiError } from '@/lib/api'
import {
  boundsForRange,
  formatDuration,
  statsQuery,
  type SermonDetail,
  type SermonListItem,
  type SermonListPage,
  type SermonStatsRange,
} from '@/lib/sermons'
import { cn } from '@/lib/utils'
import { EditRecapDialog } from '@/components/sermon/EditRecapDialog'
import { forgetSermon, listItemFrom, onSermonsChanged, peekSermon, rememberSermon } from '@/components/sermon/sermon-cache'

const PAGE_SIZE = 20
/** Load more only after a full page — short libraries stay as a single scroll. */
const PAGINATE_AFTER = PAGE_SIZE
/** Filter control appears once the index is long enough to need narrowing. */
const FILTER_AFTER = 8
/** How often to re-read while a recap is still being written. */
const PENDING_POLL_MS = 8_000

const RANGE_OPTIONS: { key: Exclude<SermonStatsRange, 'custom'>; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: '7d', label: 'Last 7 days' },
  { key: '4w', label: 'Last 4 weeks' },
  { key: '12w', label: 'Last 12 weeks' },
  { key: 'ytd', label: 'This year' },
]

type ListFilter = {
  range: Exclude<SermonStatsRange, 'custom'>
  speaker: string
}

const ORG_ROLES = ['viewer', 'operator', 'admin', 'owner'] as const

function roleAtLeast(role: string | null | undefined, need: (typeof ORG_ROLES)[number]): boolean {
  if (!role) return false
  const have = ORG_ROLES.indexOf(role as (typeof ORG_ROLES)[number])
  return have >= ORG_ROLES.indexOf(need)
}

function groupByServiceDay(items: SermonListItem[]): { day: string; items: SermonListItem[] }[] {
  const groups: { day: string; items: SermonListItem[] }[] = []
  for (const item of items) {
    const day = item.preachedAt.slice(0, 10)
    const last = groups.at(-1)
    if (last?.day === day) last.items.push(item)
    else groups.push({ day, items: [item] })
  }
  return groups
}

function formatGroupDay(isoDay: string): string {
  return new Date(`${isoDay}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function splitDay(isoDay: string): { day: string; month: string; weekday: string } {
  const date = new Date(`${isoDay}T12:00:00`)
  return {
    day: date.toLocaleDateString(undefined, { day: 'numeric' }),
    month: date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
    weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
  }
}

function formatServiceTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function StatusNote({ status }: { status: SermonListItem['status'] }): React.ReactElement | null {
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium tracking-wide text-primary">
        <span className="size-1.5 animate-pulse rounded-full bg-primary" />
        Writing
      </span>
    )
  }
  if (status === 'failed') {
    return <span className="text-[10.5px] font-medium text-destructive">Failed</span>
  }
  return null
}

function matchesQuery(item: SermonListItem, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [item.headline, item.title, item.speaker]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(needle)
}

function SermonRow({
  item,
  open,
  compact,
  canEdit,
  canDelete,
  onPrefetch,
  onRename,
  onDelete,
}: {
  item: SermonListItem
  open: boolean
  compact: boolean
  canEdit: boolean
  canDelete: boolean
  onPrefetch: (id: string) => void
  onRename: (item: SermonListItem) => void
  onDelete: (item: SermonListItem) => void
}): React.ReactElement {
  const serviceName =
    item.headline && item.title && item.title !== item.headline ? item.title : null
  const duration = formatDuration(item.durationMs)
  const time = formatServiceTime(item.preachedAt)

  const row = (
    <Link
      href={`/dashboard/sermons/${item.id}`}
      aria-current={open ? 'page' : undefined}
      onPointerEnter={() => onPrefetch(item.id)}
      className={cn(
        'group relative block rounded-lg transition-[background-color,transform,box-shadow] duration-200',
        'active:scale-[0.985] motion-reduce:active:scale-100',
        compact ? 'px-3 py-3' : 'px-2 py-3.5',
        open
          ? 'bg-primary/[0.09] text-foreground shadow-[inset_0_0_0_1px_rgba(245,158,11,0.18)]'
          : 'text-muted-foreground hover:bg-white/[0.035] hover:text-foreground',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {serviceName ? (
            <span className="mb-1 block truncate font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              {serviceName}
            </span>
          ) : null}
          <span
            className={cn(
              'block text-[13.5px] leading-snug tracking-[-0.01em]',
              open ? 'font-medium text-paper' : 'text-inherit group-hover:text-paper',
              compact ? 'line-clamp-2' : 'truncate',
            )}
          >
            {item.headline ?? item.title}
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-2 text-[12px] text-mute">
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">{time}</span>
            {item.speaker ? (
              <>
                <span className="text-white/15" aria-hidden>
                  ·
                </span>
                <span className="truncate">{item.speaker}</span>
              </>
            ) : null}
            <StatusNote status={item.status} />
          </span>
        </div>
        {duration ? (
          <span
            className={cn(
              'shrink-0 pt-0.5 font-mono text-[10.5px] tabular-nums tracking-wide',
              open ? 'text-primary' : 'text-faint group-hover:text-mute',
            )}
          >
            {duration}
          </span>
        ) : null}
      </div>
    </Link>
  )

  if (!canEdit && !canDelete) return row

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block select-none">{row}</ContextMenuTrigger>
      <ContextMenuContent>
        {canEdit ? (
          <ContextMenuItem onClick={() => onRename(item)}>
            <PencilIcon />
            Rename
          </ContextMenuItem>
        ) : null}
        {canEdit && canDelete ? <ContextMenuSeparator /> : null}
        {canDelete ? (
          <ContextMenuItem variant="destructive" onClick={() => onDelete(item)}>
            <Trash2Icon />
            Delete
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * The recap list, living in the sermons *layout* rather than a page.
 *
 * That placement is the whole point: a layout is not remounted when the route
 * below it changes, so opening a recap does not re-fetch the list, lose the
 * scroll position, or drop pages already loaded with "Load more".
 *
 * Open vs closed is a typesetter's index, not a stack of cards: date as the
 * section, title as the entry, status only when something is still happening.
 */
export function SermonList(): React.ReactElement {
  const { session, request } = useDashboard()
  const router = useRouter()
  const orgId = session.orgId
  const orgRole =
    session.role ?? session.orgs.find((org) => org.id === session.orgId)?.role ?? null
  const canDelete = roleAtLeast(orgRole, 'admin')
  const canEdit = roleAtLeast(orgRole, 'operator')
  const openId = useSelectedLayoutSegment()
  const compact = Boolean(openId)
  const [items, setItems] = useState<SermonListItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<SermonListItem | null>(null)
  const [deleting, setDeleting] = useState<SermonListItem | null>(null)
  const [metaBusy, setMetaBusy] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ListFilter>({ range: 'all', speaker: '' })
  const [filterOpen, setFilterOpen] = useState(false)
  const cancelled = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const scrolledTo = useRef<string | null>(null)
  const [bar, setBar] = useState<{ top: number; height: number } | null>(null)
  const [slide, setSlide] = useState(false)
  const filtered = useMemo(() => items.filter((item) => matchesQuery(item, query)), [items, query])
  const groups = useMemo(() => groupByServiceDay(filtered), [filtered])
  const speakers = useMemo(() => {
    const names = new Set<string>()
    for (const item of items) {
      const name = item.speaker.trim()
      if (name) names.add(name)
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [items])
  const filterActive = filter.range !== 'all' || Boolean(filter.speaker)
  const showFilter =
    items.length >= FILTER_AFTER || Boolean(cursor) || speakers.length > 1 || filterActive
  const showLoadMore = Boolean(cursor) && items.length >= PAGINATE_AFTER && !query.trim()

  const load = useCallback(
    async (options: { cursor?: string | null; initial: boolean; filter?: ListFilter }) => {
      if (!orgId) {
        setLoading(false)
        return
      }
      const active = options.filter ?? filter
      try {
        const params = new URLSearchParams()
        params.set('limit', String(PAGE_SIZE))
        if (options.cursor) params.set('cursor', options.cursor)
        const filterQuery = statsQuery({
          range: active.range,
          ...boundsForRange(active.range),
          speaker: active.speaker,
        })
        const page = await request<SermonListPage>(
          `/v1/orgs/${orgId}/sermons?${params.toString()}${filterQuery ? `&${filterQuery}` : ''}`,
        )
        if (cancelled.current) return
        setItems((current) => (options.cursor ? [...current, ...page.items] : page.items))
        setCursor(page.nextCursor)
        setError(null)
      } catch (failure) {
        if (cancelled.current) return
        if (options.initial) {
          setError(failure instanceof ApiError ? failure.message : 'Could not load sermons.')
        }
      } finally {
        if (!cancelled.current && options.initial) setLoading(false)
      }
    },
    [filter, orgId, request],
  )

  useEffect(() => {
    cancelled.current = false
    setLoading(true)
    setCursor(null)
    void load({ initial: true })
    return () => {
      cancelled.current = true
    }
  }, [load])

  useEffect(() => {
    return onSermonsChanged((change) => {
      if (change.type === 'forget') {
        setItems((current) => current.filter((item) => item.id !== change.id))
        return
      }
      const next = listItemFrom(change.detail)
      setItems((current) => {
        const index = current.findIndex((item) => item.id === next.id)
        if (index < 0) return current
        const copy = current.slice()
        copy[index] = { ...copy[index], ...next }
        return copy
      })
    })
  }, [])

  useLayoutEffect(() => {
    if (!compact || !openId) {
      setBar(null)
      setSlide(false)
      return
    }
    const root = listRef.current
    const row = rowRefs.current.get(openId)
    if (!root || !row) return

    const place = (): void => {
      const next = {
        top: Math.round(row.getBoundingClientRect().top - root.getBoundingClientRect().top),
        height: Math.round(row.getBoundingClientRect().height),
      }
      setBar((current) =>
        current && current.top === next.top && current.height === next.height ? current : next,
      )
    }

    place()
    const frame = requestAnimationFrame(() => setSlide(true))
    const observer = new ResizeObserver(place)
    observer.observe(root)
    observer.observe(row)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [compact, openId, filtered])

  useEffect(() => {
    if (!compact || !openId || scrolledTo.current === openId) return
    const row = rowRefs.current.get(openId)
    if (!row) return
    row.scrollIntoView({
      block: 'nearest',
      behavior: scrolledTo.current ? 'smooth' : 'instant',
    })
    scrolledTo.current = openId
  }, [compact, openId, filtered])

  const hasPending = items.some((item) => item.status === 'pending')
  useVisibleInterval(() => void load({ initial: false }), PENDING_POLL_MS, hasPending)

  const prefetch = (id: string): void => {
    if (!orgId || peekSermon(id)) return
    void request<SermonDetail>(`/v1/orgs/${orgId}/sermons/${id}`)
      .then(rememberSermon)
      .catch(() => undefined)
  }

  const loadMore = async (): Promise<void> => {
    if (!cursor) return
    setLoadingMore(true)
    await load({ cursor, initial: false })
    setLoadingMore(false)
  }

  const saveMeta = async (input: { headline: string; speaker: string; title: string }): Promise<void> => {
    if (!orgId || !renaming) return
    setMetaBusy(true)
    setMetaError(null)
    try {
      const detail = await request<SermonDetail>(`/v1/orgs/${orgId}/sermons/${renaming.id}`, {
        method: 'PATCH',
        body: {
          speaker: input.speaker,
          title: input.title,
          ...(renaming.status === 'ready' || renaming.headline ? { headline: input.headline } : {}),
        },
      })
      rememberSermon(detail)
      setRenaming(null)
    } catch (failure) {
      setMetaError(failure instanceof ApiError ? failure.message : 'That did not work.')
    } finally {
      setMetaBusy(false)
    }
  }

  const removeSermon = async (): Promise<void> => {
    if (!orgId || !deleting) return
    const id = deleting.id
    setMetaBusy(true)
    setMetaError(null)
    try {
      await request(`/v1/orgs/${orgId}/sermons/${id}`, { method: 'DELETE' })
      forgetSermon(id)
      setDeleting(null)
      if (openId === id) router.push('/dashboard/sermons')
    } catch (failure) {
      setMetaError(failure instanceof ApiError ? failure.message : 'That did not work.')
    } finally {
      setMetaBusy(false)
    }
  }

  function body(): React.ReactElement {
    if (loading) {
      return (
        <div className={cn('flex flex-col gap-5', compact ? 'px-3 pt-4' : 'pt-2')}>
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex gap-3">
              {compact ? (
                <div className="flex w-9 shrink-0 flex-col items-center gap-1 pt-1">
                  <div className="h-5 w-6 rounded bg-white/[0.06]" />
                  <div className="h-2 w-7 rounded bg-white/[0.04]" />
                </div>
              ) : null}
              <div className="flex flex-1 flex-col gap-2 py-1">
                <div className="h-3.5 w-4/5 rounded bg-white/[0.06]" />
                <div className="h-2.5 w-1/2 rounded bg-white/[0.04]" />
              </div>
            </div>
          ))}
        </div>
      )
    }

    if (!orgId) {
      return <p className={cn('text-sm text-muted-foreground', compact && 'px-3 pt-4')}>Link a church first.</p>
    }

    if (error) {
      return (
        <div className={cn(compact && 'px-3 pt-4')}>
          <p className="text-sm text-destructive">{error}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={() => void load({ initial: true })}
          >
            Try again
          </Button>
        </div>
      )
    }

    if (items.length === 0) {
      return (
        <div className={cn(compact ? 'px-3 pt-6' : 'py-6 text-center')}>
          <p className="text-sm leading-relaxed text-muted-foreground">
            No recaps yet. End a service in the Kairo desktop app and its recap appears here.
          </p>
          <Link
            href="/dashboard/download"
            className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline"
          >
            Get the desktop app
          </Link>
        </div>
      )
    }

    if (filtered.length === 0) {
      return (
        <p className={cn('text-sm text-muted-foreground', compact ? 'px-3 py-6' : 'py-6 text-center')}>
          No recaps match “{query.trim()}”.
        </p>
      )
    }

    return (
      <>
        <div ref={listRef} className={cn('relative', compact ? 'px-2 pb-4 pt-2' : 'pt-1')}>
          {compact && bar ? (
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute right-0 z-10 w-[2px] rounded-full bg-primary shadow-[0_0_12px_rgba(245,158,11,0.45)]',
                slide && 'transition-[top,height] duration-300 ease-out motion-reduce:transition-none',
              )}
              style={{ top: bar.top, height: bar.height }}
            />
          ) : null}

          <div className="flex flex-col gap-6">
            {groups.map((group, groupIndex) => {
              const stamp = splitDay(group.day)
              return (
                <section
                  key={group.day}
                  className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-300"
                  style={{ animationDelay: `${Math.min(groupIndex, 4) * 40}ms` }}
                >
                  {compact ? (
                    <div className="mb-2 flex items-end gap-2.5 px-1">
                      <span className="font-display text-[22px] leading-none font-semibold tracking-tight text-paper">
                        {stamp.day}
                      </span>
                      <span className="pb-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
                        {stamp.month}
                        <span className="mx-1.5 text-white/15">·</span>
                        {stamp.weekday}
                        {group.items.length === 1 ? (
                          <>
                            <span className="mx-1.5 text-white/15">·</span>
                            <span className="normal-case tracking-normal">
                              {formatServiceTime(group.items[0]!.preachedAt)}
                            </span>
                          </>
                        ) : null}
                      </span>
                      <span className="mb-1.5 h-px flex-1 bg-gradient-to-r from-white/12 to-transparent" />
                    </div>
                  ) : (
                    <h2 className="mb-2 px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      {formatGroupDay(group.day)}
                    </h2>
                  )}

                  <ul className="flex flex-col gap-0.5">
                    {group.items.map((item) => (
                      <li
                        key={item.id}
                        ref={(node) => {
                          if (node) rowRefs.current.set(item.id, node)
                          else rowRefs.current.delete(item.id)
                        }}
                      >
                        <SermonRow
                          item={item}
                          open={item.id === openId}
                          compact={compact}
                          canEdit={canEdit}
                          canDelete={canDelete}
                          onPrefetch={prefetch}
                          onRename={(next) => {
                            setMetaError(null)
                            setRenaming(next)
                          }}
                          onDelete={(next) => {
                            setMetaError(null)
                            setDeleting(next)
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        </div>

        {showLoadMore ? (
          <div className={cn(compact ? 'px-3 pb-4' : 'mt-4')}>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        ) : null}
      </>
    )
  }

  return (
    <div className="flex min-h-0 flex-col">
      {items.length > 0 || query || filterActive ? (
        <div
          className={cn(
            compact
              ? 'sticky top-0 z-20 border-b border-white/10 bg-background/90 px-3 py-3 backdrop-blur-md'
              : 'mb-5',
          )}
        >
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search title, preacher…"
                aria-label="Search recaps"
                className={cn(
                  'h-9 bg-white/[0.03] pr-8 pl-8 text-[13px] placeholder:text-faint',
                  'border-white/10 focus-visible:border-primary/40 focus-visible:ring-primary/20',
                )}
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-faint transition-colors hover:text-paper"
                  onClick={() => setQuery('')}
                >
                  <XIcon className="size-3.5" />
                </button>
              ) : null}
            </div>
            {showFilter ? (
              <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Filter recaps"
                      className={cn(
                        'size-9 shrink-0 border-white/10 bg-white/[0.03]',
                        filterActive && 'border-primary/40 text-primary',
                      )}
                    />
                  }
                >
                  <ListFilterIcon className="size-3.5" />
                </PopoverTrigger>
                <PopoverContent align="end" className="flex w-64 flex-col gap-3">
                  <div>
                    <p className="px-1 text-[11px] font-medium text-muted-foreground">When</p>
                    <div className="mt-1 flex flex-col">
                      {RANGE_OPTIONS.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          className={cn(
                            'flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm outline-none hover:bg-accent',
                            filter.range === option.key && 'bg-accent/60',
                          )}
                          onClick={() => {
                            setFilter((current) => ({ ...current, range: option.key }))
                            setFilterOpen(false)
                          }}
                        >
                          <span className="flex-1">{option.label}</span>
                          {filter.range === option.key ? <CheckIcon className="size-3.5" /> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                  {speakers.length > 0 ? (
                    <div>
                      <p className="px-1 text-[11px] font-medium text-muted-foreground">Preacher</p>
                      <div className="mt-1 flex max-h-40 flex-col overflow-y-auto">
                        <button
                          type="button"
                          className={cn(
                            'flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm outline-none hover:bg-accent',
                            !filter.speaker && 'bg-accent/60',
                          )}
                          onClick={() => {
                            setFilter((current) => ({ ...current, speaker: '' }))
                            setFilterOpen(false)
                          }}
                        >
                          <span className="flex-1">All preachers</span>
                          {!filter.speaker ? <CheckIcon className="size-3.5" /> : null}
                        </button>
                        {speakers.map((name) => (
                          <button
                            key={name}
                            type="button"
                            className={cn(
                              'flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm outline-none hover:bg-accent',
                              filter.speaker === name && 'bg-accent/60',
                            )}
                            onClick={() => {
                              setFilter((current) => ({ ...current, speaker: name }))
                              setFilterOpen(false)
                            }}
                          >
                            <span className="flex-1 truncate">{name}</span>
                            {filter.speaker === name ? <CheckIcon className="size-3.5" /> : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {filterActive ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-start"
                      onClick={() => {
                        setFilter({ range: 'all', speaker: '' })
                        setFilterOpen(false)
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : null}
                </PopoverContent>
              </Popover>
            ) : null}
          </div>
        </div>
      ) : null}

      {body()}

      {renaming ? (
        <EditRecapDialog
          sermon={renaming}
          open
          busy={metaBusy}
          error={metaError}
          onOpenChange={(open) => {
            if (!open) {
              setRenaming(null)
              setMetaError(null)
            }
          }}
          onSave={(input) => void saveMeta(input)}
        />
      ) : null}
      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null)
            setMetaError(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this recap?</DialogTitle>
            <DialogDescription>
              {deleting
                ? `${deleting.headline ?? deleting.title} will be removed, along with its transcript and any share link.`
                : 'This recap will be removed.'}
            </DialogDescription>
          </DialogHeader>
          {metaError ? <p className="text-sm text-destructive">{metaError}</p> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={metaBusy}
              onClick={() => {
                setDeleting(null)
                setMetaError(null)
              }}
            >
              Keep it
            </Button>
            <Button type="button" variant="destructive" disabled={metaBusy} onClick={() => void removeSermon()}>
              {metaBusy ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
