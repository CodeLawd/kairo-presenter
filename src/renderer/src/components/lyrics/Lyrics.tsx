import { reorderLyricSlide } from '@shared/lyrics-reorder'
import { useLibraryWidth } from './useLibraryWidth'
import { useImportRequest } from '@/hooks/useImportRequest'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Search,
  Music2,
  Star,
  ChevronDown,
  X,
  Plus,
  Trash2,
  Download,
  Eye,
  Upload,
  Loader2,
  AlertCircle,
  MoreVertical,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Edit2,
  Save,
  FilePlus,
  ChevronLeft,
  ChevronRight,
  Globe,
  Library,
} from '@/icons'
import { cn, downloadFile } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type {
  LyricsSong,
  LyricsSongSection,
  LyricsSectionType,
  LyricsImportSource,
  LyricsOnlineResult,
  LyricsOnlinePreview,
  LyricsProvider,
  ProPresenterPlaylist,
} from '@shared/ipc'
import {
  buildSlides,
  insertSlideBreaks,
  preserveSlideBreaks,
  sectionSlideChunks,
  sectionColoredSlideChunks,
} from '@shared/lyrics-slides'
import { expandJammedLines, splitSectionAtCursor } from '@shared/lyrics-section-edit'
import {
  sectionsHaveGlosses,
  stripLineGlosses,
} from '@shared/lyrics-translate'
import { DEFAULT_GLOSS_COLOR, normalizeGlossColor, resolveLyricLineColor } from '@shared/lyrics-style'
import { isGlossLine } from '@shared/lyrics-translate'
import { formatOnlineLyricsError } from '@shared/lyrics-online-error'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { useAppStore } from '@/stores/useAppStore'
import { useSettings } from '@/hooks/useSettings'
import { LiveOutputRail } from '@/components/operator/LiveOutputRail'
import { BoothWorkspace } from '@/components/layout/BoothWorkspace'
import { useLiveRailWidth } from '@/components/operator/useLiveRailWidth'
import { buildLyricsLiveOutputPayload } from '@shared/live-output'

// ─── Local types ──────────────────────────────────────────────────────────────

type FilterType = 'all' | 'favorites' | 'recent'
type SortType = 'title' | 'artist' | 'recent' | 'added'
type SendStatus = 'idle' | 'sending' | 'sent' | 'error'
type ImportStatus = 'idle' | 'importing' | 'error'
type ImportTab = 'file' | 'paste' | 'online'

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
    lines: preserveSlideBreaks(s.linesText.split('\n')),
  }))
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

function SectionSlideGrid({
  section,
  sectionIndex,
  startIndex,
  glossColor,
  paintColor,
  liveSlideIndex,
  pushingSlideIndex,
  onPushSlide,
  onPreviewSlide,
  onSetLineColor,
  onReorder,
  reorderBusy,
}: {
  onReorder: (from: number, to: number) => void
  reorderBusy: boolean
  section: LyricsSongSection
  sectionIndex: number
  /** 1-based index of this section's first slide in the full song. */
  startIndex: number
  glossColor: string
  /** When set, clicking a line applies this color (null clears override). */
  paintColor: string | null | undefined
  /** Zero-based index of the slide currently on screen in ProPresenter. */
  liveSlideIndex: number | null
  /** Zero-based index of the slide mid-push, if any. */
  pushingSlideIndex: number | null
  onPushSlide: (zeroBasedIndex: number) => void
  onPreviewSlide: (zeroBasedIndex: number) => void
  onSetLineColor: (sectionIndex: number, lineIndex: number, color: string | null) => void
}): React.ReactElement {
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const chunks = sectionColoredSlideChunks(section, glossColor)

  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-2.5">
        <h3 className="text-xs font-medium text-slate-400 tracking-tight">
          {section.label}
        </h3>
        <span className="ml-auto text-[11px] text-slate-600 tabular-nums">
          {chunks.length} slide{chunks.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,180px),200px))] gap-2">
        {chunks.map((lines, i) => {
          const slideNo = startIndex + i
          const zeroBased = slideNo - 1
          const lineCount = lines.length
          const isLive = liveSlideIndex === zeroBased
          const isPushing = pushingSlideIndex === zeroBased
          return (
            <button
              key={i}
              type="button"
              data-lyric-slide={zeroBased}
              draggable={!reorderBusy}
              disabled={reorderBusy}
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-kairo-slide', String(zeroBased))
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(event) => {
                if (reorderBusy || !event.dataTransfer.types.includes('application/x-kairo-slide')) return
                event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(zeroBased)
              }}
              onDragLeave={() => setDropTarget(null)}
              onDragEnd={() => setDropTarget(null)}
              onDrop={(event) => {
                event.preventDefault(); setDropTarget(null)
                const raw = event.dataTransfer.getData('application/x-kairo-slide')
                if (raw && !reorderBusy) onReorder(Number(raw), zeroBased)
              }}
              onClick={() => onPushSlide(zeroBased)}
              className={cn(
                'group relative w-full aspect-video rounded-lg overflow-hidden',
                'bg-black border text-left',
                'shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
                isLive
                  ? 'border-teal-400/70 ring-1 ring-teal-400/40'
                  : 'border-white/[0.08] hover:border-teal-500/40 hover:ring-1 hover:ring-teal-500/20',
                dropTarget === zeroBased && 'ring-2 ring-teal-400',
                isPushing && 'opacity-70',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50',
                'transition-all duration-150'
              )}
              aria-label={`Push slide ${slideNo} to ProPresenter`}
              title="Push this slide to ProPresenter"
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-6 top-1/3 h-1/2 rounded-full bg-teal-500/[0.07] blur-2xl opacity-0 group-hover:opacity-100 transition-opacity"
              />

              {/* Preview is the secondary action now — click the tile to go live. */}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onPreviewSlide(zeroBased) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    onPreviewSlide(zeroBased)
                  }
                }}
                title={`Preview slide ${slideNo}`}
                aria-label={`Preview slide ${slideNo}`}
                className={cn(
                  'absolute top-1.5 right-1.5 z-10 grid place-items-center h-5 w-5 rounded-md',
                  'bg-black/60 text-white/50 border border-white/10 cursor-pointer',
                  'opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity',
                  'hover:text-teal-300 hover:border-teal-500/40'
                )}
              >
                <Eye size={11} />
              </span>

              {isLive && (
                <span className="absolute top-1.5 left-1.5 z-10 px-1.5 py-px rounded text-[8px] font-bold tracking-wider uppercase bg-teal-500/20 text-teal-300 border border-teal-500/30">
                  Live
                </span>
              )}

              <div className="absolute inset-0 flex flex-col items-center justify-center px-3.5 gap-0.5">
                {lineCount > 0 ? (
                  lines.map((line, j) => (
                    <p
                      key={j}
                      role={paintColor !== undefined ? 'button' : undefined}
                      onClick={
                        paintColor !== undefined
                          ? (e) => {
                              e.stopPropagation()
                              onSetLineColor(sectionIndex, line.sourceLineIndex, paintColor)
                            }
                          : undefined
                      }
                      title={
                        paintColor !== undefined
                          ? paintColor
                            ? 'Apply color to this line'
                            : 'Clear custom color (use auto gloss)'
                          : undefined
                      }
                      className={cn(
                        'w-full text-center font-semibold tracking-wide leading-snug line-clamp-2',
                        !line.color && 'text-white/90',
                        lineCount <= 2 ? 'text-[12px]' : lineCount === 3 ? 'text-[11px]' : 'text-[10px]',
                        paintColor !== undefined && 'hover:underline cursor-pointer'
                      )}
                      style={line.color ? { color: line.color } : undefined}
                    >
                      {line.text}
                    </p>
                  ))
                ) : (
                  <p className="text-[11px] text-white/20 italic">Empty</p>
                )}
              </div>

              <span className="absolute bottom-1.5 right-2 text-[9px] font-bold tabular-nums tracking-wider text-white/25 group-hover:text-teal-400/70 transition-colors">
                {slideNo}
              </span>
            </button>
          )
        })}
      </div>
    </section>
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
  onSplit,
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
  onSplit: (index: number, cursor: number) => void
  onDragStart: (index: number) => void
  onDragOver: (e: React.DragEvent, index: number) => void
  onDrop: (index: number) => void
}): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const slideCount = sectionSlideChunks({
    type: section.type,
    label: section.label,
    lines: preserveSlideBreaks(section.linesText.split('\n')),
  }).length

  const cursorPos = (): number => textareaRef.current?.selectionStart ?? section.linesText.length

  return (
    <div
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={() => onDrop(index)}
      className={cn(
        'overflow-hidden rounded-lg border transition-colors duration-150 focus-within:border-white/15',
        isDragTarget
          ? 'border-teal-500/50 bg-teal-500/5 shadow-[0_0_0_1px_rgba(20,184,166,0.25)]'
          : 'border-white/[0.07] bg-white/[0.012]'
      )}
    >
      {/* Section header row */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.055] px-3 py-2.5">
        <div
          draggable
          onDragStart={(e) => {
            // Keep text selection in the textarea from hijacking reorder.
            e.dataTransfer.effectAllowed = 'move'
            onDragStart(index)
          }}
          onDragEnd={() => onDrop(index)}
          className="text-slate-600 cursor-grab active:cursor-grabbing shrink-0 p-0.5 -ml-0.5 rounded hover:text-slate-400 hover:bg-white/5"
          title="Drag to reorder"
          aria-label="Drag to reorder section"
        >
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
          title="Change section type"
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
          aria-label={`Section ${index + 1} label`}
          placeholder="Section label…"
        />
        <span className="text-[10px] text-slate-600 tabular-nums shrink-0">
          {slideCount} slide{slideCount !== 1 ? 's' : ''}
        </span>

        {/* Reorder + delete */}
        <details className="group/tools relative text-xs text-slate-500">
          <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-[10px] font-medium hover:bg-white/5 hover:text-slate-200 focus-visible:outline-teal-500">Reflow tools</summary>
          <div className="absolute right-0 top-full z-30 mt-1 flex w-56 flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-zinc-950 p-2 shadow-2xl">
          <button
            type="button"
            title="Put each line on its own slide"
            onClick={() => onUpdate(section._key, { linesText: insertSlideBreaks(section.linesText, 1) })}
            className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors focus-visible:outline-none"
          >
            1 line per slide
          </button>
          <button
            type="button"
            title="Break into 2-line slides"
            onClick={() => onUpdate(section._key, { linesText: insertSlideBreaks(section.linesText, 2) })}
            className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors focus-visible:outline-none"
          >
            2 lines per slide
          </button>
          <button
            type="button"
            title="Split jammed phrases onto their own rows"
            onClick={() => onUpdate(section._key, { linesText: expandJammedLines(section.linesText) })}
            className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors focus-visible:outline-none"
          >
            Separate phrases
          </button>
          <button
            type="button"
            title="Split into a new section from the cursor line down"
            onClick={() => onSplit(index, cursorPos())}
            className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-teal-500/80 hover:text-teal-300 hover:bg-teal-500/10 transition-colors focus-visible:outline-none"
          >
            Split at cursor
          </button>
          <button
            type="button"
            title="Remove all slide breaks in this section"
            onClick={() => onUpdate(section._key, {
              linesText: section.linesText.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).join('\n'),
            })}
            className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors focus-visible:outline-none"
          >
            Remove slide breaks
          </button>
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
        </details>
      </div>

      {/* Lyrics textarea */}
      <textarea
        ref={textareaRef}
        value={section.linesText}
        onChange={(e) => onUpdate(section._key, { linesText: e.target.value })}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            onSplit(index, e.currentTarget.selectionStart)
          }
        }}
        rows={Math.min(16, Math.max(4, section.linesText.split('\n').length + 1))}
        className="w-full resize-y bg-transparent px-4 py-3 font-sans text-sm leading-7 text-slate-200 placeholder:text-slate-700 focus-visible:outline-none"
        aria-label={`${section.label || 'Section'} lyrics`}
        placeholder="One line per row. Blank line = new slide."
        spellCheck
      />

    </div>
  )
}

// ─── SlidePreviewModal ────────────────────────────────────────────────────────

function SlidePreviewModal({
  song,
  glossColor,
  initialIndex = 0,
  onClose,
}: {
  song: LyricsSong
  glossColor: string
  initialIndex?: number
  onClose: () => void
}): React.ReactElement {
  const slides = useMemo(
    () => buildSlides(song, { glossColor }),
    [song, glossColor]
  )
  const [slideIndex, setSlideIndex] = useState(() =>
    Math.min(Math.max(0, initialIndex), Math.max(0, slides.length - 1))
  )
  const slide = slides[slideIndex] ?? null

  useEffect(() => {
    setSlideIndex(Math.min(Math.max(0, initialIndex), Math.max(0, slides.length - 1)))
  }, [song.id, initialIndex, slides.length])

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
                  slide.lines.map((line, i) => {
                    const color = slide.lineColors?.[i]
                    return (
                      <p
                        key={i}
                        className={cn(
                          'text-center leading-snug font-semibold tracking-wide',
                          !color && 'text-white'
                        )}
                        style={{
                          fontSize: slide.lines.length <= 2 ? '2.25rem' : slide.lines.length <= 3 ? '1.75rem' : '1.4rem',
                          ...(color ? { color } : {}),
                        }}
                      >
                        {line}
                      </p>
                    )
                  })
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

// ─── OnlineResultRow ──────────────────────────────────────────────────────────

function providerLabel(provider: LyricsProvider): string {
  if (provider === 'lrclib') return 'LRCLIB'
  if (provider === 'web') return 'Web'
  return 'Genius'
}

function OnlineResultRow({
  result,
  isBusy,
  disabled,
  selected,
  onSelect,
  onImport,
  onOpenExisting,
}: {
  result: LyricsOnlineResult
  isBusy: boolean
  disabled: boolean
  selected?: boolean
  onSelect: (result: LyricsOnlineResult) => void
  onImport: (result: LyricsOnlineResult) => void
  onOpenExisting: (songId: string) => void
}): React.ReactElement {
  const inLibrary = Boolean(result.existingSongId)

  const meta = [result.artist || 'Unknown artist', result.releaseYear, providerLabel(result.provider)]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(result)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(result)
        }
      }}
      className={cn(
        'group flex items-start gap-2.5 px-3 py-2.5 rounded-lg border transition-all duration-150 cursor-pointer',
        selected
          ? 'bg-teal-500/10 border-teal-500/40'
          : 'border-transparent hover:bg-surface-tertiary hover:border-surface-border/50'
      )}
    >
      <div className="w-7 h-7 rounded-lg bg-surface-elevated border border-surface-border/50 flex items-center justify-center shrink-0 mt-0.5">
        <Music2 size={12} className="text-slate-500" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-slate-200 truncate leading-tight">
          {result.title}
        </p>
        <p className="text-[11px] text-slate-500 truncate mt-0.5">{meta}</p>
        {result.snippet && (
          <p className="text-[11px] text-slate-500 truncate mt-1 pl-2 border-l border-teal-500/40 italic">
            {result.snippet}
          </p>
        )}
      </div>

      {inLibrary ? (
        <button
          type="button"
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold text-teal-400 bg-teal-500/10 border border-teal-500/25 hover:bg-teal-500/20 transition-colors focus-visible:outline-none"
          onClick={(e) => {
            e.stopPropagation()
            onOpenExisting(result.existingSongId as string)
          }}
        >
          <Library size={11} /> In library
        </button>
      ) : (
        <button
          type="button"
          disabled={disabled}
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold text-slate-400 border border-surface-border/60 hover:text-white hover:border-teal-500/40 hover:bg-teal-500/10 disabled:opacity-40 transition-colors focus-visible:outline-none"
          onClick={(e) => {
            e.stopPropagation()
            onImport(result)
          }}
        >
          {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
          {isBusy ? 'Importing…' : 'Import'}
        </button>
      )}
    </div>
  )
}

// ─── OnlinePreviewPane ────────────────────────────────────────────────────────

function OnlinePreviewPane({
  result,
  preview,
  loading,
  error,
  importing,
  onImport,
  onOpenExisting,
  emptyHint = 'Click a result to preview lyrics before importing',
}: {
  result: LyricsOnlineResult | null
  preview: LyricsOnlinePreview | null
  loading: boolean
  error: string | null
  importing: boolean
  onImport: (result: LyricsOnlineResult) => void
  onOpenExisting: (songId: string) => void
  emptyHint?: string
}): React.ReactElement {
  if (!result) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6 py-10">
        <div className="w-11 h-11 rounded-xl bg-surface-secondary/50 border border-surface-border/40 flex items-center justify-center">
          <Eye size={16} className="text-slate-600" />
        </div>
        <p className="text-sm font-medium text-slate-400">{emptyHint}</p>
      </div>
    )
  }

  const inLibrary = Boolean(result.existingSongId)

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <div className="shrink-0 px-4 py-3 border-b border-surface-border/40">
        <p className="text-sm font-semibold text-white truncate">{result.title}</p>
        <p className="text-[11px] text-slate-500 mt-0.5 truncate">
          {[result.artist || 'Unknown artist', providerLabel(result.provider)].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
            <Loader2 size={16} className="animate-spin text-teal-400" />
            <span className="text-sm">Loading lyrics…</span>
          </div>
        )}
        {!loading && error && (
          <div className="flex flex-col items-center gap-3 py-12 text-center px-6">
            <div className="w-10 h-10 rounded-xl bg-surface-secondary/60 flex items-center justify-center">
              <AlertCircle size={16} className="text-slate-400" />
            </div>
            <div className="space-y-1.5 max-w-xs">
              <p className="text-sm font-medium text-slate-200">{error}</p>
              <p className="text-xs text-slate-500 leading-relaxed">
                Try another search result, or paste lyrics under Import → Paste.
              </p>
            </div>
          </div>
        )}
        {!loading && !error && preview && (
          <div className="space-y-5">
            {preview.sections.map((section, i) => (
              <div key={`${section.label}-${i}`}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-teal-500/80 mb-2">
                  {section.label}
                </p>
                <div className="space-y-1">
                  {section.lines.map((line, li) =>
                    line.trim() === '' ? (
                      <div key={li} className="h-2" />
                    ) : (
                      <p
                        key={li}
                        className={cn(
                          'text-[13px] leading-relaxed',
                          !resolveLyricLineColor(line, DEFAULT_GLOSS_COLOR) && 'text-slate-200',
                          isGlossLine(line) && 'italic'
                        )}
                        style={(() => {
                          const c = resolveLyricLineColor(line, DEFAULT_GLOSS_COLOR)
                          return c ? { color: c } : undefined
                        })()}
                      >
                        {line}
                      </p>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 py-3 border-t border-surface-border/40 flex items-center justify-end gap-2">
        {inLibrary ? (
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5 text-xs py-1.5 px-3"
            onClick={() => onOpenExisting(result.existingSongId as string)}
          >
            <Library size={12} /> Open in library
          </button>
        ) : (
          <button
            type="button"
            disabled={importing || loading || Boolean(error) || !preview}
            className="btn-primary flex items-center gap-1.5 text-xs py-1.5 px-3 disabled:opacity-40"
            onClick={() => onImport(result)}
          >
            {importing ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            {importing ? 'Importing…' : 'Import song'}
          </button>
        )}
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
  const [tab, setTab] = useState<ImportTab>('file')
  const [dragOver, setDragOver] = useState(false)
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  // File tab
  const [filePreview, setFilePreview] = useState<LyricsSong | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Online tab
  const [onlineQuery, setOnlineQuery] = useState('')
  const [onlineResults, setOnlineResults] = useState<LyricsOnlineResult[]>([])
  const [onlineSearching, setOnlineSearching] = useState(false)
  const [onlineSearched, setOnlineSearched] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [previewResult, setPreviewResult] = useState<LyricsOnlineResult | null>(null)
  const [previewData, setPreviewData] = useState<LyricsOnlinePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  /** Guards against a slow earlier response overwriting a newer one. */
  const searchSeqRef = useRef(0)
  const previewSeqRef = useRef(0)
  const previewCacheRef = useRef(new Map<string, LyricsOnlinePreview>())

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
      setError(formatOnlineLyricsError(err))
      setStatus('error')
    }
  }, [pasteForm, onImported, onClose])

  // ── Online search (debounced) ──────────────────────────────────────────────
  useEffect(() => {
    if (tab !== 'online') return
    const q = onlineQuery.trim()
    if (q.length < 3) {
      setOnlineResults([])
      setOnlineSearched(false)
      setOnlineSearching(false)
      return
    }

    const seq = ++searchSeqRef.current
    setOnlineSearching(true)
    const timer = setTimeout(() => {
      window.api.lyrics.searchOnline(q)
        .then((results) => {
          if (searchSeqRef.current !== seq) return
          setOnlineResults(results)
          setOnlineSearched(true)
          setError(null)
        })
        .catch((err: Error) => {
          if (searchSeqRef.current !== seq) return
          setOnlineResults([])
          setOnlineSearched(true)
          setError(err.message)
        })
        .finally(() => {
          if (searchSeqRef.current === seq) setOnlineSearching(false)
        })
    }, 450)

    return () => clearTimeout(timer)
  }, [onlineQuery, tab])

  const handleOnlineImport = useCallback(async (result: LyricsOnlineResult): Promise<void> => {
    setImportingId(result.id)
    setError(null)
    try {
      const source: LyricsImportSource = {
        type: 'online',
        provider: result.provider,
        url: result.url,
        title: result.title,
        artist: result.artist,
      }
      const song = await window.api.lyrics.import(source)
      onImported(song)
      onClose()
    } catch (err) {
      setError(formatOnlineLyricsError(err))
    } finally {
      setImportingId(null)
    }
  }, [onImported, onClose])

  const handleOpenExisting = useCallback(async (songId: string): Promise<void> => {
    const song = await window.api.lyrics.getSong(songId)
    if (song) onImported(song)
    onClose()
  }, [onImported, onClose])

  const handlePreviewSelect = useCallback(async (result: LyricsOnlineResult): Promise<void> => {
    setPreviewResult(result)
    setPreviewError(null)
    const cached = previewCacheRef.current.get(result.id)
    if (cached) {
      setPreviewData(cached)
      setPreviewLoading(false)
      return
    }
    setPreviewData(null)
    setPreviewLoading(true)
    const seq = ++previewSeqRef.current
    try {
      const data = await window.api.lyrics.previewOnline({
        provider: result.provider,
        url: result.url,
        title: result.title,
        artist: result.artist,
      })
      if (previewSeqRef.current !== seq) return
      previewCacheRef.current.set(result.id, data)
      setPreviewData(data)
    } catch (err) {
      if (previewSeqRef.current !== seq) return
      setPreviewError(formatOnlineLyricsError(err))
      setPreviewData(null)
    } finally {
      if (previewSeqRef.current === seq) setPreviewLoading(false)
    }
  }, [])

  const handleTabChange = useCallback((next: ImportTab): void => {
    setTab(next)
    setError(null)
    setStatus('idle')
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          'w-full bg-surface rounded-2xl border border-surface-border shadow-2xl flex flex-col overflow-hidden',
          tab === 'online' ? 'max-w-5xl' : 'max-w-xl'
        )}
        style={{
          maxHeight: 'calc(100vh - 4rem)',
          ...(tab === 'online' ? { height: 'min(720px, calc(100vh - 4rem))' } : {}),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border/50 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">Import Song</h2>
            <p className="text-xs text-slate-500 mt-0.5">Search online, upload a .usr file, or paste lyrics directly</p>
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
          {(['online', 'file', 'paste'] as const).map((t) => (
            <button
              key={t}
              onClick={() => handleTabChange(t)}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors',
                tab === t
                  ? 'bg-surface-elevated text-white border border-surface-border'
                  : 'text-slate-500 hover:text-slate-300'
              )}
            >
              {t === 'online' && <Globe size={12} />}
              {t === 'online' ? 'Search Online' : t === 'file' ? 'Upload File' : 'Paste Lyrics'}
            </button>
          ))}
        </div>

        {/* Body */}
        {tab === 'online' ? (
          <div className="flex-1 flex flex-col min-h-0 px-5 py-4 gap-3">
            <div className="shrink-0">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                {onlineSearching && (
                  <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-teal-400 animate-spin" />
                )}
                <input
                  className="input pl-9 pr-9"
                  placeholder="Song title, artist, or a line from the lyrics…"
                  value={onlineQuery}
                  onChange={(e) => {
                    setOnlineQuery(e.target.value)
                    setPreviewResult(null)
                    setPreviewData(null)
                    setPreviewError(null)
                  }}
                  autoFocus
                />
              </div>
              <p className="text-[11px] text-slate-600 mt-1.5">
                Click a result to preview lyrics, then Import if it’s the right song.
              </p>
            </div>

            {error && (
              <div className="shrink-0 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                <AlertCircle size={13} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex-1 min-h-0 flex gap-0 rounded-xl border border-surface-border/50 overflow-hidden bg-surface-secondary/30">
              <div className="w-[42%] min-w-[220px] max-w-[360px] overflow-y-auto border-r border-surface-border/40 p-2 space-y-1">
                {onlineResults.length > 0 &&
                  onlineResults.map((result) => (
                    <OnlineResultRow
                      key={result.id}
                      result={result}
                      selected={previewResult?.id === result.id}
                      isBusy={importingId === result.id}
                      disabled={importingId !== null}
                      onSelect={(r) => void handlePreviewSelect(r)}
                      onImport={handleOnlineImport}
                      onOpenExisting={(id) => void handleOpenExisting(id)}
                    />
                  ))}

                {!onlineSearching && onlineSearched && onlineResults.length === 0 && !error && (
                  <div className="flex flex-col items-center justify-center py-10 gap-3 text-center px-4">
                    <Globe size={16} className="text-slate-600" />
                    <p className="text-sm font-medium text-slate-400">No matches found</p>
                  </div>
                )}

                {!onlineSearched && onlineQuery.trim().length < 3 && (
                  <div className="flex flex-col items-center justify-center py-10 gap-3 text-center px-4">
                    <Search size={16} className="text-slate-600" />
                    <p className="text-sm font-medium text-slate-400">Search by any part of the song</p>
                  </div>
                )}
              </div>

              <OnlinePreviewPane
                result={previewResult}
                preview={previewData}
                loading={previewLoading}
                error={previewError}
                importing={importingId !== null}
                onImport={handleOnlineImport}
                onOpenExisting={(id) => void handleOpenExisting(id)}
              />
            </div>
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto px-2 py-5 space-y-5 min-h-0">
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
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-surface-border/50 shrink-0">
          <button className="btn-secondary" onClick={onClose}>
            {tab === 'online' ? 'Close' : 'Cancel'}
          </button>
          {tab === 'online' ? null : tab === 'file' ? (
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
  const liveRail = useLiveRailWidth()

  // ── Library ──────────────────────────────────────────────────────────────────
  // Seeded from the startup snapshot so returning to this tab never flashes an
  // empty library while a fresh read resolves.
  const [songs, setSongs] = useState<LyricsSong[]>(() => useBootstrapStore.getState().lyrics)
  // The library is already in hand from bootstrap; nothing to wait for.
  const [loading] = useState(false)
  const [lyricsSettings] = useSettings('lyrics', {
    braveApiKey: '',
    googleTranslateApiKey: '',
    glossColor: DEFAULT_GLOSS_COLOR,
  })
  const glossColor = normalizeGlossColor(lyricsSettings.glossColor)
  /** undefined = paint off; string = apply; null = clear override */
  const [paintColor, setPaintColor] = useState<string | null | undefined>(undefined)

  // ── Selection + library chrome (session-persisted across tab switches) ───────
  const selectedId = useAppStore((s) => s.lyricsSelectedSongId)
  const filter = useAppStore((s) => s.lyricsFilter)
  const sortBy = useAppStore((s) => s.lyricsSortBy)
  const setLyricsViewState = useAppStore((s) => s.setLyricsViewState)
  const setSelectedId = useCallback(
    (id: string | null) => setLyricsViewState({ selectedSongId: id }),
    [setLyricsViewState]
  )
  const setFilter = useCallback(
    (next: FilterType) => setLyricsViewState({ filter: next }),
    [setLyricsViewState]
  )
  const setSortBy = useCallback(
    (next: SortType) => setLyricsViewState({ sortBy: next }),
    [setLyricsViewState]
  )

  /**
   * A song that was just imported and must be opened in the editor pane once it
   * lands in `songs`. Selection lives in the Zustand store while `songs` is
   * React state, so the two updates are not guaranteed to commit in the same
   * render — setting the id directly can be undone by the stale-selection effect
   * below, which would see the new id against the old list. Handing the id to an
   * effect keyed on `songs` makes the open deterministic.
   */
  const pendingOpenIdRef = useRef<string | null>(null)

  // ── Selection + editor ───────────────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [isNewSong, setIsNewSong] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)
  const [translateError, setTranslateError] = useState<string | null>(null)
  const [translateSourceLang, setTranslateSourceLang] = useState('auto')

  // ── Section drag state ───────────────────────────────────────────────────────
  const dragSrcRef = useRef<number | null>(null)
  const [dragTargetIdx, setDragTargetIdx] = useState<number | null>(null)
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playlistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Search (ephemeral — not restored across visits) ──────────────────────────
  const [query, setQuery] = useState('')

  /** Full-text hits from the main process, which also searches the lyric body. */
  const [ftsMatches, setFtsMatches] = useState<LyricsSong[] | null>(null)
  const [ftsSearching, setFtsSearching] = useState(false)
  /** Opt-in web search — library query stays local until the operator asks. */
  const [onlineRequested, setOnlineRequested] = useState(false)
  const [onlineSuggestions, setOnlineSuggestions] = useState<LyricsOnlineResult[]>([])
  const [onlineSearching, setOnlineSearching] = useState(false)
  const [onlineError, setOnlineError] = useState<string | null>(null)
  const [importingOnlineId, setImportingOnlineId] = useState<string | null>(null)
  const [webPreviewResult, setWebPreviewResult] = useState<LyricsOnlineResult | null>(null)
  const [webPreviewData, setWebPreviewData] = useState<LyricsOnlinePreview | null>(null)
  const [webPreviewLoading, setWebPreviewLoading] = useState(false)
  const [webPreviewError, setWebPreviewError] = useState<string | null>(null)
  const ftsSeqRef = useRef(0)
  const onlineSeqRef = useRef(0)
  const webPreviewSeqRef = useRef(0)
  const webPreviewCacheRef = useRef(new Map<string, LyricsOnlinePreview>())
  const [sortOpen, setSortOpen] = useState(false)
  const [showSongTools, setShowSongTools] = useState(false)
  const libraryWidth = useLibraryWidth()
  const [reorderBusy, setReorderBusy] = useState(false)
  const reorderLock = useRef(false)
  const sortRef = useRef<HTMLDivElement>(null)

  // ── Overlays ─────────────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LyricsSong | null>(null)
  const [showImport, setShowImport] = useState(false)
  useImportRequest(['lyrics'], () => setShowImport(true), !showImport)
  const [showSlidePreview, setShowSlidePreview] = useState(false)
  const [previewSlideIndex, setPreviewSlideIndex] = useState(0)

  // ── Live slide push ──────────────────────────────────────────────────────────
  /** Zero-based index of the slide last pushed to ProPresenter, if any. */
  const [liveSlideIndex, setLiveSlideIndex] = useState<number | null>(null)
  const [pushingSlideIndex, setPushingSlideIndex] = useState<number | null>(null)

  // ── Action bar ───────────────────────────────────────────────────────────────
  const [, setSendStatus] = useState<SendStatus>('idle')
  const [sendError, setSendError] = useState<string | null>(null)
  const [playlists, setPlaylists] = useState<ProPresenterPlaylist[]>([])
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const [, setPlaylistStatus] = useState<'idle' | 'adding' | 'added'>('idle')
  const [exportOpen, setExportOpen] = useState(false)
  const playlistRef = useRef<HTMLDivElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)

  // ── Derived ──────────────────────────────────────────────────────────────────
  const selectedSong = useMemo(() => songs.find((s) => s.id === selectedId) ?? null, [songs, selectedId])

  const songSlides = useMemo(
    () => (selectedSong ? buildSlides(selectedSong, { glossColor }) : []),
    [selectedSong, glossColor]
  )

  const sectionSlideStarts = useMemo(() => {
    if (!selectedSong) return [] as number[]
    let next = 1
    return selectedSong.sections.map((section) => {
      const start = next
      next += sectionSlideChunks(section).length
      return start
    })
  }, [selectedSong])

  const filteredSongs = useMemo(() => {
    const q = query.trim().toLowerCase()
    let pool = songs

    if (q) {
      // Metadata match runs locally so the list responds on every keystroke.
      const matches = new Map<string, LyricsSong>()
      for (const song of songs) {
        if (
          song.title.toLowerCase().includes(q) ||
          (song.artist || '').toLowerCase().includes(q) ||
          (song.ccliNumber ?? '').includes(q)
        ) {
          matches.set(song.id, song)
        }
      }
      // Full-text hits arrive a beat later and add lyric-body matches.
      for (const hit of ftsMatches ?? []) {
        if (!matches.has(hit.id)) matches.set(hit.id, songs.find((s) => s.id === hit.id) ?? hit)
      }
      pool = [...matches.values()]
    }

    const result = applyFilter(pool, filter)
    return applySort(result, filter === 'recent' ? 'recent' : sortBy)
  }, [songs, filter, sortBy, query, ftsMatches])

  const contextMenuSong = useMemo(
    () => (contextMenu ? songs.find((s) => s.id === contextMenu.songId) ?? null : null),
    [songs, contextMenu]
  )

  // ── Publish library edits back to the shared snapshot ────────────────────────
  useEffect(() => {
    useBootstrapStore.getState().setLyrics(songs)
  }, [songs])

  // Open a freshly imported song as soon as it is actually in the library, so
  // importing always lands you on the song rather than just adding a row.
  useEffect(() => {
    const pendingId = pendingOpenIdRef.current
    if (!pendingId) return
    if (!songs.some((song) => song.id === pendingId)) return

    pendingOpenIdRef.current = null
    setSelectedId(pendingId)
    setEditMode(false)
    setWebPreviewResult(null)
    setWebPreviewData(null)
    setWebPreviewError(null)
  }, [songs, setSelectedId])

  // Drop a stale selection if the song was deleted or the library reloaded.
  // Never while an import is waiting to open — that selection is about to
  // become valid, and clearing it here is what closed the pane on import.
  useEffect(() => {
    if (pendingOpenIdRef.current) return
    if (selectedId && !songs.some((song) => song.id === selectedId)) {
      setSelectedId(null)
    }
  }, [songs, selectedId, setSelectedId])

  // ── Timer cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (sendTimerRef.current) clearTimeout(sendTimerRef.current)
      if (playlistTimerRef.current) clearTimeout(playlistTimerRef.current)
    }
  }, [])

  // ── Library full-text search (local only) ────────────────────────────────────
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setFtsMatches(null)
      setFtsSearching(false)
      return
    }
    const seq = ++ftsSeqRef.current
    setFtsSearching(true)
    const timer = setTimeout(() => {
      window.api.lyrics.search(q)
        .then((results) => {
          if (ftsSeqRef.current === seq) setFtsMatches(results)
        })
        .catch(() => {
          if (ftsSeqRef.current === seq) setFtsMatches(null)
        })
        .finally(() => {
          if (ftsSeqRef.current === seq) setFtsSearching(false)
        })
    }, 180)
    return () => clearTimeout(timer)
  }, [query])

  // New library query → drop any previous web results (don't auto-hit the net).
  useEffect(() => {
    onlineSeqRef.current += 1
    setOnlineRequested(false)
    setOnlineSuggestions([])
    setOnlineSearching(false)
    setOnlineError(null)
    setWebPreviewResult(null)
    setWebPreviewData(null)
    setWebPreviewError(null)
  }, [query])

  // ── Online search (opt-in only) ──────────────────────────────────────────────
  useEffect(() => {
    if (!onlineRequested) return
    const q = query.trim()
    if (q.length < 3) return

    const seq = ++onlineSeqRef.current
    setOnlineSearching(true)
    setOnlineError(null)
    window.api.lyrics.searchOnline(q)
      .then((results) => {
        if (onlineSeqRef.current !== seq) return
        setOnlineSuggestions(results)
        setOnlineError(null)
        setWebPreviewResult((prev) => {
          if (!prev) return prev
          if (results.some((r) => r.id === prev.id)) return prev
          setWebPreviewData(null)
          setWebPreviewError(null)
          return null
        })
      })
      .catch((err: Error) => {
        if (onlineSeqRef.current !== seq) return
        setOnlineSuggestions([])
        setOnlineError(err.message)
      })
      .finally(() => {
        if (onlineSeqRef.current === seq) setOnlineSearching(false)
      })
    // query is read when the operator opts in; changing the query clears
    // onlineRequested via the effect above, so we intentionally omit it here
    // (no exhaustive-deps plugin configured).
  }, [onlineRequested])

  // ── Close dropdowns on outside click ────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && paintColor !== undefined) {
        setPaintColor(undefined)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [paintColor])

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
    setWebPreviewResult(null)
    setWebPreviewData(null)
    setWebPreviewError(null)
    setSendStatus('idle')
    setSendError(null)
    setTranslateError(null)
    setLiveSlideIndex(null)
  }, [editMode, setSelectedId])

  // ── Edit mode ────────────────────────────────────────────────────────────────
  const handleEdit = useCallback((): void => {
    if (!selectedSong) return
    setEditState(songToEdit(selectedSong))
    setIsNewSong(false)
    setEditMode(true)
    setSaveError(null)
    setTranslateError(null)
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

  const handleTranslateToEnglish = useCallback(async (): Promise<void> => {
    const sections: LyricsSongSection[] = editMode && editState
      ? editToSections(editState.sections)
      : selectedSong?.sections ?? []
    if (sections.length === 0) return

    setTranslating(true)
    setTranslateError(null)
    try {
      const sectionsForTranslate = sections.map((sec) => ({
        ...sec,
        lines: stripLineGlosses(sec.lines),
      }))
      const translated = await window.api.lyrics.translateSections(sectionsForTranslate, {
        target: 'en',
        sourceLanguage: translateSourceLang,
        title: editMode && editState ? editState.title : selectedSong?.title,
        artist: editMode && editState ? editState.artist : selectedSong?.artist,
      })
      if (editMode && editState) {
        setEditState((prev) =>
          prev
            ? {
                ...prev,
                sections: translated.map((sec, i) => ({
                  _key: prev.sections[i]?._key ?? makeKey(),
                  type: sec.type,
                  label: sec.label,
                  linesText: sec.lines.join('\n'),
                })),
              }
            : prev
        )
      } else if (selectedSong) {
        const updated = await window.api.lyrics.update(selectedSong.id, {
          ...selectedSong,
          sections: translated.map((sec) => ({
            ...sec,
            // Fresh glosses use Settings gloss color via () detection.
            lineColors: undefined,
          })),
        })
        if (updated) {
          setSongs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
        }
      }
    } catch (err) {
      setTranslateError((err as Error).message)
    } finally {
      setTranslating(false)
    }
  }, [editMode, editState, selectedSong, translateSourceLang])

  const canUndoTranslation = useMemo(() => {
    const sections =
      editMode && editState
        ? editToSections(editState.sections)
        : selectedSong?.sections ?? []
    return sectionsHaveGlosses(sections)
  }, [editMode, editState, selectedSong])

  const handleUndoTranslation = useCallback(async (): Promise<void> => {
    setTranslateError(null)
    if (editMode && editState) {
      setEditState((prev) =>
        prev
          ? {
              ...prev,
              sections: prev.sections.map((sec) => ({
                ...sec,
                linesText: stripLineGlosses(sec.linesText.split('\n')).join('\n'),
              })),
            }
          : prev
      )
      return
    }
    if (!selectedSong || !sectionsHaveGlosses(selectedSong.sections)) return
    const stripped = selectedSong.sections.map((sec) => ({
      ...sec,
      lines: stripLineGlosses(sec.lines),
      lineColors: undefined,
    }))
    try {
      const updated = await window.api.lyrics.update(selectedSong.id, {
        ...selectedSong,
        sections: stripped,
      })
      if (updated) {
        setSongs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      }
    } catch (err) {
      setTranslateError((err as Error).message)
    }
  }, [editMode, editState, selectedSong])

  const handleSetLineColor = useCallback(
    async (sectionIndex: number, lineIndex: number, color: string | null): Promise<void> => {
      if (!selectedSong || editMode) return
      const sections = selectedSong.sections.map((sec, si) => {
        if (si !== sectionIndex) return sec
        const colors = [...(sec.lineColors ?? sec.lines.map(() => null))]
        while (colors.length < sec.lines.length) colors.push(null)
        colors[lineIndex] = color
        const hasAny = colors.some((c) => Boolean(c?.trim()))
        return {
          ...sec,
          lineColors: hasAny ? colors : undefined,
        }
      })
      try {
        const updated = await window.api.lyrics.update(selectedSong.id, {
          ...selectedSong,
          sections,
        })
        if (updated) {
          setSongs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
        }
      } catch (err) {
        setTranslateError((err as Error).message)
      }
    },
    [selectedSong, editMode]
  )

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

  const splitSection = useCallback((index: number, cursor: number): void => {
    setEditState((p) => {
      if (!p) return p
      const next = splitSectionAtCursor(p.sections, index, cursor, makeKey, 'verse')
      return next ? { ...p, sections: next } : p
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
    // Opened by the pending-open effect once `songs` has committed.
    pendingOpenIdRef.current = song.id
  }, [])

  // ── Online suggestions ───────────────────────────────────────────────────────
  const handlePreviewSuggestion = useCallback(async (result: LyricsOnlineResult): Promise<void> => {
    if (editMode) return
    setSelectedId(null)
    setWebPreviewResult(result)
    setWebPreviewError(null)
    setOnlineError(null)
    const cached = webPreviewCacheRef.current.get(result.id)
    if (cached) {
      setWebPreviewData(cached)
      setWebPreviewLoading(false)
      return
    }
    setWebPreviewData(null)
    setWebPreviewLoading(true)
    const seq = ++webPreviewSeqRef.current
    try {
      const data = await window.api.lyrics.previewOnline({
        provider: result.provider,
        url: result.url,
        title: result.title,
        artist: result.artist,
      })
      if (webPreviewSeqRef.current !== seq) return
      webPreviewCacheRef.current.set(result.id, data)
      setWebPreviewData(data)
    } catch (err) {
      if (webPreviewSeqRef.current !== seq) return
      setWebPreviewError(formatOnlineLyricsError(err))
      setWebPreviewData(null)
    } finally {
      if (webPreviewSeqRef.current === seq) setWebPreviewLoading(false)
    }
  }, [editMode])

  const handleImportSuggestion = useCallback(async (result: LyricsOnlineResult): Promise<void> => {
    setImportingOnlineId(result.id)
    setOnlineError(null)
    try {
      const song = await window.api.lyrics.import({
        type: 'online',
        provider: result.provider,
        url: result.url,
        title: result.title,
        artist: result.artist,
      })
      setSongs((prev) => {
        const exists = prev.some((s) => s.id === song.id)
        return exists ? prev.map((s) => (s.id === song.id ? song : s)) : [song, ...prev]
      })
      // Opened by the pending-open effect once `songs` has committed; that
      // effect also drops the web preview so the song view takes the pane.
      pendingOpenIdRef.current = song.id
      setQuery('')
      setSendStatus('idle')
      setSendError(null)
    } catch (err) {
      setOnlineError(formatOnlineLyricsError(err))
    } finally {
      setImportingOnlineId(null)
    }
  }, [])

  const handleSelectSuggestionInLibrary = useCallback((songId: string): void => {
    setSelectedId(songId)
    setWebPreviewResult(null)
    setWebPreviewData(null)
    setWebPreviewError(null)
    setQuery('')
    setSendStatus('idle')
    setSendError(null)
  }, [])

  // ── Send to PP ───────────────────────────────────────────────────────────────
  // TODO: wire to the action bar when the send flow lands (kept for the WIP).
  const _handleSendToPP = useCallback(async (): Promise<void> => {
    if (!selectedId) return
    setSendStatus('sending')
    setSendError(null)
    try {
      await window.api.lyrics.sendToProPresenter(selectedId, {})
      if (selectedSong) {
        useAppStore.getState().setLiveOutputPreview(
          buildLyricsLiveOutputPayload(selectedSong, songSlides[0]),
        )
      }
      setSendStatus('sent')
      sendTimerRef.current = setTimeout(() => setSendStatus('idle'), 3000)
    } catch (err) {
      setSendStatus('error')
      setSendError((err as Error).message)
    }
  }, [selectedId, selectedSong, songSlides])

  /**
   * Clicking a slide tile puts it on screen. Errors surface in the same action-bar
   * slot the whole-song push uses, so there is one place to look when PP refuses.
   */
  const handlePushSlide = useCallback(async (zeroBased: number): Promise<void> => {
    if (!selectedId) return
    setPushingSlideIndex(zeroBased)
    setSendError(null)
    try {
      await window.api.lyrics.pushSlide(selectedId, zeroBased)
      setLiveSlideIndex(zeroBased)
      if (selectedSong) {
        useAppStore.getState().setLiveOutputPreview(
          buildLyricsLiveOutputPayload(selectedSong, songSlides[zeroBased]),
        )
      }
    } catch (err) {
      setSendError((err as Error).message)
    } finally {
      setPushingSlideIndex(null)
    }
  }, [selectedId, selectedSong, songSlides])

  const handleReorderSlide = async (from: number, to: number): Promise<void> => {
    if (!selectedSong || reorderLock.current || from === to || !Number.isInteger(from)) return
    reorderLock.current = true; setReorderBusy(true); setSendError(null)
    try {
      const updated = await window.api.lyrics.update(selectedSong.id, { ...selectedSong, sections: reorderLyricSlide(selectedSong.sections, from, to) })
      if (!updated) throw new Error('Could not save slide order')
      setSongs(previous => previous.map(song => song.id === updated.id ? updated : song))
      setLiveSlideIndex(null)
    } catch (error) { setSendError((error as Error).message) }
    finally { reorderLock.current = false; setReorderBusy(false) }
  }

  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || event.isComposing) return
      const target = event.target as HTMLElement | null
      if (editMode || !selectedSong || showSlidePreview || showImport || deleteTarget || webPreviewResult || reorderBusy || pushingSlideIndex !== null || !document.hasFocus() || document.querySelector('.kairo-pp-settings, [role="dialog"], [role="menu"]') || target?.closest('input, textarea, select, [contenteditable="true"], [role="separator"]')) return
      event.preventDefault(); event.stopImmediatePropagation()
      const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
      const next = liveSlideIndex === null ? 0 : Math.max(0, Math.min(songSlides.length - 1, liveSlideIndex + delta))
      if (next === liveSlideIndex || !songSlides.length) return
      document.querySelector(`[data-lyric-slide="${next}"]`)?.scrollIntoView({ block: 'nearest' })
      void handlePushSlide(next)
    }
    window.addEventListener('keydown', navigate, true)
    return () => window.removeEventListener('keydown', navigate, true)
  }, [editMode, selectedSong, showSlidePreview, showImport, deleteTarget, webPreviewResult, reorderBusy, pushingSlideIndex, liveSlideIndex, songSlides.length, handlePushSlide])

  // ── Playlists ────────────────────────────────────────────────────────────────
  // TODO: wire to the playlist UI when it lands (kept for the WIP).
  const _handlePlaylistOpen = useCallback(async (): Promise<void> => {
    setPlaylistOpen((o) => !o)
    if (playlists.length === 0) {
      try { setPlaylists(await window.api.propresenter.getPlaylists()) } catch { /* PP not connected */ }
    }
  }, [playlists.length])

  const _handleAddToPlaylist = useCallback(async (playlistId: string): Promise<void> => {
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
    <>
    <BoothWorkspace
      rail={
        <LiveOutputRail
          width={liveRail.width}
          onResizeStart={liveRail.onResizeStart}
          onResizeKeyDown={liveRail.onResizeKeyDown}
        />
      }
    >
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
        {/* Page header */}
      <div className={cn("flex-shrink-0 px-6 pt-6 pb-4 items-start justify-between gap-4", editMode ? "hidden" : "flex")}>
        <div>
          <h1 className="page-header">Lyrics</h1>
          <p className="page-subtitle">Manage and project worship songs to ProPresenter</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" onClick={() => setShowImport(true)}>
            <Upload data-icon="inline-start" /> Import
          </Button>
          <Button onClick={handleNewSong}>
            <FilePlus data-icon="inline-start" /> New Song
          </Button>
        </div>
      </div>

      {/* Main split layout */}
      <div ref={libraryWidth.containerRef} className={cn("flex-1 flex min-h-0 min-w-0 overflow-hidden", editMode ? "px-4 pb-4" : "px-6 pb-6")}>

        {/* ── Left panel: Library (compact) ─────────────────────────────────── */}
        <div style={{ width: libraryWidth.width }} className={cn("shrink-0 flex-col gap-2.5 min-h-0 min-w-0", editMode ? "hidden" : "flex")}>
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <Input
              type="text"
              className="pl-9 pr-9"
              placeholder="Search your library or the web…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search songs"
            />
            {query && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute right-2 top-1/2 -translate-y-1/2"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <X />
              </Button>
            )}
          </div>

          {/* Wrap controls within the library panel as the window narrows. */}
          <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
            <ToggleGroup
              type="single"
              value={filter}
              className="min-w-0 max-w-full flex-wrap"
              onValueChange={(value) => value && setFilter(value as FilterType)}
              variant="outline"
              size="sm"
            >
            {(['all', 'favorites', 'recent'] as FilterType[]).map((f) => (
              <ToggleGroupItem
                key={f}
                value={f}
                className="text-[11px]"
              >
                {f === 'all' ? 'All' : f === 'favorites' ? '★ Favorites' : 'Recent'}
              </ToggleGroupItem>
            ))}
            </ToggleGroup>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="ml-auto">Sort <ChevronDown data-icon="inline-end" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuGroup>
                  {(['title', 'artist', 'recent', 'added'] as SortType[]).map((s) => (
                    <DropdownMenuItem
                      key={s}
                      onSelect={() => setSortBy(s)}
                    >
                      {sortBy === s ? '✓ ' : ''}{s === 'recent' ? 'Last Modified' : s === 'added' ? 'Date Added' : `By ${s.charAt(0).toUpperCase() + s.slice(1)}`}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Song list */}
          <div className="flex-1 overflow-y-auto space-y-0.5 min-h-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-slate-600">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : (
              <>
                {filteredSongs.length === 0 && !query && (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
                    <div className="w-12 h-12 rounded-xl bg-surface-secondary/50 border border-surface-border/40 flex items-center justify-center">
                      <Music2 size={18} className="text-slate-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-400">No songs yet</p>
                      <p className="text-xs text-slate-600 mt-1">
                        Use Import to search online, upload a file, or paste lyrics
                      </p>
                    </div>
                  </div>
                )}

                {filteredSongs.map((song) => (
                  <SongListItem
                    key={song.id}
                    song={song}
                    isSelected={song.id === selectedId}
                    onSelect={handleSelect}
                    onContextMenu={handleContextMenu}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}

                {query.trim() && filteredSongs.length === 0 && ftsSearching && (
                  <div className="flex items-center justify-center gap-2 py-6 text-slate-600">
                    <Loader2 size={14} className="animate-spin" />
                    <span className="text-xs">Searching library…</span>
                  </div>
                )}

                {query.trim().length > 0 &&
                  query.trim().length < 3 &&
                  filteredSongs.length === 0 &&
                  !ftsSearching && (
                    <p className="text-xs text-slate-600 text-center py-6 px-4">
                      Nothing in your library matches that.
                    </p>
                  )}

                {query.trim().length >= 3 &&
                  filteredSongs.length === 0 &&
                  !ftsSearching &&
                  !onlineRequested && (
                    <div className="flex flex-col items-center gap-3 py-6 px-4 text-center">
                      <p className="text-xs text-slate-600">
                        Nothing in your library matches that.
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setOnlineRequested(true)}
                      >
                        <Globe data-icon="inline-start" />
                        Search online
                      </Button>
                    </div>
                  )}

                {query.trim().length >= 3 &&
                  filteredSongs.length > 0 &&
                  !onlineRequested && (
                    <div className="pt-2 mt-1 border-t border-surface-border/30">
                      <button
                        type="button"
                        onClick={() => setOnlineRequested(true)}
                        className="w-full flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] text-slate-500 hover:text-teal-300 transition-colors"
                      >
                        <Globe size={11} />
                        Search online for more
                      </button>
                    </div>
                  )}

                {/* Online suggestions — only after explicit request */}
                {onlineRequested && query.trim().length >= 3 && (
                  <div className="pt-3 mt-2 border-t border-surface-border/40 space-y-1.5">
                    <div className="flex items-center gap-1.5 px-1 pb-0.5">
                      <Globe size={11} className="text-slate-600" />
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                        From the web
                      </p>
                      {onlineSearching && <Loader2 size={10} className="text-teal-400 animate-spin" />}
                    </div>

                    {onlineError && (
                      <p className="text-[11px] text-red-400/80 px-1 py-2">{onlineError}</p>
                    )}

                    {!onlineSearching && !onlineError && onlineSuggestions.length === 0 && (
                      <p className="text-[11px] text-slate-600 px-1 py-2">No matches online.</p>
                    )}

                    {onlineSuggestions.map((result) => (
                      <OnlineResultRow
                        key={result.id}
                        result={result}
                        selected={webPreviewResult?.id === result.id}
                        isBusy={importingOnlineId === result.id}
                        disabled={importingOnlineId !== null}
                        onSelect={(r) => void handlePreviewSuggestion(r)}
                        onImport={handleImportSuggestion}
                        onOpenExisting={handleSelectSuggestionInLibrary}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {!loading && songs.length > 0 && (
            <p className="text-[11px] text-slate-600 text-center tabular-nums shrink-0">
              {filteredSongs.length} of {songs.length} song{songs.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* ── Right panel: Editor (70%) ─────────────────────────────────────── */}
        <button
          type="button"
          {...libraryWidth.separatorProps}
          title="Drag to resize library · double-click to reset"
          className={cn("group mx-2 w-2 shrink-0 cursor-col-resize touch-none items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50", editMode ? "hidden" : "flex")}
        ><span className="h-12 w-px bg-white/10 transition-colors group-hover:bg-teal-400/70 group-active:bg-teal-400" /></button>
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          {webPreviewResult && !editMode ? (
            <OnlinePreviewPane
              result={webPreviewResult}
              preview={webPreviewData}
              loading={webPreviewLoading}
              error={webPreviewError}
              importing={importingOnlineId !== null}
              onImport={handleImportSuggestion}
              onOpenExisting={handleSelectSuggestionInLibrary}
              emptyHint="Click a web result to preview lyrics"
            />
          ) : !selectedSong && !editMode ? (
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
              <div className={cn("z-20 flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-surface/95 px-4 py-3 backdrop-blur", editMode && "sticky top-0")}>
                <div className="flex-1 min-w-0">
                  {editMode ? (
                    <div className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-amber-400" aria-hidden="true" />
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-300">
                        {isNewSong ? 'New song' : 'Editing song'}
                      </p>
                      {!isNewSong && selectedSong && <span className="truncate text-xs text-zinc-500">{selectedSong.title}</span>}
                    </div>
                  ) : (
                    <div>
                      <p className="text-base font-semibold tracking-tight text-white truncate">{selectedSong?.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{selectedSong?.artist || 'Unknown Artist'}</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!editMode && <button
                    type="button"
                    className={cn('btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-3', showSongTools && 'text-teal-300')}
                    aria-expanded={showSongTools}
                    aria-controls="lyrics-song-tools"
                    onClick={() => {
                      setShowSongTools(open => !open)
                      setPaintColor(undefined)
                      setPlaylistOpen(false)
                      setExportOpen(false)
                    }}
                  >
                    Song tools <ChevronDown size={12} className={showSongTools ? 'rotate-180' : ''} />
                  </button>}
                  {editMode ? (
                    <>
                      <button
                        className="btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-3"
                        onClick={handleCancelEdit}
                        disabled={saving || translating}
                      >
                        <X size={12} /> Cancel
                      </button>
                      <button
                        className="btn-primary flex items-center gap-1.5 text-xs py-1.5 px-3"
                        onClick={handleSave}
                        disabled={saving || translating}
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

              {showSongTools && !editMode && (
                <div id="lyrics-song-tools" className="shrink-0 flex flex-wrap items-center gap-3 px-2 pb-3 text-xs">
                  <details className="relative">
                    <summary className="cursor-pointer text-slate-400 hover:text-white">Translate lyrics</summary>
                    <div className="absolute right-0 top-full z-30 mt-2 w-64 space-y-3 rounded-lg border border-surface-border bg-surface-elevated p-3 shadow-xl">
                      <label className="block text-slate-400">Original language
                        <select aria-label="Translation source language" value={translateSourceLang} onChange={event => setTranslateSourceLang(event.target.value)} className="input mt-1 w-full" disabled={translating || saving}>
                          {['auto', 'yo', 'ig', 'ha', 'fr', 'es', 'pt'].map((lang, i) => <option key={lang} value={lang}>{['Auto-detect', 'Yoruba', 'Igbo', 'Hausa', 'French', 'Spanish', 'Portuguese'][i]}</option>)}
                        </select>
                      </label>
                      <button className="btn-secondary w-full text-xs" disabled={translating || saving} onClick={() => void handleTranslateToEnglish()}>{translating ? 'Translating…' : 'Translate to English'}</button>
                      {canUndoTranslation && <button className="text-xs text-slate-400" disabled={translating || saving} onClick={() => void handleUndoTranslation()}>Undo translation</button>}
                    </div>
                  </details>
                  {!editMode && <DropdownMenu><DropdownMenuTrigger asChild><button className="text-slate-400 hover:text-white">Export lyrics</button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => handleExport('txt')}>Plain text (.txt)</DropdownMenuItem><DropdownMenuItem onSelect={() => handleExport('usr')}>SongSelect (.usr)</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
                </div>
              )}

              {sendError && <p role="alert" className="px-2 py-2 text-xs text-red-400">{sendError}</p>}
              {translateError && (
                <div className="mx-5 mt-3 flex items-start gap-2 px-3.5 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                  <AlertCircle size={12} className="shrink-0 mt-0.5" />
                  <span>{translateError}</span>
                </div>
              )}

              {/* Scrollable content */}
              <div className={cn("flex-1 overflow-y-auto py-4 space-y-4 min-h-0", editMode ? "px-2 sm:px-5" : "px-5")}>
                {editMode && editState ? (
                  /* Edit mode: metadata + sections */
                  <div className="mx-auto w-full max-w-5xl space-y-5">
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-4">
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
                      <details className="col-span-full text-xs text-slate-500">
                        <summary className="cursor-pointer py-1 hover:text-slate-200">Song details</summary>
                        <div className="mt-3 grid gap-3">
                      <div>
                        <label className="label">Copyright</label>
                        <input
                          className="input"
                          placeholder="© Year Author"
                          value={editState.copyright}
                          onChange={(e) => patchEdit('copyright', e.target.value)}
                        />
                      </div>
                      {/* <div>
                        <label className="label">CCLI Number</label>
                        <input
                          className="input"
                          placeholder="0000000"
                          value={editState.ccliNumber}
                          onChange={(e) => patchEdit('ccliNumber', e.target.value)}
                        />
                      </div> */}
                        </div>
                      </details>
                    </div>

                    {saveError && (
                      <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                        <AlertCircle size={12} className="shrink-0 mt-0.5" />
                        <span>{saveError}</span>
                      </div>
                    )}

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-4 px-1">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">Lyrics</p>
                        <p className="text-[10px] text-zinc-600">Blank line creates a slide</p>
                      </div>
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
                          onSplit={splitSection}
                          onDragStart={handleDragStart}
                          onDragOver={handleDragOver}
                          onDrop={handleDrop}
                        />
                      ))}
                      <button
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 py-2.5 text-xs font-medium text-zinc-600 transition-colors hover:border-white/20 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
                        onClick={addSection}
                      >
                        <Plus size={13} /> Add Section
                      </button>
                    </div>
                  </div>
                ) : selectedSong && (
                  /* View mode: stage filmstrips in push order */
                  <>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-3 border-b border-surface-border/30">
                      {selectedSong.copyright && (
                        <span className="text-[11px] text-slate-500">© {selectedSong.copyright}</span>
                      )}
                      {selectedSong.ccliNumber && (
                        <span className="text-[11px] text-slate-500">CCLI #{selectedSong.ccliNumber}</span>
                      )}
                      <span className="text-[11px] text-slate-500 tabular-nums">
                        {songSlides.length} slides
                        <span className="text-slate-600"> · {selectedSong.sections.length} sections</span>
                      </span>
                      <span className="text-[11px] text-slate-600 ml-auto hidden sm:inline">
                        {paintColor !== undefined
                          ? 'Click a lyric line to paint · Esc turns paint off'
                          : '← → Previous / next · Drag slides to reorder'}
                      </span>
                    </div>

                    <div className="space-y-4 pt-1">
                      {selectedSong.sections.map((section, i) => (
                        <SectionSlideGrid
                          key={i}
                          section={section}
                          onReorder={(from, to) => void handleReorderSlide(from, to)}
                          reorderBusy={reorderBusy}
                          sectionIndex={i}
                          startIndex={sectionSlideStarts[i] ?? 1}
                          glossColor={glossColor}
                          paintColor={paintColor}
                          liveSlideIndex={liveSlideIndex}
                          pushingSlideIndex={pushingSlideIndex}
                          onSetLineColor={(si, li, c) => void handleSetLineColor(si, li, c)}
                          onPushSlide={(zeroBased) => {
                            if (paintColor !== undefined) return
                            void handlePushSlide(zeroBased)
                          }}
                          onPreviewSlide={(zeroBased) => {
                            setPreviewSlideIndex(zeroBased)
                            setShowSlidePreview(true)
                          }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>


            </>
          )}
        </div>
      </div>
      </div>
    </BoothWorkspace>

      {/* Modals */}
      {showImport && (
        <ImportModal onImported={handleImported} onClose={() => setShowImport(false)} />
      )}

      {showSlidePreview && selectedSong && (
        <SlidePreviewModal
          song={selectedSong}
          glossColor={glossColor}
          initialIndex={previewSlideIndex}
          onClose={() => setShowSlidePreview(false)}
        />
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
    </>
  )
}
