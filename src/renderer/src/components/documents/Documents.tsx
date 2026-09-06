import { useImportRequest } from '@/hooks/useImportRequest'
import { useAppStore } from '@/stores/useAppStore'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Pencil,
  Send,
  Trash2,
  Upload,
} from '@/icons'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  documentsErrorMessage,
  type ProjectionDocument,
} from '@shared/documents'
import { overlayMediaUrl } from '@shared/overlay-template'

interface ContextMenuState {
  id: string
  x: number
  y: number
}

export default function Documents(): React.ReactElement {
  const [documents, setDocuments] = useState<ProjectionDocument[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [importMenuOpen, setImportMenuOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const importMenuRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const lock = useRef(false)
  const current = documents.find((doc) => doc.id === selected)

  useEffect(() => {
    void window.api.documents.list().then(setDocuments).catch((err) => setError(documentsErrorMessage(err)))
  }, [])

  useEffect(() => {
    if (!importMenuOpen) return
    const onPointer = (event: MouseEvent): void => {
      if (!importMenuRef.current?.contains(event.target as Node)) setImportMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setImportMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [importMenuOpen])

  useEffect(() => {
    if (!contextMenu) return
    const onPointer = (event: MouseEvent): void => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setContextMenu(null)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  useLayoutEffect(() => {
    if (!renamingId) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [renamingId])

  const importDocument = useCallback(
    async (kind: 'pdf' | 'powerpoint' = 'pdf'): Promise<void> => {
      if (lock.current) return
      lock.current = true
      setBusy(true)
      setImportMenuOpen(false)
      setError('')
      setStatus('Opening…')
      let id: string | undefined
      let pdf: PDFDocumentProxy | undefined
      try {
        const prepared = await window.api.documents.prepare(kind)
        if (!prepared) {
          setStatus('')
          return
        }
        id = prepared.id
        const [{ getDocument, GlobalWorkerOptions }, { default: workerUrl }] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
        ])
        GlobalWorkerOptions.workerSrc = workerUrl
        pdf = await getDocument({ data: prepared.data, isEvalSupported: false }).promise
        if (pdf.numPages > 500) {
          throw new Error('Documents can contain up to 500 pages. Split this document into smaller files.')
        }
        for (let index = 0; index < pdf.numPages; index++) {
          setStatus(`Rendering ${index + 1} / ${pdf.numPages}`)
          const sourcePage = await pdf.getPage(index + 1)
          const original = sourcePage.getViewport({ scale: 1 })
          const viewport = sourcePage.getViewport({
            scale: Math.min(1920 / original.width, 1080 / original.height),
          })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Page rendering is unavailable.')
          await sourcePage.render({ canvasContext: context, viewport, background: 'white' }).promise
          const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (value) => (value ? resolve(value) : reject(new Error('Could not render page.'))),
              'image/png',
            ),
          )
          await window.api.documents.savePage(id, index, new Uint8Array(await blob.arrayBuffer()))
          canvas.width = 0
          canvas.height = 0
          sourcePage.cleanup()
        }
        setDocuments(await window.api.documents.finish(id))
        setSelected(id)
        setPage(0)
        setStatus('')
      } catch (err) {
        if (id) await window.api.documents.cancel(id).catch(() => undefined)
        setStatus('')
        setError(documentsErrorMessage(err))
      } finally {
        await pdf?.destroy().catch(() => undefined)
        lock.current = false
        setBusy(false)
      }
    },
    [],
  )

  useImportRequest(['pdf', 'powerpoint'], (kind) => importDocument(kind as 'pdf' | 'powerpoint'), !busy)

  const push = async (target: number): Promise<void> => {
    if (!current || lock.current || target < 0 || target >= current.pages.length) return
    lock.current = true
    setBusy(true)
    setError('')
    setStatus('Pushing…')
    try {
      const result = await window.api.documents.push(current.id, target)
      if (!result.applied) {
        throw new Error('The page could not be displayed on NDI. Check output settings and try again.')
      }
      useAppStore.getState().clearScriptureLiveOutput()
      useAppStore.setState({ liveOutputLabel: `${current.name} · Page ${target + 1}` })
      setPage(target)
      setStatus('')
    } catch (err) {
      setStatus('')
      setError(documentsErrorMessage(err))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (!id || lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    setContextMenu(null)
    setRenamingId(null)
    try {
      const next = await window.api.documents.remove(id)
      setDocuments(next)
      if (selected === id) {
        setSelected(next[0]?.id ?? null)
        setPage(0)
      }
      setStatus('')
    } catch (err) {
      setError(documentsErrorMessage(err))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const startRename = (id: string): void => {
    const doc = documents.find((item) => item.id === id)
    if (!doc) return
    setContextMenu(null)
    setSelected(id)
    setRenamingId(id)
    setRenameDraft(doc.name)
  }

  const commitRename = async (): Promise<void> => {
    if (!renamingId || lock.current) return
    const id = renamingId
    const draft = renameDraft
    const existing = documents.find((doc) => doc.id === id)
    if (existing && draft.trim() === existing.name) {
      setRenamingId(null)
      return
    }
    lock.current = true
    setBusy(true)
    setError('')
    try {
      setDocuments(await window.api.documents.rename(id, draft))
      setRenamingId(null)
    } catch (err) {
      setError(documentsErrorMessage(err))
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const openContextMenu = (event: React.MouseEvent, id: string): void => {
    event.preventDefault()
    event.stopPropagation()
    setImportMenuOpen(false)
    setSelected(id)
    setPage(0)
    const pad = 8
    const width = 160
    const height = 88
    setContextMenu({
      id,
      x: Math.min(event.clientX, window.innerWidth - width - pad),
      y: Math.min(event.clientY, window.innerHeight - height - pad),
    })
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-surface-border px-4">
        <div className="flex min-w-0 items-baseline gap-3">
          {current ? (
            <p className="truncate text-sm text-zinc-200">
              {current.name}
              <span className="text-zinc-500"> · {page + 1}/{current.pages.length}</span>
            </p>
          ) : (
            <p className="truncate text-sm text-zinc-600">No document selected</p>
          )}
          {busy && status && (
            <p className="truncate text-xs text-teal-400/90" aria-live="polite">
              {status}
            </p>
          )}
        </div>

        <div ref={importMenuRef} className="relative shrink-0">
          <div className="flex">
            <button
              type="button"
              className="btn-primary flex h-8 items-center gap-1.5 rounded-r-none px-3 text-xs"
              disabled={busy}
              onClick={() => void importDocument('pdf')}
            >
              <Upload size={13} aria-hidden="true" />
              Import
            </button>
            <button
              type="button"
              className="btn-primary h-8 rounded-l-none border-l border-teal-700/50 px-2"
              disabled={busy}
              aria-expanded={importMenuOpen}
              aria-haspopup="menu"
              aria-label="Import options"
              onClick={() => setImportMenuOpen((open) => !open)}
            >
              <ChevronDown size={13} aria-hidden="true" />
            </button>
          </div>
          {importMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-1 min-w-[11rem] overflow-hidden rounded border border-surface-border bg-surface-elevated"
            >
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-surface-secondary"
                disabled={busy}
                onClick={() => void importDocument('pdf')}
              >
                PDF…
              </button>
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-surface-secondary"
                disabled={busy}
                onClick={() => void importDocument('powerpoint')}
              >
                PowerPoint…
              </button>
            </div>
          )}
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="shrink-0 border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300"
        >
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <aside
          className="flex w-52 shrink-0 flex-col border-r border-surface-border"
          aria-label="Imported documents"
        >
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {documents.length === 0 ? (
              <p className="px-2 py-3 text-xs text-zinc-600">No documents</p>
            ) : (
              documents.map((doc) => {
                const active = selected === doc.id
                const renaming = renamingId === doc.id
                return (
                  <div
                    key={doc.id}
                    onContextMenu={(event) => openContextMenu(event, doc.id)}
                    className={[
                      'mb-0.5 rounded px-1 py-1 transition-colors',
                      active
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200',
                    ].join(' ')}
                  >
                    {renaming ? (
                      <form
                        className="flex items-center gap-2 px-1.5 py-1"
                        onSubmit={(event) => {
                          event.preventDefault()
                          void commitRename()
                        }}
                      >
                        <FileText size={14} className="shrink-0 opacity-60" aria-hidden="true" />
                        <input
                          ref={renameInputRef}
                          value={renameDraft}
                          disabled={busy}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onBlur={() => void commitRename()}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              setRenamingId(null)
                              setRenameDraft(doc.name)
                            }
                          }}
                          aria-label="Document name"
                          className="min-w-0 flex-1 rounded border border-surface-border bg-surface px-1.5 py-0.5 text-xs text-zinc-100 outline-none focus:border-teal-500/60"
                        />
                      </form>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setSelected(doc.id)
                          setPage(0)
                          setStatus('')
                          setError('')
                          setRenamingId(null)
                        }}
                        onDoubleClick={() => startRename(doc.id)}
                        title="Right-click to rename or delete"
                        className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left"
                      >
                        <FileText size={14} className="shrink-0 opacity-60" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">{doc.name}</span>
                          <span className="mt-0.5 block text-[10px] text-zinc-600">
                            {doc.pages.length} {doc.pages.length === 1 ? 'page' : 'pages'}
                          </span>
                        </span>
                      </button>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {!current ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
              <p className="text-sm text-zinc-500">Import a PDF to present page by page</p>
              <button
                type="button"
                className="btn-secondary flex h-8 items-center gap-1.5 px-3 text-xs"
                disabled={busy}
                onClick={() => void importDocument('pdf')}
              >
                <Upload size={13} aria-hidden="true" />
                Import PDF
              </button>
            </div>
          ) : (
            <>
              <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black px-4 py-3">
                <img
                  className="max-h-full max-w-full object-contain"
                  src={overlayMediaUrl(current.pages[page])}
                  alt={`${current.name}, page ${page + 1}`}
                />
              </div>

              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-surface-border px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="btn-secondary inline-flex h-9 w-9 items-center justify-center p-0"
                    disabled={busy || page === 0}
                    onClick={() => void push(page - 1)}
                    title="Push previous page"
                    aria-label="Push previous page"
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn-primary inline-flex h-9 items-center gap-1.5 px-4 text-sm"
                    disabled={busy}
                    onClick={() => void push(page)}
                  >
                    <Send size={14} aria-hidden="true" />
                    Push
                  </button>
                  <button
                    type="button"
                    className="btn-secondary inline-flex h-9 w-9 items-center justify-center p-0"
                    disabled={busy || page === current.pages.length - 1}
                    onClick={() => void push(page + 1)}
                    title="Push next page"
                    aria-label="Push next page"
                  >
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
                <button
                  type="button"
                  className="btn-secondary inline-flex h-9 w-9 items-center justify-center p-0 text-zinc-400 hover:text-rose-300"
                  disabled={busy}
                  onClick={() => void remove(current.id)}
                  title="Remove imported copy"
                  aria-label="Remove imported document"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>

              {current.pages.length > 1 && (
                <div
                  className="flex shrink-0 gap-2 overflow-x-auto border-t border-surface-border bg-surface-secondary/40 px-3 py-3"
                  aria-label="Pages"
                >
                  {current.pages.map((path, index) => (
                    <button
                      key={path}
                      type="button"
                      disabled={busy}
                      onClick={() => void push(index)}
                      aria-label={`Push page ${index + 1}`}
                      title={`Push page ${index + 1}`}
                      aria-pressed={page === index}
                      className={[
                        'relative h-28 w-48 shrink-0 overflow-hidden rounded-md border bg-black',
                        page === index
                          ? 'border-teal-400/80 ring-1 ring-teal-400/40'
                          : 'border-surface-border opacity-70 hover:opacity-100',
                      ].join(' ')}
                    >
                      <img
                        loading="lazy"
                        src={overlayMediaUrl(path)}
                        alt=""
                        className="h-full w-full object-contain"
                      />
                      <span className="absolute bottom-1 right-1.5 rounded bg-black/55 px-1 text-[11px] font-medium text-white/85">
                        {index + 1}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          role="menu"
          className="fixed z-50 w-40 overflow-hidden rounded border border-surface-border bg-surface-elevated py-1"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-200 hover:bg-surface-secondary"
            disabled={busy}
            onClick={() => startRename(contextMenu.id)}
          >
            <Pencil size={13} aria-hidden="true" />
            Rename
          </button>
          <div className="my-1 border-t border-surface-border/60" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-rose-300 hover:bg-rose-500/10"
            disabled={busy}
            onClick={() => void remove(contextMenu.id)}
          >
            <Trash2 size={13} aria-hidden="true" />
            Delete
          </button>
        </div>
      )}
    </section>
  )
}
