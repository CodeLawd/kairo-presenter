import { useEffect, useMemo, useState } from 'react'
import { BookOpen, ListMusic, Loader, Music2, X } from '@/icons'
import { cn } from '@/lib/utils'
import { describeDuplicate } from '@shared/lyrics-duplicate'
import type {
  PlaylistImportChoice,
  SongImportChoice,
  TransferPreview,
} from '@shared/kairo-bundle'
import { commitKairoImport, describeCommit, useTransferStore } from '@/stores/useTransfer'

type DuplicateChoice = Exclude<SongImportChoice, 'add'>

const DUPLICATE_CHOICES: { id: DuplicateChoice; label: string; hint: string }[] = [
  { id: 'skip', label: 'Keep mine', hint: 'Leave your copy as it is' },
  { id: 'replace', label: 'Replace', hint: 'Overwrite your copy with the imported one' },
  { id: 'keep-both', label: 'Keep both', hint: 'Add the imported one as a separate song' },
]

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T
  options: { id: T; label: string; hint?: string }[]
  onChange: (value: T) => void
  label: string
  size?: 'sm' | 'md'
}): React.ReactElement {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-none bg-surface-tertiary p-0.5" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          title={option.hint}
          onClick={() => onChange(option.id)}
          className={cn(
            'rounded-none font-medium transition-colors',
            size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]',
            value === option.id ? 'bg-surface-border text-white' : 'text-white/45 hover:text-white/75',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function exportedLabel(preview: TransferPreview): string {
  if (!preview.exportedAt) return preview.fileName
  const date = new Date(preview.exportedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  return `${preview.fileName} · exported ${date}`
}

/**
 * The review step between opening a `.kairo` file and changing anything.
 *
 * New songs are ticked by default; songs the library already holds default to
 * "Keep mine" so importing a file twice is harmless. Nothing is written until
 * Import — cancelling discards the parsed file in main.
 */
export function ImportReviewModal({ preview }: { preview: TransferPreview }): React.ReactElement {
  const { setPreview, notify } = useTransferStore()
  const duplicates = preview.songs.filter((song) => song.duplicate)
  const newSongs = preview.songs.filter((song) => !song.duplicate)

  const [bulk, setBulk] = useState<DuplicateChoice>('skip')
  const [choices, setChoices] = useState<Record<string, SongImportChoice>>(() =>
    Object.fromEntries(preview.songs.map((song) => [song.id, song.duplicate ? 'skip' : 'add'])),
  )
  const [createSetlist, setCreateSetlist] = useState(Boolean(preview.setlist))
  const [playlistChoice, setPlaylistChoice] = useState<PlaylistImportChoice>(
    preview.playlist?.exists ? 'keep-both' : 'replace',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = (): void => {
    if (busy) return
    void window.api.transfer.discard(preview.token)
    setPreview(null)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const applyBulk = (choice: DuplicateChoice): void => {
    setBulk(choice)
    setChoices((current) => {
      const next = { ...current }
      for (const song of duplicates) next[song.id] = choice
      return next
    })
  }

  const counts = useMemo(() => {
    let add = 0
    let replace = 0
    for (const song of preview.songs) {
      const choice = choices[song.id]
      if (choice === 'add' || choice === 'keep-both') add++
      else if (choice === 'replace') replace++
    }
    return { add, replace }
  }, [choices, preview.songs])

  const isPlaylist = preview.kind === 'scripture-playlist'
  const nothingToDo = isPlaylist
    ? playlistChoice === 'skip'
    : counts.add + counts.replace === 0 && !(createSetlist && preview.setlist)

  const runImport = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await commitKairoImport({
        token: preview.token,
        songs: choices,
        createSetlist,
        ...(preview.playlist ? { playlist: playlistChoice } : {}),
      })
      notify({ tone: 'ok', text: describeCommit(result) })
      setPreview(null)
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setBusy(false)
    }
  }

  const KindIcon = isPlaylist ? BookOpen : preview.setlist ? ListMusic : Music2
  const songCount = counts.add + counts.replace
  const importLabel = isPlaylist
    ? 'Import playlist'
    : songCount > 0
      ? `Import ${songCount} song${songCount === 1 ? '' : 's'}`
      : createSetlist && preview.setlist
        ? 'Create setlist'
        : 'Nothing to import'
  const allAlreadyHere = !isPlaylist && newSongs.length === 0 && duplicates.length > 0

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 animate-fade-in"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kairo-import-title"
        className="flex max-h-[min(640px,90vh)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-surface-border px-5 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-teal-500/25 bg-tint-teal text-teal-300">
            <KindIcon size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="kairo-import-title" className="truncate text-sm font-semibold text-white">
              Import “{preview.name}”
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-white/40">{exportedLabel(preview)}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-md text-white/40 hover:bg-surface-tertiary hover:text-white"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {preview.playlist ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-white/[0.06] bg-surface-secondary px-3.5 py-3">
                <p className="text-[13px] font-medium text-white">{preview.playlist.title}</p>
                <p className="mt-0.5 text-[11px] text-white/40">
                  Scripture playlist · {preview.playlist.itemCount} passage
                  {preview.playlist.itemCount === 1 ? '' : 's'} · verse text included
                </p>
              </div>
              {preview.playlist.exists ? (
                <div className="space-y-1.5">
                  <p className="text-[12px] text-white/70">You already have this playlist.</p>
                  <Segmented
                    label="Existing playlist"
                    value={playlistChoice}
                    onChange={setPlaylistChoice}
                    options={[
                      { id: 'keep-both', label: 'Keep both' },
                      { id: 'replace', label: 'Replace mine' },
                      { id: 'skip', label: 'Don’t import' },
                    ]}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <>
              {allAlreadyHere ? (
                <p className="rounded-xl border border-teal-500/20 bg-tint-teal px-3.5 py-2.5 text-[12px] leading-relaxed text-teal-200/90">
                  {duplicates.length === 1 ? 'This song is' : `All ${duplicates.length} songs are`} already in
                  your library, so there’s nothing new to add. Choose <span className="font-medium">Replace</span> to
                  overwrite your copies with these, or <span className="font-medium">Keep both</span> to add them again.
                </p>
              ) : null}

              <p className="text-[12px] text-white/55">
                {preview.songs.length} song{preview.songs.length === 1 ? '' : 's'}
                {' · '}
                <span className="text-white/80">{newSongs.length} new</span>
                {duplicates.length > 0 ? ` · ${duplicates.length} already in your library` : ''}
              </p>

              {preview.setlist ? (
                <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/[0.06] bg-surface-secondary px-3.5 py-2.5">
                  <input
                    type="checkbox"
                    checked={createSetlist}
                    onChange={(event) => setCreateSetlist(event.target.checked)}
                    className="h-3.5 w-3.5 accent-teal-500"
                  />
                  <ListMusic size={14} className="shrink-0 text-white/45" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-white">
                      Create setlist “{preview.setlist.name}”
                    </span>
                    <span className="block text-[11px] text-white/40">
                      {preview.setlist.songCount} songs in service order
                    </span>
                  </span>
                </label>
              ) : null}

              {duplicates.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12px] text-white/70">For songs you already have</p>
                  <Segmented label="All duplicates" value={bulk} onChange={applyBulk} options={DUPLICATE_CHOICES} />
                </div>
              ) : null}

              <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06]">
                {preview.songs.map((song) => {
                  const choice = choices[song.id]
                  const setChoice = (next: SongImportChoice): void =>
                    setChoices((current) => ({ ...current, [song.id]: next }))
                  return (
                    <li key={song.id} className="flex items-center gap-2.5 px-3 py-2">
                      {song.duplicate ? (
                        <span className="w-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <input
                          type="checkbox"
                          checked={choice === 'add'}
                          onChange={(event) => setChoice(event.target.checked ? 'add' : 'skip')}
                          aria-label={`Import ${song.title}`}
                          className="h-3.5 w-3.5 shrink-0 accent-teal-500"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] leading-tight text-white">{song.title}</p>
                        <p className="mt-0.5 truncate text-[11px] text-white/35">
                          {song.duplicate
                            ? describeDuplicate(song.duplicate)
                            : [song.artist, `${song.sectionCount} section${song.sectionCount === 1 ? '' : 's'}`]
                                .filter(Boolean)
                                .join(' · ')}
                        </p>
                      </div>
                      {song.duplicate ? (
                        <Segmented
                          size="sm"
                          label={`What to do with ${song.title}`}
                          value={choice as DuplicateChoice}
                          onChange={setChoice}
                          options={DUPLICATE_CHOICES}
                        />
                      ) : (
                        <span className="shrink-0 rounded-full bg-tint-teal px-1.5 py-0.5 text-[10px] font-medium text-teal-300">
                          New
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {preview.skippedFiles?.length ? (
            <details className="text-[11px] text-amber-400/90">
              <summary className="cursor-pointer">
                {preview.skippedFiles.length} file{preview.skippedFiles.length === 1 ? '' : 's'} could not be read and
                will be skipped
              </summary>
              <ul className="mt-1.5 space-y-0.5 pl-3 text-white/45">
                {preview.skippedFiles.map((file) => (
                  <li key={file.fileName} className="truncate">
                    {file.fileName} — {file.error}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {error ? <p role="alert" className="text-[12px] text-red-400">{error}</p> : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-surface-border px-5 py-3">
          <button type="button" className="btn-secondary px-3.5 py-1.5 text-sm" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5 px-3.5 py-1.5 text-sm disabled:opacity-40"
            onClick={() => void runImport()}
            disabled={busy || nothingToDo}
          >
            {busy ? <Loader size={13} className="animate-spin" aria-hidden="true" /> : null}
            {busy ? 'Importing…' : importLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}
