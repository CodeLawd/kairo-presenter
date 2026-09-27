import { useEffect, useRef, useState } from 'react'
import { Clock, ListMusic, Pencil, Plus, Star, Trash2, Upload } from '@/icons'
import { exportKairo } from '@/stores/useTransfer'
import { cn } from '@/lib/utils'
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

const FILTERS: Array<{ id: Exclude<LibrarySource, 'all'>; label: string; Icon: typeof Star }> = [
  { id: 'favorites', label: 'Favorites', Icon: Star },
  { id: 'recent', label: 'Recent', Icon: Clock },
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
      selected ? 'row-selected' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200',
    )

  return (
    <nav aria-label="Song sources" className="shrink-0 space-y-3">
      <LibrarySection
        kind="songs"
        activeLibraryId={activeSetlistId ? '' : activeLibraryId}
        counts={libraryCounts}
        onSelect={onSelectLibrary}
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

      <div>
        <div className="flex items-center gap-1 px-2 pb-1">
          <p className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Setlists</p>
          <button
            type="button"
            aria-label="New setlist"
            title="New setlist"
            className="grid size-5 place-items-center rounded text-zinc-600 transition-colors hover:bg-white/5 hover:text-zinc-300"
            onClick={createList}
          >
            <Plus size={12} />
          </button>
        </div>

        {lists.length === 0 ? (
          <p className="px-2 py-2 text-[11px] leading-relaxed text-zinc-600">
            Drag a song onto ＋ to start a service order.
          </p>
        ) : (
          lists.map((list) => {
            const selected = activeSetlistId === list.id
            return renamingId === list.id ? (
              <input
                key={list.id}
                ref={inputRef}
                value={draftName}
                maxLength={80}
                aria-label="Setlist name"
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={() => commitRename(list)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); commitRename(list) }
                  if (event.key === 'Escape') { event.preventDefault(); setRenamingId(null) }
                }}
                className="mb-0.5 w-full rounded-md bg-white/[0.06] px-2 py-1.5 text-[12px] text-zinc-100 outline-none ring-1 ring-teal-500/40"
              />
            ) : (
              <div
                key={list.id}
                // Dropping a song straight onto a setlist adds it there without
                // first making that list the one on screen.
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(SONG_DRAG_TYPE)) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'copy'
                  setDropListId(list.id)
                }}
                onDragLeave={() => setDropListId((value) => (value === list.id ? null : value))}
                onDrop={(event) => {
                  event.preventDefault()
                  setDropListId(null)
                  const songId = songIdFromDrag(event.dataTransfer)
                  if (songId) run({ action: 'add', songId, listId: list.id })
                }}
                className={cn(rowClass(selected), dropListId === list.id && 'ring-1 ring-teal-400/70')}
              >
                <ListMusic size={13} className="shrink-0" aria-hidden />
                <button
                  type="button"
                  aria-current={selected}
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => onSelectSetlist(list.id)}
                >
                  {list.name}
                </button>
                <span className="shrink-0 text-[10px] tabular-nums text-zinc-600 group-hover:hidden">
                  {list.songIds.length}
                </span>
                <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  <button
                    type="button"
                    aria-label={`Rename ${list.name}`}
                    className="grid size-5 place-items-center rounded text-zinc-500 hover:text-zinc-200"
                    onClick={() => { setDraftName(list.name); setRenamingId(list.id) }}
                  >
                    <Pencil size={10} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Export ${list.name}`}
                    title="Export setlist as a .kairo file"
                    className="grid size-5 place-items-center rounded text-zinc-500 hover:text-zinc-200"
                    onClick={() => void exportKairo({ kind: 'setlist', listId: list.id })}
                  >
                    <Upload size={10} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${list.name}`}
                    className="grid size-5 place-items-center rounded text-zinc-500 hover:text-rose-400"
                    onClick={() => run({ action: 'delete', listId: list.id })}
                  >
                    <Trash2 size={10} />
                  </button>
                </span>
              </div>
            )
          })
        )}
      </div>
      {error && <p role="alert" className="px-2 text-[10px] text-red-400">{error}</p>}
    </nav>
  )
}
