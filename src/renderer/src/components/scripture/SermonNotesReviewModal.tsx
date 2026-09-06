import { useCallback, useEffect, useRef, useState } from "react";
import Highlight from "@tiptap/extension-highlight";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { ArrowDown, ArrowUp, FileText, Loader, ScanSearch, X } from '@/icons';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SermonNotesAnalysis, SermonPlanDraft } from "@shared/ipc";
import { normalizedReferenceLabel } from "@shared/sermon-notes-review";

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

function editorHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  return `<p>${escaped.replace(/\n/g, "<br>")}</p>`
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
    const from = Math.min(match.start + 1, maxPosition)
    const to = Math.min(match.end + 1, maxPosition)
    if (from < to) {
      transaction.addMark(from, to, markType.create({
        color: "#facc15",
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
  const [analysis, setAnalysis] = useState<SermonNotesAnalysis>({
    matches: draft.matches,
    items: draft.items,
  })
  const [scanning, setScanning] = useState(false)
  const [activeMatch, setActiveMatch] = useState(0)
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
    try {
      const next = await window.api.scripture.scanSermonNotes(text)
      if (sequence !== scanSequenceRef.current) return
      setAnalysis(next)
      setActiveMatch((current) => Math.min(current, Math.max(0, next.matches.length - 1)))
    } finally {
      if (sequence === scanSequenceRef.current) setScanning(false)
    }
  }, [])

  const editor = useEditor({
    extensions: [StarterKit, ScriptureHighlight.configure({ multicolor: true })],
    content: editorHtml(draft.text),
    editorProps: {
      attributes: {
        class:
          "min-h-full whitespace-pre-wrap break-words px-8 py-7 font-sans text-[15px] leading-7 text-slate-800 outline-none selection:bg-teal-200/70",
        spellcheck: "true",
        "aria-label": "Editable sermon notes",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (paintingRef.current) return
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
      scanTimerRef.current = setTimeout(() => void scan(currentEditor.getText()), 300)
    },
  })

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
    const documentSize = editor.state.doc.content.size
    let next = 0
    for (let index = 0; index < analysis.matches.length; index += 1) {
      const position = Math.min(analysis.matches[index].start + 1, documentSize)
      let top: number
      try {
        top = editor.view.coordsAtPos(position).top
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
    ignoreSyncUntilRef.current = Date.now() + 400
    setActiveMatch(normalized)
    editor
      .chain()
      .focus()
      .setTextSelection({ from: match.start + 1, to: match.end + 1 })
      .scrollIntoView()
      .run()
  }, [analysis.matches, editor])

  const confirm = (): void => {
    if (!editor || scanning || analysis.items.length === 0) return
    onConfirm(title.trim() || draft.title, editor.getText(), analysis)
  }

  const matchCount = analysis.matches.length

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/82 p-5 backdrop-blur-md">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sermon-review-title"
        className="flex h-[min(860px,calc(100vh-40px))] w-[min(1180px,calc(100vw-40px))] flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface-secondary shadow-2xl shadow-black/50"
      >
        <header className="flex items-center justify-between gap-5 border-b border-surface-border px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <ScanSearch size={16} className="shrink-0 text-slate-500" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id="sermon-review-title" className="text-sm font-semibold text-slate-100">
                Review sermon notes
              </h2>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">
                {draft.sourceFileName} · edit anything misread, then confirm
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel} disabled={confirming} aria-label="Close review">
            <X size={17} />
          </Button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_310px]">
          <div className="flex min-h-0 flex-col border-r border-surface-border bg-[#111820]">
            <div className="flex items-center gap-2.5 border-b border-surface-border/80 px-4 py-2.5">
              <FileText size={14} className="shrink-0 text-slate-500" aria-hidden="true" />
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                aria-label="Playlist title"
                className="h-8 max-w-md border-transparent bg-transparent px-2 text-sm font-semibold text-slate-200 hover:border-surface-border focus:border-teal-500/50"
              />
              <div className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500">
                {scanning && <Loader size={12} className="animate-spin text-yellow-300" />}
                {scanning ? "Scanning edits…" : "Changes scan automatically"}
              </div>
            </div>
            <div
              ref={notesScrollRef}
              onScroll={handleNotesScroll}
              className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
              style={{ scrollbarGutter: "stable" }}
            >
              <div className="mx-auto min-h-full max-w-3xl overflow-hidden rounded-sm bg-[#f7f4ea] shadow-[0_20px_55px_rgba(0,0,0,0.32)] ring-1 ring-black/15 [&_mark]:rounded-[3px] [&_mark]:bg-yellow-300 [&_mark]:px-0.5 [&_mark]:text-slate-950 [&_mark]:shadow-[0_0_0_1px_rgba(202,138,4,0.18)] [&_mark[data-active=true]]:bg-amber-400 [&_mark[data-active=true]]:shadow-[0_0_0_2px_rgba(180,83,9,0.55)]">
                <EditorContent editor={editor} className="sermon-notes-editor min-h-full" />
              </div>
            </div>
          </div>

          <aside className="flex min-h-0 flex-col bg-surface-secondary">
            <div className="flex items-center justify-between gap-3 border-b border-surface-border px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Detected
                <span className="ml-2 tracking-normal tabular-nums text-slate-300">
                  {matchCount === 0 ? "0" : `${activeMatch + 1} / ${matchCount}`}
                </span>
              </p>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => goToMatch(activeMatch - 1)} disabled={matchCount === 0} aria-label="Previous reference">
                  <ArrowUp size={14} />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => goToMatch(activeMatch + 1)} disabled={matchCount === 0} aria-label="Next reference">
                  <ArrowDown size={14} />
                </Button>
              </div>
            </div>

            <div
              ref={matchListRef}
              className="relative min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2"
              style={{ scrollbarGutter: "stable" }}
            >
              {matchCount === 0 ? (
                <div className="m-1 rounded-lg border border-dashed border-surface-border px-4 py-6 text-center">
                  <p className="text-[13px] font-medium text-slate-300">No references found</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Add one such as “John 3:16” directly in the notes.
                  </p>
                </div>
              ) : analysis.matches.map((match, index) => {
                const isActive = activeMatch === index
                return (
                  <button
                    key={`${match.start}-${match.reference}`}
                    ref={(element) => {
                      matchButtonsRef.current[index] = element
                    }}
                    type="button"
                    aria-current={isActive}
                    onClick={() => goToMatch(index)}
                    className={cn(
                      // Borderless rows keep a long list quiet; only the active
                      // one earns a tint and an accent bar.
                      "relative flex w-full items-baseline gap-2.5 rounded-lg py-2 pl-3.5 pr-2.5 text-left transition-colors",
                      isActive
                        ? "bg-yellow-400/[0.09]"
                        : "hover:bg-surface-tertiary/50",
                    )}
                  >
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-yellow-400"
                      />
                    )}
                    <span
                      className={cn(
                        "w-4 shrink-0 text-right text-[10px] font-semibold tabular-nums",
                        isActive ? "text-yellow-300" : "text-slate-600",
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
                        <span className="mt-0.5 block truncate text-[10px] font-medium uppercase tracking-wider text-slate-600">
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

        <footer className="flex items-center justify-between gap-4 border-t border-surface-border bg-surface/60 px-5 py-3.5">
          <p className="text-xs text-slate-500">
            Highlighted text becomes{" "}
            <span className="font-semibold text-slate-300 tabular-nums">{analysis.items.length}</span>{" "}
            playlist item{analysis.items.length === 1 ? "" : "s"}
          </p>
          <div className="flex gap-2.5">
            <Button variant="outline" onClick={onCancel} disabled={confirming}>Cancel</Button>
            <Button onClick={confirm} disabled={confirming || scanning || analysis.items.length === 0}>
              {confirming && <Loader data-icon="inline-start" className="animate-spin" />}
              {confirming ? "Creating playlist…" : "Confirm & import"}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  )
}
