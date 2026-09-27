import { useEffect } from 'react'
import { AlertTriangle, CheckCircle, X } from '@/icons'
import { cn } from '@/lib/utils'
import { useImportRequest } from '@/hooks/useImportRequest'
import { importKairo, useTransferStore } from '@/stores/useTransfer'
import { ExportSongsModal } from './ExportSongsModal'
import { ImportReviewModal } from './ImportReviewModal'

const NOTICE_MS = 6_000
const KAIRO_KINDS = ['kairo'] as const

/**
 * Mounted once at the app root: the review screen, the song export picker,
 * and the one-line result notice — so any screen, the File menu, or a file
 * double-clicked in Finder can start an import or export.
 */
export function TransferHost(): React.ReactElement {
  const { preview, notice, songExport, setPreview, notify } = useTransferStore()

  useImportRequest(KAIRO_KINDS, importKairo)

  useEffect(() => {
    const unsubscribe = window.api.transfer.onOpened((result) => {
      if ('error' in result) notify({ tone: 'error', text: `${result.fileName}: ${result.error}` })
      else setPreview(result)
    })
    // Subscribe first, then tell main — files opened before launch are held
    // until this point.
    window.api.transfer.ready()
    return unsubscribe
  }, [notify, setPreview])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => notify(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice, notify])

  return (
    <>
      {preview ? <ImportReviewModal key={preview.token} preview={preview} /> : null}
      {songExport ? <ExportSongsModal preselect={songExport.preselect} /> : null}
      {notice ? (
        <div
          role="status"
          className={cn(
            'fixed bottom-5 left-1/2 z-[70] flex max-w-md -translate-x-1/2 items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] shadow-2xl animate-fade-in',
            notice.tone === 'ok'
              ? 'border-white/10 bg-surface-elevated text-white'
              : 'border-red-500/30 bg-surface-elevated text-red-300',
          )}
        >
          {notice.tone === 'ok' ? (
            <CheckCircle size={15} className="shrink-0 text-teal-400" aria-hidden="true" />
          ) : (
            <AlertTriangle size={15} className="shrink-0" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1">{notice.text}</span>
          <button
            type="button"
            onClick={() => notify(null)}
            aria-label="Dismiss"
            className="shrink-0 text-white/40 hover:text-white"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </>
  )
}
