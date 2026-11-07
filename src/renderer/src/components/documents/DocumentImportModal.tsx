import { useLayoutEffect, useRef } from 'react'
import { AlertCircle, FileText, Loader, MonitorPlay } from '@/icons'

export interface DocumentImportProgress {
  stage: 'preparing' | 'rendering' | 'finishing' | 'error'
  name?: string
  format?: 'pdf' | 'ppt' | 'pptx'
  completed: number
  total: number
  sizeBytes?: number
  maxSizeBytes?: number
  error?: string
}

export function DocumentImportModal({ progress, canceling, onCancel, onClose, onRetry }: {
  progress: DocumentImportProgress
  canceling: boolean
  onCancel: () => void
  onClose: () => void
  onRetry: () => void
}): React.ReactElement {
  const dialog = useRef<HTMLDialogElement>(null)
  const failed = progress.stage === 'error'
  const determinate = progress.stage === 'rendering' && progress.total > 0
  const percent = determinate ? Math.floor(progress.completed / progress.total * 100) : 0
  const unit = progress.format === 'pdf' ? 'Page' : 'Slide'
  const Icon = progress.format && progress.format !== 'pdf' ? MonitorPlay : FileText
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = dialog.current
    node?.showModal()
    return () => { node?.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  const line = canceling ? 'Canceling…'
    : progress.stage === 'rendering' && progress.total ? `${unit} ${Math.min(progress.completed + 1, progress.total)} of ${progress.total}`
      : progress.stage === 'finishing' ? 'Almost done…'
        : 'Preparing…'
  return (
    <dialog ref={dialog} aria-labelledby="document-import-title"
      onCancel={(event) => { event.preventDefault(); if (failed) onClose(); else if (!canceling && progress.stage !== 'finishing') onCancel() }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-[380px] overflow-hidden rounded-2xl p-0 text-zinc-200 modal-glass backdrop:bg-black/35">
      <div className="flex flex-col items-center px-7 pb-6 pt-7 text-center">
        <div className="relative">
          <span className="grid h-16 w-24 place-items-center rounded-lg bg-surface-tertiary ring-1 ring-white/10">
            <Icon size={28} weight="fill" className={progress.format === 'pdf' ? 'text-cyan-400' : 'text-orange-400'} aria-hidden="true" />
          </span>
          <span className={`absolute -bottom-2 -right-2 grid size-7 place-items-center rounded-full ring-4 ring-surface-elevated text-on-accent ${failed ? 'bg-red-500' : 'bg-teal-500'}`}>
            {failed ? <AlertCircle size={15} aria-hidden="true" /> : <Loader size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          </span>
        </div>
        <h2 id="document-import-title" className="mt-5 text-[17px] font-semibold tracking-tight text-white">
          {failed ? 'Couldn’t import' : 'Importing'}
        </h2>
        <p className="mt-1 max-w-full truncate text-[12px] text-zinc-500" title={progress.name}>{progress.name || 'PDF or PowerPoint'}</p>

        {failed ? (
          <p role="alert" className="mt-4 text-[13px] leading-relaxed text-zinc-400">{progress.error}</p>
        ) : (
          <div className="mt-5 w-full">
            <div role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={determinate ? percent : undefined} aria-valuetext={line}
              className="h-2 overflow-hidden rounded-full bg-surface-tertiary">
              <div className={determinate
                ? 'h-full rounded-full bg-teal-500 transition-[width] duration-200 motion-reduce:transition-none'
                : 'h-full w-full animate-pulse rounded-full bg-teal-500/60 motion-reduce:animate-none'}
              style={determinate ? { width: `${percent}%` } : undefined} />
            </div>
            <div className="mt-2 flex justify-between text-[12px] tabular-nums text-zinc-500" aria-live="polite">
              <span>{line}</span>
              {determinate && <span>{percent}%</span>}
            </div>
          </div>
        )}

        <div className="mt-6 flex w-full flex-col gap-2">
          {failed ? (
            <>
              <button type="button" className="btn-primary h-10 w-full text-[13px] font-semibold" onClick={onRetry} autoFocus>Choose file again</button>
              <button type="button" className="btn-secondary h-10 w-full text-[13px]" onClick={onClose}>Close</button>
            </>
          ) : (
            <button type="button" className="btn-secondary h-10 w-full text-[13px] disabled:opacity-50"
              disabled={canceling || progress.stage === 'finishing'} onClick={onCancel}>
              {canceling ? 'Canceling…' : 'Cancel'}
            </button>
          )}
        </div>
      </div>
    </dialog>
  )
}
