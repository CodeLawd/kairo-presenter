import { useEffect, useMemo, useState } from 'react'
import { Loader, Search, Upload, X } from '@/icons'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { exportKairo, useTransferStore } from '@/stores/useTransfer'

/**
 * Pick songs for a `.kairo` file. Opening with nothing preselected and
 * pressing "Select all" is how the whole library is exported.
 */
export function ExportSongsModal({ preselect }: { preselect: string[] }): React.ReactElement {
  const songs = useBootstrapStore((s) => s.lyrics)
  const close = useTransferStore((s) => s.closeSongExport)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselect))
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !busy) close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, close])

  const sorted = useMemo(
    () => [...songs].sort((a, b) => a.title.localeCompare(b.title)),
    [songs],
  )
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((song) => `${song.title} ${song.artist}`.toLowerCase().includes(q))
  }, [sorted, query])

  const allVisibleSelected = visible.length > 0 && visible.every((song) => selected.has(song.id))
  const toggleAllVisible = (): void =>
    setSelected((current) => {
      const next = new Set(current)
      for (const song of visible) {
        if (allVisibleSelected) next.delete(song.id)
        else next.add(song.id)
      }
      return next
    })
  const toggle = (id: string): void =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const everything = selected.size === songs.length && songs.length > 0

  const runExport = async (): Promise<void> => {
    setBusy(true)
    const saved = await exportKairo(
      everything && !name.trim()
        ? { kind: 'library' }
        : { kind: 'songs', songIds: sorted.filter((s) => selected.has(s.id)).map((s) => s.id), name: name.trim() || undefined },
    )
    setBusy(false)
    if (saved) close()
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 animate-fade-in"
      onClick={() => { if (!busy) close() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kairo-export-title"
        className="flex max-h-[min(640px,90vh)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="kairo-export-title" className="text-sm font-semibold text-white">Export songs</h2>
            <p className="mt-0.5 text-[11px] text-white/40">
              Saves a .kairo file any Kairo can import, lyrics included.
            </p>
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

        <div className="space-y-2 px-5 py-3">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search songs"
              aria-label="Search songs to export"
              className="input h-8 pl-8 text-[13px]"
              autoFocus
            />
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <button type="button" className="text-teal-400 hover:text-teal-300" onClick={toggleAllVisible}>
              {allVisibleSelected ? 'Clear' : query ? 'Select matches' : 'Select all'}
            </button>
            <span className="tabular-nums text-white/40">
              {selected.size} of {songs.length} selected
            </span>
          </div>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
          {visible.length === 0 ? (
            <li className="px-3 py-6 text-center text-[12px] text-white/35">
              {songs.length === 0 ? 'Your song library is empty.' : 'No songs match.'}
            </li>
          ) : (
            visible.map((song) => (
              <li key={song.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-1.5 hover:bg-surface-tertiary">
                  <input
                    type="checkbox"
                    checked={selected.has(song.id)}
                    onChange={() => toggle(song.id)}
                    className="h-3.5 w-3.5 shrink-0 accent-teal-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-white">{song.title}</span>
                    {song.artist ? (
                      <span className="block truncate text-[11px] text-white/35">{song.artist}</span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))
          )}
        </ul>

        <footer className="space-y-2.5 px-5 py-3">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={everything ? 'All songs' : selected.size === 1 ? 'File name (optional)' : `${selected.size} songs`}
            aria-label="Export name"
            maxLength={80}
            className="input h-8 text-[13px]"
          />
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-secondary px-3.5 py-1.5 text-sm" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex items-center gap-1.5 px-3.5 py-1.5 text-sm disabled:opacity-40"
              disabled={busy || selected.size === 0}
              onClick={() => void runExport()}
            >
              {busy ? <Loader size={13} className="animate-spin" aria-hidden="true" /> : <Upload size={13} aria-hidden="true" />}
              Export {selected.size > 0 ? selected.size : ''} song{selected.size === 1 ? '' : 's'}…
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
