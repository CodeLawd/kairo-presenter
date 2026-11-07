import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SlideConverterStatus } from '@shared/documents'
import { AlertCircle, Download, Image, Loader, MonitorPlay, WifiOff } from '@/icons'

/** The downloaded converter's status, kept current while the download runs. */
export function useSlideConverter(): SlideConverterStatus | null {
  const [status, setStatus] = useState<SlideConverterStatus | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.api.documents.converter.status().then((next) => { if (!cancelled) setStatus(next) }).catch(() => undefined)
    const unsubscribe = window.api.documents.converter.onChanged(setStatus)
    return () => { cancelled = true; unsubscribe() }
  }, [])
  return status
}

export function formatMB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

/** Progress for a running download; shared by the import dialog and Settings. */
export function ConverterProgress({ status }: { status: SlideConverterStatus }): React.ReactElement {
  const installing = status.state === 'installing'
  const percent = status.sizeBytes ? Math.min(100, Math.floor(status.receivedBytes / status.sizeBytes * 100)) : 0
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12px]" aria-live="polite">
        <span className="text-zinc-300">{installing ? 'Setting up…' : `Downloading · ${formatMB(status.receivedBytes)} of ${formatMB(status.sizeBytes)}`}</span>
        {!installing && <span className="tabular-nums text-zinc-400">{percent}%</span>}
      </div>
      <div role="progressbar" aria-label="Slide converter download" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={installing ? undefined : percent} aria-valuetext={installing ? 'Setting up' : `${percent}%`}
        className="h-1.5 overflow-hidden rounded-full bg-surface-tertiary">
        <div className={installing
          ? 'h-full w-1/3 animate-pulse rounded-full bg-teal-500 motion-reduce:animate-none'
          : 'h-full rounded-full bg-teal-500 transition-[width] duration-200 motion-reduce:transition-none'}
        style={installing ? undefined : { width: `${percent}%` }} />
      </div>
    </div>
  )
}

/**
 * Shown when a PowerPoint is picked and nothing on this computer can convert
 * it accurately. One decision, then the import carries on by itself.
 */
export function SlideConverterDialog({ name, format, onReady, onSimplified, onCancel }: {
  name: string
  format: 'pdf' | 'ppt' | 'pptx'
  /** The converter is installed: continue the import. */
  onReady: () => void
  /** Import now with the built-in renderer (.pptx only). */
  onSimplified: () => void
  onCancel: () => void
}): React.ReactElement {
  const dialog = useRef<HTMLDialogElement>(null)
  const status = useSlideConverter()
  const [started, setStarted] = useState(false)
  const done = useRef(false)
  const busy = status?.state === 'downloading' || status?.state === 'installing'
  const canSimplify = format === 'pptx'

  useLayoutEffect(() => {
    const node = dialog.current
    node?.showModal()
    return () => node?.close()
  }, [])

  // Ready — whether just downloaded or already there — means carry on.
  useEffect(() => {
    if (status?.state === 'ready' && !done.current) { done.current = true; onReady() }
  }, [status?.state, onReady])

  const download = (): void => {
    setStarted(true)
    void window.api.documents.converter.install()
  }
  const cancel = (): void => {
    if (busy) void window.api.documents.converter.cancel()
    onCancel()
  }

  const unsupported = status?.state === 'unsupported'
  const failed = status?.state === 'error' && started

  const percent = status?.sizeBytes ? Math.min(100, Math.floor(status.receivedBytes / status.sizeBytes * 100)) : 0
  const size = status?.sizeBytes ? formatMB(status.sizeBytes) : 'about 300 MB'

  return (
    <dialog ref={dialog} aria-labelledby="slide-converter-title" aria-describedby="slide-converter-body"
      onCancel={(event) => { event.preventDefault(); cancel() }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-[400px] overflow-hidden rounded-2xl p-0 text-zinc-200 modal-glass backdrop:bg-black/35">
      <div className="flex flex-col items-center px-7 pb-6 pt-7 text-center">
        {/* The deck itself, with what's about to happen to it. */}
        <div className="relative">
          <span className="grid h-16 w-24 place-items-center rounded-lg bg-surface-tertiary ring-1 ring-white/10">
            <MonitorPlay size={28} weight="fill" className="text-orange-400" aria-hidden="true" />
          </span>
          <span className={`absolute -bottom-2 -right-2 grid size-7 place-items-center rounded-full ring-4 ring-surface-elevated ${failed ? 'bg-red-500' : 'bg-teal-500'} text-on-accent`}>
            {failed ? <AlertCircle size={15} aria-hidden="true" />
              : busy ? <Loader size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                : <Download size={14} aria-hidden="true" />}
          </span>
        </div>

        <h2 id="slide-converter-title" className="mt-5 text-[17px] font-semibold tracking-tight text-white">
          {failed ? 'The download didn’t finish' : busy ? 'Getting the slide converter' : unsupported ? 'Install LibreOffice to continue' : 'Keep every slide exactly as designed'}
        </h2>
        <p className="mt-1 max-w-full truncate text-[12px] text-zinc-500" title={name}>{name}</p>

        <div id="slide-converter-body" className="mt-5 w-full">
          {unsupported ? (
            <p className="text-[13px] leading-relaxed text-zinc-400">Install LibreOffice from your software center, then import this file again.</p>
          ) : failed ? (
            <p className="text-[13px] leading-relaxed text-zinc-400">{status?.error}</p>
          ) : busy && status ? (
            <div className="text-left">
              <div className="h-2 overflow-hidden rounded-full bg-surface-tertiary" role="progressbar" aria-label="Slide converter download"
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={status.state === 'installing' ? undefined : percent}>
                <div className={status.state === 'installing'
                  ? 'h-full w-full animate-pulse rounded-full bg-teal-500 motion-reduce:animate-none'
                  : 'h-full rounded-full bg-teal-500 transition-[width] duration-300 motion-reduce:transition-none'}
                style={status.state === 'installing' ? undefined : { width: `${percent}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-[12px] tabular-nums text-zinc-500" aria-live="polite">
                <span>{status.state === 'installing' ? 'Setting up…' : `${formatMB(status.receivedBytes)} of ${formatMB(status.sizeBytes)}`}</span>
                {status.state !== 'installing' && <span>{percent}%</span>}
              </div>
              <p className="mt-4 text-center text-[12px] text-zinc-500">Your slides import as soon as this finishes.</p>
            </div>
          ) : (
            <ul className="space-y-2.5 rounded-xl bg-black/20 px-4 py-3.5 text-left text-[13px] text-zinc-300">
              <li className="flex items-center gap-3"><Image size={15} className="shrink-0 text-zinc-500" aria-hidden="true" />Every picture, font and effect kept</li>
              <li className="flex items-center gap-3"><Download size={15} className="shrink-0 text-zinc-500" aria-hidden="true" />Free, one-time download · {size}</li>
              <li className="flex items-center gap-3"><WifiOff size={15} className="shrink-0 text-zinc-500" aria-hidden="true" />Stays in Kairo and works offline</li>
            </ul>
          )}
        </div>

        <div className="mt-6 flex w-full flex-col gap-2">
          {!busy && !unsupported && (
            <button type="button" className="btn-primary h-10 w-full whitespace-nowrap text-[13px] font-semibold" onClick={download} disabled={!status} autoFocus>
              {failed ? 'Try again' : 'Download and import'}
            </button>
          )}
          <button type="button" className="btn-secondary h-10 w-full whitespace-nowrap text-[13px]" onClick={cancel}>
            {busy ? 'Stop download' : 'Cancel'}
          </button>
          {canSimplify && !busy && (
            <button type="button" className="mt-1 whitespace-nowrap text-[12px] text-zinc-500 transition-colors hover:text-zinc-200" onClick={onSimplified}>
              Import a simplified version instead
            </button>
          )}
        </div>
      </div>
    </dialog>
  )
}
