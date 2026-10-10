import { useEffect, useRef, useState } from 'react'
import { Check, ListMusic, Pencil, Star, Trash2, Upload } from '@/icons'
import { exportKairo, useTransferStore } from '@/stores/useTransfer'
import { leavesTarget } from '@/lib/drag'
import { cn } from '@/lib/utils'
import { RowContextMenu } from '@/components/shared/RowContextMenu'
import {
  runSetlistCommand,
  songIdFromDrag,
  useSetlistStore,
  SONG_DRAG_TYPE,
} from '@/stores/useSetlist'
import { DEFAULT_SETLIST_NAME, type SongSetlist } from '@shared/setlist'
import { LibrarySection } from '@/components/shared/LibrarySection'

/** Library views that are not a library: saved filters over whatever is shown. */
export type LibrarySource = 'all' | 'favorites' | 'recent'

// "Recent" was every song by last edit — the Sort menu's "Last modified" does that.
const FILTERS: Array<{ id: Exclude<LibrarySource, 'all'>; label: string; Icon: typeof Star }> = [
  { id: 'favorites', label: 'Favorites', Icon: Star },
]

/**
 * Where the song list gets its contents: a library view, or one setlist.
 *
 * Two sections in one rail rather than a filter row plus a separate panel —
 * the operator picks a source once and the list below answers, so there is
 * only ever one place to look for "what am I seeing".
 */
export function LibraryRail({
  source,
  activeLibraryId,
  activeSetlistId,
  libraryCounts,
  filterCounts,
  onSelectLibrary,
  onSelectSource,
  onSelectSetlist,
}: {
  source: LibrarySource
  activeLibraryId: string
  activeSetlistId: string | null
  libraryCounts: Record<string, number>
  filterCounts: Record<Exclude<LibrarySource, 'all'>, number>
  onSelectLibrary: (libraryId: string) => void
  onSelectSource: (source: LibrarySource) => void
  onSelectSetlist: (id: string) => void
}): React.ReactElement {
  const lists = useSetlistStore((state) => state.lists)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [dropListId, setDropListId] = useState<string | null>(null)
  const [landedListId, setLandedListId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!renamingId) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [renamingId])

  const run = (command: Parameters<typeof runSetlistCommand>[0]): void => {
    setError('')
    void runSetlistCommand(command).catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    )
  }

  /** Adds a dropped song to a setlist, with a word of confirmation either way. */
  const addDroppedSong = (list: SongSetlist, songId: string, title: string): void => {
    const notify = useTransferStore.getState().notify
    // Adding a song already on the list would move it to the end — a
    // surprise mid-service. Say so and leave the order alone.
    if (list.songIds.includes(songId)) {
      notify({ tone: 'ok', text: `“${title}” is already on ${list.name}` })
      return
    }
    setError('')
    void runSetlistCommand({ action: 'add', songId, listId: list.id })
      .then(() => {
        setLandedListId(list.id)
        setTimeout(() => setLandedListId((value) => (value === list.id ? null : value)), 1200)
        notify({ tone: 'ok', text: `Added “${title}” to ${list.name}` })
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  // With no setlists the section stays out of the way — ＋ → New setlist makes
  // one. It comes back while a song is dragged, so dropping one still starts a list.
  const [songDragging, setSongDragging] = useState(false)
  useEffect(() => {
    const start = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes(SONG_DRAG_TYPE)) setSongDragging(true)
    }
    const end = (): void => setSongDragging(false)
    window.addEventListener('dragstart', start)
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => {
      window.removeEventListener('dragstart', start)
      window.removeEventListener('dragend', end)
      window.removeEventListener('drop', end)
    }
  }, [])

  /** A drop on the section but not on a row: the active setlist, or a new one. */
  const [sectionDrop, setSectionDrop] = useState(false)
  const activeList = lists.find((list) => list.id === (activeSetlistId ?? useSetlistStore.getState().activeId)) ?? lists[0] ?? null
  const dropOnSection = (songId: string, title: string): void => {
    if (activeList) { addDroppedSong(activeList, songId, title); return }
    void runSetlistCommand({ action: 'create', name: DEFAULT_SETLIST_NAME })
      .then(() => {
        const created = useSetlistStore.getState().lists[0]
        if (created) addDroppedSong(created, songId, title)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  const createList = (): void => {
    void runSetlistCommand({ action: 'create', name: DEFAULT_SETLIST_NAME })
      .then(() => {
        const created = useSetlistStore.getState().lists[0]
        if (!created) return
        onSelectSetlist(created.id)
        setDraftName(created.name)
        setRenamingId(created.id)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  const commitRename = (list: SongSetlist): void => {
    if (draftName.trim() && draftName !== list.name) {
      run({ action: 'rename', listId: list.id, name: draftName })
    }
    setRenamingId(null)
  }

  const rowClass = (selected: boolean): string =>
    cn(
      'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors',
      selected ? 'row-selected' : 'text-zinc-400 hover:bg-surface-tertiary hover:text-zinc-200',
    )

  return (
    <nav aria-label="Song sources" className="shrink-0 space-y-3">
      <LibrarySection
        kind="songs"
        activeLibraryId={activeSetlistId ? '' : activeLibraryId}
        counts={libraryCounts}
        onSelect={onSelectLibrary}
        addItems={[{ label: 'New playlist', icon: <ListMusic size={13} />, onSelect: createList }]}
        extraRows={FILTERS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={!activeSetlistId && source === id}
            className={rowClass(!activeSetlistId && source === id)}
            onClick={() => onSelectSource(id)}
          >
            <Icon size={13} className="shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">{filterCounts[id]}</span>
          </button>
        ))}
      />

      {(lists.length > 0 || songDragging) && (
      <div
        // The whole section is a drop target: a row takes it into that list,
        // anywhere else goes to the active setlist (or starts one).
        className={cn('-mx-1 rounded-lg px-1 pb-1 transition-colors', sectionDrop && 'bg-surface-tertiary')}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(SONG_DRAG_TYPE)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setSectionDrop(true)
        }}
        onDragLeave={(event) => { if (leavesTarget(event)) setSectionDrop(false) }}
        onDrop={(event) => {
          event.preventDefault()
          setSectionDrop(false)
          const songId = songIdFromDrag(event.dataTransfer)
          if (songId) dropOnSection(songId, event.dataTransfer.getData('text/plain') || 'Song')
        }}
      >
        <div className="flex items-center gap-1 px-2 pb-1">
          <p className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Playlists</p>
          {sectionDrop && !dropListId && (
            <span className="text-[10px] text-zinc-300">
              {activeList ? `Add to ${activeList.name}` : 'Start a playlist'}
            </span>
          )}
        </div>

        {lists.length === 0 ? (
          <p className="px-2 py-2 text-[11px] leading-relaxed text-zinc-500">Drop here to start a playlist</p>
        ) : (
          lists.map((list) => {
            const selected = activeSetlistId === list.id
            return renamingId === list.id ? (
              <input
                key={list.id}
                ref={inputRef}
                value={draftName}
                maxLength={80}
                aria-label="Playlist name"
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={() => commitRename(list)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); commitRename(list) }
                  if (event.key === 'Escape') { event.preventDefault(); setRenamingId(null) }
                }}
                className="mb-0.5 w-full rounded-md bg-surface-tertiary px-2 py-1.5 text-[12px] text-zinc-100 outline-none ring-1 ring-teal-500/40"
              />
            ) : (
              <RowContextMenu
                key={list.id}
                items={[
                  { label: 'Rename', icon: <Pencil size={13} />, onSelect: () => { setDraftName(list.name); setRenamingId(list.id) } },
                  { label: 'Export as .kairo file…', icon: <Upload size={13} />, onSelect: () => void exportKairo({ kind: 'setlist', listId: list.id }) },
                  { label: 'Delete', icon: <Trash2 size={13} />, destructive: true, onSelect: () => run({ action: 'delete', listId: list.id }) },
                ]}
              >
              <div
                // Dropping a song straight onto a setlist adds it there without
                // first making that list the one on screen.
                onDragEnter={(event) => {
                  if (!event.dataTransfer.types.includes(SONG_DRAG_TYPE)) return
                  event.preventDefault()
                  setDropListId(list.id)
                }}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(SONG_DRAG_TYPE)) return
                  event.preventDefault()
                  event.stopPropagation()
                  event.dataTransfer.dropEffect = 'copy'
                  setDropListId(list.id)
                }}
                onDragLeave={(event) => {
                  if (leavesTarget(event)) setDropListId((value) => (value === list.id ? null : value))
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setDropListId(null)
                  setSectionDrop(false)
                  const songId = songIdFromDrag(event.dataTransfer)
                  if (songId) addDroppedSong(list, songId, event.dataTransfer.getData('text/plain') || 'Song')
                }}
                className={cn(
                  rowClass(selected),
                  dropListId === list.id && 'bg-surface-border text-white',
                  landedListId === list.id && dropListId !== list.id && 'bg-surface-elevated text-white',
                )}
              >
                <ListMusic size={13} className="shrink-0" aria-hidden />
                <button
                  type="button"
                  aria-current={selected}
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => onSelectSetlist(list.id)}
                  onDoubleClick={() => { setDraftName(list.name); setRenamingId(list.id) }}
                >
                  {list.name}
                </button>
                {dropListId === list.id ? (
                  <span className="shrink-0 text-[10px] font-medium text-zinc-300">Add here</span>
                ) : landedListId === list.id ? (
                  <Check size={12} className="shrink-0 text-zinc-200" aria-label="Added" />
                ) : (
                  <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                    {list.songIds.length}
                  </span>
                )}
              </div>
              </RowContextMenu>
            )
          })
        )}
      </div>
      )}
      {error && <p role="alert" className="px-2 text-[10px] text-red-400">{error}</p>}
    </nav>
  )
}
