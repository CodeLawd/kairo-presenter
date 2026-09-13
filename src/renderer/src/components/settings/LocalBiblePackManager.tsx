import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Trash2, Upload } from '@/icons'
import type { LocalBiblePackStatus } from '@shared/ipc'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'

/**
 * Optional local Bible packs (today: NKJV).
 *
 * The file picker runs in the main process — this panel never sees a
 * filesystem path, only the typed install status. The one-click download
 * lives in the translation picker above; this panel covers install-from-file
 * and removal of whatever is installed.
 */
export function LocalBiblePackManager(): JSX.Element {
  const [status, setStatus] = useState<LocalBiblePackStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const next = await window.api.scripture.getLocalBiblePackStatus('NKJV')
    setStatus(next)
    return next
  }, [])

  useEffect(() => {
    let active = true
    window.api.scripture
      .getLocalBiblePackStatus('NKJV')
      .then((next) => { if (active) setStatus(next) })
      .catch((err: Error) => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const refreshTranslations = useCallback(async () => {
    try {
      const translations = await window.api.scripture.getTranslations()
      useBootstrapStore.getState().setTranslations(translations)
    } catch {
      // Availability refresh is best-effort; the pack status above is authoritative.
    }
  }, [])

  const install = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await window.api.scripture.installLocalBiblePack()
      if (!next) return
      setStatus(next)
      await refreshTranslations()
    } catch (err) {
      const message = (err as Error).message
      setError(message)
      await reload().catch(() => {})
    } finally {
      setBusy(false)
    }
  }, [refreshTranslations, reload])

  const remove = useCallback(async () => {
    const confirmed = window.confirm(
      'Remove the local copy of the New King James Version?\n\n' +
        'Its verses are deleted from this computer. The translation can still be searched online with an API.Bible key.',
    )
    if (!confirmed) return
    setBusy(true)
    setError(null)
    try {
      const next = await window.api.scripture.removeLocalBibleTranslation('NKJV')
      setStatus(next)
      await refreshTranslations()
    } catch (err) {
      setError((err as Error).message)
      await reload().catch(() => {})
    } finally {
      setBusy(false)
    }
  }, [refreshTranslations, reload])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] text-white">New King James Version</p>
        <p className="text-[11px] text-white/40">
          {loading ? 'Checking…' : status?.installed ? 'Installed' : 'Not installed'}
        </p>
      </div>

      <p className="text-[11px] leading-snug text-white/40">
        {status?.installed
          ? `${status.verseCount.toLocaleString()} verses available offline — no API key needed.`
          : 'Works entirely offline after installing a pack file. Without it, NKJV searches use your API.Bible key.'}
      </p>

      {error && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-400" role="alert">
          <AlertTriangle size={11} className="mt-px shrink-0" />
          {error}
        </p>
      )}

      <div className="flex gap-1.5">
        <button
          type="button"
          className="btn-secondary px-2 py-1 text-[11px]"
          disabled={busy || loading}
          onClick={() => { void install() }}
        >
          <Upload size={11} className="mr-1 inline" />
          {busy ? 'Working…' : 'Install from file…'}
        </button>
        {status?.installed && (
          <button
            type="button"
            className="btn-secondary px-2 py-1 text-[11px]"
            disabled={busy || loading}
            onClick={() => { void remove() }}
          >
            <Trash2 size={11} className="mr-1 inline" />
            Remove local copy
          </button>
        )}
      </div>
    </div>
  )
}
