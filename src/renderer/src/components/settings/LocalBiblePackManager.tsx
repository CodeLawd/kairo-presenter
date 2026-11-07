import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertDialog, DropdownMenu } from 'radix-ui'
import { AlertTriangle, CheckCircle, ChevronDown, Download, Loader, Trash2 } from '@/icons'
import type { InstalledLocalBiblePack, LocalBiblePackStatus } from '@shared/ipc'
import { isBundledTranslation } from '@shared/bible-translations'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { MovableDialog } from '@/components/shared/MovableDialog'
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
  const [expanded, setExpanded] = useState(true)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
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
    (option) => isBundledTranslation(option.id) && option.available,
  )
  const downloadable = translations.filter((option) => option.downloadable)
  const online = translations.filter((option) =>
    option.available && option.requiresApiKey && !option.downloadable && !isBundledTranslation(option.id),
  )

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

  const pendingPacks = packs.filter(pack => pack.downloadable &&
    !installed.some(item => item.translation.toUpperCase() === pack.id.toUpperCase()))

  const downloadAll = async (): Promise<void> => {
    setBulkBusy(true)
    setBulkError(null)
    try {
      for (const pack of pendingPacks) {
        const status = await window.api.scripture.getLocalBiblePackStatus(pack.id)
        if (!status.installed) await window.api.scripture.downloadLocalBibleTranslation(pack.id)
      }
    } catch (error) {
      setBulkError((error as Error).message)
    } finally {
      try {
        useBootstrapStore.getState().setTranslations(await window.api.scripture.getTranslations())
      } catch (error) {
        setBulkError((error as Error).message)
      } finally {
        refreshAll()
        setBulkBusy(false)
      }
    }
  }

  return (
    <div className="py-2">
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left text-[13px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          aria-expanded={expanded} aria-controls="english-bible-library" onClick={() => setExpanded(value => !value)}>
          <span aria-hidden="true" className="grid h-6 w-6 place-items-center overflow-hidden rounded-full text-xl">🇬🇧</span>
          English
        </button>
        {pendingPacks.length > 0 && (
          <button type="button" disabled={bulkBusy} onClick={() => { void downloadAll() }}
            className="rounded-md text-[12px] font-medium text-white hover:text-white/75 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400">
            {bulkBusy ? 'Downloading…' : 'Download all'}
          </button>
        )}
        <button type="button" aria-label={expanded ? 'Collapse English Bibles' : 'Expand English Bibles'} aria-expanded={expanded} aria-controls="english-bible-library"
          onClick={() => setExpanded(value => !value)} className={ROW_ICON_ACTION}>
          <ChevronDown size={18} className={expanded ? 'rotate-180' : ''} aria-hidden="true" />
        </button>
      </div>
      {bulkError && <p role="alert" className="px-4 pb-2 text-[12px] text-amber-400">{bulkError}</p>}
      <ul id="english-bible-library" hidden={!expanded}>
        {bundled.map((option) => (
          <BibleRowShell key={option.id} id={option.id} name={option.name} detail={null}>
            <span className="grid h-7 w-7 place-items-center text-white" role="img" aria-label="Built in · available offline" title="Built in · available offline">
              <CheckCircle size={18} aria-hidden="true" />
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
        {online.map((option) => (
          <BibleRowShell key={option.id} id={option.id} name={option.name} detail={null}>
            <span className="text-[11px] text-white/65">Online</span>
          </BibleRowShell>
        ))}
      </ul>
    </div>
  )
}

/** Compact translation row with optional progress or error details. */
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
    <li className="px-4 py-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-snug text-white"><span className="font-semibold">{id}</span> · {name}</p>
          {detail && <p
            className={cn(
              'mt-0.5 break-words text-[12px] leading-snug',
              detailTone === 'warn' ? 'text-amber-400' : 'text-white/65',
            )}
          >
            {detail}
          </p>}
        </div>
        {children ? <div className="flex shrink-0 items-center gap-1">{children}</div> : null}
      </div>
      {footer}
    </li>
  )
}

const ROW_ICON_ACTION =
  'grid h-7 w-7 place-items-center rounded-md text-white/50 transition-colors hover:bg-surface-tertiary hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 disabled:opacity-40'

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
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const actionsRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const reload = useCallback(async () => {
    const next = await window.api.scripture.getLocalBiblePackStatus(translationId)
    setStatus(previous => (previous?.installation?.revision ?? 0) > (next.installation?.revision ?? 0) ? previous : next)
    return next
  }, [translationId])

  const refreshTranslations = useCallback(async () => {
    try {
      const translations = await window.api.scripture.getTranslations()
      useBootstrapStore.getState().setTranslations(translations)
    } catch {
      // Availability refresh is best-effort; the pack status above is authoritative.
    }
  }, [])

  useEffect(() => {
    let active = true
    const unsubscribe = window.api.scripture.onLocalBibleInstallProgress(progress => {
      if (!active || progress.translation !== translationId) return
      setError(null)
      setStatus(previous => {
        if ((previous?.installation?.revision ?? 0) > progress.revision) return previous
        return {
          translation: translationId, verseCount: previous?.verseCount ?? 0,
          chapterCount: previous?.chapterCount ?? 0,
          installed: progress.phase === 'ready' || Boolean(previous?.installed),
          installation: progress,
        }
      })
      if (progress.phase === 'ready') {
        const bootstrap = useBootstrapStore.getState()
        bootstrap.setTranslations(bootstrap.translations.map(option => option.id === translationId
          ? { ...option, available: true, requiresApiKey: false }
          : option))
        void reload().then(() => refreshTranslations()).then(onChanged).catch(() => {})
      }
    })
    window.api.scripture
      .getLocalBiblePackStatus(translationId)
      .then((next) => {
        if (active) setStatus(previous => (previous?.installation?.revision ?? 0) > (next.installation?.revision ?? 0) ? previous : next)
      })
      .catch((err: Error) => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; unsubscribe() }
  }, [translationId, epoch, reload, onChanged, refreshTranslations])



  const download = useCallback(async () => {
    setBusy('download')
    setError(null)
    try {
      const next = await window.api.scripture.downloadLocalBibleTranslation(translationId)
      setStatus(previous => ({ ...next, installation: previous?.installation }))
      setBusy(null)
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
    setBusy('remove')
    setError(null)
    try {
      const next = await window.api.scripture.removeLocalBibleTranslation(translationId)
      setStatus(next)
      setRemoveDialogOpen(false)
      await refreshTranslations()
      onChanged()
    } catch (err) {
      setError((err as Error).message)
      await reload().catch(() => {})
    } finally {
      setBusy(null)
    }
  }, [onChanged, refreshTranslations, reload, translationId])

  const isInstalled = Boolean(status?.installed)
  const installation = status?.installation
  const phase = installation?.phase
  const installing = phase === 'downloading' || phase === 'verifying' || phase === 'installing' || (busy === 'download' && phase !== 'ready' && phase !== 'failed')
  const failure = (phase === 'failed' ? installation?.error : null) || error
  const received = installation?.receivedBytes ?? 0
  const total = installation?.totalBytes
  const percent = total ? Math.min(100, Math.floor(received / total * 100)) : undefined
  const amount = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} MB`
  const detail = failure
    ? failure
    : installing
      ? phase === 'verifying' ? 'Checking download…'
        : phase === 'installing' ? 'Finishing installation…'
          : received > 0 ? `Downloading · ${amount(received)}${total ? ` of ${amount(total)} · ${percent}%` : ' received'}`
            : 'Connecting to download…'
    : loading
      ? 'Checking…'
        : isInstalled
          ? 'Ready offline · No internet needed'
          : downloadable
            ? `${size ? `${size.replace(/^about /, '~')} · ` : ''}Download once to use offline`
            : 'Not installed'

  // Nothing to offer on a non-downloadable pack that is already gone.
  if (!loading && !isInstalled && !downloadable && !failure) return null

  return (
    <AlertDialog.Root open={removeDialogOpen} onOpenChange={(open) => { if (busy !== 'remove') setRemoveDialogOpen(open) }}>
      <BibleRowShell
        id={translationId}
        name={translationName}
        detail={
          failure ? (
            <span role="alert" className="inline-flex items-start gap-1">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              {detail}
            </span>
          ) : (installing || loading) ? <span role="status" aria-live="polite">{detail}</span> : null
        }
        detailTone={failure ? 'warn' : 'muted'}
        footer={installing ? (
          <div className="mt-2">
            {phase === 'downloading' && total ? (
              <div role="progressbar" aria-label={`Downloading ${translationId}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1 overflow-hidden rounded-full bg-surface-border">
                <div className="h-full rounded-full bg-teal-400 transition-[width] duration-150 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
              </div>
            ) : <div role="progressbar" aria-label={`Installing ${translationId}`} className="h-1 rounded-full bg-surface-border" />}
            <p className="mt-1.5 text-[11px] text-white/60">You can keep using Kairo while this finishes.</p>
          </div>
        ) : undefined}
      >
        {installing ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-white/65">
            <Loader size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Installing…
          </span>
        ) : isInstalled ? (
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger asChild>
                <button ref={actionsRef} type="button" className={ROW_ICON_ACTION} disabled={busy !== null || loading}
                  aria-label={`Actions for ${translationName}`} title="Installed · manage download">
                  <CheckCircle size={18} className="text-white" aria-hidden="true" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={4}
                  onCloseAutoFocus={(event) => { if (removeDialogOpen) event.preventDefault() }}
                  className="z-[80] min-w-[180px] rounded-lg bg-surface-elevated p-1 text-[13px] text-white shadow-lg outline-none">
                  <DropdownMenu.Item className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-red-400 outline-none focus:bg-surface-border"
                    onSelect={() => { setError(null); setRemoveDialogOpen(true) }}>
                    <Trash2 size={14} aria-hidden="true" />
                    Remove download…
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
        ) : downloadable ? (
          <button
            type="button"
            className={ROW_ICON_ACTION}
            disabled={busy !== null || loading}
            aria-label={`${failure ? 'Retry download' : 'Download'} ${translationName}`}
            title={`${failure ? 'Retry download' : 'Download'} ${translationId}${size ? ` (${size})` : ''}`}
            onClick={() => { void download() }}
          >
            <Download size={18} className="text-white" aria-hidden="true" />
          </button>
        ) : null}
      </BibleRowShell>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[80] bg-black/50" />
        <div className="fixed inset-0 z-[81] flex items-center justify-center p-4 pointer-events-none">
          <MovableDialog className="w-full max-w-[420px] pointer-events-auto">
            <AlertDialog.Content className="w-full rounded-xl bg-surface-secondary p-6 text-white shadow-xl outline-none"
              onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus() }}
              onCloseAutoFocus={(event) => { event.preventDefault(); actionsRef.current?.focus() }}
              onEscapeKeyDown={(event) => { event.preventDefault(); if (busy !== 'remove') setRemoveDialogOpen(false) }}>
              <div data-modal-drag>
                <AlertDialog.Title className="text-[18px] font-semibold leading-snug">Remove {translationId} download?</AlertDialog.Title>
                <AlertDialog.Description className="mt-2 text-[14px] leading-relaxed text-white/70">
                  {translationName} will be removed from this computer.
                  {downloadable ? ' You can download it again whenever you need it.' : ' This Bible is no longer available for download in Kairo.'}
                </AlertDialog.Description>
              </div>
              {error && <p role="alert" className="mt-3 text-[13px] text-red-400">{error}</p>}
              <div className="mt-6 flex justify-end gap-2">
                <AlertDialog.Cancel asChild>
                  <button ref={cancelRef} type="button" className="btn-secondary" disabled={busy === 'remove'}>Cancel</button>
                </AlertDialog.Cancel>
                <button type="button" className="rounded-md bg-red-600 px-3 py-2 text-[13px] font-medium text-white hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50"
                  disabled={busy === 'remove'} onClick={() => { void remove() }}>
                  {busy === 'remove' ? 'Removing…' : 'Remove download'}
                </button>
              </div>
            </AlertDialog.Content>
          </MovableDialog>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
