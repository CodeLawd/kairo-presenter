import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Download, Lock, RefreshCw } from 'lucide-react'
import type { ApiBibleOfflineTranslation } from '@shared/ipc'
import {
  OFFLINE_BIBLE_ACTION_LABELS,
  formatOfflineBibleExpiry,
  getOfflineBibleActions,
  getOfflineBibleProgressPercent,
  getOfflineBibleStatusLabel,
  mergeOfflineDownloadProgress,
  type OfflineBibleAction,
} from './offline-bible-view-model'

/**
 * Offline cache management for API.Bible translations. Progress is pushed from
 * the main process — this panel never polls, and never sees the API key, the
 * cache path, or cached text.
 */
export function OfflineBibleManager(): JSX.Element {
  const [rows, setRows] = useState<ApiBibleOfflineTranslation[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const next = await window.api.scripture.listOfflineTranslations()
    setRows(next)
  }, [])

  useEffect(() => {
    let active = true
    window.api.scripture
      .listOfflineTranslations()
      .then((next) => { if (active) setRows(next) })
      .catch((err: Error) => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })

    const unsubscribe = window.api.scripture.onOfflineDownloadProgress((progress) => {
      setRows((current) => mergeOfflineDownloadProgress(current, progress))
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const run = useCallback(
    async (row: ApiBibleOfflineTranslation, action: OfflineBibleAction) => {
      if (action === 'remove') {
        const confirmed = window.confirm(
          `Remove the offline copy of ${row.name}?\n\n` +
            'Its cached scripture text is deleted from this computer. Your API.Bible key and app settings are not changed, and the translation can still be searched online.',
        )
        if (!confirmed) return
      }
      setBusy(row.bibleId)
      setError(null)
      try {
        const api = window.api.scripture
        if (action === 'pause') await api.pauseTranslationDownload(row.bibleId)
        else if (action === 'refresh') await api.refreshOfflineTranslation(row.bibleId)
        else if (action === 'remove') await api.removeOfflineTranslation(row.bibleId)
        else await api.downloadTranslation(row.bibleId)
        await reload()
      } catch (err) {
        setError((err as Error).message)
        await reload().catch(() => {})
      } finally {
        setBusy(null)
      }
    },
    [reload],
  )

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="label">Offline Bibles</label>
        <button
          type="button"
          className="btn-secondary text-[10px] px-2 py-1"
          onClick={() => { void reload() }}
        >
          <RefreshCw size={11} className="mr-1 inline" />
          Reload
        </button>
      </div>

      <p className="mt-1 text-[10px] text-slate-500 leading-relaxed">
        API.Bible translations can be cached on this computer for offline use. Cached text must be
        refreshed at least every 30 days; expired text is not displayed until it is refreshed.
      </p>

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-[10px] text-amber-400">
          <AlertTriangle size={11} className="mt-px shrink-0" />
          {error}
        </p>
      )}

      <div className="mt-3 space-y-2">
        {loading && <p className="text-[10px] text-slate-500">Checking cached Bibles…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-[10px] text-slate-500">
            No API.Bible translations have been cached yet. Save an API.Bible key and search a
            passage to start caching, or download a translation once its offline licence is confirmed.
          </p>
        )}

        {rows.map((row) => {
          const actions = getOfflineBibleActions(row)
          const percent = getOfflineBibleProgressPercent(row)
          const expiry = formatOfflineBibleExpiry(row)
          return (
            <div key={row.bibleId} className="rounded-lg bg-surface-secondary/50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white tracking-tight truncate">
                    {row.translation} — {row.name}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {getOfflineBibleStatusLabel(row)}
                    {expiry ? ` · ${expiry}` : ''}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {row.cachedVerses.toLocaleString()} verses cached
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {actions.map((action) => (
                    <button
                      key={action}
                      type="button"
                      className="btn-secondary text-[10px] px-2 py-1"
                      disabled={busy === row.bibleId && action !== 'pause'}
                      onClick={() => { void run(row, action) }}
                    >
                      {action === 'download' && <Download size={11} className="mr-1 inline" />}
                      {OFFLINE_BIBLE_ACTION_LABELS[action]}
                    </button>
                  ))}
                </div>
              </div>

              {row.totalChapters > 0 && row.status !== 'downloaded' && (
                <div className="mt-2 h-1 rounded bg-surface-tertiary overflow-hidden">
                  <div className="h-full bg-teal-500 transition-all" style={{ width: `${percent}%` }} />
                </div>
              )}

              {!row.offlineDownloadEnabled && (
                <p className="mt-2 flex items-start gap-1.5 text-[10px] text-slate-500 leading-relaxed">
                  <Lock size={11} className="mt-px shrink-0" />
                  Whole-Bible download is disabled for this translation until its API.Bible plan and
                  publisher licence are confirmed to permit offline storage in this app. Verses you
                  search are still cached for 30 days.
                </p>
              )}

              {row.copyright && (
                <p className="mt-2 text-[10px] text-slate-600 leading-relaxed">{row.copyright}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
