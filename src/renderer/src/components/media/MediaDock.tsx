import { selectGesture, useMultiSelect, type SelectGesture } from '@/hooks/useMultiSelect'
import { MarqueeSelect } from '@/components/shared/MarqueeSelect'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SelectionAction, SelectionBar } from '@/components/shared/SelectionBar'
import { useImportRequest } from '@/hooks/useImportRequest'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ClipboardPaste,
  Copy,
  Film,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Images,
  Queue,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Scissors,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from '@/icons'
import { cn } from '@/lib/utils'
import { useMediaDockStore } from '@/stores/useMediaDockStore'
import { useAppStore } from '@/stores/useAppStore'
import { useSettings } from '@/hooks/useSettings'
import { DEFAULT_PRESENTATION_SETTINGS } from '@shared/program'
import { overlayMediaUrl } from '@shared/overlay-template'
import { mediaFilterCss, normalizeMediaPlayback } from '@shared/media-playback'
import { reorderIds } from '@shared/media-order'
import type { MediaItem, MediaLibrary, MediaPlayback } from '@shared/ipc'

// ─── Sizing ───────────────────────────────────────────────────────────────────
// The dock slides up from the bottom when opened from the header. Height is
// still drag-resizable; collapsing puts it away entirely (no persistent rail).

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
  // Server-rendered smoke tests have no browser viewport. Use the normal dock
  // ceiling there; the resize effect clamps against the real window on mount.
  if (typeof window === 'undefined') return HARD_MAX_HEIGHT
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
  if (typeof window === 'undefined') return clampHeight(DEFAULT_HEIGHT)
  let raw = 0
  try { raw = Number(window.localStorage.getItem(STORAGE_KEY)) } catch { /* Use default when storage is unavailable. */ }
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
  livePaused: false,
  error: null,
}

/** What the sidebar is pointed at: the whole library, or one playlist. */
type Selection = { kind: 'all' } | { kind: 'playlist'; id: string }

// ─── Dock ─────────────────────────────────────────────────────────────────────

export default function MediaDock(): React.ReactElement | null {
  const open = useMediaDockStore((state) => state.open)
  const setOpen = useMediaDockStore((state) => state.setOpen)
  const setLive = useMediaDockStore((state) => state.setLive)
  const [library, setLibrary] = useState<MediaLibrary>(EMPTY_LIBRARY)
  const [height, setHeight] = useState(storedHeight)
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
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null)
  const [addingMedia, setAddingMedia] = useState(false)
  const [canPaste, setCanPaste] = useState(false)
  /** Right-click / keyboard target for Copy · Cut. */
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  /** Right-click on empty grid chrome (not a thumbnail). */
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number } | null>(null)
  /** Id being dragged to rearrange the grid; null when idle. */
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dropPosition, setDropPosition] = useState<'before' | 'after'>('before')
  /**
   * Refs mirror the drag state so `drop` can read them after `dragend` has
   * already cleared React state — Chromium fires those in either order.
   */
  const draggingIdRef = useRef<string | null>(null)
  const dropTargetRef = useRef<{ id: string; position: 'before' | 'after' } | null>(null)
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

  useEffect(() => {
    setLive({
      id: liveItem?.id ?? null,
      name: liveItem?.name ?? null,
      paused: library.livePaused,
    })
  }, [liveItem?.id, liveItem?.name, library.livePaused, setLive])

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
      if (availableRoom() < MIN_HEIGHT) setOpen(false)
      setHeight((current) => clampHeight(current))
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [setOpen])

  const rememberHeight = (value: number): void => {
    try { window.localStorage.setItem(STORAGE_KEY, String(Math.round(value))) } catch { /* Resizing works without persistence. */ }
  }
  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    if (event.key === 'Home' || event.key === 'Escape') { setOpen(false); return }
    if (event.key === 'Enter' || event.key === ' ') {
      setOpen(false)
      return
    }
    if (availableRoom() < MIN_HEIGHT) return
    const next = event.key === 'End' ? maxHeight() : clampHeight(height + (event.key === 'ArrowUp' ? 24 : -24))
    setHeight(next); rememberHeight(next)
  }

  const beginDrag = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.focus()
    // Pointer capture keeps the drag alive over the iframe-free but
    // pointer-hungry content below, and guarantees we get the release event.
    handle.setPointerCapture(event.pointerId)

    const startY = event.clientY
    const startHeight = heightRef.current
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
      apply(moveEvent.clientY)
    }

    const finish = (upEvent: PointerEvent): void => {
      if (released) return
      released = true
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
      handle.removeEventListener('lostpointercapture', finish)
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      setHeight(heightRef.current)

      const travel = upEvent.clientY - startY
      if (upEvent.type === 'pointercancel' || upEvent.type === 'lostpointercapture') {
        setHeight(startHeight)
        return
      }
      if (Math.abs(travel) < 4) {
        return
      }
      // Dragged far enough down → dismiss the sheet.
      if (startHeight - travel < MIN_HEIGHT - 40) {
        setOpen(false)
        setHeight(startHeight)
      } else {
        rememberHeight(heightRef.current)
      }
    }

    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
    handle.addEventListener('lostpointercapture', finish)
  }, [setOpen])

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
  }, [])

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Clicking a background IS the push — no confirm step, one gesture mid-song. */
  const [presentation, savePresentation] = useSettings('presentation', DEFAULT_PRESENTATION_SETTINGS)
  const soundOn = presentation.audio.enabled
  const toggleSound = (): void => {
    void savePresentation({ ...presentation, audio: { ...presentation.audio, enabled: !soundOn } })
      .catch((err: unknown) => setError((err as Error).message))
  }

  const pushItem = useCallback(async (item: MediaItem): Promise<void> => {
    setBusyId(item.id)
    setError(null)
    try {
      // With no screen on, the background is still live — the operator's
      // preview shows it — so there is nothing to warn about here.
      await window.api.media.push(item.id)
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
      useAppStore.setState({ liveDocumentPreview: null })
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

  // ── Sidebar width ──────────────────────────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState<number>(readSidebarWidth)
  useEffect(() => {
    try { window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth)) } catch { /* per-viewer nicety only */ }
  }, [sidebarWidth])
  const beginSidebarResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    const move = (e: PointerEvent): void => setSidebarWidth(clampSidebar(startWidth + e.clientX - startX))
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /**
   * "+" makes the playlist at once and puts its name in edit, the way Finder
   * makes a folder — no dialog, no Save button. Escape keeps the default name.
   */
  const newPlaylist = async (): Promise<void> => {
    const taken = new Set(library.playlists.map((p) => p.name))
    let name = 'Untitled playlist'
    for (let n = 2; taken.has(name); n++) name = `Untitled playlist ${n}`
    const id = await createPlaylist(name)
    if (id) setRenamingId(id)
  }

  const createPlaylist = useCallback(async (name: string): Promise<string | null> => {
    setError(null)
    try {
      const previous = new Set(library.playlists.map((playlist) => playlist.id))
      const next = await window.api.media.createPlaylist(name)
      setLibrary(next)
      const created = next.playlists.find((playlist) => !previous.has(playlist.id))
      if (created) setSelection({ kind: 'playlist', id: created.id })
      return created?.id ?? null
    } catch (err) {
      setError((err as Error).message)
      return null
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

  const deleteItem = useCallback(async (item: MediaItem): Promise<void> => {
    if (!window.confirm(
      `Delete “${item.name}” from the backgrounds folder?\n\nThis removes the file from disk and cannot be undone.`,
    )) return
    setError(null)
    try {
      setLibrary(await window.api.media.deleteItem(item.id))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  // ── Bulk selection ─────────────────────────────────────────────────────────
  const visibleIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems])
  const mediaSelect = useMultiSelect<string>(visibleIds)

  const addPickedToPlaylist = useCallback(async (playlistId: string): Promise<void> => {
    const playlist = library.playlists.find((p) => p.id === playlistId)
    if (!playlist) return
    const adding = visibleIds.filter((id) => mediaSelect.selected.has(id) && !playlist.itemIds.includes(id))
    setError(null)
    try {
      setLibrary(await window.api.media.setPlaylistItems(playlistId, [...playlist.itemIds, ...adding]))
      mediaSelect.clear()
    } catch (err) {
      setError((err as Error).message)
    }
  }, [library.playlists, mediaSelect, visibleIds])

  const removePickedFromPlaylist = useCallback(async (playlistId: string): Promise<void> => {
    const playlist = library.playlists.find((p) => p.id === playlistId)
    if (!playlist) return
    setError(null)
    try {
      setLibrary(await window.api.media.setPlaylistItems(
        playlistId,
        playlist.itemIds.filter((id) => !mediaSelect.selected.has(id)),
      ))
      mediaSelect.clear()
    } catch (err) {
      setError((err as Error).message)
    }
  }, [library.playlists, mediaSelect])

  const deletePicked = useCallback(async (): Promise<void> => {
    const ids = visibleIds.filter((id) => mediaSelect.selected.has(id))
    if (ids.length === 0) return
    if (!window.confirm(
      `Delete ${ids.length} item${ids.length === 1 ? '' : 's'} from the backgrounds folder?\n\nThis removes the files from disk and cannot be undone.`,
    )) return
    setError(null)
    try {
      let next: MediaLibrary | null = null
      for (const id of ids) next = await window.api.media.deleteItem(id)
      if (next) setLibrary(next)
      mediaSelect.clear()
    } catch (err) {
      setError((err as Error).message)
    }
  }, [mediaSelect, visibleIds])

  const renameItem = useCallback(async (itemId: string, name: string): Promise<void> => {
    setRenamingItemId(null)
    setError(null)
    try {
      setLibrary(await window.api.media.renameItem(itemId, name))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const revealItem = useCallback(async (itemId: string): Promise<void> => {
    try {
      await window.api.media.revealItem(itemId)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const copyItem = useCallback(async (itemId: string): Promise<void> => {
    setError(null)
    if (typeof window.api.media.copyItems !== 'function') {
      setError('Restart Kairo to enable copy and paste.')
      return
    }
    try {
      await window.api.media.copyItems([itemId])
      setCanPaste(true)
      setSelectedItemId(itemId)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const cutItem = useCallback(async (itemId: string): Promise<void> => {
    setError(null)
    if (typeof window.api.media.cutItems !== 'function') {
      setError('Restart Kairo to enable copy and paste.')
      return
    }
    try {
      const fromPlaylistId = selection?.kind === 'playlist' ? selection.id : undefined
      await window.api.media.cutItems([itemId], fromPlaylistId)
      setCanPaste(true)
      setSelectedItemId(itemId)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [selection])

  const pasteItems = useCallback(async (): Promise<void> => {
    setError(null)
    if (typeof window.api.media.pasteItems !== 'function') {
      setError('Restart Kairo to enable copy and paste.')
      return
    }
    try {
      const playlistId = selection?.kind === 'playlist' ? selection.id : undefined
      setLibrary(await window.api.media.pasteItems(playlistId))
      const still = typeof window.api.media.clipboardHasFiles === 'function'
        ? await window.api.media.clipboardHasFiles()
        : false
      setCanPaste(still)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [selection])

  // Paste availability changes when Finder or this app puts files on the clipboard.
  useEffect(() => {
    if (typeof window.api.media.clipboardHasFiles !== 'function') return
    let cancelled = false
    const poll = (): void => {
      window.api.media
        .clipboardHasFiles()
        .then((next) => { if (!cancelled) setCanPaste(next) })
        .catch(() => undefined)
    }
    poll()
    const id = window.setInterval(poll, 2000)
    const onFocus = (): void => poll()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  // Cmd/Ctrl+C · X · V while the dock is open (capture so Edit-menu roles don't win).
  useEffect(() => {
    if (!open) return

    const typing = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null
      return Boolean(el?.closest('input, textarea, select, [contenteditable="true"]'))
    }

    const targetId = (): string | null =>
      selectedItemId ?? liveItem?.id ?? visibleItems[0]?.id ?? null

    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (typing(event.target)) return

      const key = event.key.toLowerCase()
      if (key === 'v') {
        event.preventDefault()
        event.stopPropagation()
        void pasteItems()
        return
      }
      const id = targetId()
      if (!id) return
      if (key === 'c') {
        event.preventDefault()
        event.stopPropagation()
        void copyItem(id)
      } else if (key === 'x') {
        event.preventDefault()
        event.stopPropagation()
        void cutItem(id)
      }
    }

    // Electron Edit-menu Paste synthesizes a paste event — catch that too.
    const onPaste = (event: ClipboardEvent): void => {
      if (typing(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      void pasteItems()
    }

    window.addEventListener('keydown', onKey, true)
    window.addEventListener('paste', onPaste, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('paste', onPaste, true)
    }
  }, [open, selectedItemId, liveItem?.id, visibleItems, copyItem, cutItem, pasteItems])

  /**
   * Persist a rearrange. Playlist order is the playlist's own `itemIds`
   * (including any missing entries, so a drag never quietly drops them). The
   * All-backgrounds view writes the library `itemOrder` in the media manifest.
   */
  const reorderItems = useCallback(async (
    draggedId: string,
    targetId: string,
    position: 'before' | 'after',
  ): Promise<void> => {
    if (draggedId === targetId) return
    setError(null)
    try {
      if (selection?.kind === 'playlist') {
        const playlist = library.playlists.find((p) => p.id === selection.id)
        if (!playlist) return
        const nextIds = reorderIds(playlist.itemIds, draggedId, targetId, position)
        if (nextIds.join('\0') === playlist.itemIds.join('\0')) return
        // Optimistic — the grid should move under the pointer before IPC returns.
        setLibrary((current) => ({
          ...current,
          playlists: current.playlists.map((p) =>
            p.id === selection.id ? { ...p, itemIds: nextIds } : p,
          ),
        }))
        setLibrary(await window.api.media.setPlaylistItems(selection.id, nextIds))
        return
      }
      const currentIds = library.items.map((item) => item.id)
      const nextIds = reorderIds(currentIds, draggedId, targetId, position)
      if (nextIds.join('\0') === currentIds.join('\0')) return
      const byId = new Map(library.items.map((item) => [item.id, item]))
      const optimistic = nextIds
        .map((id) => byId.get(id))
        .filter((item): item is MediaItem => Boolean(item))
      setLibrary((current) => ({ ...current, items: optimistic }))
      setLibrary(await window.api.media.setItemOrder(nextIds))
    } catch (err) {
      setError((err as Error).message)
      // Pull the real library back if the write failed.
      try {
        setLibrary(await window.api.media.getLibrary())
      } catch {
        /* keep the error already shown */
      }
    }
  }, [library.items, library.playlists, selection])

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

  useImportRequest(['image', 'video'], async kind => {
    setAddingMedia(true)
    setError(null)
    try {
      setLibrary(await window.api.media.importFiles(kind as 'image' | 'video'))
      setSelection({ kind: 'all' })
    } catch (err) { setError((err as Error).message) }
    finally { setAddingMedia(false) }
  }, !addingMedia)

  const setPaused = useCallback(async (paused: boolean): Promise<void> => {
    setLibrary((current) => ({ ...current, livePaused: paused }))
    try {
      setLibrary(await window.api.media.setPaused(paused))
    } catch (err) {
      setError((err as Error).message)
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

  return (
    <div
      className={cn(
        'grid shrink-0 overflow-hidden bg-surface transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
        open ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      style={{ gridTemplateRows: open ? `${height}px` : '0px' }}
      aria-hidden={!open}
    >
      <div className="flex min-h-0 flex-col overflow-hidden">
        <DragHandle onPointerDown={beginDrag} onKeyDown={resizeWithKeyboard} height={height} maximum={maxHeight()} />

        {!library.folder ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <button type="button" onClick={() => setOpen(false)} className="self-end px-4 py-1 text-xs text-slate-400 hover:text-white">Close media</button>
          <EmptyState onChoose={chooseFolder} />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Collections — resizable, like a Finder sidebar */}
          <div
            className="relative flex shrink-0 flex-col overflow-y-auto bg-surface-secondary py-2"
            style={{ width: sidebarWidth }}
          >
            <SidebarHeading>Library</SidebarHeading>
            <SidebarRow
              icon={<Images size={13} aria-hidden="true" />}
              label="All backgrounds"
              count={library.items.length}
              active={selection?.kind === 'all'}
              onClick={() => setSelection({ kind: 'all' })}
            />

            <SidebarHeading
              action={
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void newPlaylist()}
                  className="grid h-5 w-5 place-items-center text-slate-500 hover:bg-surface-tertiary hover:text-slate-200"
                  aria-label="New playlist"
                  title="New playlist"
                >
                  <Plus size={12} aria-hidden="true" />
                </button>
              }
            >
              Playlists
            </SidebarHeading>
            {library.playlists.map((playlist) => (
              renamingId === playlist.id ? (
                <div key={playlist.id} className="px-1.5">
                  <InlineNameInput
                    icon={<Queue size={13} aria-hidden="true" />}
                    initialValue={playlist.name}
                    placeholder="Playlist name"
                    actions={false}
                    onCommit={(name) => void renamePlaylist(playlist.id, name)}
                    onCancel={() => setRenamingId(null)}
                  />
                </div>
              ) : (
                <SidebarRow
                  key={playlist.id}
                  icon={<Queue size={13} aria-hidden="true" />}
                  label={playlist.name}
                  count={playlist.itemIds.length}
                  active={selection?.kind === 'playlist' && selection.id === playlist.id}
                  onClick={() => setSelection({ kind: 'playlist', id: playlist.id })}
                  onRename={() => setRenamingId(playlist.id)}
                  onDelete={() => void deletePlaylist(playlist.id, playlist.name)}
                />
              )
            ))}
            {library.playlists.length === 0 && (
              <button
                type="button"
                onClick={() => void newPlaylist()}
                className="mx-1.5 flex items-center gap-2 px-2 py-1.5 text-left text-[12px] text-slate-500 hover:bg-surface-tertiary hover:text-slate-200"
              >
                <Plus size={12} aria-hidden="true" /> New playlist
              </button>
            )}

            {/* Resize edge */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize media sidebar"
              aria-valuenow={sidebarWidth}
              aria-valuemin={SIDEBAR_MIN}
              aria-valuemax={SIDEBAR_MAX}
              tabIndex={0}
              onPointerDown={beginSidebarResize}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') setSidebarWidth((w) => clampSidebar(w - 16))
                if (event.key === 'ArrowRight') setSidebarWidth((w) => clampSidebar(w + 16))
              }}
              className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize hover:bg-slate-600 focus-visible:bg-slate-500 focus-visible:outline-none"
            />
          </div>

          {/* Content */}
          <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-4 pt-2 shrink-0">
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
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-live" aria-hidden="true" />
                  <span className="min-w-0 truncate text-[11px] text-slate-400">
                    {liveItem.kind === 'video' && library.livePaused && <>Paused{' · '}</>}
                    <span className="font-medium text-slate-200">{liveItem.name}</span>
                  </span>
                  {liveItem.kind === 'video' && (
                    <LiveTransportButton
                      paused={library.livePaused}
                      onToggle={() => void setPaused(!library.livePaused)}
                    />
                  )}
                  {liveItem.kind === 'video' && (
                    <button
                      type="button"
                      onClick={toggleSound}
                      aria-pressed={soundOn}
                      aria-label={soundOn ? 'Mute video sound' : 'Play video sound'}
                      title={soundOn ? 'Video sound is on — click to mute' : 'Video sound is off — click to play it'}
                      className={cn(
                        'grid h-6 w-6 place-items-center rounded transition-colors',
                        soundOn ? 'text-slate-200 hover:bg-surface-tertiary' : 'text-slate-500 hover:text-slate-200',
                      )}
                    >
                      {soundOn ? <Volume2 size={12} aria-hidden="true" /> : <VolumeX size={12} aria-hidden="true" />}
                    </button>
                  )}
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

              <button type="button" onClick={() => void clearBackground()} disabled={!liveItem} title="Remove the background from the live output" className="btn-secondary flex items-center gap-1.5 px-2.5 py-1.5 text-xs">
                <X size={11} aria-hidden="true" /> Clear background
              </button>
              <button
                type="button"
                onClick={() => void window.api.media.rescan()}
                className="grid h-[26px] w-[26px] place-items-center rounded-none text-slate-400 hover:text-white"
                aria-label="Rescan folder"
                title="Rescan folder"
              >
                <RefreshCw size={12} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-[26px] w-[26px] place-items-center rounded-none text-slate-400 hover:text-white"
                aria-label="Close media panel"
                title="Close media panel — playback continues"
              >
                <ChevronDown size={13} aria-hidden="true" />
              </button>
            </div>

            {(error || library.error) && (
              <p className="mx-5 mt-2 flex items-start gap-1.5 border-l-2 border-amber-400 bg-surface-secondary px-2.5 py-1.5 text-[11px] leading-snug text-slate-300">
                <AlertTriangle size={11} className="mt-px shrink-0 text-amber-400" aria-hidden="true" />
                <span className="flex-1">{library.error ?? error}</span>
              </p>
            )}

            {missingIds.length > 0 && (
              <p className="mx-5 mt-2 flex items-start gap-1.5 border-l-2 border-amber-400 bg-surface-secondary px-2.5 py-1.5 text-[11px] leading-snug text-slate-300">
                <AlertTriangle size={11} className="mt-px shrink-0 text-amber-400" aria-hidden="true" />
                <span>
                  {missingIds.length} item{missingIds.length === 1 ? '' : 's'} in this playlist
                  {missingIds.length === 1 ? ' is' : ' are'} no longer in the folder
                  {' — '}
                  <span className="text-slate-400">{missingIds.slice(0, 3).join(', ')}</span>
                  {missingIds.length > 3 ? '…' : ''}
                </span>
              </p>
            )}

            <MarqueeSelect
              className="flex min-h-0 flex-1 flex-col"
              onBegin={mediaSelect.beginMarquee}
              onChange={mediaSelect.updateMarquee}
            >
            <div
              className="grid flex-1 min-h-0 content-start items-start gap-x-3.5 gap-y-3 overflow-y-auto px-5 py-2.5 [grid-template-columns:repeat(auto-fill,minmax(168px,1fr))]"
              onContextMenu={(event) => {
                // Thumbnails stopPropagation; anything else is empty chrome.
                event.preventDefault()
                setBgMenu({ x: event.clientX, y: event.clientY })
              }}
            >
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
                  picked={mediaSelect.isSelected(item.id)}
                  onPick={(gesture) => mediaSelect.pick(item.id, gesture)}
                  busy={item.id === busyId}
                  undecodable={undecodable.has(item.id)}
                  playlists={library.playlists}
                  playback={normalizeMediaPlayback(library.playback[item.id])}
                  dragging={draggingId === item.id}
                  dragOver={dragOverId === item.id}
                  dropPosition={dragOverId === item.id ? dropPosition : null}
                  onPush={() => {
                    setSelectedItemId(item.id)
                    void pushItem(item)
                  }}
                  onSelect={() => setSelectedItemId(item.id)}
                  onPlaybackChange={(patch) => void setPlayback(item.id, patch)}
                  onAddToPlaylist={(playlistId) => void addToPlaylist(playlistId, item.id)}
                  onRemoveFromPlaylist={
                    selection?.kind === 'playlist'
                      ? () => void removeFromPlaylist(selection.id, item.id)
                      : undefined
                  }
                  renaming={renamingItemId === item.id}
                  onRename={() => setRenamingItemId(item.id)}
                  onRenameCommit={(name) => void renameItem(item.id, name)}
                  onRenameCancel={() => setRenamingItemId(null)}
                  onCopy={() => void copyItem(item.id)}
                  onCut={() => void cutItem(item.id)}
                  onPaste={() => void pasteItems()}
                  canPaste={canPaste}
                  onReveal={() => void revealItem(item.id)}
                  onDelete={() => void deleteItem(item)}
                  onUndecodable={() => markUndecodable(item.id)}
                  onDragStart={() => {
                    draggingIdRef.current = item.id
                    dropTargetRef.current = null
                    setDraggingId(item.id)
                    setDragOverId(null)
                  }}
                  onDragEnd={() => {
                    // Drop may still be pending — clear React state for the
                    // highlight, but leave the refs for onDrop to read.
                    setDraggingId(null)
                    setDragOverId(null)
                  }}
                  onDragOver={(position) => {
                    if (draggingIdRef.current === item.id) return
                    dropTargetRef.current = { id: item.id, position }
                    setDragOverId(item.id)
                    setDropPosition(position)
                  }}
                  onDrop={() => {
                    const from = draggingIdRef.current
                    const target = dropTargetRef.current
                    draggingIdRef.current = null
                    dropTargetRef.current = null
                    setDraggingId(null)
                    setDragOverId(null)
                    if (!from || from === item.id) return
                    void reorderItems(
                      from,
                      item.id,
                      target?.id === item.id ? target.position : 'before',
                    )
                  }}
                />
              ))}
              {selection?.kind === 'playlist' && (
                <button
                  type="button"
                  onClick={() => void addMediaToPlaylist(selection.id)}
                  disabled={addingMedia}
                  className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 bg-surface-secondary text-slate-500 hover:bg-surface-tertiary hover:text-slate-200 disabled:opacity-50"
                >
                  <Plus size={18} aria-hidden="true" />
                  <span className="text-xs font-medium">
                    {addingMedia ? 'Adding…' : 'Add media'}
                  </span>
                </button>
              )}
            </div>
            {mediaSelect.selected.size > 0 && (
              <SelectionBar
                className="mx-5 mb-2.5 shrink-0"
                count={mediaSelect.selected.size}
                noun="item"
                onClear={mediaSelect.clear}
              >
                {library.playlists.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-md bg-surface-elevated px-2.5 text-[12px] font-medium text-white hover:bg-surface-border">
                        <Plus size={12} /> Add to playlist
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-72 w-52 overflow-y-auto">
                      {library.playlists.map((playlist) => (
                        <DropdownMenuItem key={playlist.id} onSelect={() => void addPickedToPlaylist(playlist.id)}>
                          <span className="truncate">{playlist.name}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {selection?.kind === 'playlist' && (
                  <SelectionAction onClick={() => void removePickedFromPlaylist(selection.id)}>
                    Remove from playlist
                  </SelectionAction>
                )}
                <SelectionAction danger onClick={() => void deletePicked()}>
                  <Trash2 size={12} /> Delete
                </SelectionAction>
              </SelectionBar>
            )}
            </MarqueeSelect>

            {bgMenu && (
              <BackgroundMenu
                x={bgMenu.x}
                y={bgMenu.y}
                canPaste={canPaste}
                onPaste={() => void pasteItems()}
                onClose={() => setBgMenu(null)}
              />
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  )
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function DragHandle({ onPointerDown, onKeyDown, height, maximum }: {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  height: number
  maximum: number
}): React.ReactElement {
  return (
    <div role="separator" tabIndex={0} aria-orientation="horizontal" aria-label="Resize media panel"
      aria-valuemin={MIN_HEIGHT} aria-valuemax={maximum} aria-valuenow={height}
      title="Drag to resize · Arrow keys adjust · Enter closes"
      onPointerDown={onPointerDown} onKeyDown={onKeyDown}
      // Same 6px gutter as the one beside the live rail; the grip only shows on hover.
      className="group flex h-1.5 shrink-0 cursor-ns-resize touch-none items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-teal-400">
      <span className="h-0.5 w-8 rounded-full bg-transparent transition-colors group-hover:bg-slate-400" />
    </div>
  )
}

const SIDEBAR_WIDTH_KEY = 'kairo.mediaDock.sidebarWidth'
const SIDEBAR_MIN = 150
const SIDEBAR_MAX = 360
const SIDEBAR_DEFAULT = 200

function clampSidebar(width: number): number {
  return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)))
}

function readSidebarWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY))
    return Number.isFinite(stored) && stored > 0 ? clampSidebar(stored) : SIDEBAR_DEFAULT
  } catch {
    return SIDEBAR_DEFAULT
  }
}

function SidebarHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex h-7 items-center justify-between px-3 pt-2 first:pt-0">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{children}</span>
      {action}
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
  // Rename and Delete live on right-click, as everywhere else on macOS — no
  // icons appearing under the pointer on hover.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const hasMenu = !!(onRename || onDelete)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onDoubleClick={onRename}
      onContextMenu={hasMenu ? (event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
        setMenu({ x: event.clientX, y: event.clientY })
      } : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick()
        if (e.key === 'F2' && onRename) onRename()
        if ((e.key === 'Delete' || e.key === 'Backspace') && e.metaKey && onDelete) onDelete()
      }}
      className={cn(
        'mx-1.5 flex cursor-pointer items-center gap-2 px-2 py-1.5 transition-colors',
        active ? 'row-selected' : 'text-slate-400 hover:bg-surface-tertiary',
      )}
    >
      {/* Media's colour (coral, as on its rail button) marks every collection. */}
      <span className="shrink-0 text-[rgb(var(--hue-coral))]">{icon}</span>
      <span className="flex-1 truncate text-[12px]">{label}</span>
      <span className={cn('shrink-0 text-[10px] tabular-nums', active ? 'text-slate-400' : 'text-slate-600')}>
        {count}
      </span>
      {menu && (
        <SidebarRowMenu
          x={menu.x}
          y={menu.y}
          onRename={onRename}
          onDelete={onDelete}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function SidebarRowMenu({
  x,
  y,
  onRename,
  onDelete,
  onClose,
}: {
  x: number
  y: number
  onRename?: () => void
  onDelete?: () => void
  onClose: () => void
}): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const left = Math.min(x, Math.max(8, window.innerWidth - 188))
  const top = Math.min(y, Math.max(8, window.innerHeight - 100))

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

  const run = (action: () => void): void => {
    onClose()
    action()
  }

  return createPortal(
    <div
      ref={rootRef}
      role="menu"
      className="fixed z-[80] w-[180px] overflow-hidden bg-surface-elevated py-1"
      style={{ left, top }}
      onClick={(event) => event.stopPropagation()}
    >
      {onRename && <MenuItem icon={<Pencil size={12} />} label="Rename" onClick={() => run(onRename)} />}
      {onDelete && (
        <button
          type="button"
          role="menuitem"
          onClick={() => run(onDelete)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-400 hover:bg-surface-tertiary"
        >
          <Trash2 size={12} aria-hidden="true" />
          Delete playlist…
        </button>
      )}
    </div>,
    document.body,
  )
}

/**
 * Names a new folder or playlist in place, or renames a background.
 *
 * Electron does not implement `window.prompt`, and blur-to-commit fights both
 * Strict Mode remounts and the click that opened this row — the input would
 * mount, blur empty, and vanish. Enter commits; Escape abandons.
 *
 * `actions` shows Save / Cancel for playlist creation (where an empty field is
 * common). Background rename stays a single field — Enter / Escape only.
 */
function InlineNameInput({
  icon,
  initialValue = '',
  placeholder,
  actions = true,
  onCommit,
  onCancel,
}: {
  icon: React.ReactNode
  initialValue?: string
  placeholder: string
  /** Save / Cancel buttons. Off for thumbnail rename. */
  actions?: boolean
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

  const cancel = (): void => {
    if (settled.current) return
    settled.current = true
    onCancel()
  }

  const commit = (): void => {
    if (settled.current) return
    const name = value.trim()
    if (!name) {
      // Empty Enter on rename resets; on create it just stays open until Cancel.
      if (!actions) cancel()
      return
    }
    settled.current = true
    onCommit(name)
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 border border-slate-500 bg-surface-tertiary px-2',
        actions ? 'py-1.5' : 'py-1',
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-slate-400">{icon}</span>
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
          onBlur={() => {
            // Finder-style: clicking away keeps what was typed.
            if (!actions) commit()
          }}
          className="w-full min-w-0 bg-transparent text-xs font-medium text-white outline-none placeholder:text-slate-500"
          aria-label={placeholder}
        />
      </div>
      {actions && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={commit}
            disabled={!value.trim()}
            className="flex flex-1 items-center justify-center gap-1 bg-teal-500 px-2 py-1 text-[10px] font-semibold text-on-accent hover:bg-teal-600 disabled:opacity-40"
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
      )}
    </div>
  )
}

/**
 * A background tile.
 *
 * The thumbnail frame is the drag source — drag it to rearrange, click it to
 * push. Right-click opens Finder-style actions (rename, copy, cut, reveal, delete).
 */
function MediaCard({
  item,
  live,
  picked,
  onPick,
  busy,
  undecodable,
  playlists,
  playback,
  dragging,
  dragOver,
  dropPosition,
  renaming,
  onPush,
  onSelect,
  onPlaybackChange,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onRename,
  onRenameCommit,
  onRenameCancel,
  onCopy,
  onCut,
  onPaste,
  canPaste,
  onReveal,
  onDelete,
  onUndecodable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  item: MediaItem
  live: boolean
  /** Picked for a bulk action (⌘/Shift-click or rubber band). */
  picked: boolean
  onPick: (gesture: SelectGesture) => void
  busy: boolean
  undecodable: boolean
  playlists: MediaLibrary['playlists']
  playback: MediaPlayback
  dragging: boolean
  dragOver: boolean
  dropPosition: 'before' | 'after' | null
  renaming: boolean
  onPush: () => void
  onSelect: () => void
  onPlaybackChange: (patch: Partial<MediaPlayback>) => void
  onAddToPlaylist: (playlistId: string) => void
  onRemoveFromPlaylist?: () => void
  onRename: () => void
  onRenameCommit: (name: string) => void
  onRenameCancel: () => void
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  canPaste: boolean
  onReveal: () => void
  onDelete: () => void
  onUndecodable: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: (position: 'before' | 'after') => void
  onDrop: () => void
}): React.ReactElement {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  /** Set when a rearrange drag actually moved — blocks the click-to-push. */
  const didDragRef = useRef(false)
  const thumbRef = useRef<HTMLDivElement>(null)
  const filter = mediaFilterCss(playback)

  return (
    <div
      data-media-card=""
      className={cn(
        'relative flex min-w-0 flex-col gap-1.5 transition-opacity',
        dragging && 'opacity-40',
      )}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const rect = event.currentTarget.getBoundingClientRect()
        onDragOver(event.clientX < rect.left + rect.width / 2 ? 'before' : 'after')
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onDrop()
      }}
    >
      {dragOver && dropPosition === 'before' && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-2 top-0 bottom-6 w-0.5 rounded-full bg-teal-400"
        />
      )}
      {dragOver && dropPosition === 'after' && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-2 top-0 bottom-6 w-0.5 rounded-full bg-teal-400"
        />
      )}

      <div
        ref={thumbRef}
        role="button"
        draggable={!renaming}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', item.id)
          const node = thumbRef.current
          if (node) {
            const rect = node.getBoundingClientRect()
            event.dataTransfer.setDragImage(
              node,
              Math.min(rect.width / 2, 80),
              Math.min(rect.height / 2, 45),
            )
          }
          didDragRef.current = false
          onDragStart()
        }}
        onDrag={(event) => {
          if (event.clientX !== 0 || event.clientY !== 0) didDragRef.current = true
        }}
        onDragEnd={onDragEnd}
        data-select-id={item.id}
        onClick={(event) => {
          if (didDragRef.current) {
            didDragRef.current = false
            return
          }
          // ⌘/Shift-click only selects; a plain click still goes live.
          const gesture = selectGesture(event)
          if (gesture) { onPick(gesture); return }
          onPush()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onPush()
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onSelect()
          setMenu({ x: event.clientX, y: event.clientY })
        }}
        title={`Push ${item.name} · drag to rearrange · right-click for more`}
        aria-label={`Push ${item.name} to screen`}
        className={cn(
          'relative w-full aspect-video overflow-hidden bg-black border-2 transition-colors duration-150 cursor-grab active:cursor-grabbing',
          // The frame alone says what is on screen — no badge on the picture.
          picked
            ? 'border-white'
            : live
              ? 'border-live'
              : 'border-transparent hover:border-slate-600',
          busy && 'opacity-70'
        )}
      >
        {picked && (
          <span className="absolute left-1.5 top-1.5 z-10 grid size-4 place-items-center rounded-full bg-white text-black" aria-hidden="true">
            <Check size={10} weight="bold" />
          </span>
        )}
        <Thumb
          item={item}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          style={filter ? { filter } : undefined}
          onError={onUndecodable}
        />

      </div>

      {renaming ? (
        <InlineNameInput
          icon={item.kind === 'video'
            ? <Film size={10} aria-hidden="true" />
            : <ImageIcon size={10} aria-hidden="true" />}
          initialValue={item.name}
          placeholder="Name"
          actions={false}
          onCommit={onRenameCommit}
          onCancel={onRenameCancel}
        />
      ) : (
        <div className="flex items-center gap-1.5 px-0.5">
          {item.kind === 'video'
            ? <Film size={10} className="shrink-0 text-slate-600" aria-hidden="true" />
            : <ImageIcon size={10} className="shrink-0 text-slate-600" aria-hidden="true" />}
          <span className={cn('min-w-0 flex-1 truncate text-[11px]', live ? 'font-medium text-white' : 'text-slate-400')}>
            {item.name}
          </span>
          {undecodable && (
            <span className="shrink-0 text-[10px] text-amber-400" title="This file will not play">Can’t play</span>
          )}
          {item.kind === 'video' && playback.loop && !undecodable && (
            <Repeat size={10} className="shrink-0 text-slate-500" aria-label="Loops" />
          )}
        </div>
      )}

      {menu && (
        <ItemMenu
          x={menu.x}
          y={menu.y}
          item={item}
          playback={playback}
          playlists={playlists}
          canPaste={canPaste}
          onPlaybackChange={onPlaybackChange}
          onAddToPlaylist={onAddToPlaylist}
          onRemoveFromPlaylist={onRemoveFromPlaylist}
          onRename={onRename}
          onCopy={onCopy}
          onCut={onCut}
          onPaste={onPaste}
          onReveal={onReveal}
          onDelete={onDelete}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function BackgroundMenu({
  x,
  y,
  canPaste,
  onPaste,
  onClose,
}: {
  x: number
  y: number
  canPaste: boolean
  onPaste: () => void
  onClose: () => void
}): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const left = Math.min(x, Math.max(8, window.innerWidth - 200))
  const top = Math.min(y, Math.max(8, window.innerHeight - 80))

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
      className="fixed z-[80] w-[180px] overflow-hidden rounded-xl bg-surface-elevated py-1 shadow-2xl"
      style={{ left, top }}
    >
      <button
        type="button"
        role="menuitem"
        disabled={!canPaste}
        onClick={() => {
          if (!canPaste) return
          onClose()
          onPaste()
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-200 hover:bg-surface-tertiary disabled:cursor-default disabled:text-slate-600 disabled:hover:bg-transparent"
      >
        <ClipboardPaste size={12} className={canPaste ? 'text-slate-500' : 'text-slate-700'} aria-hidden="true" />
        Paste
      </button>
    </div>,
    document.body,
  )
}

function ItemMenu({
  x,
  y,
  item,
  playback,
  playlists,
  canPaste,
  onPlaybackChange,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onRename,
  onCopy,
  onCut,
  onPaste,
  onReveal,
  onDelete,
  onClose,
}: {
  x: number
  y: number
  item: MediaItem
  playback: MediaPlayback
  playlists: MediaLibrary['playlists']
  canPaste: boolean
  onPlaybackChange: (patch: Partial<MediaPlayback>) => void
  onAddToPlaylist: (playlistId: string) => void
  onRemoveFromPlaylist?: () => void
  onRename: () => void
  onCopy: () => void
  onCut: () => void
  onPaste?: () => void
  onReveal: () => void
  onDelete: () => void
  onClose: () => void
}): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const place = (): void => {
      const menu = rootRef.current
      if (!menu) return
      const rect = menu.getBoundingClientRect()
      setPosition({
        left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [x, y, playlists.length, item.kind, onRemoveFromPlaylist])

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

  const run = (action: () => void): void => {
    onClose()
    action()
  }

  return createPortal(
    <div
      ref={rootRef}
      role="menu"
      className="fixed z-[80] max-h-[calc(100vh-16px)] w-[252px] max-w-[calc(100vw-16px)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl bg-surface-elevated py-1 shadow-2xl"
      style={{ left: position.left, top: position.top }}
    >
      <MenuItem icon={<Pencil size={12} />} label="Rename" onClick={() => run(onRename)} />
      <MenuItem icon={<Copy size={12} />} label="Copy" onClick={() => run(onCopy)} />
      <MenuItem icon={<Scissors size={12} />} label="Cut" onClick={() => run(onCut)} />
      <MenuItem
        icon={<ClipboardPaste size={12} />}
        label="Paste"
        disabled={!canPaste || !onPaste}
        onClick={() => { if (canPaste && onPaste) run(onPaste) }}
      />
      <MenuItem
        icon={<FolderOpen size={12} />}
        label={navigator.platform.startsWith('Mac') ? 'Show in Finder' : 'Show in folder'}
        onClick={() => run(onReveal)}
      />

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

      <div className="px-3 py-2.5">
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
        <div className="py-1">
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
          className="block w-full px-3 py-2 text-left text-xs text-slate-300 hover:bg-surface-tertiary hover:text-red-400"
        >
          Remove from playlist
        </button>
      )}

      <button
        type="button"
        onClick={() => run(onDelete)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-400 hover:bg-tint-red"
      >
        <Trash2 size={12} aria-hidden="true" />
        Delete from folder…
      </button>
    </div>,
    document.body,
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}): React.ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-200 hover:bg-surface-tertiary disabled:cursor-default disabled:text-slate-600 disabled:hover:bg-transparent"
    >
      <span className={disabled ? 'text-slate-700' : 'text-slate-500'}>{icon}</span>
      {label}
    </button>
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
        className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-surface-border accent-teal-400"
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
function LiveTransportButton({
  paused,
  onToggle,
}: {
  paused: boolean
  onToggle: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      title={paused ? 'Play' : 'Pause'}
      aria-label={paused ? 'Play video' : 'Pause video'}
      className="grid h-6 w-6 place-items-center text-slate-200 hover:bg-surface-tertiary"
    >
      {paused
        ? <Play size={11} fill="currentColor" aria-hidden="true" />
        : <Pause size={11} fill="currentColor" aria-hidden="true" />}
    </button>
  )
}

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
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        className={className}
        style={style}
        onError={onError}
        loading="lazy"
      />
    )
  }
  return (
    <video
      src={src}
      draggable={false}
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
        <div className="grid h-11 w-11 place-items-center bg-surface-secondary">
          <Folder size={20} className="text-slate-400" aria-hidden="true" />
        </div>
        <p className="text-[15px] font-semibold text-white">Choose your backgrounds folder</p>
        <p className="text-xs leading-relaxed text-slate-400">
          Point Kairo at the folder your motion backgrounds already live in. Files
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
