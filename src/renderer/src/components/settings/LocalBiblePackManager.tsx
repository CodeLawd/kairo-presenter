import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Download, Loader, Trash2 } from '@/icons'
import type { InstalledLocalBiblePack, LocalBiblePackStatus } from '@shared/ipc'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { cn } from '@/lib/utils'

/**
 * Offline Bible library, driven by the bible-translations registry.
 *
 * Which ids appear here is data, not code: bundled translations show as
 * built-in, any registry entry with a `downloadablePack` offers a one-click
 * download, and every other installed pack gets its own row so it can still be
 * removed even when the registry has never heard of its id.
 *
 * Download, verification, and install all run in the main process — this
 * panel only sees the typed install status.
 */
export function LocalBiblePackManager(): JSX.Element {
  const translations = useBootstrapStore((state) => state.translations)
  const [epoch, setEpoch] = useState(0)
  const [installed, setInstalled] = useState<InstalledLocalBiblePack[]>([])

  useEffect(() => {
    let active = true
    window.api.scripture
      .listInstalledLocalBiblePacks()
      .then((packs) => { if (active) setInstalled(packs) })
      .catch(() => { /* rows for downloadable packs still render */ })
    return () => { active = false }
  }, [epoch])

  const refreshAll = useCallback(() => setEpoch((value) => value + 1), [])

  const bundled = translations.filter(
    (option) => option.access === 'local' && option.available && !option.downloadable,
  )
  const downloadable = translations.filter((option) => option.downloadable)

  // Downloadable registry packs first (installed or not), then every other
  // installed pack. Before the first snapshot loads, the registry default
  // keeps the panel useful.
  const packs: Array<{ id: string; name: string; downloadable: boolean; size?: string }> = (
    downloadable.length > 0
      ? downloadable.map((option) => ({
          id: option.id,
          name: option.name,
          downloadable: true,
          size: option.downloadApprox,
        }))
      : [{ id: 'NKJV', name: 'New King James Version', downloadable: true }]
  )
  for (const pack of installed) {
    const id = pack.translation.toUpperCase()
    if (packs.some((row) => row.id.toUpperCase() === id)) continue
    if (bundled.some((option) => option.id.toUpperCase() === id)) continue
    packs.push({ id: pack.translation, name: pack.name, downloadable: false })
  }

  return (
    <ul className="divide-y divide-white/[0.07]">
      {bundled.map((option) => (
        <BibleRowShell key={option.id} id={option.id} name={option.name} detail="Included with Kairo · works offline">
          <span className="inline-flex items-center gap-1 text-[11px] text-white/40">
            <Check size={12} aria-hidden="true" />
            Built in
          </span>
        </BibleRowShell>
      ))}
      {packs.map((pack) => (
        <LocalBiblePackRow
          key={pack.id}
          translationId={pack.id}
          translationName={pack.name || pack.id}
          downloadable={pack.downloadable}
          size={pack.size}
          epoch={epoch}
          onChanged={refreshAll}
        />
      ))}
    </ul>
  )
}

/** Shared list row (`<li>`): abbreviation tile, name + detail line, trailing actions. */
function BibleRowShell({
  id,
  name,
  detail,
  detailTone = 'muted',
  children,
  footer,
}: {
  id: string
  name: string
  detail: React.ReactNode
  detailTone?: 'muted' | 'warn'
  children?: React.ReactNode
  footer?: React.ReactNode
}): JSX.Element {
  return (
    <li className="px-3.5 py-2.5">
      <div className="flex items-center gap-3">
        <span className="grid h-8 min-w-[40px] shrink-0 place-items-center rounded-[7px] bg-white/[0.06] px-1.5 font-mono text-[10px] font-semibold tracking-wide text-white/75">
          {id}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] leading-tight text-white">{name}</p>
          <p
            className={cn(
              'mt-0.5 truncate text-[11px] leading-snug',
              detailTone === 'warn' ? 'text-amber-400' : 'text-white/40',
            )}
          >
            {detail}
          </p>
        </div>
        {children ? <div className="flex shrink-0 items-center gap-1">{children}</div> : null}
      </div>
      {footer}
    </li>
  )
}

const ROW_ACTION =
  'inline-flex h-7 items-center gap-1.5 rounded-[6px] bg-white/[0.08] px-2.5 text-[12px] font-medium text-white transition-colors hover:bg-white/[0.13] disabled:opacity-40'
const ROW_ICON_ACTION =
  'grid h-7 w-7 place-items-center rounded-[6px] text-white/35 transition-colors hover:bg-white/[0.07] hover:text-[#FF453A] disabled:opacity-40'

function LocalBiblePackRow({
  translationId,
  translationName,
  downloadable,
  size,
  epoch,
  onChanged,
}: {
  translationId: string
  translationName: string
  downloadable: boolean
  size?: string
  epoch: number
  onChanged: () => void
}): JSX.Element | null {
  const [status, setStatus] = useState<LocalBiblePackStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'download' | 'remove' | null>(null)
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
    setBusy('download')
    setError(null)
    try {
      const next = await window.api.scripture.downloadLocalBibleTranslation(translationId)
      setStatus(next)
      await refreshTranslations()
      onChanged()
    } catch (err) {
      setError((err as Error).message)
      await reload().catch(() => {})
    } finally {
      setBusy(null)
    }
  }, [onChanged, refreshTranslations, reload, translationId])

  const remove = useCallback(async () => {
    const confirmed = window.confirm(
      `Remove ${translationName} from this computer?\n\n` +
        (downloadable
          ? 'You can download it again at any time, or search it online with an API.Bible key.'
          : 'This translation is no longer offered for download, so it cannot be reinstalled from here.'),
    )
    if (!confirmed) return
    setBusy('remove')
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
      setBusy(null)
    }
  }, [downloadable, onChanged, refreshTranslations, reload, translationId, translationName])

  const isInstalled = Boolean(status?.installed)
  const detail = error
    ? error
    : loading
      ? 'Checking…'
      : busy === 'download'
        ? 'Downloading and verifying…'
        : isInstalled
          ? `Installed · ${status!.verseCount.toLocaleString()} verses · works offline`
          : downloadable
            ? `${size ? `${size.replace(/^about /, '~')} · ` : ''}Download once to use offline`
            : 'Not installed'

  // Nothing to offer on a non-downloadable pack that is already gone.
  if (!loading && !isInstalled && !downloadable && !error) return null

  return (
    <BibleRowShell
      id={translationId}
      name={translationName}
      detail={
        error ? (
          <span className="inline-flex items-center gap-1">
            <AlertTriangle size={11} className="shrink-0" aria-hidden="true" />
            {detail}
          </span>
        ) : detail
      }
      detailTone={error ? 'warn' : 'muted'}
    >
      {isInstalled ? (
        <>
          <span className="inline-flex items-center gap-1 pr-1 text-[11px] text-[#30D158]">
            <Check size={12} aria-hidden="true" />
            Installed
          </span>
          <button
            type="button"
            className={ROW_ICON_ACTION}
            disabled={busy !== null || loading}
            onClick={() => { void remove() }}
            aria-label={`Remove ${translationName}`}
            title="Remove from this computer"
          >
            {busy === 'remove' ? (
              <Loader size={13} className="animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 size={13} aria-hidden="true" />
            )}
          </button>
        </>
      ) : downloadable ? (
        <button
          type="button"
          className={ROW_ACTION}
          disabled={busy !== null || loading}
          onClick={() => { void download() }}
        >
          {busy === 'download' ? (
            <Loader size={12} className="animate-spin" aria-hidden="true" />
          ) : (
            <Download size={12} aria-hidden="true" />
          )}
          {busy === 'download' ? 'Installing…' : 'Install'}
        </button>
      ) : null}
    </BibleRowShell>
  )
}
