import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Search,
  Music2,
  Star,
  Send,
  ChevronDown,
  X,
  Plus,
  Trash2,
  Download,
  Eye,
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  MoreVertical,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Edit2,
  Save,
  FileText,
  ListMusic,
  FilePlus,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { cn, downloadFile } from '@/lib/utils'
import type {
  LyricsSong,
  LyricsSongSection,
  LyricsSectionType,
  LyricsImportSource,
  SongPresentOptions,
  ProPresenterPlaylist,
} from '@shared/ipc'

// ─── Local types ──────────────────────────────────────────────────────────────

type FilterType = 'all' | 'favorites' | 'recent'
type SortType = 'title' | 'artist' | 'recent' | 'added'
type SendStatus = 'idle' | 'sending' | 'sent' | 'error'
type ImportStatus = 'idle' | 'importing' | 'error'

interface EditSection {
  _key: string
  type: LyricsSectionType
  label: string
  linesText: string
}

interface EditState {
  title: string
  artist: string
  copyright: string
  ccliNumber: string
  sections: EditSection[]
}

interface ContextMenuState {
  songId: string
  x: number
  y: number
}

interface Slide {
  sectionLabel: string
  lines: string[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SECTION_COLORS: Record<LyricsSectionType, string> = {
  verse: 'text-blue-400 bg-blue-500/10 border-blue-500/25',
  chorus: 'text-teal-400 bg-teal-500/10 border-teal-500/25',
  bridge: 'text-purple-400 bg-purple-500/10 border-purple-500/25',
  'pre-chorus': 'text-orange-400 bg-orange-500/10 border-orange-500/25',
  tag: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/25',
  intro: 'text-slate-400 bg-slate-500/10 border-slate-500/25',
  outro: 'text-slate-400 bg-slate-500/10 border-slate-500/25',
  ending: 'text-rose-400 bg-rose-500/10 border-rose-500/25',
}

const SECTION_TYPE_OPTS: { value: LyricsSectionType; label: string }[] = [
  { value: 'verse', label: 'Verse' },
  { value: 'chorus', label: 'Chorus' },
  { value: 'bridge', label: 'Bridge' },
  { value: 'pre-chorus', label: 'Pre-Chorus' },
  { value: 'tag', label: 'Tag' },
  { value: 'intro', label: 'Intro' },
  { value: 'outro', label: 'Outro' },
  { value: 'ending', label: 'Ending' },
]

const SEND_LABEL: Record<SendStatus, string> = {
  idle: 'Push to PP',
  sending: 'Sending…',
  sent: 'Sent!',
  error: 'Failed',
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

let _keyN = 0
function makeKey(): string {
  return `s${++_keyN}`
}

function songToEdit(song: LyricsSong): EditState {
  return {
    title: song.title,
    artist: song.artist,
    copyright: song.copyright ?? '',
    ccliNumber: song.ccliNumber ?? '',
    sections: song.sections.map((s) => ({
      _key: makeKey(),
      type: s.type,
      label: s.label,
      linesText: s.lines.join('\n'),
    })),
  }
}

function editToSections(sections: EditSection[]): LyricsSongSection[] {
  return sections.map((s) => ({
    type: s.type,
    label: s.label,
    lines: s.linesText.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()),
  }))
}

function wrapLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line]
  const words = line.split(/\s+/)
  const wrapped: string[] = []
  let cur = ''
  for (const word of words) {
    if (!cur) { cur = word }
    else if (cur.length + 1 + word.length <= maxChars) { cur += ' ' + word }
    else { wrapped.push(cur); cur = word }
  }
  if (cur) wrapped.push(cur)
  return wrapped.length > 0 ? wrapped : [line]
}

function buildSlides(song: LyricsSong, opts: SongPresentOptions): Slide[] {
  const linesPerSlide = opts.linesPerSlide ?? 4
  const maxChars = opts.maxCharsPerLine ?? 40
  const slides: Slide[] = []
  for (const section of song.sections) {
    const expanded: string[] = []
    for (const line of section.lines) expanded.push(...wrapLine(line, maxChars))
    if (expanded.length === 0) {
      slides.push({ sectionLabel: section.label, lines: [] })
      continue
    }
    for (let i = 0; i < expanded.length; i += linesPerSlide) {
      const chunk = expanded.slice(i, i + linesPerSlide)
      const count = Math.ceil(expanded.length / linesPerSlide)
      const label = count > 1 ? `${section.label} (${Math.floor(i / linesPerSlide) + 1}/${count})` : section.label
      slides.push({ sectionLabel: label, lines: chunk })
    }
  }
  return slides
}


function toTxt(song: LyricsSong): string {
  const lines: string[] = [`Title: ${song.title}`]
  if (song.artist) lines.push(`Artist: ${song.artist}`)
  if (song.copyright) lines.push(`Copyright: ${song.copyright}`)
  if (song.ccliNumber) lines.push(`CCLI: ${song.ccliNumber}`)
  lines.push('')
  for (const sec of song.sections) {
    lines.push(`[${sec.label}]`, ...sec.lines, '')
  }
  return lines.join('\n').trimEnd()
}

function toUsr(song: LyricsSong): string {
  const lines: string[] = [`Title=${song.title}`]
  if (song.artist) lines.push(`Author=${song.artist}`)
  if (song.copyright) lines.push(`Copyright=${song.copyright}`)
  if (song.ccliNumber) lines.push(`CCLI#=${song.ccliNumber}`)
  lines.push('')
  for (const sec of song.sections) {
    const tag =
      sec.type === 'verse' ? 'V'
      : sec.type === 'chorus' ? 'C'
      : sec.type === 'bridge' ? 'B'
      : sec.type === 'pre-chorus' ? 'PC'
      : sec.type === 'tag' ? 'T'
      : sec.type === 'intro' ? 'I'
      : sec.type === 'outro' ? 'O'
      : 'E'
    lines.push(`{${tag}}`, ...sec.lines, '')
  }
  return lines.join('\n').trimEnd()
}

function applyFilter(songs: LyricsSong[], filter: FilterType): LyricsSong[] {
  if (filter === 'favorites') return songs.filter((s) => s.isFavorite)
  return songs
}

function applySort(songs: LyricsSong[], sort: SortType): LyricsSong[] {
  const out = [...songs]
  switch (sort) {
    case 'title':  out.sort((a, b) => a.title.localeCompare(b.title)); break
    case 'artist': out.sort((a, b) => (a.artist || '').localeCompare(b.artist || '')); break
    case 'recent': out.sort((a, b) => b.updatedAt - a.updatedAt); break
    case 'added':  out.sort((a, b) => b.createdAt - a.createdAt); break
  }
  return out
}

// ─── SectionBadge ─────────────────────────────────────────────────────────────

function SectionBadge({ type }: { type: LyricsSectionType }): React.ReactElement {
  const label =
    type === 'pre-chorus' ? 'Pre-C'
    : type.charAt(0).toUpperCase() + type.slice(1)
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border shrink-0',
      SECTION_COLORS[type]
    )}>
      {label}
    </span>
  )
}

// ─── SongListItem ─────────────────────────────────────────────────────────────

function SongListItem({
  song,
  isSelected,
  onSelect,
  onContextMenu,
  onToggleFavorite,
}: {
  song: LyricsSong
  isSelected: boolean
  onSelect: (id: string) => void
  onContextMenu: (e: React.MouseEvent, id: string) => void
  onToggleFavorite: (id: string) => void
}): React.ReactElement {
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'group flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150 border select-none',
        isSelected
          ? 'bg-teal-600/15 border-teal-500/30'
          : 'hover:bg-surface-tertiary border-transparent hover:border-surface-border/50'
      )}
      onClick={() => onSelect(song.id)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(song.id)}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, song.id) }}
    >
      <div className={cn(
        'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors',
        isSelected
          ? 'bg-teal-500/20 border border-teal-500/30'
          : 'bg-surface-elevated border border-surface-border/50'
      )}>
        <Music2 size={12} className={cn(isSelected ? 'text-teal-400' : 'text-slate-500')} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn('text-[13px] font-semibold truncate leading-tight', isSelected ? 'text-white' : 'text-slate-200')}>
          {song.title}
        </p>
        <p className="text-[11px] text-slate-500 truncate mt-0.5">
          {song.artist || 'Unknown Artist'}
          {song.ccliNumber && <span className="text-slate-600"> · #{song.ccliNumber}</span>}
        </p>
      </div>
      <button
        className={cn(
          'shrink-0 rounded p-0.5 transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-500/50',
          song.isFavorite
            ? 'text-yellow-400 opacity-100'
            : 'text-slate-600 opacity-0 group-hover:opacity-100 hover:text-yellow-400'
        )}
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(song.id) }}
        aria-label={song.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Star size={13} className={cn(song.isFavorite && 'fill-yellow-400')} />
      </button>
      <button
        className="shrink-0 rounded p-0.5 text-slate-600 opacity-0 group-hover:opacity-100 hover:text-slate-400 transition-all duration-150 focus-visible:outline-none"
        onClick={(e) => { e.stopPropagation(); onContextMenu(e, song.id) }}
        aria-label="More options"
      >
        <MoreVertical size={13} />
      </button>
    </div>
  )
}

// ─── FloatingContextMenu ──────────────────────────────────────────────────────

function FloatingContextMenu({
  menu,
  song,
  onEdit,
  onDelete,
  onToggleFavorite,
  onClose,
}: {
  menu: ContextMenuState
  song: LyricsSong | undefined
  onEdit: () => void
  onDelete: () => void
  onToggleFavorite: () => void
  onClose: () => void
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])

  const item = (
    label: string,
    icon: React.ReactNode,
    action: () => void,
    danger = false
  ): React.ReactElement => (
    <button
      className={cn(
        'w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-left transition-colors',
        danger
          ? 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
          : 'text-slate-300 hover:bg-surface-tertiary hover:text-white'
      )}
      onClick={() => { action(); onClose() }}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <div
      ref={ref}
      className="fixed z-50 w-44 rounded-lg bg-surface-elevated border border-surface-border shadow-2xl overflow-hidden animate-fade-in py-1"
      style={{ top: menu.y, left: menu.x }}
    >
      {item('Edit Song', <Edit2 size={13} />, onEdit)}
      {item(
        song?.isFavorite ? 'Remove Favorite' : 'Mark Favorite',
        <Star size={13} className={cn(song?.isFavorite && 'fill-yellow-400 text-yellow-400')} />,
        onToggleFavorite
      )}
      <div className="my-1 border-t border-surface-border/50" />
      {item('Delete', <Trash2 size={13} />, onDelete, true)}
    </div>
  )
}

// ─── SectionEditBlock ─────────────────────────────────────────────────────────

function SectionEditBlock({
  section,
  index,
  total,
  isDragTarget,
  onUpdate,
  onDelete,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  section: EditSection
  index: number
  total: number
  isDragTarget: boolean
  onUpdate: (key: string, patch: Partial<EditSection>) => void
  onDelete: (key: string) => void
  onMove: (from: number, to: number) => void
  onDragStart: (index: number) => void
  onDragOver: (e: React.DragEvent, index: number) => void
  onDrop: (index: number) => void
}): React.ReactElement {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={() => onDrop(index)}
      onDragEnd={() => onDrop(index)}
      className={cn(
        'rounded-xl border transition-all duration-150',
        isDragTarget
          ? 'border-teal-500/50 bg-teal-500/5 shadow-[0_0_0_1px_rgba(20,184,166,0.25)]'
          : 'border-surface-border/50 bg-surface-secondary/30'
      )}
    >
      {/* Section header row */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-border/30">
        <div className="text-slate-600 cursor-grab active:cursor-grabbing shrink-0">
          <GripVertical size={14} />
        </div>

        {/* Type selector */}
        <select
          value={section.type}
          onChange={(e) => {
            const t = e.target.value as LyricsSectionType
            const opt = SECTION_TYPE_OPTS.find((o) => o.value === t)
            onUpdate(section._key, { type: t, label: opt?.label ?? t })
          }}
          className={cn(
            'appearance-none text-[11px] font-bold uppercase tracking-wider cursor-pointer focus-visible:outline-none rounded px-1.5 py-0.5 border',
            SECTION_COLORS[section.type]
          )}
          style={{ backgroundColor: 'transparent' }}
        >
          {SECTION_TYPE_OPTS.map((o) => (
            <option key={o.value} value={o.value} className="bg-zinc-900 text-slate-200 font-normal normal-case tracking-normal text-sm">
              {o.label}
            </option>
          ))}
        </select>

        {/* Label input */}
        <input
          type="text"
          value={section.label}
          onChange={(e) => onUpdate(section._key, { label: e.target.value })}
          className="flex-1 bg-transparent text-[13px] font-medium text-slate-300 placeholder:text-slate-600 focus-visible:outline-none min-w-0 border-b border-transparent focus-visible:border-surface-border transition-colors"
          placeholder="Section label…"
        />

        {/* Reorder + delete */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
            className="p-1 rounded text-slate-600 hover:text-slate-400 disabled:opacity-30 transition-colors focus-visible:outline-none"
            aria-label="Move section up"
          >
            <ArrowUp size={12} />
          </button>
          <button
            disabled={index === total - 1}
            onClick={() => onMove(index, index + 1)}
            className="p-1 rounded text-slate-600 hover:text-slate-400 disabled:opacity-30 transition-colors focus-visible:outline-none"
            aria-label="Move section down"
          >
            <ArrowDown size={12} />
          </button>
          <button
            onClick={() => onDelete(section._key)}
            className="p-1 rounded text-slate-700 hover:text-red-400 transition-colors focus-visible:outline-none"
            aria-label="Delete section"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Lyrics textarea */}
      <textarea
        value={section.linesText}
        onChange={(e) => onUpdate(section._key, { linesText: e.target.value })}
        rows={Math.max(3, section.linesText.split('\n').length + 1)}
        className="w-full bg-transparent px-4 py-2.5 text-[13px] text-slate-300 leading-relaxed font-sans resize-none focus-visible:outline-none placeholder:text-slate-700"
        placeholder="Enter lyrics, one line per row…"
        spellCheck
      />
    </div>
  )
}

// ─── SlidePreviewModal ────────────────────────────────────────────────────────

function SlidePreviewModal({
  song,
  onClose,
}: {
  song: LyricsSong
  onClose: () => void
}): React.ReactElement {
  const [slideIndex, setSlideIndex] = useState(0)
  const slides = useMemo(() => buildSlides(song, {}), [song])
  const slide = slides[slideIndex] ?? null

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setSlideIndex((i) => Math.min(i + 1, slides.length - 1))
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setSlideIndex((i) => Math.max(i - 1, 0))
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose, slides.length])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm animate-fade-in p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-white">{song.title}</p>
            <p className="text-xs text-slate-500 mt-0.5">{song.artist}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 tabular-nums">{slideIndex + 1} / {slides.length}</span>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-none"
              aria-label="Close preview"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Slide canvas */}
        <div
          className="relative rounded-2xl overflow-hidden bg-black border border-white/5 shadow-2xl"
          style={{ aspectRatio: '16/9' }}
        >
          {slide && (
            <>
              {/* Section label */}
              <div className="absolute top-4 left-5 z-10">
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/25">
                  {slide.sectionLabel}
                </span>
              </div>

              {/* Lyrics content */}
              <div className="absolute inset-0 flex flex-col items-center justify-center px-14 gap-2">
                {slide.lines.length > 0 ? (
                  slide.lines.map((line, i) => (
                    <p
                      key={i}
                      className="text-white text-center leading-snug font-semibold tracking-wide"
                      style={{ fontSize: slide.lines.length <= 2 ? '2.25rem' : slide.lines.length <= 3 ? '1.75rem' : '1.4rem' }}
                    >
                      {line}
                    </p>
                  ))
                ) : (
                  <p className="text-white/15 text-sm italic">Empty slide</p>
                )}
              </div>

              {/* Progress bar */}
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/5">
                <div
                  className="h-full bg-white/20 transition-all duration-200"
                  style={{ width: `${((slideIndex + 1) / slides.length) * 100}%` }}
                />
              </div>
            </>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            disabled={slideIndex === 0}
            onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/10 border border-transparent hover:border-white/10 disabled:opacity-30 transition-all focus-visible:outline-none"
          >
            <ChevronLeft size={14} /> Previous
          </button>

          {slides.length <= 24 && (
            <div className="flex items-center gap-1">
              {slides.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setSlideIndex(i)}
                  className={cn(
                    'rounded-full transition-all duration-150 focus-visible:outline-none',
                    i === slideIndex
                      ? 'w-4 h-1.5 bg-white'
                      : 'w-1.5 h-1.5 bg-white/20 hover:bg-white/40'
                  )}
                  aria-label={`Slide ${i + 1}`}
                />
              ))}
            </div>
          )}

          <button
            disabled={slideIndex === slides.length - 1}
            onClick={() => setSlideIndex((i) => Math.min(slides.length - 1, i + 1))}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/10 border border-transparent hover:border-white/10 disabled:opacity-30 transition-all focus-visible:outline-none"
          >
            Next <ChevronRight size={14} />
          </button>
        </div>

        <p className="text-center text-[11px] text-white/20">Use arrow keys to navigate · Esc to close</p>
      </div>
    </div>
  )
}

// ─── ImportModal ──────────────────────────────────────────────────────────────

function ImportModal({
  onImported,
  onClose,
}: {
  onImported: (song: LyricsSong) => void
  onClose: () => void
}): React.ReactElement {
  const [tab, setTab] = useState<'file' | 'paste'>('file')
  const [dragOver, setDragOver] = useState(false)
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  // File tab
  const [filePreview, setFilePreview] = useState<LyricsSong | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Paste tab
  const [pasteForm, setPasteForm] = useState({ title: '', artist: '', copyright: '', text: '' })
  const setPasteField = useCallback(<K extends keyof typeof pasteForm>(key: K, val: string): void => {
    setPasteForm((p) => ({ ...p, [key]: val }))
  }, [])

  useEffect(() => {
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  const readFile = useCallback((file: File): void => {
    if (!file.name.endsWith('.usr') && !file.name.endsWith('.txt')) {
      setError('Only .usr and .txt files are supported.')
      return
    }
    const reader = new FileReader()
    reader.onload = (e): void => {
      const content = e.target?.result as string
      const source: LyricsImportSource = { type: 'usr', content, filename: file.name }
      setStatus('importing')
      setError(null)
      window.api.lyrics.import(source)
        .then((song) => { setFilePreview(song); setStatus('idle') })
        .catch((err: Error) => { setError(err.message); setStatus('error') })
    }
    reader.readAsText(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) readFile(file)
  }, [readFile])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file) readFile(file)
    e.target.value = ''
  }, [readFile])

  const handleConfirmFile = useCallback((): void => {
    if (!filePreview) return
    onImported(filePreview)
    onClose()
  }, [filePreview, onImported, onClose])

  const handlePasteImport = useCallback(async (): Promise<void> => {
    if (!pasteForm.title.trim() || !pasteForm.text.trim()) return
    setStatus('importing')
    setError(null)
    try {
      const source: LyricsImportSource = {
        type: 'text',
        title: pasteForm.title.trim(),
        artist: pasteForm.artist.trim(),
        text: pasteForm.text,
        copyright: pasteForm.copyright.trim() || undefined,
      }
      const song = await window.api.lyrics.import(source)
      onImported(song)
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setStatus('error')
    }
  }, [pasteForm, onImported, onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-surface rounded-2xl border border-surface-border shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'calc(100vh - 4rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border/50 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">Import Song</h2>
            <p className="text-xs text-slate-500 mt-0.5">Upload a .usr file or paste lyrics directly</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-surface-elevated transition-colors focus-visible:outline-none"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-5 pt-3 gap-1 shrink-0">
          {(['file', 'paste'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors',
                tab === t
                  ? 'bg-surface-elevated text-white border border-surface-border'
                  : 'text-slate-500 hover:text-slate-300'
              )}
            >
              {t === 'file' ? 'Upload File' : 'Paste Lyrics'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
          {tab === 'file' && (
            !filePreview ? (
              <div
                className={cn(
                  'border-2 border-dashed rounded-xl px-6 py-12 flex flex-col items-center gap-3 cursor-pointer transition-all',
                  dragOver
                    ? 'border-teal-500/60 bg-teal-500/5'
                    : 'border-surface-border/40 hover:border-surface-border'
                )}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                {status === 'importing'
                  ? <Loader2 size={28} className="text-teal-400 animate-spin" />
                  : <Upload size={28} className="text-slate-600" />
                }
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-300">
                    {status === 'importing' ? 'Reading file…' : 'Drop a .usr or .txt file here'}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">or click to browse your files</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".usr,.txt"
                  className="hidden"
                  onChange={handleFileInput}
                />
              </div>
            ) : (
              <div className="space-y-3">
                {/* File preview card */}
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-surface-secondary/40 border border-surface-border/40">
                  <div className="w-9 h-9 rounded-lg bg-teal-500/15 border border-teal-500/25 flex items-center justify-center shrink-0">
                    <Music2 size={15} className="text-teal-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{filePreview.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {filePreview.artist || 'Unknown artist'}
                      {filePreview.ccliNumber && <span className="text-slate-600"> · CCLI #{filePreview.ccliNumber}</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => setFilePreview(null)}
                    className="text-slate-600 hover:text-slate-400 transition-colors p-0.5 focus-visible:outline-none shrink-0"
                    aria-label="Remove and choose another file"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Section preview */}
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {filePreview.sections.map((sec, i) => (
                    <div key={i} className="flex items-start gap-2 py-0.5">
                      <SectionBadge type={sec.type} />
                      <p className="text-[12px] text-slate-400 leading-relaxed line-clamp-2 pt-0.5">
                        {sec.lines.slice(0, 2).join(' · ')}
                        {sec.lines.length > 2 && (
                          <span className="text-slate-600"> +{sec.lines.length - 2} more</span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}

          {tab === 'paste' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Title *</label>
                  <input
                    className="input"
                    placeholder="Song title"
                    value={pasteForm.title}
                    onChange={(e) => setPasteField('title', e.target.value)}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="label">Artist</label>
                  <input
                    className="input"
                    placeholder="Artist name"
                    value={pasteForm.artist}
                    onChange={(e) => setPasteField('artist', e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="label">Copyright</label>
                <input
                  className="input"
                  placeholder="© Year Author"
                  value={pasteForm.copyright}
                  onChange={(e) => setPasteField('copyright', e.target.value)}
                />
              </div>
              <div>
                <label className="label">Lyrics *</label>
                <textarea
                  className="input resize-none font-mono text-[13px] leading-relaxed"
                  placeholder={`Paste lyrics here.\n\nUse [Verse 1], [Chorus], [Bridge] to label sections,\nor separate sections with a blank line.`}
                  rows={10}
                  value={pasteForm.text}
                  onChange={(e) => setPasteField('text', e.target.value)}
                />
                <p className="text-[11px] text-slate-600 mt-1">
                  Sections auto-detected from labels or double blank lines.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 px-3.5 py-3 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-sm">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-surface-border/50 shrink-0">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          {tab === 'file' ? (
            <button
              disabled={!filePreview || status === 'importing'}
              className="btn-primary flex items-center gap-2"
              onClick={handleConfirmFile}
            >
              {status === 'importing' && <Loader2 size={13} className="animate-spin" />}
              Import Song
            </button>
          ) : (
            <button
              disabled={!pasteForm.title.trim() || !pasteForm.text.trim() || status === 'importing'}
              className="btn-primary flex items-center gap-2"
              onClick={handlePasteImport}
            >
              {status === 'importing' && <Loader2 size={13} className="animate-spin" />}
              Import Song
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── DeleteConfirmModal ───────────────────────────────────────────────────────

function DeleteConfirmModal({
  song,
  onConfirm,
  onCancel,
}: {
  song: LyricsSong
  onConfirm: () => void
  onCancel: () => void
}): React.ReactElement {
  useEffect(() => {
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm bg-surface rounded-2xl border border-surface-border shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/25 flex items-center justify-center shrink-0">
            <Trash2 size={15} className="text-red-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Delete Song</h3>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              Delete <span className="text-white font-medium">"{song.title}"</span>?
              This cannot be undone.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button className="btn-secondary text-sm py-1.5 px-3.5" onClick={onCancel}>Cancel</button>
          <button
            className="px-3.5 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 text-sm font-medium transition-colors focus-visible:outline-none"
            onClick={onConfirm}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Lyrics(): React.ReactElement {
  // ── Library ──────────────────────────────────────────────────────────────────
  const [songs, setSongs] = useState<LyricsSong[]>([])
  const [loading, setLoading] = useState(true)

  // ── Selection + editor ───────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [isNewSong, setIsNewSong] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // ── Section drag state ───────────────────────────────────────────────────────
  const dragSrcRef = useRef<number | null>(null)
  const [dragTargetIdx, setDragTargetIdx] = useState<number | null>(null)
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playlistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Search/filter/sort ───────────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [sortBy, setSortBy] = useState<SortType>('title')
  const [sortOpen, setSortOpen] = useState(false)
  const sortRef = useRef<HTMLDivElement>(null)

  // ── Overlays ─────────────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LyricsSong | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [showSlidePreview, setShowSlidePreview] = useState(false)

  // ── Action bar ───────────────────────────────────────────────────────────────
  const [sendStatus, setSendStatus] = useState<SendStatus>('idle')
  const [sendError, setSendError] = useState<string | null>(null)
  const [playlists, setPlaylists] = useState<ProPresenterPlaylist[]>([])
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const [playlistStatus, setPlaylistStatus] = useState<'idle' | 'adding' | 'added'>('idle')
  const [exportOpen, setExportOpen] = useState(false)
  const playlistRef = useRef<HTMLDivElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)

  // ── Derived ──────────────────────────────────────────────────────────────────
  const selectedSong = useMemo(() => songs.find((s) => s.id === selectedId) ?? null, [songs, selectedId])

  const filteredSongs = useMemo(() => {
    let result = applyFilter(songs, filter)
    result = applySort(result, filter === 'recent' ? 'recent' : sortBy)
    if (query.trim()) {
      const q = query.toLowerCase()
      result = result.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          (s.artist || '').toLowerCase().includes(q) ||
          (s.ccliNumber ?? '').includes(q)
      )
    }
    return result
  }, [songs, filter, sortBy, query])

  const contextMenuSong = useMemo(
    () => (contextMenu ? songs.find((s) => s.id === contextMenu.songId) ?? null : null),
    [songs, contextMenu]
  )

  // ── Load library on mount ────────────────────────────────────────────────────
  useEffect(() => {
    window.api.lyrics.getLibrary()
      .then((lib) => { setSongs(lib); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  // ── Timer cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (sendTimerRef.current) clearTimeout(sendTimerRef.current)
      if (playlistTimerRef.current) clearTimeout(playlistTimerRef.current)
    }
  }, [])

  // ── Close dropdowns on outside click ────────────────────────────────────────
  useEffect(() => {
    if (!sortOpen && !playlistOpen && !exportOpen) return
    const handler = (e: MouseEvent): void => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false)
      if (playlistRef.current && !playlistRef.current.contains(e.target as Node)) setPlaylistOpen(false)
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [sortOpen, playlistOpen, exportOpen])

  // ── Selection ────────────────────────────────────────────────────────────────
  const handleSelect = useCallback((id: string): void => {
    if (editMode) return
    setSelectedId(id)
    setSendStatus('idle')
    setSendError(null)
  }, [editMode])

  // ── Edit mode ────────────────────────────────────────────────────────────────
  const handleEdit = useCallback((): void => {
    if (!selectedSong) return
    setEditState(songToEdit(selectedSong))
    setIsNewSong(false)
    setEditMode(true)
    setSaveError(null)
  }, [selectedSong])

  const handleNewSong = useCallback((): void => {
    const empty: EditState = {
      title: '',
      artist: '',
      copyright: '',
      ccliNumber: '',
      sections: [{ _key: makeKey(), type: 'verse', label: 'Verse 1', linesText: '' }],
    }
    setSelectedId(null)
    setEditState(empty)
    setIsNewSong(true)
    setEditMode(true)
    setSaveError(null)
  }, [])

  const handleCancelEdit = useCallback((): void => {
    setEditMode(false)
    setEditState(null)
    setSaveError(null)
    if (isNewSong) setSelectedId(null)
    setIsNewSong(false)
  }, [isNewSong])

  const patchEdit = useCallback(<K extends keyof Omit<EditState, 'sections'>>(key: K, value: EditState[K]): void => {
    setEditState((p) => p ? { ...p, [key]: value } : p)
  }, [])

  const handleSave = useCallback(async (): Promise<void> => {
    if (!editState) return
    setSaving(true)
    setSaveError(null)
    try {
      const sections = editToSections(editState.sections)
      if (isNewSong) {
        const body = sections.map((s) => `[${s.label}]\n${s.lines.join('\n')}`).join('\n\n')
        const source: LyricsImportSource = {
          type: 'text',
          title: editState.title.trim() || 'Untitled',
          artist: editState.artist.trim(),
          text: body,
          copyright: editState.copyright.trim() || undefined,
        }
        const song = await window.api.lyrics.import(source)
        setSongs((prev) => [song, ...prev])
        setSelectedId(song.id)
      } else if (selectedId && selectedSong) {
        const updated: LyricsSong = {
          ...selectedSong,
          title: editState.title.trim() || selectedSong.title,
          artist: editState.artist.trim(),
          copyright: editState.copyright.trim() || undefined,
          ccliNumber: editState.ccliNumber.trim() || undefined,
          sections,
          updatedAt: Date.now(),
        }
        const result = await window.api.lyrics.update(selectedId, updated)
        if (result) {
          setSongs((prev) => prev.map((s) => (s.id === selectedId ? result : s)))
        }
      }
      setEditMode(false)
      setEditState(null)
      setIsNewSong(false)
    } catch (err) {
      setSaveError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [editState, isNewSong, selectedId, selectedSong])

  // ── Section helpers ──────────────────────────────────────────────────────────
  const updateSection = useCallback((key: string, patch: Partial<EditSection>): void => {
    setEditState((p) => p ? { ...p, sections: p.sections.map((s) => s._key === key ? { ...s, ...patch } : s) } : p)
  }, [])

  const deleteSection = useCallback((key: string): void => {
    setEditState((p) => p ? { ...p, sections: p.sections.filter((s) => s._key !== key) } : p)
  }, [])

  const addSection = useCallback((): void => {
    setEditState((p) => {
      if (!p) return p
      const verseCount = p.sections.filter((s) => s.type === 'verse').length
      return {
        ...p,
        sections: [...p.sections, { _key: makeKey(), type: 'verse', label: `Verse ${verseCount + 1}`, linesText: '' }],
      }
    })
  }, [])

  const moveSection = useCallback((from: number, to: number): void => {
    setEditState((p) => {
      if (!p) return p
      const secs = [...p.sections]
      const [item] = secs.splice(from, 1)
      secs.splice(to, 0, item)
      return { ...p, sections: secs }
    })
  }, [])

  // ── Drag handlers ────────────────────────────────────────────────────────────
  const handleDragStart = useCallback((index: number): void => { dragSrcRef.current = index }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number): void => {
    e.preventDefault()
    setDragTargetIdx(index)
  }, [])

  const handleDrop = useCallback((toIndex: number): void => {
    const from = dragSrcRef.current
    if (from !== null && from !== toIndex) moveSection(from, toIndex)
    dragSrcRef.current = null
    setDragTargetIdx(null)
  }, [moveSection])

  // ── Favorite ─────────────────────────────────────────────────────────────────
  const handleToggleFavorite = useCallback(async (id: string): Promise<void> => {
    const result = await window.api.lyrics.toggleFavorite(id)
    setSongs((prev) => prev.map((s) => s.id === id ? { ...s, isFavorite: result } : s))
  }, [])

  // ── Delete ───────────────────────────────────────────────────────────────────
  const handleDeleteConfirm = useCallback(async (): Promise<void> => {
    if (!deleteTarget) return
    await window.api.lyrics.delete(deleteTarget.id)
    setSongs((prev) => prev.filter((s) => s.id !== deleteTarget.id))
    if (selectedId === deleteTarget.id) { setSelectedId(null); setEditMode(false); setEditState(null) }
    setDeleteTarget(null)
  }, [deleteTarget, selectedId])

  // ── Import ───────────────────────────────────────────────────────────────────
  const handleImported = useCallback((song: LyricsSong): void => {
    setSongs((prev) => {
      const exists = prev.some((s) => s.id === song.id)
      return exists ? prev.map((s) => s.id === song.id ? song : s) : [song, ...prev]
    })
    setSelectedId(song.id)
  }, [])

  // ── Send to PP ───────────────────────────────────────────────────────────────
  const handleSendToPP = useCallback(async (): Promise<void> => {
    if (!selectedId) return
    setSendStatus('sending')
    setSendError(null)
    try {
      await window.api.lyrics.sendToProPresenter(selectedId, {})
      setSendStatus('sent')
      sendTimerRef.current = setTimeout(() => setSendStatus('idle'), 3000)
    } catch (err) {
      setSendStatus('error')
      setSendError((err as Error).message)
    }
  }, [selectedId])

  // ── Playlists ────────────────────────────────────────────────────────────────
  const handlePlaylistOpen = useCallback(async (): Promise<void> => {
    setPlaylistOpen((o) => !o)
    if (playlists.length === 0) {
      try { setPlaylists(await window.api.propresenter.getPlaylists()) } catch { /* PP not connected */ }
    }
  }, [playlists.length])

  const handleAddToPlaylist = useCallback(async (playlistId: string): Promise<void> => {
    if (!selectedId) return
    setPlaylistOpen(false)
    setPlaylistStatus('adding')
    await window.api.lyrics.addToPlaylist(selectedId, playlistId)
    setPlaylistStatus('added')
    playlistTimerRef.current = setTimeout(() => setPlaylistStatus('idle'), 2500)
  }, [selectedId])

  // ── Export ───────────────────────────────────────────────────────────────────
  const handleExport = useCallback((format: 'txt' | 'usr'): void => {
    if (!selectedSong) return
    setExportOpen(false)
    const slug = selectedSong.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()
    downloadFile(
      format === 'txt' ? toTxt(selectedSong) : toUsr(selectedSong),
      `${slug}.${format}`,
      'text/plain'
    )
  }, [selectedSong])

  // ── Context menu ─────────────────────────────────────────────────────────────
  const handleContextMenu = useCallback((e: React.MouseEvent, id: string): void => {
    const x = Math.min(e.clientX, window.innerWidth - 184)
    const y = Math.min(e.clientY, window.innerHeight - 120)
    setContextMenu({ songId: id, x, y })
  }, [])

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full max-h-full overflow-hidden">
      {/* Page header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="page-header">Lyrics</h1>
          <p className="page-subtitle">Manage and project worship songs to ProPresenter</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button className="btn-secondary flex items-center gap-1.5 text-sm py-2" onClick={() => setShowImport(true)}>
            <Upload size={14} /> Import
          </button>
          <button className="btn-primary flex items-center gap-1.5 text-sm py-2" onClick={handleNewSong}>
            <FilePlus size={14} /> New Song
          </button>
        </div>
      </div>

      {/* Main split layout */}
      <div className="flex-1 flex min-h-0 px-6 pb-6 gap-4">

        {/* ── Left panel: Library (40%) ────────────────────────────────────── */}
        <div className="w-[40%] shrink-0 flex flex-col gap-2.5 min-h-0">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              type="text"
              className="input pl-9 pr-9 py-2 text-sm"
              placeholder="Search title, artist, CCLI…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search songs"
            />
            {query && (
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors focus-visible:outline-none"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Filter chips + sort */}
          <div className="flex items-center gap-1">
            {(['all', 'favorites', 'recent'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors',
                  filter === f
                    ? 'bg-surface-elevated text-white border border-surface-border'
                    : 'text-slate-500 hover:text-slate-300 border border-transparent'
                )}
              >
                {f === 'all' ? 'All' : f === 'favorites' ? '★ Favorites' : 'Recent'}
              </button>
            ))}
            <div className="flex-1" />
            <div className="relative" ref={sortRef}>
              <button
                onClick={() => setSortOpen((o) => !o)}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors focus-visible:outline-none rounded-lg border border-transparent hover:border-surface-border"
              >
                Sort <ChevronDown size={11} className={cn('transition-transform', sortOpen && 'rotate-180')} />
              </button>
              {sortOpen && (
                <div className="absolute right-0 mt-1 w-36 rounded-lg bg-surface-elevated border border-surface-border shadow-xl z-30 py-1 overflow-hidden animate-fade-in">
                  {(['title', 'artist', 'recent', 'added'] as SortType[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => { setSortBy(s); setSortOpen(false) }}
                      className={cn(
                        'w-full px-3.5 py-1.5 text-[12px] text-left transition-colors',
                        sortBy === s ? 'text-teal-400 bg-teal-500/10' : 'text-slate-400 hover:bg-surface-tertiary hover:text-white'
                      )}
                    >
                      {s === 'recent' ? 'Last Modified' : s === 'added' ? 'Date Added' : `By ${s.charAt(0).toUpperCase() + s.slice(1)}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Song list */}
          <div className="flex-1 overflow-y-auto space-y-0.5 min-h-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-slate-600">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : filteredSongs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
                <div className="w-12 h-12 rounded-xl bg-surface-secondary/50 border border-surface-border/40 flex items-center justify-center">
                  <Music2 size={18} className="text-slate-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-400">
                    {query ? 'No songs match your search' : 'No songs yet'}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">
                    {query ? 'Try a different keyword' : 'Import a .usr file or add a new song'}
                  </p>
                </div>
              </div>
            ) : (
              filteredSongs.map((song) => (
                <SongListItem
                  key={song.id}
                  song={song}
                  isSelected={song.id === selectedId}
                  onSelect={handleSelect}
                  onContextMenu={handleContextMenu}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))
            )}
          </div>

          {!loading && songs.length > 0 && (
            <p className="text-[11px] text-slate-600 text-center tabular-nums shrink-0">
              {filteredSongs.length} of {songs.length} song{songs.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* ── Right panel: Editor (60%) ─────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0 card p-0 overflow-hidden">
          {!selectedSong && !editMode ? (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
              <div className="w-16 h-16 rounded-2xl bg-surface-secondary/50 border border-surface-border/30 flex items-center justify-center">
                <Music2 size={24} className="text-slate-600" />
              </div>
              <div>
                <p className="text-slate-400 text-sm font-medium">Select a song to view and edit</p>
                <p className="text-slate-600 text-xs mt-1">Or create a new song with the button above</p>
              </div>
            </div>
          ) : (
            <>
              {/* Editor header */}
              <div className="flex-shrink-0 flex items-center justify-between gap-3 px-5 py-3.5 border-b border-surface-border/50">
                <div className="flex-1 min-w-0">
                  {editMode ? (
                    <p className="text-xs font-bold text-teal-400 uppercase tracking-wider">
                      {isNewSong ? 'New Song' : 'Editing'}
                    </p>
                  ) : (
                    <div>
                      <p className="text-sm font-semibold text-white truncate">{selectedSong?.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{selectedSong?.artist || 'Unknown Artist'}</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {editMode ? (
                    <>
                      <button
                        className="btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-3"
                        onClick={handleCancelEdit}
                        disabled={saving}
                      >
                        <X size={12} /> Cancel
                      </button>
                      <button
                        className="btn-primary flex items-center gap-1.5 text-xs py-1.5 px-3"
                        onClick={handleSave}
                        disabled={saving}
                      >
                        {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-3"
                      onClick={handleEdit}
                    >
                      <Edit2 size={12} /> Edit
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
                {editMode && editState ? (
                  /* Edit mode: metadata + sections */
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Title</label>
                        <input
                          className="input"
                          placeholder="Song title"
                          value={editState.title}
                          onChange={(e) => patchEdit('title', e.target.value)}
                          autoFocus={isNewSong}
                        />
                      </div>
                      <div>
                        <label className="label">Artist</label>
                        <input
                          className="input"
                          placeholder="Artist or band name"
                          value={editState.artist}
                          onChange={(e) => patchEdit('artist', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="label">Copyright</label>
                        <input
                          className="input"
                          placeholder="© Year Author"
                          value={editState.copyright}
                          onChange={(e) => patchEdit('copyright', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="label">CCLI Number</label>
                        <input
                          className="input"
                          placeholder="0000000"
                          value={editState.ccliNumber}
                          onChange={(e) => patchEdit('ccliNumber', e.target.value)}
                        />
                      </div>
                    </div>

                    {saveError && (
                      <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                        <AlertCircle size={12} className="shrink-0 mt-0.5" />
                        <span>{saveError}</span>
                      </div>
                    )}

                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                        Sections — drag to reorder
                      </p>
                      {editState.sections.map((sec, idx) => (
                        <SectionEditBlock
                          key={sec._key}
                          section={sec}
                          index={idx}
                          total={editState.sections.length}
                          isDragTarget={dragTargetIdx === idx}
                          onUpdate={updateSection}
                          onDelete={deleteSection}
                          onMove={moveSection}
                          onDragStart={handleDragStart}
                          onDragOver={handleDragOver}
                          onDrop={handleDrop}
                        />
                      ))}
                      <button
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-surface-border/30 text-slate-600 hover:text-slate-400 hover:border-surface-border text-xs font-medium transition-colors focus-visible:outline-none"
                        onClick={addSection}
                      >
                        <Plus size={13} /> Add Section
                      </button>
                    </div>
                  </>
                ) : selectedSong && (
                  /* View mode: metadata + sections */
                  <>
                    {(selectedSong.copyright || selectedSong.ccliNumber) && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-1 border-b border-surface-border/30">
                        {selectedSong.copyright && (
                          <span className="text-[11px] text-slate-500">© {selectedSong.copyright}</span>
                        )}
                        {selectedSong.ccliNumber && (
                          <span className="text-[11px] text-slate-500">CCLI #{selectedSong.ccliNumber}</span>
                        )}
                        <span className="text-[11px] text-slate-600">
                          {selectedSong.sections.length} section{selectedSong.sections.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    )}

                    <div className="space-y-3">
                      {selectedSong.sections.map((section, i) => (
                        <div key={i} className="group/sec">
                          <div className="flex items-center gap-2 mb-2">
                            <SectionBadge type={section.type} />
                            <span className="text-[11px] font-medium text-slate-500">{section.label}</span>
                            <span className="text-[10px] text-slate-700 ml-auto opacity-0 group-hover/sec:opacity-100 transition-opacity">
                              {section.lines.length} line{section.lines.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="bg-surface-secondary/30 border border-surface-border/20 rounded-xl px-4 py-3 space-y-0.5">
                            {section.lines.length > 0 ? (
                              section.lines.map((line, j) => (
                                <p key={j} className="text-[13px] text-slate-300 leading-relaxed tracking-wide">
                                  {line}
                                </p>
                              ))
                            ) : (
                              <p className="text-[12px] text-slate-700 italic">Empty section</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Action bar */}
              {!editMode && selectedSong && (
                <div className="flex-shrink-0 border-t border-surface-border/50 px-5 py-3 flex items-center gap-2 flex-wrap">
                  {/* Push to ProPresenter */}
                  <button
                    onClick={handleSendToPP}
                    disabled={sendStatus === 'sending'}
                    title={sendError ?? undefined}
                    className={cn(
                      'flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all border',
                      sendStatus === 'sent'
                        ? 'bg-teal-500/15 border-teal-500/30 text-teal-400'
                        : sendStatus === 'error'
                        ? 'bg-red-500/15 border-red-500/30 text-red-400'
                        : 'btn-primary'
                    )}
                  >
                    {sendStatus === 'sending' && <Loader2 size={12} className="animate-spin" />}
                    {sendStatus === 'sent' && <CheckCircle2 size={12} />}
                    {sendStatus === 'error' && <AlertCircle size={12} />}
                    {sendStatus === 'idle' && <Send size={12} />}
                    {SEND_LABEL[sendStatus]}
                  </button>

                  {/* Add to Playlist */}
                  <div className="relative" ref={playlistRef}>
                    <button
                      onClick={handlePlaylistOpen}
                      className={cn(
                        'btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-xs',
                        playlistStatus === 'added' && 'text-teal-400 border-teal-500/30'
                      )}
                    >
                      {playlistStatus === 'adding' ? <Loader2 size={12} className="animate-spin" /> : <ListMusic size={12} />}
                      {playlistStatus === 'added' ? 'Added!' : 'Playlist'}
                      <ChevronDown size={11} className={cn('transition-transform', playlistOpen && 'rotate-180')} />
                    </button>
                    {playlistOpen && (
                      <div className="absolute bottom-full left-0 mb-1 w-52 rounded-lg bg-surface-elevated border border-surface-border shadow-2xl z-30 py-1 overflow-hidden animate-fade-in max-h-48 overflow-y-auto">
                        {playlists.length === 0 ? (
                          <p className="px-4 py-3 text-xs text-slate-500 text-center">
                            No playlists found.{' '}
                            <span className="text-slate-600">Connect ProPresenter first.</span>
                          </p>
                        ) : (
                          playlists.map((pl) => (
                            <button
                              key={pl.id}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-left text-slate-300 hover:bg-surface-tertiary hover:text-white transition-colors"
                              onClick={() => handleAddToPlaylist(pl.id)}
                            >
                              <ListMusic size={12} className="text-slate-600 shrink-0" />
                              <span className="truncate">{pl.name}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* Preview Slides */}
                  <button
                    className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-xs"
                    onClick={() => setShowSlidePreview(true)}
                  >
                    <Eye size={12} /> Preview
                  </button>

                  <div className="flex-1" />

                  {/* Export */}
                  <div className="relative" ref={exportRef}>
                    <button
                      className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-xs"
                      onClick={() => setExportOpen((o) => !o)}
                    >
                      <Download size={12} /> Export
                      <ChevronDown size={11} className={cn('transition-transform', exportOpen && 'rotate-180')} />
                    </button>
                    {exportOpen && (
                      <div className="absolute bottom-full right-0 mb-1 w-44 rounded-lg bg-surface-elevated border border-surface-border shadow-xl z-30 py-1 overflow-hidden animate-fade-in">
                        <button
                          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-left text-slate-300 hover:bg-surface-tertiary hover:text-white transition-colors"
                          onClick={() => handleExport('txt')}
                        >
                          <FileText size={12} className="text-slate-600" /> Plain text (.txt)
                        </button>
                        <button
                          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-left text-slate-300 hover:bg-surface-tertiary hover:text-white transition-colors"
                          onClick={() => handleExport('usr')}
                        >
                          <FileText size={12} className="text-slate-600" /> SongSelect (.usr)
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      {showImport && (
        <ImportModal onImported={handleImported} onClose={() => setShowImport(false)} />
      )}

      {showSlidePreview && selectedSong && (
        <SlidePreviewModal song={selectedSong} onClose={() => setShowSlidePreview(false)} />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          song={deleteTarget}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {contextMenu && (
        <FloatingContextMenu
          menu={contextMenu}
          song={contextMenuSong ?? undefined}
          onEdit={() => {
            if (contextMenuSong) {
              setSelectedId(contextMenuSong.id)
              setEditState(songToEdit(contextMenuSong))
              setIsNewSong(false)
              setEditMode(true)
            }
          }}
          onDelete={() => {
            if (contextMenuSong) setDeleteTarget(contextMenuSong)
          }}
          onToggleFavorite={() => handleToggleFavorite(contextMenu.songId)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
