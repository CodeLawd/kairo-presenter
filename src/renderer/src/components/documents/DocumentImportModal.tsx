import { formatDocumentSize } from '@shared/documents'
import { useLayoutEffect, useRef } from 'react'
import { AlertCircle, Check, FileText, Loader, MonitorPlay } from '@/icons'

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
  const determinate = progress.total > 0
  const percent = determinate ? Math.floor(progress.completed / progress.total * 100) : 0
  const labels = ['Preparing document', progress.format === 'pdf' ? 'Importing pages' : 'Importing slides', 'Finishing']
  const stageIndex = progress.stage === 'preparing' ? 0 : progress.stage === 'rendering' ? 1 : 2
  const Icon = failed ? AlertCircle : progress.format && progress.format !== 'pdf' ? MonitorPlay : FileText
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = dialog.current
    node?.showModal()
    return () => { node?.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  return (
    <dialog ref={dialog} aria-labelledby="document-import-title" aria-describedby="document-import-description"
      onCancel={(event) => { event.preventDefault(); if (failed) onClose(); else if (!canceling && progress.stage !== 'finishing') onCancel() }}
      className="m-auto max-h-[90vh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-2xl border border-surface-border bg-surface-elevated p-0 text-zinc-200 shadow-2xl backdrop:bg-black/60">
      <div className="px-6 pb-5 pt-6">
        <div className="flex items-center gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${failed ? 'bg-tint-red text-red-300' : 'bg-surface-tertiary text-teal-400'}`}><Icon size={23} aria-hidden="true" /></span>
          <div className="min-w-0">
            <h2 id="document-import-title" className="text-base font-semibold text-white">{failed ? 'Couldn’t import document' : canceling ? 'Canceling import' : 'Importing document'}</h2>
            <p className="mt-1 truncate text-xs text-zinc-400" title={progress.name}>{progress.name || 'PDF or PowerPoint'}</p>
          </div>
        </div>
        {progress.sizeBytes !== undefined && progress.maxSizeBytes !== undefined && <p className="mt-4 text-xs tabular-nums text-zinc-400">{formatDocumentSize(progress.sizeBytes)} <span className="text-zinc-500">· Maximum {Math.round(progress.maxSizeBytes / (1024 * 1024))} MB</span></p>}
        <p id="document-import-description" className="mt-5 text-sm leading-relaxed text-zinc-400">
          {failed ? progress.error : canceling ? 'Removing the unfinished import. Your library will stay as it was.' : progress.stage === 'preparing' ? progress.name ? 'Preparing your document for import.' : 'Choose a file. PowerPoint presentations may take a moment to prepare.' : progress.stage === 'finishing' ? 'Saving your document to the library.' : 'Creating previews so your document is ready to present.'}
        </p>
        {!failed && <div className="mt-5">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs" aria-live="polite">
            <span className="text-zinc-300">{canceling ? 'Canceling…' : progress.stage === 'rendering' ? `${progress.format === 'pdf' ? 'Page' : 'Slide'} ${Math.min(progress.completed + 1, progress.total)} of ${progress.total}` : labels[stageIndex]}</span>
            {determinate && <span className="tabular-nums text-teal-400">{percent}%</span>}
          </div>
          <div role="progressbar" aria-label="Document import progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={determinate ? percent : undefined}
            aria-valuetext={canceling ? 'Canceling import' : determinate ? `${progress.completed} of ${progress.total} complete` : 'Preparing document'}
            className="h-1.5 overflow-hidden rounded-full bg-surface-tertiary">
            <div className={`h-full rounded-full bg-teal-500 ${determinate ? 'transition-[width] duration-200 motion-reduce:transition-none' : 'w-1/3 animate-pulse motion-reduce:animate-none'}`} style={determinate ? { width: `${percent}%` } : undefined} />
          </div>
          <ol className="mt-5 flex flex-wrap justify-between gap-2 text-[11px]">
            {labels.map((label, index) => <li key={label} className={`flex items-center gap-1.5 ${index <= stageIndex ? 'text-zinc-300' : 'text-zinc-500'}`}>
              {index < stageIndex ? <Check size={12} className="text-teal-400" aria-hidden="true" /> : index === stageIndex ? <Loader size={12} className="animate-spin text-teal-400 motion-reduce:animate-none" aria-hidden="true" /> : <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" aria-hidden="true" />}{label}
            </li>)}
          </ol>
        </div>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-surface-border px-6 py-4">
        {failed ? <><button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={onClose}>Close</button><button type="button" className="btn-primary px-3 py-2 text-xs" onClick={onRetry}>Choose file again</button></> : <button type="button" className="btn-secondary min-w-28 px-3 py-2 text-xs disabled:opacity-50" disabled={canceling || progress.stage === 'finishing'} onClick={onCancel}>{canceling ? 'Canceling…' : 'Cancel import'}</button>}
      </footer>
    </dialog>
  )
}
