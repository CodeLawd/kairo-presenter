import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Download, Trash2, Upload } from '@/icons'
import type { InstalledLocalBiblePack, LocalBiblePackStatus } from '@shared/ipc'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'

/**
 * Optional local Bible packs, driven by the bible-translations registry.
 *
 * Which ids appear here is data, not code: any registry entry with a
 * `downloadablePack` shows up (flagged `downloadable` on the translation
 * option). Adding a new downloadable translation needs no change here.
 *
 * Download, verification, and install all run in the main process — this
 * panel only sees the typed install status. The translation picker above
 * offers the same one-click download when a downloadable id is selected.
 * The single "Install from file" button below the list accepts a pack for
 * ANY translation — that is how new translations land without an app release.
 * Every installed, non-bundled pack gets its own row (and Remove button), even
 * when the registry has never heard of its id.
 */
export function LocalBiblePackManager(): JSX.Element {
  const translations = useBootstrapStore((state) => state.translations)
  const downloadable = translations.filter((option) => option.downloadable)
  const [epoch, setEpoch] = useState(0)
  const [installed, setInstalled] = useState<InstalledLocalBiblePack[]>([])
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    window.api.scripture
      .listInstalledLocalBiblePacks()
      .then((packs) => { if (active) setInstalled(packs) })
      .catch(() => { /* rows for downloadable packs still render */ })
    return () => { active = false }
  }, [epoch])

  const refreshAll = useCallback(() => setEpoch((value) => value + 1), [])

  // Downloadable registry packs first (installed or not), then every other
  // installed pack. Before the first snapshot loads, the registry default
  // keeps the panel useful.
  const packs: Array<{ id: string; name: string; downloadable: boolean }> = (
    downloadable.length > 0
      ? downloadable.map((option) => ({ id: option.id, name: option.name, downloadable: true }))
      : [{ id: 'NKJV', name: 'New King James Version', downloadable: true }]
  )
  for (const pack of installed) {
    if (!packs.some((row) => row.id.toUpperCase() === pack.translation.toUpperCase())) {
      packs.push({ id: pack.translation, name: pack.name, downloadable: false })
    }
  }

  const installFromFile = useCallback(async () => {
    setInstalling(true)
    setInstallError(null)
    try {
      // Native picker runs in main; no path ever crosses the bridge. Returns
      // null when the operator cancels.
      const installed = await window.api.scripture.installLocalBiblePack()
      if (installed) {
        try {
          const refreshed = await window.api.scripture.getTranslations()
          useBootstrapStore.getState().setTranslations(refreshed)
        } catch {
          // Availability refresh is best-effort; the row statuses reload below.
        }
        refreshAll()
      }
    } catch (err) {
      setInstallError((err as Error).message)
    } finally {
      setInstalling(false)
    }
  }, [refreshAll])

  return (
    <div className="space-y-4">
      {packs.map((pack) => (
        <LocalBiblePackRow
          key={pack.id}
          translationId={pack.id}
          translationName={pack.name || pack.id}
          downloadable={pack.downloadable}
          epoch={epoch}
          onChanged={refreshAll}
        />
      ))}

      {installError && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-400" role="alert">
          <AlertTriangle size={11} className="mt-px shrink-0" />
          {installError}
        </p>
      )}

      <div className="flex gap-1.5">
        <button
          type="button"
          className="btn-secondary px-2 py-1 text-[11px]"
          disabled={installing}
          onClick={() => { void installFromFile() }}
          title="Install a Bible pack file for any translation"
        >
          <Upload size={11} className="mr-1 inline" />
          {installing ? 'Installing…' : 'Install from file…'}
        </button>
      </div>
    </div>
  )
}

function LocalBiblePackRow({
  translationId,
  translationName,
  downloadable,
  epoch,
  onChanged,
}: {
  translationId: string
  translationName: string
  downloadable: boolean
  epoch: number
  onChanged: () => void
}): JSX.Element {
  const [status, setStatus] = useState<LocalBiblePackStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const next = await window.api.scripture.getLocalBiblePackStatus(translationId)
    setStatus(next)
    return next
  }, [translationId])

  useEffect(() => {
    let active = true
    setLoading(true)
    window.api.scripture
      .getLocalBiblePackStatus(translationId)
      .then((next) => { if (active) setStatus(next) })
      .catch((err: Error) => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [translationId, epoch])

  const refreshTranslations = useCallback(async () => {
    try {
      const translations = await window.api.scripture.getTranslations()
      useBootstrapStore.getState().setTranslations(translations)
    } catch {
      // Availability refresh is best-effort; the pack status above is authoritative.
    }
  }, [])

  const download = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await window.api.scripture.downloadLocalBibleTranslation(translationId)
      setStatus(next)
      await refreshTranslations()
      onChanged()
    } catch (err) {
      const message = (err as Error).message
      setError(message)
      await reload().catch(() => {})
    } finally {
      setBusy(false)
    }
  }, [onChanged, refreshTranslations, reload, translationId])

  const remove = useCallback(async () => {
    const confirmed = window.confirm(
      `Remove the local copy of ${translationName}?\n\n` +
        (downloadable
          ? 'Its verses are deleted from this computer. You can download it again, or search it online with an API.Bible key.'
          : 'Its verses are deleted from this computer. To use it offline again, install its pack file again.'),
    )
    if (!confirmed) return
    setBusy(true)
    setError(null)
    try {
      const next = await window.api.scripture.removeLocalBibleTranslation(translationId)
      setStatus(next)
      await refreshTranslations()
      onChanged()
    } catch (err) {
      setError((err as Error).message)
      await reload().catch(() => {})
    } finally {
      setBusy(false)
    }
  }, [downloadable, onChanged, refreshTranslations, reload, translationId, translationName])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] text-white">{translationName}</p>
        <p className="text-[11px] text-white/40">
          {loading ? 'Checking…' : status?.installed ? 'Installed' : 'Not installed'}
        </p>
      </div>

      <p className="text-[11px] leading-snug text-white/40">
        {status?.installed
          ? `${status.verseCount.toLocaleString()} verses available offline — no API key needed.`
          : downloadable
            ? `Download once to use ${translationId} entirely offline. Without it, ${translationId} searches use your API.Bible key.`
            : `Not installed. Use "Install from file…" to add ${translationId} again.`}
      </p>

      {error && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-400" role="alert">
          <AlertTriangle size={11} className="mt-px shrink-0" />
          {error}
        </p>
      )}

      <div className="flex gap-1.5">
        {downloadable && !status?.installed && (
          <button
            type="button"
            className="btn-secondary px-2 py-1 text-[11px]"
            disabled={busy || loading}
            onClick={() => { void download() }}
          >
            <Download size={11} className="mr-1 inline" />
            {busy ? 'Downloading…' : `Download ${translationId}`}
          </button>
        )}
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
