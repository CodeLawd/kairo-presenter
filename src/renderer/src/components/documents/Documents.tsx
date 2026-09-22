import { useImportRequest } from '@/hooks/useImportRequest'
import { useAppStore } from '@/stores/useAppStore'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Pencil,
  Play,
  Send,
  SlidersHorizontal,
  Square,
  Trash2,
  Upload,
} from '@/icons'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  DEFAULT_DOCUMENTS_SETTINGS,
  documentsErrorMessage,
  normalizeDocumentsSettings,
  SLIDESHOW_MAX_SEC,
  SLIDESHOW_MIN_SEC,
  type DocumentsSettings,
  type ProjectionDocument,
} from '@shared/documents'
import { overlayMediaUrl } from '@shared/overlay-template'
import { commandForShortcut, shortcutFromEvent } from '@shared/keyboard-shortcuts'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { cn } from '@/lib/utils'
import { LibrarySection } from '@/components/shared/LibrarySection'
import { startLibraryItemDrag, useLibrary } from '@/stores/useLibraries'
import { DEFAULT_LIBRARY_ID, itemsInLibrary, libraryCounts } from '@shared/libraries'

interface ContextMenuState {
  id: string
  x: number
  y: number
}

/** Thrown to unwind the render loop when the operator cancels an import. */
class ImportCanceled extends Error {}

export default function Documents({ active = true }: { active?: boolean }): React.ReactElement {
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
  const shortcuts = useBootstrapStore((state) => state.settings.display.shortcuts)
  const documentLibrary = useLibrary('documents')
  const [activeLibraryId, setActiveLibraryId] = useState<string>(DEFAULT_LIBRARY_ID)
  const storedSlideshow = useBootstrapStore((state) => state.settings.documents)
  const [slideshow, setSlideshow] = useState<DocumentsSettings>(
    () => normalizeDocumentsSettings(storedSlideshow ?? DEFAULT_DOCUMENTS_SETTINGS),
  )
  const [playing, setPlaying] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [slideshowMenuOpen, setSlideshowMenuOpen] = useState(false)
  const slideshowMenuRef = useRef<HTMLDivElement>(null)
  const liveThumbRef = useRef<HTMLButtonElement>(null)
  /** Set by the Cancel button; the render loop checks it between pages. */
  const cancelImport = useRef(false)
  const [canceling, setCanceling] = useState(false)
  const [importing, setImporting] = useState(false)
  const current = documents.find((doc) => doc.id === selected)
  const visibleDocuments = itemsInLibrary(documentLibrary, documents, activeLibraryId)

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
    /** No `kind` opens one picker that takes PDFs and PowerPoints together. */
    async (kind?: 'pdf' | 'powerpoint'): Promise<void> => {
      if (lock.current) return
      lock.current = true
      cancelImport.current = false
      setCanceling(false)
      setImporting(true)
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
        if (cancelImport.current) throw new ImportCanceled()
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
          if (cancelImport.current) throw new ImportCanceled()
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
        // A cancel is the operator's own doing — clean up the half-written
        // import, but never shout about it in the error banner.
        if (id) await window.api.documents.cancel(id).catch(() => undefined)
        setStatus('')
        if (!(err instanceof ImportCanceled)) setError(documentsErrorMessage(err))
      } finally {
        await pdf?.destroy().catch(() => undefined)
        cancelImport.current = false
        setCanceling(false)
        setImporting(false)
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
      // Announcement loops: the first page going live is the whole cue, so the
      // operator should not have to press a second button to start the run.
      if (slideshow.slideshowAutoStart) setPlaying(true)
    } catch (err) {
      setStatus('')
      setError(documentsErrorMessage(err))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  /**
   * Presentation-clicker and keyboard page control.
   *
   * A clicker is just a keyboard: most send Page Down / Page Up, some send the
   * arrows. Both map to the same `previous`/`next` commands the booth uses, so
   * a remap in Settings moves the pages too. The listener runs in the capture
   * phase and calls `preventDefault`, which is how Operator's app-wide handler
   * (it stays mounted on every route) knows to leave the event alone — without
   * that, a clicker on this screen would scroll scripture suggestions instead.
   */
  const stepPage = useRef<(delta: number) => void>(() => {})
  stepPage.current = (delta: number): void => {
    if (!current || lock.current) return
    void push(page + delta)
  }
  useEffect(() => {
    if (!active || !current) return
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (
        event.defaultPrevented ||
        event.isComposing ||
        target?.matches('input, textarea, select, [contenteditable="true"]') ||
        document.querySelector('[role="menu"], [role="dialog"], [role="alertdialog"]')
      ) return
      const shortcut = shortcutFromEvent(event)
      const command = shortcut ? commandForShortcut(shortcut, shortcuts) : undefined
      if (command !== 'previous' && command !== 'next') return
      event.preventDefault()
      event.stopPropagation()
      stepPage.current(command === 'next' ? 1 : -1)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [active, current?.id, shortcuts])

  const saveSlideshow = useCallback((patch: Partial<DocumentsSettings>): void => {
    setSlideshow((previous) => {
      const next = normalizeDocumentsSettings({ ...previous, ...patch })
      useBootstrapStore.getState().setSettings({
        ...useBootstrapStore.getState().settings,
        documents: next,
      })
      void window.api.settings.set('documents', next).catch(() => undefined)
      return next
    })
  }, [])

  /**
   * Unattended advance.
   *
   * The timer is rescheduled from `page`, so a manual push or a clicker press
   * mid-run restarts the dwell rather than firing early on the old schedule.
   * A single `setTimeout` per page (not a repeating interval) means a slow push
   * can never stack a queue of overdue advances behind it.
   */
  const advance = useRef<() => void>(() => {})
  advance.current = (): void => {
    if (!current) return
    const last = current.pages.length - 1
    if (page >= last && !slideshow.slideshowLoop) {
      setPlaying(false)
      return
    }
    void push(page >= last ? 0 : page + 1)
  }
  useEffect(() => {
    if (!playing || !current) {
      setCountdown(0)
      return
    }
    if (current.pages.length < 2) {
      setPlaying(false)
      return
    }
    const seconds = slideshow.slideshowSec
    setCountdown(seconds)
    const tick = setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000)
    // If a push is still in flight when the dwell expires, wait for it rather
    // than dropping the turn: `push` refuses while locked, and a dropped turn
    // would end the run silently (the next timer is scheduled off `page`).
    let timer = setTimeout(function fire() {
      if (lock.current) {
        timer = setTimeout(fire, 250)
        return
      }
      advance.current()
    }, seconds * 1000)
    return () => { clearInterval(tick); clearTimeout(timer) }
  }, [playing, current?.id, current?.pages.length, page, slideshow.slideshowSec, slideshow.slideshowLoop])

  // Keep the live page visible in the strip — during a slideshow nobody is
  // there to scroll it by hand.
  useEffect(() => {
    liveThumbRef.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [page, selected])

  // A deck that is gone, or replaced by another, must not keep advancing.
  useEffect(() => { setPlaying(false) }, [selected])

  useEffect(() => {
    if (!slideshowMenuOpen) return
    const onPointer = (event: MouseEvent): void => {
      if (!slideshowMenuRef.current?.contains(event.target as Node)) setSlideshowMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSlideshowMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [slideshowMenuOpen])

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
            <div className="flex min-w-0 items-baseline gap-2">
              <p className="truncate text-xs text-teal-400/90" aria-live="polite">
                {canceling ? 'Canceling…' : status}
              </p>
              {importing && (
                <button
                  type="button"
                  disabled={canceling}
                  className="shrink-0 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-200 hover:underline disabled:opacity-40"
                  onClick={() => { cancelImport.current = true; setCanceling(true) }}
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>

        <div ref={importMenuRef} className="relative shrink-0">
          <div className="flex">
            <button
              type="button"
              className="btn-primary flex h-8 items-center gap-1.5 rounded-r-none px-3 text-xs"
              disabled={busy}
              onClick={() => void importDocument()}
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
          <div className="shrink-0 border-b border-surface-border p-1.5">
            <LibrarySection
              kind="documents"
              activeLibraryId={activeLibraryId}
              counts={libraryCounts(documentLibrary, documents)}
              onSelect={setActiveLibraryId}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {visibleDocuments.length === 0 ? (
              <p className="px-2 py-3 text-xs text-zinc-600">
                {documents.length === 0 ? 'No documents' : 'Nothing in this library'}
              </p>
            ) : (
              visibleDocuments.map((doc) => {
                const active = selected === doc.id
                const renaming = renamingId === doc.id
                return (
                  <div
                    key={doc.id}
                    draggable={!renaming}
                    onDragStart={(event) => startLibraryItemDrag(event, doc.id, doc.name)}
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
              <p className="text-sm text-zinc-500">Import a PDF or PowerPoint to present page by page</p>
              <button
                type="button"
                className="btn-secondary flex h-8 items-center gap-1.5 px-3 text-xs"
                disabled={busy}
                onClick={() => void importDocument()}
              >
                <Upload size={13} aria-hidden="true" />
                Import document
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

                  <div ref={slideshowMenuRef} className="relative ml-3 flex items-center gap-0.5">
                    <button
                      type="button"
                      className={cn(
                        'inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors disabled:opacity-40',
                        playing
                          ? 'bg-teal-500/15 text-teal-300'
                          : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-100',
                      )}
                      disabled={current.pages.length < 2}
                      aria-pressed={playing}
                      title={playing ? 'Stop the slideshow' : `Advance every ${slideshow.slideshowSec}s`}
                      onClick={() => setPlaying((value) => !value)}
                    >
                      {playing ? <Square size={12} weight="fill" aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
                      {playing ? (
                        <span className="tabular-nums">{countdown}s</span>
                      ) : (
                        'Slideshow'
                      )}
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center rounded-md px-2 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-100"
                      aria-expanded={slideshowMenuOpen}
                      aria-haspopup="dialog"
                      aria-label="Slideshow settings"
                      title="Slideshow settings"
                      onClick={() => setSlideshowMenuOpen((open) => !open)}
                    >
                      <SlidersHorizontal size={13} aria-hidden="true" />
                    </button>
                    {slideshowMenuOpen && (
                      <div
                        role="dialog"
                        aria-label="Slideshow settings"
                        className="absolute bottom-full left-0 z-30 mb-1.5 w-60 rounded-lg border border-surface-border bg-surface-elevated p-3 shadow-2xl"
                      >
                        <label className="block text-[11px] text-zinc-400">
                          Seconds per page
                          <input
                            type="number"
                            className="input mt-1 h-8 text-xs"
                            min={SLIDESHOW_MIN_SEC}
                            max={SLIDESHOW_MAX_SEC}
                            value={slideshow.slideshowSec}
                            onChange={(event) => saveSlideshow({ slideshowSec: Number(event.target.value) })}
                          />
                        </label>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {[5, 10, 15, 30, 60].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              className={cn(
                                'rounded px-2 py-1 text-[11px] transition-colors',
                                slideshow.slideshowSec === preset
                                  ? 'bg-teal-500/20 text-teal-300'
                                  : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200',
                              )}
                              onClick={() => saveSlideshow({ slideshowSec: preset })}
                            >
                              {preset}s
                            </button>
                          ))}
                        </div>
                        <label className="mt-3 flex items-center gap-2 text-[11px] text-zinc-300">
                          <input
                            type="checkbox"
                            checked={slideshow.slideshowLoop}
                            onChange={(event) => saveSlideshow({ slideshowLoop: event.target.checked })}
                          />
                          Loop back to page 1
                        </label>
                        <label className="mt-2 flex items-center gap-2 text-[11px] text-zinc-300">
                          <input
                            type="checkbox"
                            checked={slideshow.slideshowAutoStart}
                            onChange={(event) => saveSlideshow({ slideshowAutoStart: event.target.checked })}
                          />
                          Start on first push
                        </label>
                        <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
                          Pushing a page by hand or with a clicker restarts the timer.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs tabular-nums text-zinc-500">
                    {page + 1} / {current.pages.length}
                  </span>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md p-0 text-zinc-600 transition-colors hover:bg-white/5 hover:text-rose-300 disabled:opacity-40"
                    disabled={busy}
                    onClick={() => void remove(current.id)}
                    title="Remove imported copy"
                    aria-label="Remove imported document"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>

              {current.pages.length > 1 && (
                <div
                  className="flex shrink-0 gap-2.5 overflow-x-auto border-t border-surface-border bg-black/20 px-3 py-3"
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
                      ref={page === index ? liveThumbRef : undefined}
                      className={cn(
                        // Height, not width: pages come portrait and landscape,
                        // and a fixed box letterboxes one of them into a stamp.
                        'group/page relative h-44 shrink-0 overflow-hidden rounded-md border bg-black transition-opacity',
                        page === index
                          ? 'border-teal-400/80 ring-1 ring-teal-400/40'
                          : 'border-white/[0.06] opacity-60 hover:opacity-100',
                      )}
                    >
                      <img
                        loading="lazy"
                        src={overlayMediaUrl(path)}
                        alt=""
                        className="h-full w-auto max-w-[22rem] object-contain"
                      />
                      <span
                        className={cn(
                          'absolute bottom-1 right-1.5 rounded px-1 text-[10px] font-medium tabular-nums',
                          page === index ? 'bg-teal-400/90 text-black' : 'bg-black/55 text-white/70',
                        )}
                      >
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
