import { useEffect, useRef, useState } from 'react'
import { Library as LibraryIcon, Pencil, Plus, Trash2 } from '@/icons'
import { cn } from '@/lib/utils'
import {
  itemIdFromDrag,
  runLibrariesCommand,
  useLibrary,
  LIBRARY_ITEM_DRAG_TYPE,
} from '@/stores/useLibraries'
import {
  DEFAULT_LIBRARY_ID,
  DEFAULT_LIBRARY_NAME,
  type Library,
  type LibraryKind,
} from '@shared/libraries'

/**
 * The LIBRARY half of a page rail: the default library, then user-made ones.
 *
 * Shared by Lyrics, Documents and Scripture so the three pages behave the same
 * — create with ＋, rename and delete on hover, drag an item onto a row to file
 * it there. Deleting a library returns its items to the default, so the control
 * is safe to reach for mid-service.
 */
export function LibrarySection({
  kind,
  activeLibraryId,
  counts,
  onSelect,
  extraRows,
}: {
  kind: LibraryKind
  activeLibraryId: string
  counts: Record<string, number>
  onSelect: (libraryId: string) => void
  /** Page-specific rows shown under the libraries, e.g. Favorites or Recent. */
  extraRows?: React.ReactNode
}): React.ReactElement {
  const library = useLibrary(kind)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [dropId, setDropId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!renamingId) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [renamingId])

  const run = (command: Parameters<typeof runLibrariesCommand>[0]): void => {
    setError('')
    void runLibrariesCommand(command).catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    )
  }

  const createLibrary = (): void => {
    setError('')
    void runLibrariesCommand({ action: 'create', kind, name: 'New library' })
      .then((state) => {
        const created = state[kind].libraries.at(-1)
        if (!created) return
        setDraftName(created.name)
        setRenamingId(created.id)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  const commitRename = (target: Library): void => {
    if (draftName.trim() && draftName !== target.name) {
      run({ action: 'rename', kind, libraryId: target.id, name: draftName })
    }
    setRenamingId(null)
  }

  const rowClass = (selected: boolean, dropping: boolean): string =>
    cn(
      'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors',
      selected ? 'row-selected' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200',
      dropping && 'ring-1 ring-teal-400/70',
    )

  const dropHandlers = (libraryId: string): React.HTMLAttributes<HTMLElement> => ({
    onDragOver: (event) => {
      if (!event.dataTransfer.types.includes(LIBRARY_ITEM_DRAG_TYPE)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropId(libraryId)
    },
    onDragLeave: () => setDropId((value) => (value === libraryId ? null : value)),
    onDrop: (event) => {
      event.preventDefault()
      setDropId(null)
      const itemId = itemIdFromDrag(event.dataTransfer)
      if (itemId) run({ action: 'assign', kind, itemIds: [itemId], libraryId })
    },
  })

  return (
    <div>
      <div className="flex items-center gap-1 px-2 pb-1">
        <p className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Library</p>
        <button
          type="button"
          aria-label="New library"
          title="New library"
          className="grid size-5 place-items-center rounded text-zinc-600 transition-colors hover:bg-white/5 hover:text-zinc-300"
          onClick={createLibrary}
        >
          <Plus size={12} />
        </button>
      </div>

      <button
        type="button"
        aria-current={activeLibraryId === DEFAULT_LIBRARY_ID}
        className={rowClass(activeLibraryId === DEFAULT_LIBRARY_ID, dropId === DEFAULT_LIBRARY_ID)}
        onClick={() => onSelect(DEFAULT_LIBRARY_ID)}
        {...dropHandlers(DEFAULT_LIBRARY_ID)}
      >
        <LibraryIcon size={13} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{DEFAULT_LIBRARY_NAME[kind]}</span>
        <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">{counts[DEFAULT_LIBRARY_ID] ?? 0}</span>
      </button>

      {library.libraries.map((entry) =>
        renamingId === entry.id ? (
          <input
            key={entry.id}
            ref={inputRef}
            value={draftName}
            maxLength={80}
            aria-label="Library name"
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={() => commitRename(entry)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); commitRename(entry) }
              if (event.key === 'Escape') { event.preventDefault(); setRenamingId(null) }
            }}
            className="mb-0.5 w-full rounded-md bg-white/[0.06] px-2 py-1.5 text-[12px] text-zinc-100 outline-none ring-1 ring-teal-500/40"
          />
        ) : (
          <div
            key={entry.id}
            className={rowClass(activeLibraryId === entry.id, dropId === entry.id)}
            {...dropHandlers(entry.id)}
          >
            <LibraryIcon size={13} className="shrink-0" aria-hidden />
            <button
              type="button"
              aria-current={activeLibraryId === entry.id}
              className="min-w-0 flex-1 truncate text-left"
              onClick={() => onSelect(entry.id)}
            >
              {entry.name}
            </button>
            <span className="shrink-0 text-[10px] tabular-nums text-zinc-600 group-hover:hidden">
              {counts[entry.id] ?? 0}
            </span>
            <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
              <button
                type="button"
                aria-label={`Rename ${entry.name}`}
                className="grid size-5 place-items-center rounded text-zinc-500 hover:text-zinc-200"
                onClick={() => { setDraftName(entry.name); setRenamingId(entry.id) }}
              >
                <Pencil size={10} />
              </button>
              <button
                type="button"
                aria-label={`Delete ${entry.name}`}
                title={`Delete ${entry.name} — its items move to ${DEFAULT_LIBRARY_NAME[kind]}`}
                className="grid size-5 place-items-center rounded text-zinc-500 hover:text-rose-400"
                onClick={() => {
                  if (activeLibraryId === entry.id) onSelect(DEFAULT_LIBRARY_ID)
                  run({ action: 'delete', kind, libraryId: entry.id })
                }}
              >
                <Trash2 size={10} />
              </button>
            </span>
          </div>
        ),
      )}

      {extraRows}
      {error && <p role="alert" className="px-2 pt-1 text-[10px] text-red-400">{error}</p>}
    </div>
  )
}
