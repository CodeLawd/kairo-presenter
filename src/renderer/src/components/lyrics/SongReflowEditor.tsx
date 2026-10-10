import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Popover } from 'radix-ui'
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from '@/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { LyricsSectionType } from '@shared/ipc'
import { nextSectionLabel, parseReflow, reflowHeaderLabel } from '@shared/lyrics-reflow'
import { sectionColor } from './section-colors'

export interface ReflowEditSection {
  _key: string
  type: LyricsSectionType
  label: string
  linesText: string
  hotkey?: string
}

interface Slide {
  key: string
  text: string
}

interface Block {
  key: string
  type: LyricsSectionType
  label: string
  hotkey?: string
  slides: Slide[]
}

const SECTION_TYPES: Array<{ type: LyricsSectionType; label: string }> = [
  { type: 'verse', label: 'Verse' },
  { type: 'pre-chorus', label: 'Pre-Chorus' },
  { type: 'chorus', label: 'Chorus' },
  { type: 'bridge', label: 'Bridge' },
  { type: 'tag', label: 'Tag' },
  { type: 'intro', label: 'Intro' },
  { type: 'outro', label: 'Outro' },
  { type: 'ending', label: 'Ending' },
]

interface Caret {
  key: string
  at: number
}

interface Snapshot {
  blocks: Block[]
  /** Where the cursor was, so undo puts it back there. */
  caret: Caret | null
}

/** Keystrokes in one slide closer together than this undo as one step. */
const TYPING_BURST_MS = 1000
const MAX_UNDO = 200

let keySeq = 0
const makeKey = (): string => `slide-${Date.now()}-${keySeq++}`

/** A blank line (or a run of them) — where one slide ends and the next begins. */
const BREAK_RE = /\n[ \t]*\n+/

const EMPTY_SONG: ReflowEditSection[] = [{ _key: 'empty', type: 'verse', label: 'Verse 1', linesText: '' }]

function toBlocks(sections: ReflowEditSection[]): Block[] {
  const source = sections.length > 0 ? sections : EMPTY_SONG
  return source.map((section) => ({
    key: section._key === 'empty' ? makeKey() : section._key,
    type: section.type,
    label: section.label,
    hotkey: section.hotkey,
    slides: section.linesText.split(BREAK_RE).map((text) => ({ key: makeKey(), text: text.replace(/\s+$/, '') })),
  }))
}

function toSections(blocks: Block[]): ReflowEditSection[] {
  return blocks.map((block) => ({
    _key: block.key,
    type: block.type,
    label: block.label.trim() || 'Verse',
    linesText: block.slides
      // A blank line typed inside a slide is just space — it must not come
      // back as a slide break the next time the song opens.
      .map((slide) => slide.text.replace(BREAK_RE, '\n').replace(/\s+$/, ''))
      .filter((text) => text.trim() !== '')
      .join('\n\n'),
    ...(block.hotkey ? { hotkey: block.hotkey } : {}),
  }))
}

/** A label that just names its type ("Verse 2", "Chorus") — renamed along when the type changes. */
function isStockLabel(label: string, type: LyricsSectionType): boolean {
  const name = SECTION_TYPES.find((t) => t.type === type)?.label ?? type
  return new RegExp(`^${name}( \\d+)?$`, 'i').test(label.trim())
}

/**
 * The song editor, laid out like ProPresenter's: each slide a numbered block,
 * each section a coloured gutter with its name down the side. Enter is a new
 * line; ⌥↵ breaks into a new slide and Backspace at the start of a slide joins
 * it to the one above. New sections are made on purpose — from a slide's menu
 * or Add section — or come from pasting a song with [Chorus] lines.
 */
export function SongReflowEditor({
  sections,
  onChange,
  autoFocus,
}: {
  sections: ReflowEditSection[]
  onChange: (sections: ReflowEditSection[]) => void
  autoFocus?: boolean
}): React.ReactElement {
  const [blocks, setBlocks] = useState<Block[]>(() => toBlocks(sections))
  const emittedRef = useRef<ReflowEditSection[]>(sections)
  const fieldRefs = useRef(new Map<string, HTMLTextAreaElement>())
  const [focus, setFocus] = useState<Caret | null>(null)

  useEffect(() => {
    if (autoFocus) setFocus({ key: blocks[0].slides[0].key, at: 0 })
    // Only on open.
  }, [])

  // Sections that arrive different from what this editor last reported came
  // from outside (a translation, a reload) and replace the blocks.
  useEffect(() => {
    if (sections === emittedRef.current) return
    emittedRef.current = sections
    setBlocks(toBlocks(sections))
  }, [sections])

  useLayoutEffect(() => {
    if (!focus) return
    const field = fieldRefs.current.get(focus.key)
    if (!field) {
      // That slide is gone (undone away) — don't jump there later.
      setFocus(null)
      return
    }
    field.focus()
    field.setSelectionRange(focus.at, focus.at)
    setFocus(null)
  }, [focus, blocks])

  // ─── Undo ──────────────────────────────────────────────────────────────────
  // The editor's own history: a split, a join, a paste or a section change has
  // to undo as surely as typing does, which the browser's per-field undo can't.
  // Typing in one slide within a second of the last keystroke is one step.
  const history = useRef<{ past: Snapshot[]; future: Snapshot[]; typingKey: string | null; typedAt: number }>({
    past: [],
    future: [],
    typingKey: null,
    typedAt: 0,
  })

  /** Where the cursor is, if it is in one of the slides. */
  const caretNow = (): Caret | null => {
    for (const [key, field] of fieldRefs.current) {
      if (field === document.activeElement) return { key, at: field.selectionStart }
    }
    return null
  }

  const show = (next: Block[]): void => {
    setBlocks(next)
    const out = toSections(next)
    emittedRef.current = out
    onChange(out)
  }

  const commit = (next: Block[], nextFocus?: Caret, typingKey?: string): void => {
    const h = history.current
    const now = Date.now()
    const sameBurst = typingKey !== undefined && h.typingKey === typingKey && now - h.typedAt < TYPING_BURST_MS
    if (!sameBurst) {
      h.past.push({ blocks, caret: caretNow() })
      if (h.past.length > MAX_UNDO) h.past.shift()
    }
    h.future = []
    h.typingKey = typingKey ?? null
    h.typedAt = now
    show(next.length > 0 ? next : toBlocks(EMPTY_SONG))
    if (nextFocus) setFocus(nextFocus)
  }

  const step = (from: Snapshot[], to: Snapshot[]): void => {
    const target = from.pop()
    if (!target) return
    to.push({ blocks, caret: caretNow() })
    history.current.typingKey = null
    show(target.blocks)
    if (target.caret) setFocus(target.caret)
  }

  const undo = (): void => step(history.current.past, history.current.future)
  const redo = (): void => step(history.current.future, history.current.past)

  const where = (slideKey: string): { b: number; s: number } => {
    for (let b = 0; b < blocks.length; b++) {
      const s = blocks[b].slides.findIndex((slide) => slide.key === slideKey)
      if (s !== -1) return { b, s }
    }
    return { b: -1, s: -1 }
  }

  const withSlides = (b: number, slides: Slide[]): Block[] =>
    blocks.map((block, i) => (i === b ? { ...block, slides } : block))

  /** Replaces one slide with several — a split, or a paste with breaks in it. */
  const replaceSlide = (b: number, s: number, texts: string[], focusIndex: number, focusAt: number): void => {
    const fresh = texts.map((text, i) => ({ key: i === 0 ? blocks[b].slides[s].key : makeKey(), text }))
    const slides = [...blocks[b].slides.slice(0, s), ...fresh, ...blocks[b].slides.slice(s + 1)]
    commit(withSlides(b, slides), { key: fresh[focusIndex].key, at: focusAt })
  }

  /** Typing only ever changes this slide — Enter is a new line, never a new slide. */
  const editSlide = (slideKey: string, value: string): void => {
    const { b, s } = where(slideKey)
    if (b === -1) return
    commit(withSlides(b, blocks[b].slides.map((slide, j) => (j === s ? { ...slide, text: value } : slide))), undefined, slideKey)
  }

  /**
   * A paste that carries a song's shape keeps it: blank lines become slides and
   * [Chorus] lines become sections. Anything else pastes as plain text.
   */
  const pasteInto = (slideKey: string, field: HTMLTextAreaElement, pasted: string): boolean => {
    const clean = pasted.replace(/\r\n?/g, '\n')
    const hasHeader = clean.split('\n').some((line) => reflowHeaderLabel(line) !== null)
    if (!hasHeader && !BREAK_RE.test(clean.trim())) return false
    const { b, s } = where(slideKey)
    if (b === -1) return false
    const current = blocks[b].slides[s].text
    const value = current.slice(0, field.selectionStart) + clean + current.slice(field.selectionEnd)
    if (hasHeader) {
      pasteSong(b, s, value)
    } else {
      const parts = value.split(BREAK_RE).map((part) => part.replace(/\s+$/, ''))
      const last = parts.length - 1
      replaceSlide(b, s, parts, last, parts[last].length)
    }
    return true
  }

  /** ⌥↵ (or ⌘↵): everything from the cursor moves to a new slide below. */
  const breakAt = (slideKey: string, cursor: number): void => {
    const { b, s } = where(slideKey)
    if (b === -1) return
    const text = blocks[b].slides[s].text
    replaceSlide(b, s, [text.slice(0, cursor).replace(/\s+$/, ''), text.slice(cursor).replace(/^\s+/, '')], 1, 0)
  }

  /** Backspace at the very start: this slide joins the end of the one above. */
  const joinUp = (slideKey: string): boolean => {
    const { b, s } = where(slideKey)
    if (b === -1 || s === 0) return false
    const above = blocks[b].slides[s - 1]
    const current = blocks[b].slides[s]
    const joined = [above.text, current.text].filter((t) => t.trim()).join('\n')
    const at = above.text.trim() ? above.text.length + (current.text.trim() ? 1 : 0) : 0
    const slides = [...blocks[b].slides]
    slides.splice(s - 1, 2, { key: above.key, text: joined })
    commit(withSlides(b, slides), { key: above.key, at })
    return true
  }

  const pasteSong = (b: number, s: number, value: string): void => {
    const parsed = parseReflow(value)
    const block = blocks[b]
    const before = block.slides.slice(0, s)
    const after = block.slides.slice(s + 1)
    const pasted: Block[] = []
    parsed.forEach((section) => {
      const slides = section.slides.map((slide) => ({ key: makeKey(), text: slide.lines.join('\n') }))
      if (section.headerLine === null) {
        // Text above the first [Header] stays in the section it was pasted into.
        before.push(...slides)
        return
      }
      pasted.push({ key: makeKey(), type: section.type, label: section.label, slides: slides.length ? slides : [{ key: makeKey(), text: '' }] })
    })
    const head: Block[] = before.length ? [{ ...block, slides: before }] : []
    const tail: Block[] = after.length
      ? [{ key: makeKey(), type: block.type, label: nextSectionLabel([...blocks, ...pasted], block.type), slides: after }]
      : []
    const next = [...blocks.slice(0, b), ...head, ...pasted, ...tail, ...blocks.slice(b + 1)]
    const last = pasted[pasted.length - 1]?.slides.at(-1) ?? before.at(-1)
    commit(next, last ? { key: last.key, at: last.text.length } : undefined)
  }

  // ─── Section actions ───────────────────────────────────────────────────────

  const updateBlock = (b: number, patch: Partial<Block>): void =>
    commit(blocks.map((block, i) => (i === b ? { ...block, ...patch } : block)))

  const setType = (b: number, type: LyricsSectionType): void => {
    const block = blocks[b]
    const label = isStockLabel(block.label, block.type) ? nextSectionLabel(blocks.filter((_, i) => i !== b), type) : block.label
    updateBlock(b, { type, label })
  }

  const moveBlock = (b: number, to: number): void => {
    if (to < 0 || to >= blocks.length) return
    const next = [...blocks]
    const [moved] = next.splice(b, 1)
    next.splice(to, 0, moved)
    commit(next)
  }

  const deleteBlock = (b: number): void => commit(blocks.filter((_, i) => i !== b))

  /** A new section starting at this slide: it and everything below it move in. */
  const startSectionAt = (slideKey: string, type: LyricsSectionType): void => {
    const { b, s } = where(slideKey)
    if (b === -1) return
    const block = blocks[b]
    const moved: Block = { key: makeKey(), type, label: nextSectionLabel(blocks, type), slides: block.slides.slice(s) }
    const kept: Block[] = s > 0 ? [{ ...block, slides: block.slides.slice(0, s) }] : []
    commit([...blocks.slice(0, b), ...kept, moved, ...blocks.slice(b + 1)], { key: moved.slides[0].key, at: 0 })
  }

  const addSection = (type: LyricsSectionType): void => {
    const slide = { key: makeKey(), text: '' }
    commit([...blocks, { key: makeKey(), type, label: nextSectionLabel(blocks, type), slides: [slide] }], { key: slide.key, at: 0 })
  }

  const deleteSlide = (slideKey: string): void => {
    const { b, s } = where(slideKey)
    if (b === -1) return
    const slides = blocks[b].slides.filter((_, j) => j !== s)
    if (slides.length === 0) deleteBlock(b)
    else commit(withSlides(b, slides))
  }

  let number = 0

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto"
      onKeyDownCapture={(event) => {
        if (!(event.metaKey || event.ctrlKey) || event.altKey) return
        const key = event.key.toLowerCase()
        if (key !== 'z' && key !== 'y') return
        event.preventDefault()
        if (key === 'y' || event.shiftKey) redo()
        else undo()
      }}
    >
      <div className="mx-auto w-full max-w-3xl space-y-3 px-4 pb-10">
        {blocks.map((block, b) => {
          const color = sectionColor(block.type)
          return (
            <section key={block.key} className="flex overflow-hidden rounded-md bg-surface-secondary">
              {/* The gutter: the section's name down the side, in its colour. */}
              <Popover.Root>
                <Popover.Trigger
                  className="relative flex w-7 shrink-0 justify-center bg-surface-tertiary py-2 text-[11px] font-medium text-slate-300 outline-none transition-colors hover:bg-surface-elevated hover:text-white focus-visible:bg-surface-elevated"
                  aria-label={`${block.label}: rename, change type, move or delete`}
                >
                  <span className="sticky top-2 h-fit rotate-180 whitespace-nowrap [writing-mode:vertical-rl]">{block.label}</span>
                  <span className="absolute inset-y-0 right-0 w-[3px]" style={{ backgroundColor: color }} />
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    side="left"
                    align="start"
                    sideOffset={6}
                    collisionPadding={12}
                    className="z-50 w-56 space-y-3 rounded-lg bg-surface-tertiary p-3 text-zinc-200 animate-spring-in"
                  >
                    <input
                      value={block.label}
                      maxLength={40}
                      onChange={(event) => updateBlock(b, { label: event.target.value })}
                      aria-label="Section name"
                      className="h-8 w-full rounded-md bg-surface-secondary px-2.5 text-[13px] text-white outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                    />
                    <div className="grid grid-cols-2 gap-1">
                      {SECTION_TYPES.map(({ type, label }) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setType(b, type)}
                          className={cn(
                            'flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] transition-colors',
                            block.type === type ? 'bg-surface-elevated text-white' : 'text-slate-400 hover:bg-surface-secondary hover:text-slate-200',
                          )}
                        >
                          <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: sectionColor(type) }} aria-hidden="true" />
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1 pt-1">
                      <IconAction label="Move up" disabled={b === 0} onClick={() => moveBlock(b, b - 1)}><ArrowUp size={13} /></IconAction>
                      <IconAction label="Move down" disabled={b === blocks.length - 1} onClick={() => moveBlock(b, b + 1)}><ArrowDown size={13} /></IconAction>
                      <Popover.Close asChild>
                        <button
                          type="button"
                          onClick={() => deleteBlock(b)}
                          className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-red-400 transition-colors hover:bg-tint-red"
                        >
                          <Trash2 size={12} /> Delete section
                        </button>
                      </Popover.Close>
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>

              {/* Its slides, numbered through the song like ProPresenter's. */}
              <div className="min-w-0 flex-1">
                {block.slides.map((slide) => {
                  number += 1
                  const n = number
                  return (
                    <div key={slide.key}>
                      <div className="flex h-6 items-center bg-surface-tertiary pl-2.5 pr-1 text-[11px] tabular-nums text-slate-500">
                        <span className="flex-1">{n}.</span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" aria-label={`Slide ${n} actions`} className="grid size-5 place-items-center rounded text-slate-500 hover:bg-surface-elevated hover:text-white">
                              <ChevronDown size={12} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>New section from here</DropdownMenuSubTrigger>
                              <DropdownMenuSubContent className="w-40">
                                {SECTION_TYPES.map(({ type, label }) => (
                                  <DropdownMenuItem key={type} onSelect={() => startSectionAt(slide.key, type)}>
                                    <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: sectionColor(type) }} aria-hidden="true" />
                                    {label}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => deleteSlide(slide.key)} className="text-red-400">
                              <Trash2 size={13} /> Delete slide
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <textarea
                        ref={(el) => {
                          if (el) fieldRefs.current.set(slide.key, el)
                          else fieldRefs.current.delete(slide.key)
                        }}
                        value={slide.text}
                        onChange={(event) => editSlide(slide.key, event.target.value)}
                        onPaste={(event) => {
                          if (pasteInto(slide.key, event.currentTarget, event.clipboardData.getData('text/plain'))) event.preventDefault()
                        }}
                        onKeyDown={(event) => {
                          const el = event.currentTarget
                          if ((event.altKey || event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                            event.preventDefault()
                            breakAt(slide.key, el.selectionStart)
                          } else if (event.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0) {
                            if (joinUp(slide.key)) event.preventDefault()
                          }
                        }}
                        rows={1}
                        spellCheck
                        aria-label={`${block.label}, slide ${n}`}
                        placeholder="Type the words for this slide"
                        className="block min-h-14 w-full resize-none bg-transparent px-6 py-3 text-center text-[15px] leading-7 text-slate-100 outline-none [field-sizing:content] placeholder:text-slate-600 focus:bg-surface-elevated"
                      />
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}

        <div className="flex items-center gap-3 pt-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-slate-400 transition-colors hover:bg-surface-secondary hover:text-white">
                <Plus size={13} aria-hidden="true" /> Add section
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44" onCloseAutoFocus={(event) => event.preventDefault()}>
              <DropdownMenuLabel className="text-[11px] font-medium text-slate-500">Section type</DropdownMenuLabel>
              {SECTION_TYPES.map(({ type, label }) => (
                <DropdownMenuItem key={type} onSelect={() => addSection(type)}>
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: sectionColor(type) }} aria-hidden="true" />
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <p className="ml-auto text-[11px] text-slate-600">
            ⌥↵ new slide · Backspace at the start joins it to the one above
          </p>
        </div>
      </div>
    </div>
  )
}

function IconAction({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      data-tooltip={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-md text-slate-400 transition-colors hover:bg-surface-secondary hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}
