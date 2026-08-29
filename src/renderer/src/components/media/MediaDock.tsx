import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Film,
  Folder,
  Image as ImageIcon,
  ListMusic,
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { overlayMediaUrl } from '@shared/overlay-template'
import { mediaFilterCss, normalizeMediaPlayback } from '@shared/media-playback'
import type { MediaItem, MediaLibrary, MediaPlayback } from '@shared/ipc'

// ─── Sizing ───────────────────────────────────────────────────────────────────
// The dock is dragged, so these are the stops rather than a fixed height. The
// collapsed rail still says what is on screen — that is its whole job.

const RAIL_HEIGHT = 50
const MIN_HEIGHT = 180
const HARD_MAX_HEIGHT = 520
const DEFAULT_HEIGHT = 288
const STORAGE_KEY = 'media-dock-height'

/**
 * Room kept for the page above. Pages scroll their own panels rather than
 * colliding now, so this is only about staying usable — not about protecting a
 * layout that cannot cope.
 */
const MIN_PAGE_HEIGHT = 300

/** Title bar and tab strip above the routed page — not space the dock can take. */
const APP_CHROME_HEIGHT = 44

/** Room the window can actually give the dock, once the page keeps its floor. */
function availableRoom(): number {
  return window.innerHeight - APP_CHROME_HEIGHT - MIN_PAGE_HEIGHT
}

/** Tallest the dock may be right now — bounded by the window, not just a constant. */
function maxHeight(): number {
  return Math.max(MIN_HEIGHT, Math.min(HARD_MAX_HEIGHT, availableRoom()))
}

function clampHeight(value: number): number {
  return Math.min(maxHeight(), Math.max(MIN_HEIGHT, value))
}

function storedHeight(): number {
  const raw = Number(window.localStorage.getItem(STORAGE_KEY))
  if (!Number.isFinite(raw) || raw <= 0) return clampHeight(DEFAULT_HEIGHT)
  return clampHeight(raw)
}

const EMPTY_LIBRARY: MediaLibrary = {
  folder: '',
  folders: [],
  items: [],
  playlists: [],
  playback: {},
  liveItemId: null,
  error: null,
}

/** What the sidebar is pointed at: the whole library, or one playlist. */
type Selection = { kind: 'all' } | { kind: 'playlist'; id: string }

// ─── Dock ─────────────────────────────────────────────────────────────────────

export default function MediaDock(): React.ReactElement {
  const [library, setLibrary] = useState<MediaLibrary>(EMPTY_LIBRARY)
  const [height, setHeight] = useState(storedHeight)
  const [collapsed, setCollapsed] = useState(true)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Files Chromium refused to decode — ProRes and HAP land here. */
  const [undecodable, setUndecodable] = useState<Set<string>>(() => new Set())
  /**
   * Naming happens inline. Electron does not implement `window.prompt`, so a
   * prompt-based flow silently does nothing — and an input in the list is the
   * better interaction anyway.
   */
  const [draft, setDraft] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [addingMedia, setAddingMedia] = useState(false)
  /**
   * Live height during a drag. State alone would re-enter this callback on every
   * pointermove and read a stale `height` from the closure — the old version
   * persisted the wrong value on release for exactly that reason.
   */
  const heightRef = useRef(height)
  const frameRef = useRef<number | null>(null)

  // ── Library ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    window.api.media
      .getLibrary()
      .then((next) => { if (!cancelled) setLibrary(next) })
      .catch(() => undefined)
    const off = window.api.media.onLibraryChange(setLibrary)
    return () => { cancelled = true; off() }
  }, [])

  const liveItem = useMemo(
    () => library.items.find((item) => item.id === library.liveItemId) ?? null,
    [library.items, library.liveItemId]
  )

  // Default to the whole library once a folder has been chosen.
  useEffect(() => {
    if (selection || !library.folder) return
    setSelection({ kind: 'all' })
  }, [library.folder, selection])

  const { visibleItems, missingIds } = useMemo((): { visibleItems: MediaItem[]; missingIds: string[] } => {
    if (!selection || selection.kind === 'all') {
      return { visibleItems: library.items, missingIds: [] }
    }
    const playlist = library.playlists.find((p) => p.id === selection.id)
    if (!playlist) return { visibleItems: [], missingIds: [] }

    // Playlist order is the operator's, so map ids rather than filtering items.
    // Ids that no longer resolve are counted, not dropped — a playlist that
    // quietly shrinks is how you find out mid-service that a file was renamed.
    const resolved: MediaItem[] = []
    const missing: string[] = []
    for (const id of playlist.itemIds) {
      const item = library.items.find((candidate) => candidate.id === id)
      if (item) resolved.push(item)
      else missing.push(id)
    }
    return { visibleItems: resolved, missingIds: missing }
  }, [library, selection])

  // ── Drag to resize ─────────────────────────────────────────────────────────
  useEffect(() => { heightRef.current = height }, [height])

  // A window that got shorter can leave the dock taller than the page allows —
  // and when there is no room at all the dock puts itself away rather than
  // squeezing the page into the state where its panels overlap.
  useEffect(() => {
    const onResize = (): void => {
      if (availableRoom() < MIN_HEIGHT) setCollapsed(true)
      setHeight((current) => clampHeight(current))
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const beginDrag = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const handle = event.currentTarget
    // Pointer capture keeps the drag alive over the iframe-free but
    // pointer-hungry content below, and guarantees we get the release event.
    handle.setPointerCapture(event.pointerId)

    const startY = event.clientY
    const wasCollapsed = collapsed
    const startHeight = wasCollapsed ? MIN_HEIGHT : heightRef.current
    let released = false

    const apply = (clientY: number): void => {
      // Dragging UP grows the dock, so the delta is inverted.
      const next = clampHeight(startHeight + (startY - clientY))
      heightRef.current = next
      // One state write per frame — pointermove fires far faster than paint,
      // and the unthrottled version is what made the resize feel like it stuttered.
      if (frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = null
          setHeight(heightRef.current)
        })
      }
    }

    const move = (moveEvent: PointerEvent): void => {
      if (released) return
      // No room to open into — stay a rail rather than break the page above.
      if (wasCollapsed && availableRoom() < MIN_HEIGHT) return
      if (wasCollapsed && moveEvent.clientY < startY - 8) setCollapsed(false)
      apply(moveEvent.clientY)
    }

    const finish = (upEvent: PointerEvent): void => {
      if (released) return
      released = true
      handle.releasePointerCapture?.(event.pointerId)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      setHeight(heightRef.current)

      // A decisive downward drag puts it away; a click that never moved toggles.
      const travel = upEvent.clientY - startY
      if (travel > 60) setCollapsed(true)
      else if (Math.abs(travel) < 4 && wasCollapsed) setCollapsed(false)
      else if (!wasCollapsed) window.localStorage.setItem(STORAGE_KEY, String(Math.round(heightRef.current)))
    }

    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
  }, [collapsed])

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
  }, [])

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Clicking a background IS the push — no confirm step, one gesture mid-song. */
  const pushItem = useCallback(async (item: MediaItem): Promise<void> => {
    setBusyId(item.id)
    setError(null)
    try {
      const { applied } = await window.api.media.push(item.id)
      if (!applied) {
        setError('Could not send to ProPresenter — check NDI and the video input on the Look.')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }, [])

  const clearBackground = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      await window.api.media.clear()
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const chooseFolder = useCallback(async (): Promise<void> => {
    try {
      const next = await window.api.media.chooseFolder()
      setLibrary(next)
      setSelection(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const createPlaylist = useCallback(async (name: string): Promise<void> => {
    setDraft(false)
    setError(null)
    try {
      const previous = new Set(library.playlists.map((playlist) => playlist.id))
      const next = await window.api.media.createPlaylist(name)
      setLibrary(next)
      const created = next.playlists.find((playlist) => !previous.has(playlist.id))
      if (created) setSelection({ kind: 'playlist', id: created.id })
    } catch (err) {
      setError((err as Error).message)
    }
  }, [library.playlists])

  const renamePlaylist = useCallback(async (id: string, name: string): Promise<void> => {
    setRenamingId(null)
    try {
      setLibrary(await window.api.media.renamePlaylist(id, name))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const deletePlaylist = useCallback(async (id: string, name: string): Promise<void> => {
    if (!window.confirm(`Delete the “${name}” playlist? The files stay on disk.`)) return
    const next = await window.api.media.deletePlaylist(id)
    setLibrary(next)
    setSelection(null)
  }, [])

  const addToPlaylist = useCallback(async (playlistId: string, itemId: string): Promise<void> => {
    const playlist = library.playlists.find((p) => p.id === playlistId)
    if (!playlist || playlist.itemIds.includes(itemId)) return
    setLibrary(await window.api.media.setPlaylistItems(playlistId, [...playlist.itemIds, itemId]))
  }, [library.playlists])

  const removeFromPlaylist = useCallback(async (playlistId: string, itemId: string): Promise<void> => {
    const playlist = library.playlists.find((p) => p.id === playlistId)
    if (!playlist) return
    setLibrary(await window.api.media.setPlaylistItems(
      playlistId,
      playlist.itemIds.filter((id) => id !== itemId),
    ))
  }, [library.playlists])

  const addMediaToPlaylist = useCallback(async (playlistId: string): Promise<void> => {
    setAddingMedia(true)
    setError(null)
    try {
      setLibrary(await window.api.media.addMediaToPlaylist(playlistId))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setAddingMedia(false)
    }
  }, [])

  const setPlayback = useCallback(async (itemId: string, patch: Partial<MediaPlayback>): Promise<void> => {
    setLibrary((current) => {
      const next = normalizeMediaPlayback({ ...normalizeMediaPlayback(current.playback[itemId]), ...patch })
      return { ...current, playback: { ...current.playback, [itemId]: next } }
    })
    try {
      setLibrary(await window.api.media.setPlayback(itemId, patch))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const markUndecodable = useCallback((id: string): void => {
    setUndecodable((current) => (current.has(id) ? current : new Set(current).add(id)))
  }, [])

  // ── Collapsed rail ─────────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div className="shrink-0 flex flex-col bg-surface-secondary border-t border-surface-border">
        <DragHandle onPointerDown={beginDrag} />
        <div className="flex items-center gap-3 px-5 py-2" style={{ height: RAIL_HEIGHT - 14 }}>
          <div className="flex items-center gap-1.5">
            <Film size={14} className="text-teal-400" aria-hidden="true" />
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              Background
            </span>
          </div>
          <div className="h-4 w-px bg-surface-border/80" aria-hidden="true" />
          {liveItem ? (
            <>
              <Thumb item={liveItem} className="h-[25px] w-11 rounded-[5px] border border-teal-500/55" muted />
              <span className="text-xs font-semibold text-teal-300">{liveItem.name}</span>
              <span className="text-[11px] text-slate-600">is on screen</span>
            </>
          ) : (
            <span className="text-[11px] text-slate-600">Nothing on screen</span>
          )}
          <div className="flex-1" />
          <span className="text-[11px] text-slate-600 hidden sm:inline">Drag up to change background</span>
          <button
            type="button"
            onClick={() => { if (availableRoom() >= MIN_HEIGHT) setCollapsed(false) }}
            disabled={availableRoom() < MIN_HEIGHT}
            title={availableRoom() < MIN_HEIGHT ? 'Not enough room — make the window taller' : 'Open background dock'}
            className="grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-surface-border text-slate-400 hover:text-white disabled:opacity-40"
            aria-label="Open background dock"
          >
            <ChevronUp size={13} aria-hidden="true" />
          </button>
        </div>
      </div>
    )
  }

  // ── Open dock ──────────────────────────────────────────────────────────────
  return (
    <div
      className="shrink-0 flex flex-col bg-surface-secondary border-t border-surface-border"
      style={{ height }}
    >
      <DragHandle onPointerDown={beginDrag} />

      {!library.folder ? (
        <EmptyState onChoose={chooseFolder} />
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Collections */}
          <div className="w-[196px] shrink-0 border-r border-surface-border/70 flex flex-col gap-2.5 p-2.5 overflow-y-auto">
            <div className="flex items-center justify-between gap-1.5 px-1">
              <div className="flex items-center gap-1.5">
                <Film size={13} className="text-teal-400" aria-hidden="true" />
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Background
                </span>
              </div>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { setDraft(true); setRenamingId(null) }}
                className="text-slate-500 hover:text-teal-300"
                aria-label="New playlist"
                title="New playlist"
              >
                <Plus size={12} aria-hidden="true" />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              <SidebarRow
                icon={<Film size={12} aria-hidden="true" />}
                label="All"
                count={library.items.length}
                active={selection?.kind === 'all'}
                onClick={() => setSelection({ kind: 'all' })}
              />
              {library.playlists.map((playlist) => (
                renamingId === playlist.id ? (
                  <InlineNameInput
                    key={playlist.id}
                    icon={<ListMusic size={12} aria-hidden="true" />}
                    initialValue={playlist.name}
                    placeholder="Playlist name"
                    onCommit={(name) => void renamePlaylist(playlist.id, name)}
                    onCancel={() => setRenamingId(null)}
                  />
                ) : (
                  <SidebarRow
                    key={playlist.id}
                    icon={<ListMusic size={12} aria-hidden="true" />}
                    label={playlist.name}
                    count={playlist.itemIds.length}
                    active={selection?.kind === 'playlist' && selection.id === playlist.id}
                    onClick={() => setSelection({ kind: 'playlist', id: playlist.id })}
                    onRename={() => { setRenamingId(playlist.id); setDraft(false) }}
                    onDelete={() => void deletePlaylist(playlist.id, playlist.name)}
                  />
                )
              ))}
              {draft ? (
                <InlineNameInput
                  icon={<ListMusic size={12} aria-hidden="true" />}
                  placeholder="Playlist name"
                  onCommit={(name) => void createPlaylist(name)}
                  onCancel={() => setDraft(false)}
                />
              ) : (
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => { setDraft(true); setRenamingId(null) }}
                  className="flex items-center gap-2 rounded-[7px] border border-dashed border-surface-border/90 px-2 py-1.5 text-slate-500 hover:border-teal-500/40 hover:text-teal-300"
                >
                  <Plus size={12} aria-hidden="true" />
                  <span className="text-xs">New playlist</span>
                </button>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
            <div className="flex items-center gap-3 px-5 pt-2.5 shrink-0">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-[13px] font-semibold text-slate-200 truncate">
                  {selectionLabel(selection, library)}
                </span>
                <span className="text-[11px] text-slate-600 tabular-nums shrink-0">
                  {visibleItems.length} background{visibleItems.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="flex-1" />

              {liveItem && (
                <div className="flex items-center gap-2 rounded-lg border border-teal-500/30 bg-teal-500/10 px-2.5 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden="true" />
                  <span className="text-[11px] text-teal-300">
                    On screen · <span className="font-semibold">{liveItem.name}</span>
                  </span>
                </div>
              )}

              {selection?.kind === 'playlist' && (
                <button
                  type="button"
                  onClick={() => void addMediaToPlaylist(selection.id)}
                  disabled={addingMedia}
                  className="btn-primary flex items-center gap-1.5 px-2.5 py-1.5 text-xs disabled:opacity-50"
                >
                  <Plus size={11} aria-hidden="true" />
                  {addingMedia ? 'Adding…' : 'Add media'}
                </button>
              )}

              <button type="button" onClick={() => void clearBackground()} className="btn-secondary flex items-center gap-1.5 px-2.5 py-1.5 text-xs">
                <X size={11} aria-hidden="true" /> Clear
              </button>
              <button
                type="button"
                onClick={() => void window.api.media.rescan()}
                className="grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-surface-border text-slate-400 hover:text-white"
                aria-label="Rescan folder"
                title="Rescan folder"
              >
                <RefreshCw size={12} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-surface-border text-slate-400 hover:text-white"
                aria-label="Collapse background dock"
              >
                <ChevronDown size={13} aria-hidden="true" />
              </button>
            </div>

            {(error || library.error) && (
              <p className="mx-5 mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-300">
                <AlertTriangle size={11} className="mt-px shrink-0" aria-hidden="true" />
                <span>{library.error ?? error}</span>
              </p>
            )}

            {missingIds.length > 0 && (
              <p className="mx-5 mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-300">
                <AlertTriangle size={11} className="mt-px shrink-0" aria-hidden="true" />
                <span>
                  {missingIds.length} item{missingIds.length === 1 ? '' : 's'} in this playlist
                  {missingIds.length === 1 ? ' is' : ' are'} no longer in the folder
                  {' — '}
                  <span className="text-amber-200/80">{missingIds.slice(0, 3).join(', ')}</span>
                  {missingIds.length > 3 ? '…' : ''}
                </span>
              </p>
            )}

            <div className="grid flex-1 min-h-0 content-start items-start gap-x-3.5 gap-y-3 overflow-y-auto px-5 py-2.5 [grid-template-columns:repeat(auto-fill,minmax(168px,1fr))]">
              {visibleItems.length === 0 && selection?.kind !== 'playlist' && (
                <p className="col-span-full text-xs text-slate-500">
                  No backgrounds yet — drop files in the folder, or open a playlist and add media.
                </p>
              )}
              {visibleItems.map((item) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  live={item.id === library.liveItemId}
                  busy={item.id === busyId}
                  undecodable={undecodable.has(item.id)}
                  playlists={library.playlists}
                  playback={normalizeMediaPlayback(library.playback[item.id])}
                  onPush={() => void pushItem(item)}
                  onPlaybackChange={(patch) => void setPlayback(item.id, patch)}
                  onAddToPlaylist={(playlistId) => void addToPlaylist(playlistId, item.id)}
                  onRemoveFromPlaylist={
                    selection?.kind === 'playlist'
                      ? () => void removeFromPlaylist(selection.id, item.id)
                      : undefined
                  }
                  onUndecodable={() => markUndecodable(item.id)}
                />
              ))}
              {selection?.kind === 'playlist' && (
                <button
                  type="button"
                  onClick={() => void addMediaToPlaylist(selection.id)}
                  disabled={addingMedia}
                  className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-surface-border/90 text-slate-500 hover:border-teal-500/40 hover:text-teal-300 disabled:opacity-50"
                >
                  <Plus size={18} aria-hidden="true" />
                  <span className="text-xs font-medium">
                    {addingMedia ? 'Adding…' : 'Add media'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function DragHandle({ onPointerDown }: { onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void }): React.ReactElement {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize background dock"
      onPointerDown={onPointerDown}
      className="h-3.5 shrink-0 grid place-items-center bg-surface-tertiary/50 cursor-ns-resize touch-none"
    >
      <div className="h-[3px] w-[46px] rounded-full bg-teal-500/55" />
    </div>
  )
}

function SidebarRow({
  icon,
  label,
  count,
  active,
  onClick,
  onRename,
  onDelete,
}: {
  icon: React.ReactNode
  label: string
  count: number
  active: boolean
  onClick: () => void
  onRename?: () => void
  onDelete?: () => void
}): React.ReactElement {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onDoubleClick={onRename}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick()
        if (e.key === 'F2' && onRename) onRename()
      }}
      className={cn(
        'group flex cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 border transition-colors',
        active
          ? 'bg-teal-500/12 border-teal-500/30 text-teal-300'
          : 'border-transparent text-slate-400 hover:bg-surface-tertiary'
      )}
    >
      <span className={cn('shrink-0', active ? 'text-teal-300' : 'text-slate-500')}>{icon}</span>
      <span className="flex-1 truncate text-xs font-medium">{label}</span>
      {onRename ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRename() }}
          className="hidden shrink-0 text-slate-500 hover:text-teal-300 group-hover:block"
          aria-label={`Rename ${label}`}
          title="Rename"
        >
          <Pencil size={11} aria-hidden="true" />
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="hidden shrink-0 text-slate-500 hover:text-red-400 group-hover:block"
          aria-label={`Delete ${label}`}
        >
          <Trash2 size={11} aria-hidden="true" />
        </button>
      ) : null}
      <span className={cn('shrink-0 text-[10px] tabular-nums', active ? 'text-teal-300/70' : 'text-slate-600')}>
        {count}
      </span>
    </div>
  )
}

/**
 * Names a new folder or playlist in place.
 *
 * Electron does not implement `window.prompt`, and blur-to-commit fights both
 * Strict Mode remounts and the click that opened this row — the input would
 * mount, blur empty, and vanish. Save / Enter commit; Cancel / Escape abandon.
 */
function InlineNameInput({
  icon,
  initialValue = '',
  placeholder,
  onCommit,
  onCancel,
}: {
  icon: React.ReactNode
  initialValue?: string
  placeholder: string
  onCommit: (name: string) => void
  onCancel: () => void
}): React.ReactElement {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const settled = useRef(false)

  useEffect(() => {
    const node = inputRef.current
    if (!node) return
    const id = window.requestAnimationFrame(() => {
      node.focus()
      node.select()
      node.scrollIntoView({ block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(id)
  }, [])

  const commit = (): void => {
    if (settled.current) return
    const name = value.trim()
    if (!name) return
    settled.current = true
    onCommit(name)
  }

  const cancel = (): void => {
    if (settled.current) return
    settled.current = true
    onCancel()
  }

  return (
    <div
      className="flex flex-col gap-1.5 rounded-[7px] border border-teal-500/40 bg-surface-tertiary px-2 py-1.5"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-teal-300">{icon}</span>
        <input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              cancel()
            }
          }}
          className="w-full min-w-0 bg-transparent text-xs font-medium text-white outline-none placeholder:text-slate-500"
          aria-label={placeholder}
        />
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={commit}
          disabled={!value.trim()}
          className="flex flex-1 items-center justify-center gap-1 rounded-md border border-teal-500/30 bg-teal-500/10 px-2 py-1 text-[10px] font-semibold text-teal-300 hover:bg-teal-500/15 disabled:opacity-40"
        >
          <Check size={11} aria-hidden="true" />
          Save
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={cancel}
          className="rounded-md px-2 py-1 text-[10px] font-semibold text-slate-400 hover:bg-surface-secondary hover:text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * A background tile. Clicking pushes it — the card IS the button, matching the
 * lyrics slide grid where clicking a slide puts it on screen.
 */
function MediaCard({
  item,
  live,
  busy,
  undecodable,
  playlists,
  playback,
  onPush,
  onPlaybackChange,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onUndecodable,
}: {
  item: MediaItem
  live: boolean
  busy: boolean
  undecodable: boolean
  playlists: MediaLibrary['playlists']
  playback: MediaPlayback
  onPush: () => void
  onPlaybackChange: (patch: Partial<MediaPlayback>) => void
  onAddToPlaylist: (playlistId: string) => void
  onRemoveFromPlaylist?: () => void
  onUndecodable: () => void
}): React.ReactElement {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const filter = mediaFilterCss(playback)

  return (
    <div className="relative flex min-w-0 flex-col gap-1.5">
      <button
        type="button"
        onClick={onPush}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setMenu({ x: event.clientX, y: event.clientY })
        }}
        title={`Push ${item.name} to screen`}
        aria-label={`Push ${item.name} to screen`}
        className={cn(
          'relative w-full aspect-video overflow-hidden rounded-xl bg-black border transition-all duration-150',
          live
            ? 'border-teal-400/70 ring-1 ring-teal-400/40'
            : 'border-white/[0.08] hover:border-teal-500/40 hover:ring-1 hover:ring-teal-500/20',
          busy && 'opacity-70'
        )}
      >
        <Thumb
          item={item}
          className="absolute inset-0 h-full w-full object-cover"
          style={filter ? { filter } : undefined}
          onError={onUndecodable}
        />

        {live && (
          <span className="absolute left-1.5 top-1.5 rounded border border-teal-500/45 bg-teal-500/20 px-1.5 py-px text-[8px] font-bold uppercase tracking-[0.14em] text-teal-300">
            Live
          </span>
        )}

        {item.kind === 'video' && playback.loop && (
          <span
            className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded border border-teal-500/45 bg-black/55 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-teal-300"
            title="Loops"
          >
            <Repeat size={8} aria-hidden="true" />
            Loop
          </span>
        )}

        {undecodable && (
          <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-amber-500/20 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-amber-200">
            <AlertTriangle size={8} aria-hidden="true" /> Can’t play
          </span>
        )}
      </button>

      <div className="flex items-center gap-1.5">
        {item.kind === 'video'
          ? <Film size={10} className="shrink-0 text-slate-600" aria-hidden="true" />
          : <ImageIcon size={10} className="shrink-0 text-slate-600" aria-hidden="true" />}
        <span className={cn('truncate text-[11px]', live ? 'font-semibold text-teal-300' : 'text-slate-300')}>
          {item.name}
        </span>
      </div>

      {menu && (
        <ItemMenu
          x={menu.x}
          y={menu.y}
          item={item}
          playback={playback}
          playlists={playlists}
          onPlaybackChange={onPlaybackChange}
          onAddToPlaylist={onAddToPlaylist}
          onRemoveFromPlaylist={onRemoveFromPlaylist}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function ItemMenu({
  x,
  y,
  item,
  playback,
  playlists,
  onPlaybackChange,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onClose,
}: {
  x: number
  y: number
  item: MediaItem
  playback: MediaPlayback
  playlists: MediaLibrary['playlists']
  onPlaybackChange: (patch: Partial<MediaPlayback>) => void
  onAddToPlaylist: (playlistId: string) => void
  onRemoveFromPlaylist?: () => void
  onClose: () => void
}): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const left = Math.min(x, Math.max(8, window.innerWidth - 268))
  const top = Math.min(y, Math.max(8, window.innerHeight - 320))

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={rootRef}
      role="menu"
      className="fixed z-[80] w-[252px] overflow-hidden rounded-xl border border-surface-border bg-surface-elevated py-1 shadow-2xl"
      style={{ left, top }}
    >
      {item.kind === 'video' && (
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={playback.loop}
          onClick={() => onPlaybackChange({ loop: !playback.loop })}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-200 hover:bg-surface-tertiary"
        >
          <Repeat size={12} className={playback.loop ? 'text-teal-300' : 'text-slate-500'} aria-hidden="true" />
          <span className="flex-1">Loop</span>
          {playback.loop && <Check size={12} className="text-teal-300" aria-hidden="true" />}
        </button>
      )}

      <div className="border-t border-surface-border/80 px-3 py-2.5">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Adjust color
        </p>
        <ColorSlider
          label="Brightness"
          min={0.25}
          max={1.75}
          step={0.05}
          value={playback.brightness}
          onChange={(brightness) => onPlaybackChange({ brightness })}
        />
        <ColorSlider
          label="Contrast"
          min={0.25}
          max={1.75}
          step={0.05}
          value={playback.contrast}
          onChange={(contrast) => onPlaybackChange({ contrast })}
        />
        <ColorSlider
          label="Saturation"
          min={0}
          max={2}
          step={0.05}
          value={playback.saturation}
          onChange={(saturation) => onPlaybackChange({ saturation })}
        />
      </div>

      {playlists.length > 0 && (
        <div className="border-t border-surface-border/80 py-1">
          <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Add to playlist
          </p>
          {playlists.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              onClick={() => { onAddToPlaylist(playlist.id); onClose() }}
              className="block w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-surface-tertiary hover:text-white"
            >
              {playlist.name}
            </button>
          ))}
        </div>
      )}

      {onRemoveFromPlaylist && (
        <button
          type="button"
          onClick={() => { onRemoveFromPlaylist(); onClose() }}
          className="block w-full border-t border-surface-border/80 px-3 py-2 text-left text-xs text-slate-300 hover:bg-surface-tertiary hover:text-red-400"
        >
          Remove from playlist
        </button>
      )}
    </div>,
    document.body,
  )
}

function ColorSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
}): React.ReactElement {
  return (
    <label className="mb-1.5 flex items-center gap-2 last:mb-0">
      <span className="w-[72px] shrink-0 text-[11px] text-slate-400">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-surface-border accent-teal-400"
      />
      <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-slate-500">
        {Math.round(value * 100)}%
      </span>
    </label>
  )
}

/**
 * Thumbnails come from the file itself — a paused `<video>` shows frame one, so
 * there is no thumbnail cache to build, invalidate or ship ffmpeg for. A codec
 * Chromium cannot decode fires `error`, which is how the "can't play" badge
 * knows: the check is the real decoder, not a guess from the extension.
 */
function Thumb({
  item,
  className,
  muted,
  style,
  onError,
}: {
  item: MediaItem
  className?: string
  muted?: boolean
  style?: React.CSSProperties
  onError?: () => void
}): React.ReactElement {
  const src = overlayMediaUrl(item.path)
  if (item.kind === 'image') {
    return <img src={src} alt="" className={className} style={style} onError={onError} loading="lazy" />
  }
  return (
    <video
      src={src}
      className={className}
      style={style}
      muted={muted ?? true}
      playsInline
      preload="metadata"
      onError={onError}
    />
  )
}

function EmptyState({ onChoose }: { onChoose: () => void }): React.ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex max-w-[460px] flex-col items-center gap-3 text-center">
        <div className="grid h-11 w-11 place-items-center rounded-2xl border border-teal-500/30 bg-teal-500/10">
          <Folder size={20} className="text-teal-500" aria-hidden="true" />
        </div>
        <p className="text-[15px] font-semibold text-white">Choose your backgrounds folder</p>
        <p className="text-xs leading-relaxed text-slate-400">
          Point ProAutomate at the folder your motion backgrounds already live in. Files
          already there stay put. Adding media to a playlist copies new files in.
        </p>
        <button type="button" onClick={onChoose} className="btn-primary mt-1 text-xs">
          Choose folder…
        </button>
      </div>
    </div>
  )
}

function selectionLabel(selection: Selection | null, library: MediaLibrary): string {
  if (!selection || selection.kind === 'all') return 'All backgrounds'
  return library.playlists.find((p) => p.id === selection.id)?.name ?? 'Playlist'
}
