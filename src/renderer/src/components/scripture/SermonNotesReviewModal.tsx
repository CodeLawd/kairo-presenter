import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import Highlight from "@tiptap/extension-highlight";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { ArrowDown, ArrowUp, Loader, ScanSearch, Search, X } from '@/icons';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SermonNotesAnalysis, SermonPlanDraft } from "@shared/ipc";
import {
  mapTextRangeToPos,
  normalizedReferenceLabel,
  plainTextToEditorHtml,
  SERMON_NOTES_BLOCK_SEPARATOR,
} from "@shared/sermon-notes-review";

const ScriptureHighlight = Highlight.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      reference: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-reference"),
        renderHTML: (attributes) => attributes.reference
          ? { "data-reference": attributes.reference }
          : {},
      },
      active: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-active") === "true",
        renderHTML: (attributes) => attributes.active
          ? { "data-active": "true" }
          : {},
      },
    }
  },
})

interface SermonNotesReviewModalProps {
  draft: SermonPlanDraft;
  confirming: boolean;
  onCancel: () => void;
  onConfirm: (title: string, text: string, analysis: SermonNotesAnalysis) => void;
}

/** Where in the notes viewport a reference counts as "the one being read". */
const READING_LINE_RATIO = 0.28

function editorPlainText(editor: Editor): string {
  return editor.getText({ blockSeparator: SERMON_NOTES_BLOCK_SEPARATOR })
}

function draftEditorHtml(draft: SermonPlanDraft): string {
  const html = draft.html?.trim()
  if (html) return html
  return plainTextToEditorHtml(draft.text)
}

function paintMatches(
  editor: Editor,
  analysis: SermonNotesAnalysis,
  activeIndex: number,
): void {
  const markType = editor.schema.marks.highlight
  if (!markType) return

  const maxPosition = editor.state.doc.content.size
  const transaction = editor.state.tr.removeMark(0, maxPosition, markType)
  analysis.matches.forEach((match, index) => {
    const range = mapTextRangeToPos(
      editor.state.doc,
      match.start,
      match.end,
      SERMON_NOTES_BLOCK_SEPARATOR,
    )
    if (!range) return
    const from = Math.min(range.from, maxPosition)
    const to = Math.min(range.to, maxPosition)
    if (from < to) {
      transaction.addMark(from, to, markType.create({
        color: "#CAD5E2",
        reference: normalizedReferenceLabel(match),
        active: index === activeIndex,
      }))
    }
  })
  transaction.setMeta("addToHistory", false)
  editor.view.dispatch(transaction)
}

export function SermonNotesReviewModal({
  draft,
  confirming,
  onCancel,
  onConfirm,
}: SermonNotesReviewModalProps): React.ReactElement {
  const [title, setTitle] = useState(draft.title)
  // Import-time matches are indexed against raw file text, which can diverge from
  // the TipTap document (HTML whitespace, paragraphs). Start empty and scan the
  // live editor so highlights land on the same string they were detected in.
  const [analysis, setAnalysis] = useState<SermonNotesAnalysis>({
    matches: [],
    items: draft.items,
  })
  const [scanning, setScanning] = useState(true)
  const [scanError, setScanError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const [activeMatch, setActiveMatch] = useState(0)
  const [referenceQuery, setReferenceQuery] = useState("")
  const referenceSearchRef = useRef<HTMLInputElement>(null)
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scanSequenceRef = useRef(0)
  const paintingRef = useRef(false)
  const notesScrollRef = useRef<HTMLDivElement | null>(null)
  const matchButtonsRef = useRef<Array<HTMLButtonElement | null>>([])
  const matchListRef = useRef<HTMLDivElement | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  // Jumping to a match scrolls the notes, which would immediately fire the
  // scroll sync and fight the jump. Ignore sync until the jump settles.
  const ignoreSyncUntilRef = useRef(0)

  const scan = useCallback(async (text: string): Promise<void> => {
    const sequence = ++scanSequenceRef.current
    setScanning(true)
    setScanError(null)
    try {
      const next = await window.api.scripture.scanSermonNotes(text)
      if (sequence !== scanSequenceRef.current) return
      setAnalysis(next)
      setActiveMatch((current) => Math.min(current, Math.max(0, next.matches.length - 1)))
    } catch {
      if (sequence === scanSequenceRef.current) {
        setScanError("Could not scan your edits. Try scanning again before creating the playlist.")
      }
    } finally {
      if (sequence === scanSequenceRef.current) setScanning(false)
    }
  }, [])

  const editor = useEditor({
    extensions: [StarterKit, ScriptureHighlight.configure({ multicolor: true })],
    content: draftEditorHtml(draft),
    editorProps: {
      attributes: {
        class:
          "sermon-notes-tiptap min-h-full break-words px-8 py-7 font-sans text-[15px] leading-7 text-foreground outline-none selection:bg-[#B9D7FF]",
        spellcheck: "true",
        "aria-label": "Editable sermon notes",
      },
    },
    onCreate: ({ editor: currentEditor }) => {
      void scan(editorPlainText(currentEditor))
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (paintingRef.current) return
      scanSequenceRef.current += 1
      setScanning(true)
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
      scanTimerRef.current = setTimeout(() => void scan(editorPlainText(currentEditor)), 300)
    },
  })

  useEffect(() => {
    editor?.setEditable(!confirming)
  }, [confirming, editor])

  useEffect(() => {
    // Rescans can shrink the list; drop refs to cards that no longer exist.
    matchButtonsRef.current.length = analysis.matches.length
    if (!editor) return
    paintingRef.current = true
    paintMatches(editor, analysis, activeMatch)
    paintingRef.current = false
  }, [activeMatch, analysis, editor])

  useEffect(() => () => {
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
    if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current)
    scanSequenceRef.current += 1
  }, [])

  // Scrolling the notes moves the list with them: the reference last passed by
  // the reading line becomes active, so the sidebar always shows where you are.
  const syncActiveFromScroll = useCallback((): void => {
    const container = notesScrollRef.current
    if (!editor || !container || analysis.matches.length === 0) return
    if (Date.now() < ignoreSyncUntilRef.current) return

    const bounds = container.getBoundingClientRect()
    const readingLine = bounds.top + container.clientHeight * READING_LINE_RATIO
    let next = 0
    for (let index = 0; index < analysis.matches.length; index += 1) {
      const match = analysis.matches[index]
      const range = mapTextRangeToPos(
        editor.state.doc,
        match.start,
        match.end,
        SERMON_NOTES_BLOCK_SEPARATOR,
      )
      if (!range) continue
      let top: number
      try {
        top = editor.view.coordsAtPos(range.from).top
      } catch {
        continue
      }
      if (top > readingLine) break
      next = index
    }
    setActiveMatch((current) => (current === next ? current : next))
  }, [analysis.matches, editor])

  const handleNotesScroll = useCallback((): void => {
    if (scrollFrameRef.current) return
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      syncActiveFromScroll()
    })
  }, [syncActiveFromScroll])

  // Pull the active card to the top of the list rather than letting it ride the
  // bottom edge — the references after it are the ones worth seeing next.
  useEffect(() => {
    const list = matchListRef.current
    const card = matchButtonsRef.current[activeMatch]
    if (!list || !card) return
    list.scrollTo({ top: Math.max(0, card.offsetTop - 12), behavior: "smooth" })
  }, [activeMatch])

  const goToMatch = useCallback((index: number): void => {
    if (!editor || analysis.matches.length === 0) return
    const normalized = (index + analysis.matches.length) % analysis.matches.length
    const match = analysis.matches[normalized]
    const range = mapTextRangeToPos(
      editor.state.doc,
      match.start,
      match.end,
      SERMON_NOTES_BLOCK_SEPARATOR,
    )
    if (!range) return
    ignoreSyncUntilRef.current = Date.now() + 400
    setActiveMatch(normalized)
    editor
      .chain()
      .focus()
      .setTextSelection({ from: range.from, to: range.to })
      .scrollIntoView()
      .run()
  }, [analysis.matches, editor])

  const confirm = (): void => {
    if (!editor || confirming || scanning || scanError || analysis.items.length === 0) return
    onConfirm(title.trim() || draft.title, editorPlainText(editor), analysis)
  }

  const matchCount = analysis.matches.length
  const normalizedQuery = referenceQuery.trim().toLocaleLowerCase().replace(/[–—]/g, "-")
  const visibleMatches = analysis.matches
    .map((match, index) => ({ match, index }))
    .filter(({ match }) => `${match.reference} ${match.translations.join(" ")}`
      .toLocaleLowerCase().replace(/[–—]/g, "-").includes(normalizedQuery))

  const navigateMatches = (direction: -1 | 1): void => {
    if (visibleMatches.length === 0) return
    const next = direction === 1
      ? visibleMatches.find(({ index }) => index > activeMatch) ?? visibleMatches[0]
      : visibleMatches.findLast(({ index }) => index < activeMatch) ?? visibleMatches[visibleMatches.length - 1]
    goToMatch(next.index)
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !confirming) onCancel() }}>
      <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/45" />
      <Dialog.Content
        onOpenAutoFocus={(event) => { event.preventDefault(); titleRef.current?.focus() }}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => { if (confirming) event.preventDefault() }}
        data-theme="light"
        className="fixed left-1/2 top-1/2 z-[81] flex -translate-x-1/2 -translate-y-1/2 outline-none h-[min(860px,calc(100vh-40px))] w-[min(1180px,calc(100vw-40px))] flex-col overflow-hidden rounded-2xl border-[0.5px] border-zinc-500 bg-surface text-foreground [color-scheme:light] shadow-2xl shadow-black/50"
      >
        <header className="flex shrink-0 items-start justify-between gap-5 border-b-[0.5px] border-surface-border bg-surface-elevated px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-secondary"><ScanSearch size={19} className="text-slate-400" aria-hidden="true" /></span>
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold leading-6 text-foreground">
                Review sermon notes
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-slate-500">
                Check the notes and scripture references, then create your playlist.
              </Dialog.Description>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel} disabled={confirming} aria-label="Close review">
            <X size={17} />
          </Button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px] lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-h-0 flex-col bg-surface">
            <div className="shrink-0 space-y-3 border-b-[0.5px] border-surface-border bg-surface-elevated px-6 py-4">
              <div className="flex items-center justify-between gap-4">
                <label htmlFor="sermon-playlist-title" className="text-xs font-semibold text-slate-300">Playlist name</label>
                <div role="status" className="flex items-center gap-1.5 text-xs text-slate-500">
                  {scanning && <Loader size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                  {scanning ? "Scanning notes…" : scanError ? "Scan needs attention" : "References up to date"}
                </div>
              </div>
              <Input
                id="sermon-playlist-title"
                ref={titleRef}
                value={title}
                disabled={confirming}
                onChange={(event) => setTitle(event.target.value)}
                className="h-9 bg-surface text-sm font-medium"
              />
              <p className="truncate text-xs text-slate-500" title={draft.sourceFileName}>{draft.sourceFileName} · Click the notes below to edit</p>
              {scanError && (
                <div role="alert" className="flex items-start justify-between gap-3 text-xs text-red-400">
                  <p>{scanError}</p>
                  <Button size="sm" variant="outline" disabled={scanning || confirming} onClick={() => { if (editor) void scan(editorPlainText(editor)) }}>Retry scan</Button>
                </div>
              )}
            </div>
            <div
              ref={notesScrollRef}
              onScroll={handleNotesScroll}
              className="min-h-0 flex-1 overflow-y-auto bg-surface-secondary/40 px-5 py-5"
              style={{ scrollbarGutter: "stable" }}
            >
              <div className="mx-auto min-h-full max-w-3xl overflow-hidden rounded-sm bg-paper ring-1 ring-black/15 [&_mark]:rounded-none [&_mark]:bg-[#CAD5E2] [&_mark]:px-0.5 [&_mark]:text-foreground [&_mark[data-active=true]]:bg-[#B9D7FF]">
                <EditorContent editor={editor} className="sermon-notes-editor min-h-full" />
              </div>
            </div>
          </div>

          <aside className="flex min-h-0 flex-col border-l-[0.5px] border-surface-border bg-surface-elevated">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Detected scripture <span className="ml-1 text-xs font-normal tabular-nums text-slate-500">{matchCount}</span></h3>
                <p className="mt-1 text-xs text-slate-500">Select a reference to find it in the notes.</p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => navigateMatches(-1)} disabled={confirming || scanning || !!scanError || visibleMatches.length === 0} aria-label="Previous reference">
                  <ArrowUp size={14} />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => navigateMatches(1)} disabled={confirming || scanning || !!scanError || visibleMatches.length === 0} aria-label="Next reference">
                  <ArrowDown size={14} />
                </Button>
              </div>
            </div>

            <div className="relative mx-3 mb-2">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              <Input
                ref={referenceSearchRef}
                value={referenceQuery}
                onChange={(event) => setReferenceQuery(event.target.value)}
                placeholder="Search detected scripture"
                aria-label="Search detected scripture"
                aria-controls="sermon-detected-references"
                className="h-9 bg-surface pl-8 pr-8 text-sm"
              />
              {referenceQuery && (
                <button
                  type="button"
                  aria-label="Clear scripture search"
                  onClick={() => { setReferenceQuery(""); referenceSearchRef.current?.focus() }}
                  className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </div>

            <p role="status" className="px-4 pb-2 text-xs tabular-nums text-slate-500">
              {normalizedQuery ? `${visibleMatches.length} of ${matchCount} references match` : matchCount > 0 ? `Reference ${activeMatch + 1} of ${matchCount}` : "No references yet"}
            </p>
            <div
              id="sermon-detected-references"
              ref={matchListRef}
              className="relative min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2"
              style={{ scrollbarGutter: "stable" }}
            >
              {matchCount === 0 ? (
                <div className="m-1 rounded-lg bg-surface-secondary px-4 py-6 text-center">
                  <p className="text-[13px] font-medium text-slate-300">
                    {scanning ? "Scanning for references…" : "No references found"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {scanning
                      ? "Highlights appear once the notes finish scanning."
                      : "Add one such as “John 3:16” directly in the notes."}
                  </p>
                </div>
              ) : visibleMatches.length === 0 ? (
                <p role="status" className="px-4 py-6 text-center text-xs text-slate-400">
                  No matching references. Try a book, verse or translation.
                </p>
              ) : visibleMatches.map(({ match, index }) => {
                const isActive = activeMatch === index
                return (
                  <button
                    key={`${match.start}-${match.reference}`}
                    ref={(element) => {
                      matchButtonsRef.current[index] = element
                    }}
                    type="button"
                    aria-current={isActive}
                    disabled={confirming || scanning || !!scanError}
                    onClick={() => goToMatch(index)}
                    className={cn(
                      "relative flex w-full items-baseline gap-3 rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400",
                      isActive
                        ? "border-teal-400/40 bg-teal-950"
                        : "border-transparent hover:bg-surface-secondary",
                    )}
                  >
                    <span
                      className={cn(
                        "w-4 shrink-0 text-right text-xs font-medium tabular-nums",
                        isActive ? "text-teal-300" : "text-slate-500",
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-[13px] font-medium",
                          isActive ? "text-slate-100" : "text-slate-300",
                        )}
                      >
                        {match.reference}
                      </span>
                      {match.translations.length > 0 && (
                        <span className="mt-0.5 block truncate text-xs font-normal text-slate-500">
                          {match.translations.join(" · ")}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-t-[0.5px] border-surface-border bg-surface-elevated px-6 py-4">
          <p className="text-xs text-slate-500">
            {scanning ? "Updating scripture references…" : scanError ? "Scan your notes again to continue." : (
              <>Your playlist will include <span className="font-semibold text-slate-300 tabular-nums">{analysis.items.length}</span> scripture {analysis.items.length === 1 ? "passage" : "passages"}.</>
            )}
          </p>
          <div className="flex gap-2.5">
            <Button variant="outline" onClick={onCancel} disabled={confirming}>Cancel</Button>
            <Button onClick={confirm} disabled={!editor || confirming || scanning || !!scanError || analysis.items.length === 0}>
              {confirming && <Loader data-icon="inline-start" className="animate-spin" />}
              {confirming ? "Creating playlist…" : "Create playlist"}
            </Button>
          </div>
        </footer>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
