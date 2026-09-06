import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Download, Lock, RefreshCw } from '@/icons'
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
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] text-white">Cached translations</p>
        <button
          type="button"
          className="btn-secondary px-2 py-1 text-[11px]"
          onClick={() => { void reload() }}
        >
          <RefreshCw size={11} className="mr-1 inline" />
          Reload
        </button>
      </div>

      <p className="text-[11px] leading-snug text-white/40">
        Cached for offline use. Refresh at least every 30 days.
      </p>

      {error && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-400">
          <AlertTriangle size={11} className="mt-px shrink-0" />
          {error}
        </p>
      )}

      <div className="space-y-1.5">
        {loading && <p className="text-[11px] text-white/40">Checking cached Bibles…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-[11px] leading-snug text-white/40">
            None cached yet. Save an API.Bible key and search a passage, or download once the licence allows it.
          </p>
        )}

        {rows.map((row) => {
          const actions = getOfflineBibleActions(row)
          const percent = getOfflineBibleProgressPercent(row)
          const expiry = formatOfflineBibleExpiry(row)
          return (
            <div key={row.bibleId} className="rounded-md bg-[#1c1c1c] px-2.5 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-white">
                    {row.translation} — {row.name}
                  </p>
                  <p className="mt-0.5 text-[11px] text-white/40">
                    {getOfflineBibleStatusLabel(row)}
                    {expiry ? ` · ${expiry}` : ''}
                    {' · '}
                    {row.cachedVerses.toLocaleString()} verses
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {actions.map((action) => (
                    <button
                      key={action}
                      type="button"
                      className="btn-secondary px-2 py-1 text-[11px]"
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
                <div className="mt-2 h-1 overflow-hidden rounded bg-white/10">
                  <div className="h-full bg-[#007aff] transition-all" style={{ width: `${percent}%` }} />
                </div>
              )}

              {!row.offlineDownloadEnabled && (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-white/35">
                  <Lock size={11} className="mt-px shrink-0" />
                  Whole-Bible download is disabled until the publisher licence is confirmed. Searched verses are still cached for 30 days.
                </p>
              )}

              {row.copyright && (
                <p className="mt-1.5 text-[10px] leading-snug text-white/30">{row.copyright}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
