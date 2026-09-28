import { useEffect, useMemo, useState } from 'react'
import { Download, X } from '@/icons'
import { isoDate, summarizeSongUsage, type SongUsageEntry } from '@shared/song-usage'

/** Local midnight at the start of a `yyyy-mm-dd` day. */
function startOfDay(value: string): number {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime()
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * What was sung, for a CCLI report: one line per song with its use count,
 * exportable as a per-service CSV.
 */
export function SongUsageModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const [from, setFrom] = useState(() => isoDate(Date.now() - 90 * DAY_MS))
  const [to, setTo] = useState(() => isoDate(Date.now()))
  const [entries, setEntries] = useState<SongUsageEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const range: [number, number] = [startOfDay(from), startOfDay(to) + DAY_MS]

  useEffect(() => {
    let cancelled = false
    window.api.songUsage
      .list(startOfDay(from), startOfDay(to) + DAY_MS)
      .then((next) => {
        if (!cancelled) setEntries(next)
      })
      .catch((err) => console.error(err))
    return () => {
      cancelled = true
    }
  }, [from, to])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const rows = useMemo(() => summarizeSongUsage(entries), [entries])
  const missingCcli = rows.filter((row) => !row.ccliNumber).length

  const exportCsv = async (): Promise<void> => {
    setBusy(true)
    try {
      setSaved(await window.api.songUsage.exportCsv(range[0], range[1]))
    } catch (err) {
      window.alert((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 animate-fade-in" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="song-usage-title"
        className="flex max-h-[min(640px,90vh)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-surface-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="song-usage-title" className="text-sm font-semibold text-white">Song usage</h2>
            <p className="mt-0.5 text-[11px] text-white/40">
              Every song pushed from Kairo, counted once per service — for your CCLI report.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-7 w-7 place-items-center rounded-md text-white/40 hover:bg-surface-tertiary hover:text-white">
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        <div className="flex items-end gap-3 border-b border-surface-border px-5 py-3 text-[11px] text-white/50">
          <label className="flex flex-col gap-1">
            From
            <input type="date" className="input h-8 text-xs" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            To
            <input type="date" className="input h-8 text-xs" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </label>
          <span className="ml-auto pb-2 tabular-nums">
            {entries.length} use{entries.length === 1 ? '' : 's'} · {rows.length} song{rows.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-[12px] text-white/40">No songs were pushed in this period.</p>
          ) : (
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 bg-surface text-[10px] uppercase tracking-wide text-white/40">
                <tr>
                  <th className="px-5 py-2 font-medium">Song</th>
                  <th className="px-2 py-2 font-medium">CCLI #</th>
                  <th className="px-5 py-2 text-right font-medium">Uses</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.songId} className="border-t border-surface-border/40">
                    <td className="px-5 py-1.5">
                      <div className="truncate text-white/90">{row.title}</div>
                      {row.artist && <div className="truncate text-[10px] text-white/40">{row.artist}</div>}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums text-white/60">{row.ccliNumber || <span className="text-amber-400/80">—</span>}</td>
                    <td className="px-5 py-1.5 text-right tabular-nums text-white/80">{row.uses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="flex items-center gap-3 border-t border-surface-border px-5 py-3">
          <p className="min-w-0 flex-1 truncate text-[10px] text-white/40">
            {saved
              ? `Saved to ${saved}`
              : missingCcli > 0
                ? `${missingCcli} song${missingCcli === 1 ? ' has' : 's have'} no CCLI number — add it in the song editor.`
                : 'One line per song per service, local dates.'}
          </p>
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-40"
            disabled={busy || entries.length === 0}
            onClick={() => void exportCsv()}
          >
            <Download size={12} aria-hidden="true" /> Export CSV
          </button>
        </footer>
      </div>
    </div>
  )
}
