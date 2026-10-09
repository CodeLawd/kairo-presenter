import { LibraryRail } from '@/components/lyrics/LibraryRail'
import { ZoomControl } from '@/components/shared/ZoomControl'
import { leavesTarget } from '@/lib/drag'
import { PICKED_ROW, listShortcuts, selectGesture, useMultiSelect, type SelectGesture } from '@/hooks/useMultiSelect'
import { MarqueeSelect } from '@/components/shared/MarqueeSelect'
import { SelectionBar } from '@/components/shared/SelectionBar'
import { SLIDE_LABEL_CHOICES, sectionColor, sectionFill } from '@/components/lyrics/section-colors'
import { runSetlistCommand, songIdFromDrag, startSongDrag, useSetlistStore, SONG_DRAG_TYPE } from '@/stores/useSetlist'
import { startLibraryItemDrag, useLibrary } from '@/stores/useLibraries'
import { DEFAULT_LIBRARY_ID, itemsInLibrary, libraryCounts as countByLibrary } from '@shared/libraries'
import { labelLyricSlides, moveLyricSlide } from '@shared/lyrics-reorder'
import { useLibraryWidth } from './useLibraryWidth'
import { useImportRequest } from '@/hooks/useImportRequest'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useHeaderToolbarSlot } from '@/components/layout/header-toolbar'
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
  Globe,
  Library,
  ClipboardPaste,
  MoreHorizontal,
  Check,
  ListChecks,
  Scissors,
  Languages,
  RotateCcw,
  ListMusic,
} from '@/icons'
import { SongUsageModal } from './SongUsageModal'
import { cn, downloadFile } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { exportKairo, importKairo, useTransferStore } from '@/stores/useTransfer'
import type {
  DuplicateMatch,
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
import {
  expandJammedLines,
  parseMarkedSections,
  splitSectionAtCursor,
} from '@shared/lyrics-section-edit'
import {
  sectionsHaveGlosses,
  stripLineGlosses,
} from '@shared/lyrics-translate'
import { DEFAULT_GLOSS_COLOR, normalizeGlossColor, resolveLyricLineColor } from '@shared/lyrics-style'
import { isGlossLine } from '@shared/lyrics-translate'
import { formatOnlineLyricsError } from '@shared/lyrics-online-error'
import { cleanIpcError } from '@shared/ipc-error'
import {
  hasSongMetadata,
  liftHeadingTitle,
  looksLikeLyrics,
  parseClipboardSong,
} from '@shared/lyrics-clipboard'
import { looksLikeRtf, rtfToPlainText } from '@shared/rtf-text'
import { describeDuplicate, findDuplicate } from '@shared/lyrics-duplicate'
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

/** Drag payload type for moving a slide within a song. */
const SLIDE_DRAG_TYPE = 'application/x-kairo-slide'

interface SlideDrag {
  /** Zero-based slide being carried. */
  from: number
  /** The card under the pointer and which side of it the slide would land. */
  over: { index: number; side: 'before' | 'after' } | null
}

/** Comparable form of the editor state — section keys are UI-only. */
function editSnapshot(state: EditState | null): string {
  return state
    ? JSON.stringify({ ...state, sections: state.sections.map(({ _key: _ignored, ...rest }) => rest) })
    : ''
}

/** Languages a song can be translated to English from; auto-detect first. */
const TRANSLATE_SOURCES = [
  { id: 'auto', label: 'Auto-detect' },
  { id: 'yo', label: 'Yoruba' },
  { id: 'ig', label: 'Igbo' },
  { id: 'ha', label: 'Hausa' },
  { id: 'fr', label: 'French' },
  { id: 'es', label: 'Spanish' },
  { id: 'pt', label: 'Portuguese' },
] as const

/** Slide tile size range in the song view, in percent. */
const SLIDE_ZOOM_MIN = 60
const SLIDE_ZOOM_MAX = 200

function SectionBadge({ type }: { type: LyricsSectionType }): React.ReactElement {
  const label =
    type === 'pre-chorus' ? 'Pre-C'
    : type.charAt(0).toUpperCase() + type.slice(1)
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0"
      style={sectionFill(type)}
    >
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
  slideDrag,
  onSlideDrag,
  onSetLineColor,
  onReorder,
  reorderBusy,
  zoom,
  selectedSlides,
  selecting,
  onSelectSlide,
}: {
  /** Tile size in percent; 100 is the original 180–200px tile. */
  zoom: number
  /** Slides picked for labelling (zero-based, whole song). */
  selectedSlides: ReadonlySet<number>
  /** Select mode: a plain click picks the slide instead of going live. */
  selecting: boolean
  onSelectSlide: (zeroBasedIndex: number, gesture: SelectGesture) => void
  /** Move slide `from` beside slide `target`; it joins that slide's section. */
  onReorder: (from: number, target: number, side: 'before' | 'after') => void
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
  /** The slide being dragged and where it would land, shared across sections. */
  slideDrag: SlideDrag | null
  onSlideDrag: (next: SlideDrag | null) => void
  onSetLineColor: (sectionIndex: number, lineIndex: number, color: string | null) => void
}): React.ReactElement {
  const chunks = sectionColoredSlideChunks(section, glossColor)
  const scale = zoom / 100
  const color = sectionColor(section.type)
  const firstSlide = startIndex - 1
  const lastSlide = firstSlide + chunks.length - 1
  const isDestination = Boolean(
    slideDrag?.over && slideDrag.over.index >= firstSlide && slideDrag.over.index <= lastSlide,
  )

  return (
    <section
      className={cn('-mx-2 space-y-1.5 rounded-xl px-2 py-1 transition-colors duration-150', isDestination && 'bg-surface-secondary')}
      // Anywhere in the section that is not a card: join it, at the end.
      onDragOver={(event) => {
        if (reorderBusy || !slideDrag || chunks.length === 0 || !event.dataTransfer.types.includes(SLIDE_DRAG_TYPE)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        if (slideDrag.over?.index !== lastSlide || slideDrag.over.side !== 'after') {
          onSlideDrag({ ...slideDrag, over: { index: lastSlide, side: 'after' } })
        }
      }}
      onDrop={(event) => {
        if (chunks.length === 0) return
        event.preventDefault()
        const from = Number(event.dataTransfer.getData(SLIDE_DRAG_TYPE))
        onSlideDrag(null)
        if (Number.isInteger(from) && !reorderBusy) onReorder(from, lastSlide, 'after')
      }}
    >
      {/* Cards carry the section label on their bar; an empty section has
          no cards, so it keeps a heading to stay visible and droppable. */}
      {chunks.length === 0 && (
        <h3 className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium" style={sectionFill(section.type)}>
          {section.label}
        </h3>
      )}

      <div
        className="grid gap-2"
        style={{
          // 1fr, not a fixed maximum: tiles stretch to fill the row, so no
          // dead gap is left at the end of it. Zoom sets the minimum width.
          gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${Math.round(180 * scale)}px), 1fr))`,
        }}
      >
        {chunks.map((lines, i) => {
          const slideNo = startIndex + i
          const zeroBased = slideNo - 1
          const lineCount = lines.length
          const isLive = liveSlideIndex === zeroBased
          const isPushing = pushingSlideIndex === zeroBased
          const isPicked = selectedSlides.has(zeroBased)
          return (
            <button
              key={i}
              type="button"
              data-lyric-slide={zeroBased}
              data-select-id={zeroBased}
              disabled={reorderBusy}
              // The whole card drags. Pressing ⌘ first starts a rubber band
              // instead (MarqueeSelect cancels the native drag).
              draggable={!reorderBusy && paintColor === undefined}
              onDragStart={(event) => {
                event.dataTransfer.setData(SLIDE_DRAG_TYPE, String(zeroBased))
                event.dataTransfer.effectAllowed = 'move'
                // Grab the card where the pointer is, like picking it up.
                const rect = event.currentTarget.getBoundingClientRect()
                event.dataTransfer.setDragImage(event.currentTarget, event.clientX - rect.left, event.clientY - rect.top)
                // After the image is captured, so the ghost is not the dimmed card.
                requestAnimationFrame(() => onSlideDrag({ from: zeroBased, over: null }))
              }}
              onDragEnd={() => onSlideDrag(null)}
              onDragOver={(event) => {
                if (reorderBusy || !event.dataTransfer.types.includes(SLIDE_DRAG_TYPE)) return
                event.preventDefault()
                event.stopPropagation()
                event.dataTransfer.dropEffect = 'move'
                const rect = event.currentTarget.getBoundingClientRect()
                const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
                if (slideDrag && (slideDrag.over?.index !== zeroBased || slideDrag.over.side !== side)) {
                  onSlideDrag({ ...slideDrag, over: { index: zeroBased, side } })
                }
              }}
              onDrop={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const from = Number(event.dataTransfer.getData(SLIDE_DRAG_TYPE))
                const rect = event.currentTarget.getBoundingClientRect()
                const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
                onSlideDrag(null)
                if (!Number.isInteger(from) || reorderBusy) return
                onReorder(from, zeroBased, side)
              }}
              onClick={(event) => {
                // Finishing a text selection inside the tile is not a request
                // to put the slide on screen.
                if (hasTextSelection()) return
                // ⌘/Shift-click picks slides without going live, in or out of
                // select mode — the same gestures as Finder.
                const gesture = selectGesture(event)
                if (gesture) { onSelectSlide(zeroBased, gesture); return }
                if (selecting) { onSelectSlide(zeroBased, 'toggle'); return }
                onPushSlide(zeroBased)
              }}
              // A ProPresenter-style card: the slide, then a solid bar in the
              // section's colour carrying its label. The 2px frame stays neutral
              // so it can mark live (accent) and picked (white).
              className={cn(
                'group relative w-full rounded-md',
                'border-2 text-left cursor-default',
                isLive && 'border-live',
                isPicked && !isLive && 'border-white',
                !isLive && !isPicked && 'border-surface-border hover:border-stone',
                isPushing && 'opacity-70',
                // The card being carried stays in place, faded, so the gap it
                // leaves is visible while the insertion bar shows where it goes.
                slideDrag?.from === zeroBased && 'scale-[0.97] opacity-35',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
                'transition-[border-color,box-shadow,filter,opacity,transform] duration-150'
              )}
              aria-pressed={selecting ? isPicked : undefined}
              aria-label={selecting ? `Select slide ${slideNo}` : `Show slide ${slideNo}`}
              title={selecting ? 'Select this slide' : 'Click to go live · drag to move · ⌘-click to select'}
            >
              {slideDrag && slideDrag.from !== zeroBased && slideDrag.over?.index === zeroBased && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'pointer-events-none absolute inset-y-1 z-20 w-0.5 rounded-full',
                    slideDrag.over.side === 'before' ? '-left-[5px]' : '-right-[5px]',
                  )}
                  style={{ backgroundColor: color }}
                />
              )}
              {isPicked && (
                <span className="absolute left-1.5 top-1.5 z-10 grid size-4 place-items-center rounded-full bg-white text-black" aria-hidden="true">
                  <Check size={10} weight="bold" />
                </span>
              )}

              <div className="overflow-hidden rounded-[4px]">
              <div className="relative aspect-video bg-black">
              <div className="absolute inset-0 overflow-hidden flex flex-col items-center justify-center px-3.5 gap-0.5">
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
                        paintColor !== undefined && 'hover:underline cursor-pointer'
                      )}
                      style={{
                        // Text grows with the tile so a larger slide reads larger.
                        fontSize: `${(lineCount <= 2 ? 12 : lineCount === 3 ? 11 : 10) * scale}px`,
                        ...(line.color ? { color: line.color } : {}),
                      }}
                    >
                      {line.text}
                    </p>
                  ))
                ) : (
                  <p className="text-[11px] text-white/20 italic">Empty</p>
                )}
              </div>
              </div>

              {/* Label bar: the section name on its first slide (like a
                  ProPresenter group), the slide number on every one. */}
              <div
                className="flex items-center gap-2 px-2"
                style={{ ...sectionFill(section.type), height: `${Math.round(22 * scale)}px`, fontSize: `${Math.round(12 * scale)}px` }}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{i === 0 ? section.label : ''}</span>
                <span className="shrink-0 text-[0.85em] font-semibold tabular-nums opacity-70">{slideNo}</span>
              </div>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** True when the operator has text highlighted — used to tell a selection drag
 *  apart from a click on something clickable. */
function hasTextSelection(): boolean {
  const selection = window.getSelection()
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim())
}

// ─── SongListItem ─────────────────────────────────────────────────────────────

function SongListItem({
  song,
  isSelected,
  onSelect,
  onContextMenu,
  onToggleFavorite,
  position,
  onRemoveFromSetlist,
  onDropAt,
  picked = false,
  onPick,
}: {
  song: LyricsSong
  isSelected: boolean
  onSelect: (id: string) => void
  onContextMenu: (e: React.MouseEvent, id: string) => void
  onToggleFavorite: (id: string) => void
  /** 1-based place in the setlist being viewed; absent in library views. */
  position?: number
  onRemoveFromSetlist?: (id: string) => void
  /** Setlist view: a song dropped on this row lands at `position - 1` (before) or after it. */
  onDropAt?: (songId: string, insertAt: number) => void
  /** Part of a multi-selection (setlist view). */
  picked?: boolean
  /** ⌘/Shift-click picks instead of opening (setlist view). */
  onPick?: (gesture: SelectGesture) => void
}): React.ReactElement {
  const [dropping, setDropping] = useState<'before' | 'after' | null>(null)
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(event) => {
        startSongDrag(event, song.id, song.title)
        startLibraryItemDrag(event, song.id, song.title, 'songs')
      }}
      onDragOver={(event) => {
        if (!onDropAt || !event.dataTransfer.types.includes(SONG_DRAG_TYPE)) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'copy'
        // Top half drops above this song, bottom half below — so the last
        // song in the list can have one added after it.
        const rect = event.currentTarget.getBoundingClientRect()
        setDropping(event.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
      }}
      onDragLeave={(event) => { if (leavesTarget(event)) setDropping(null) }}
      onDrop={(event) => {
        if (!onDropAt) return
        event.preventDefault()
        event.stopPropagation()
        const side = dropping
        setDropping(null)
        const dragged = songIdFromDrag(event.dataTransfer)
        const index = (position ?? 1) - 1
        if (dragged) onDropAt(dragged, side === 'after' ? index + 1 : index)
      }}
      className={cn(
        // One line per song so a setlist or library shows many at once.
        'group relative flex h-8 items-center gap-2 rounded-md px-2 cursor-pointer select-none',
        picked ? PICKED_ROW : isSelected ? 'row-selected' : 'hover:bg-surface-tertiary',
      )}
      style={dropping ? {
        boxShadow: dropping === 'before' ? 'inset 0 2px 0 rgb(255 255 255 / 0.85)' : 'inset 0 -2px 0 rgb(255 255 255 / 0.85)',
      } : undefined}
      onClick={(event) => {
        const gesture = onPick ? selectGesture(event) : null
        if (gesture && onPick) onPick(gesture)
        else onSelect(song.id)
      }}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(song.id)}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, song.id) }}
      title={[song.title, song.artist, song.ccliNumber ? `CCLI #${song.ccliNumber}` : ''].filter(Boolean).join(' · ')}
    >
      {position === undefined ? (
        <Music2 size={12} className={cn('shrink-0', isSelected ? 'text-slate-300' : 'text-slate-600')} aria-hidden="true" />
      ) : (
        <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-slate-500">{position}</span>
      )}
      <p className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className={cn('truncate text-[13px]', isSelected ? 'text-white' : 'text-slate-200')}>
          {song.title}
        </span>
        {song.artist && (
          <span className="min-w-0 shrink truncate text-[11px] text-slate-500">{song.artist}</span>
        )}
      </p>
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
      {onRemoveFromSetlist && (
        <button
          className="shrink-0 rounded p-0.5 text-slate-600 opacity-0 group-hover:opacity-100 hover:text-rose-400 transition-all duration-150 focus-visible:outline-none"
          onClick={(e) => { e.stopPropagation(); onRemoveFromSetlist(song.id) }}
          aria-label={`Remove ${song.title} from this setlist`}
        >
          <X size={13} />
        </button>
      )}
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
  onExport,
  onClose,
}: {
  menu: ContextMenuState
  song: LyricsSong | undefined
  onEdit: () => void
  onDelete: () => void
  onToggleFavorite: () => void
  onExport: () => void
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
          ? 'text-red-400 hover:bg-tint-red hover:text-red-300'
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
      className="fixed z-50 w-44 rounded-lg bg-surface-elevated shadow-2xl overflow-hidden animate-fade-in py-1"
      style={{ top: menu.y, left: menu.x }}
    >
      {item('Edit Song', <Edit2 size={13} />, onEdit)}
      {item(
        song?.isFavorite ? 'Remove Favorite' : 'Mark Favorite',
        <Star size={13} className={cn(song?.isFavorite && 'fill-yellow-400 text-yellow-400')} />,
        onToggleFavorite
      )}
      {item('Export Song…', <Upload size={13} />, onExport)}
      <div className="my-1" />
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
      style={isDragTarget ? undefined : {
        // Same colour as the section's slide bars in the song view.
        boxShadow: `inset 3px 0 0 ${sectionColor(section.type)}`,
      }}
      className={cn(
        'overflow-hidden rounded-md transition-colors duration-150',
        isDragTarget
          ? 'bg-surface-elevated'
          : 'bg-surface-secondary'
      )}
    >
      {/* Section header row */}
      <div
        className="flex items-center gap-2 bg-surface-tertiary px-3 py-2"
      >
        <div
          draggable
          onDragStart={(e) => {
            // Keep text selection in the textarea from hijacking reorder.
            e.dataTransfer.effectAllowed = 'move'
            onDragStart(index)
          }}
          onDragEnd={() => onDrop(index)}
          className="text-slate-600 cursor-grab active:cursor-grabbing shrink-0 p-0.5 -ml-0.5 rounded hover:text-slate-400 hover:bg-surface-tertiary"
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
          className="appearance-none text-[11px] font-bold uppercase tracking-wider cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 rounded px-1.5 py-0.5"
          style={sectionFill(section.type)}
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
          className="flex-1 bg-transparent text-[13px] font-medium text-slate-300 placeholder:text-slate-600 focus-visible:outline-none min-w-0 border-transparent transition-colors"
          aria-label={`Section ${index + 1} label`}
          placeholder="Section label…"
        />
        <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
          {slideCount} slide{slideCount !== 1 ? 's' : ''}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="shrink-0 rounded p-1 text-slate-500 transition-colors hover:bg-surface-tertiary hover:text-slate-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
              title="Section tools"
              aria-label={`Tools for ${section.label || `section ${index + 1}`}`}
            >
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-zinc-500">Slide breaks</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onUpdate(section._key, { linesText: insertSlideBreaks(section.linesText, 1) })}>
              One line per slide
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onUpdate(section._key, { linesText: insertSlideBreaks(section.linesText, 2) })}>
              Two lines per slide
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onUpdate(section._key, { linesText: expandJammedLines(section.linesText) })}>
              Separate run-on phrases
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onUpdate(section._key, {
                linesText: section.linesText.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).join('\n'),
              })}
            >
              Remove all slide breaks
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-zinc-500">Section</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onSplit(index, cursorPos())}>
              <Scissors size={13} />
              Split at cursor
              <span className="ml-auto text-[10px] text-zinc-500">⌘↵</span>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(index, index - 1)}>
              <ArrowUp size={13} />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === total - 1} onSelect={() => onMove(index, index + 1)}>
              <ArrowDown size={13} />
              Move down
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Deleting a section was inside "Reflow tools", where nothing suggests
            it lives. It belongs on the header row, next to the section it
            removes. */}
        <button
          type="button"
          onClick={() => onDelete(section._key)}
          className="shrink-0 rounded p-1 text-slate-600 transition-colors hover:bg-tint-red hover:text-red-400 focus-visible:outline-none"
          title="Delete this section"
          aria-label={`Delete section ${section.label || index + 1}`}
        >
          <Trash2 size={13} />
        </button>
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
        className="block w-full resize-y bg-transparent px-4 py-3 font-sans text-sm leading-7 text-slate-200 placeholder:text-slate-600 focus-visible:outline-none"
        aria-label={`${section.label || 'Section'} lyrics`}
        placeholder={'Type or paste lyrics — one line per row.\nLeave a blank line to start a new slide.'}
        spellCheck
      />

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
          ? 'row-selected border-transparent'
          : 'border-transparent hover:bg-surface-tertiary'
      )}
    >
      <div className="w-7 h-7 rounded-lg bg-surface-elevated flex items-center justify-center shrink-0 mt-0.5">
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
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold text-teal-400 bg-tint-teal hover:bg-tint-teal transition-colors focus-visible:outline-none"
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
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold text-slate-400 border border-transparent hover:text-white hover:border-teal-500/40 hover:bg-tint-teal disabled:opacity-40 transition-colors focus-visible:outline-none"
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
        <div className="w-11 h-11 rounded-xl bg-surface-secondary flex items-center justify-center">
          <Eye size={16} className="text-slate-600" />
        </div>
        <p className="text-sm font-medium text-slate-400">{emptyHint}</p>
      </div>
    )
  }

  const inLibrary = Boolean(result.existingSongId)

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <div className="shrink-0 px-4 py-3">
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
            <div className="w-10 h-10 rounded-xl bg-surface-secondary flex items-center justify-center">
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
          <div className="space-y-5 select-text cursor-text">
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

      <div className="shrink-0 px-4 py-3 flex items-center justify-end gap-2">
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

// ─── Song file import ─────────────────────────────────────────────────────────

/** One file waiting in the import queue: parsed for reading, not yet saved. */
interface QueuedSongFile {
  /** Stable per-file key, so re-dropping a file replaces rather than repeats it. */
  key: string
  fileName: string
  /** What the parse produced — shown in the preview panel, never persisted. */
  song: LyricsSong
  /** Replayed through `lyrics.import` when the operator confirms. */
  source: LyricsImportSource
  /**
   * The song this one repeats: already in the library, or earlier in this same
   * batch. A folder of song sheets is full of both.
   */
  duplicate: (DuplicateMatch & { inBatch?: boolean }) | null
  /**
   * What happens on Add. Duplicates start as 'skip'; everything else 'new'.
   * 'replace' overwrites the song already in the library, keeping its id, so
   * playlists and favourites that point at it survive.
   */
  action: QueuedFileAction
  /** True once the operator corrected the title or artist by hand. */
  renamed?: boolean
}

export type QueuedFileAction = 'skip' | 'new' | 'replace'

/**
 * The song as editable text: `[Label]` markers with the lines under them.
 * This is the format `parseText` reads back, so an edit round-trips into
 * sections without a second parser.
 */
function songToMarkedText(song: LyricsSong): string {
  return song.sections
    .map((section) => `[${section.label}]\n${section.lines.join('\n')}`)
    .join('\n\n')
}

/** Song sheets arrive as SongSelect exports, plain text, or RTF from TextEdit. */
const IMPORTABLE_SONG_FILE = /\.(usr|txt|rtf)$/i

/** "Way Maker.rtf" → "Way Maker", the last resort for an untitled document. */
function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled'
}

/**
 * Turns a dropped file into an import source.
 *
 * RTF carries no metadata block, so its text goes through the same reader as a
 * pasted web page: title and artist are lifted from the document's own heading
 * when it has one, and the file name stands in when it does not.
 */
async function sourceForFile(file: File): Promise<LyricsImportSource> {
  const raw = await file.text()
  const isRtf = file.name.toLowerCase().endsWith('.rtf') || looksLikeRtf(raw)

  const text = isRtf ? rtfToPlainText(raw) : raw
  if (isRtf && !text.trim()) throw new Error('That RTF file has no readable text.')

  // A file with a header block is a SongSelect-style export — its own metadata
  // beats anything guessed from the text.
  if (hasSongMetadata(text)) {
    return { type: 'usr', content: text, filename: file.name }
  }

  const draft = parseClipboardSong(text)
  const body = draft?.text || text
  // A song sheet opens with the song's name, often with the artist under it.
  const lifted = draft?.title?.trim()
    ? { title: '', artist: '', text: body }
    : liftHeadingTitle(body)

  return {
    type: 'text',
    title: draft?.title?.trim() || lifted.title || titleFromFileName(file.name),
    artist: draft?.artist?.trim() || lifted.artist,
    text: lifted.title ? lifted.text : body,
    ...(draft?.copyright ? { copyright: draft.copyright } : {}),
  }
}


/** Drop target for song files. Compact once the queue has something in it. */
function FileDropZone({
  compact,
  dragOver,
  progress,
  inputRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileInput,
}: {
  compact: boolean
  dragOver: boolean
  progress: { done: number; total: number } | null
  inputRef: React.RefObject<HTMLInputElement>
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void
}): React.ReactElement {
  return (
    <div
      className={cn(
        'rounded-xl flex flex-col items-center gap-2 cursor-pointer transition-all text-center',
        compact ? 'px-3 py-3' : 'px-6 py-12 gap-3',
        dragOver ? 'bg-tint-teal' : 'bg-surface-secondary hover:bg-surface-tertiary'
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      {progress
        ? <Loader2 size={compact ? 16 : 28} className="text-teal-400 animate-spin" />
        : <Upload size={compact ? 16 : 28} className="text-slate-600" />}
      <div>
        <p className={cn('font-medium text-slate-300', compact ? 'text-[12px]' : 'text-sm')}>
          {progress
            ? `Reading ${progress.done + 1} of ${progress.total}\u2026`
            : compact
              ? 'Drop more files'
              : 'Drop .usr, .txt or .rtf files here'}
        </p>
        {!compact && (
          <p className="text-xs text-slate-600 mt-1">
            or click to browse — pick as many as you like
          </p>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".usr,.txt,.rtf"
        multiple
        className="hidden"
        onChange={onFileInput}
      />
    </div>
  )
}

/** Files that could not be read. Named, so the operator can go find them. */
function FileImportErrors({
  errors,
}: {
  errors: { name: string; message: string }[]
}): React.ReactElement | null {
  if (errors.length === 0) return null
  return (
    <div className="space-y-1 px-1 pt-1">
      {errors.map((file, i) => (
        <p key={`${file.name}-${i}`} className="text-[11px] text-amber-400/80">
          <span className="text-amber-300">{file.name}</span> — {file.message}
        </p>
      ))}
    </div>
  )
}

const ACTION_LABEL: Record<QueuedFileAction, string> = {
  skip: 'Skipped',
  new: 'New copy',
  replace: 'Replaces',
}

function QueuedFileRow({
  entry,
  selected,
  onSelect,
  onRemove,
}: {
  entry: QueuedSongFile
  selected: boolean
  onSelect: () => void
  onRemove: () => void
}): React.ReactElement {
  const { song, duplicate, action } = entry
  const include = action !== 'skip'
  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-lg border px-2 py-2 transition-colors cursor-pointer',
        selected
          ? 'row-selected border-transparent'
          : 'bg-transparent border-transparent hover:bg-surface-tertiary',
        !include && 'opacity-60'
      )}
      onClick={onSelect}
    >
      <div
        className={cn(
          'w-7 h-7 rounded-md flex items-center justify-center shrink-0',
          duplicate
            ? 'bg-tint-amber'
            : 'bg-tint-teal'
        )}
      >
        {duplicate
          ? <AlertCircle size={12} className="text-amber-400" />
          : <Music2 size={12} className="text-teal-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn('text-[13px] font-medium truncate', selected ? 'text-white' : 'text-slate-300')}>
          {song.title}
        </p>
        <p className="text-[11px] text-slate-500 truncate">
          {duplicate ? (
            <span className="text-amber-400/90">
              {duplicate.inBatch ? 'Already in this batch' : 'Already in your library'}
            </span>
          ) : (
            <>
              {song.artist || 'Unknown artist'}
              <span className="text-slate-600">
                {' \u00b7 '}
                {song.sections.length} section{song.sections.length === 1 ? '' : 's'}
              </span>
            </>
          )}
        </p>
      </div>
      {duplicate && (
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
            action === 'skip' && 'text-slate-500',
            action === 'new' && 'bg-tint-teal text-teal-300',
            action === 'replace' && 'bg-tint-amber text-amber-300'
          )}
        >
          {ACTION_LABEL[action]}
        </span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        className="text-slate-600 hover:text-slate-300 transition-colors p-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
        aria-label={`Remove ${song.title} from this import`}
      >
        <X size={13} />
      </button>
    </div>
  )
}

/**
 * The song's lyrics in the import preview: always editable, never a mode.
 *
 * A song sheet that needs a line fixed, a stray heading removed, or its
 * sections put in a different order should be correctable here rather than in
 * the file, and an editor you have to switch on is an editor people assume is
 * read-only. The text is the `[Label]` marker format the parser reads, so
 * moving a block moves a section and a blank line is a slide break.
 */
function QueuedLyricsEditor({
  entry,
  onEditLyrics,
}: {
  entry: QueuedSongFile
  onEditLyrics: (text: string) => void
}): React.ReactElement {
  const [draft, setDraft] = useState(() => songToMarkedText(entry.song))
  /** The file this draft belongs to, so switching songs reloads the text
   *  without throwing away what is being typed into the current one. */
  const draftKeyRef = useRef(entry.key)

  useEffect(() => {
    if (draftKeyRef.current === entry.key) return
    draftKeyRef.current = entry.key
    setDraft(songToMarkedText(entry.song))
  }, [entry.key, entry.song])

  const handleChange = useCallback(
    (text: string): void => {
      setDraft(text)
      onEditLyrics(text)
    },
    [onEditLyrics],
  )

  return (
    <div className="flex-1 min-h-0 flex flex-col px-4 py-3 gap-2">
      <textarea
        className={cn(
          'flex-1 min-h-0 w-full resize-none rounded-lg bg-surface-secondary px-3 py-2.5',
          'text-[13px] leading-relaxed text-slate-200 select-text',
          'focus:outline-none focus:ring-1 focus:ring-teal-500/50 transition-colors'
        )}
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
        aria-label="Lyrics"
        placeholder={'[Verse 1]\nType the lyrics here'}
      />
      {/* What the text parsed into, updating as it is typed — the operator can
          see a mistyped marker land as the wrong section immediately. */}
      <div className="shrink-0 space-y-1">
        {entry.song.sections.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {entry.song.sections.map((section, i) => (
              <SectionBadge key={i} type={section.type} />
            ))}
          </div>
        )}
        <p className="text-[11px] text-slate-600">
          [Verse 1], [Chorus] mark sections · a blank line breaks a slide
        </p>
      </div>
    </div>
  )
}

function QueuedFilePreview({
  entry,
  onRename,
  onSetAction,
  onEditLyrics,
}: {
  entry: QueuedSongFile | null
  onRename: (fields: { title?: string; artist?: string }) => void
  onSetAction: (action: QueuedFileAction) => void
  onEditLyrics: (text: string) => void
}): React.ReactElement {
  if (!entry) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <Eye size={16} className="text-slate-600" />
        <p className="text-sm font-medium text-slate-400">Pick a song to read it</p>
        <p className="text-xs text-slate-600">Check the titles and sections before adding them.</p>
      </div>
    )
  }

  const { song, fileName } = entry
  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="px-4 py-3 shrink-0">
        {entry.duplicate && (
          <div className="mb-2 rounded-lg bg-tint-amber px-2.5 py-2">
            <div className="flex items-start gap-2 text-[11px] text-amber-300">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span>
                {describeDuplicate(entry.duplicate)}
                {entry.duplicate.inBatch ? ' (earlier in this import)' : ' (in your library)'}.
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {(['skip', 'new', 'replace'] as const).map((choice) => {
                // Nothing exists to overwrite when the twin is only queued.
                if (choice === 'replace' && entry.duplicate?.inBatch) return null
                const active = entry.action === choice
                return (
                  <button
                    key={choice}
                    type="button"
                    onClick={() => onSetAction(choice)}
                    aria-pressed={active}
                    className={cn(
                      'rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none',
                      active
                        ? 'bg-tint-amber text-amber-200 border border-amber-400/40'
                        : 'border border-transparent text-slate-400 hover:text-slate-200 hover:bg-surface-tertiary'
                    )}
                  >
                    {choice === 'skip' ? "Don't add" : choice === 'new' ? 'Save a new copy' : 'Replace the old one'}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {/* A file with no heading is named after itself, so the title is the
            one field that regularly needs fixing before the song is saved. */}
        <input
          className="w-full bg-transparent text-base font-semibold text-white rounded px-1 -mx-1 border border-transparent hover:border-transparent focus:border-teal-500/50 focus:bg-surface focus:outline-none transition-colors"
          value={song.title}
          onChange={(e) => onRename({ title: e.target.value })}
          placeholder="Song title"
          aria-label="Song title"
        />
        <div className="flex items-center gap-1 mt-0.5 text-[11px] text-slate-500 min-w-0">
          <input
            className="min-w-0 flex-1 bg-transparent rounded px-1 -mx-1 border border-transparent hover:border-transparent focus:border-teal-500/50 focus:bg-surface focus:outline-none focus:text-slate-300 transition-colors"
            value={song.artist ?? ''}
            onChange={(e) => onRename({ artist: e.target.value })}
            placeholder="Unknown artist"
            aria-label="Artist"
          />
          <span className="shrink-0 text-slate-600 truncate">
            {song.ccliNumber && <>CCLI #{song.ccliNumber}{' \u00b7 '}</>}
            {fileName}
          </span>
        </div>
      </div>

      <QueuedLyricsEditor entry={entry} onEditLyrics={onEditLyrics} />
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

  // File tab — a whole folder of song files is a normal drop, so files queue
  // up, get read on screen, and reach the library only on Add.
  const [fileQueue, setFileQueue] = useState<QueuedSongFile[]>([])
  const [fileErrors, setFileErrors] = useState<{ name: string; message: string }[]>([])
  const [fileProgress, setFileProgress] = useState<{ done: number; total: number } | null>(null)
  /** Queued file shown in the preview panel. */
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** Mirrors `fileQueue` for `readFiles`, which must compare a new drop against
   *  what is already queued without being re-created on every change. */
  const fileQueueRef = useRef<QueuedSongFile[]>([])

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
  const [clipboardNote, setClipboardNote] = useState<string | null>(null)
  const [clipboardReading, setClipboardReading] = useState(false)
  /** Auto-read runs once per modal so a cleared form is not refilled. */
  const clipboardAutoRef = useRef(false)

  const readClipboardText = useCallback(async (): Promise<string> => {
    // Main-process read is the reliable path; the browser API is the fallback
    // for dev builds served over http where the IPC handler may be absent.
    if (typeof window.api.lyrics.readClipboard === 'function') {
      return window.api.lyrics.readClipboard()
    }
    return navigator.clipboard.readText()
  }, [])

  /**
   * Fills the paste form from whatever song text is on the clipboard.
   * `silent` suppresses the "nothing usable" message for the automatic read
   * that happens when the tab opens.
   */
  const applyClipboard = useCallback(async (silent = false): Promise<boolean> => {
    setClipboardReading(true)
    try {
      const raw = await readClipboardText()
      if (!raw.trim() || !looksLikeLyrics(raw)) {
        if (!silent) setClipboardNote('No song text on the clipboard \u2014 copy the lyrics, then try again.')
        return false
      }
      const draft = parseClipboardSong(raw)
      if (!draft) {
        if (!silent) setClipboardNote('Could not find lyrics in the copied text.')
        return false
      }
      setPasteForm((prev) => ({
        title: draft.title || prev.title,
        artist: draft.artist || prev.artist,
        copyright: draft.copyright || prev.copyright,
        text: draft.text,
      }))
      setError(null)
      const found = [
        draft.title ? `title "${draft.title}"` : null,
        draft.artist ? `artist "${draft.artist}"` : null,
      ].filter(Boolean).join(', ')
      setClipboardNote(
        `Pasted ${draft.lineCount} lyric line${draft.lineCount === 1 ? '' : 's'}` +
        (found ? ` \u2014 detected ${found}.` : '. Add a title below.')
      )
      return true
    } catch {
      if (!silent) {
        setClipboardNote('Clipboard could not be read. Paste into the lyrics box instead.')
      }
      return false
    } finally {
      setClipboardReading(false)
    }
  }, [readClipboardText])

  /** Cleans site chrome out of text dropped straight into the lyrics box. */
  const handlePasteIntoTextarea = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const raw = e.clipboardData.getData('text/plain')
    if (!raw || !looksLikeLyrics(raw)) return
    const draft = parseClipboardSong(raw)
    if (!draft) return
    e.preventDefault()
    setPasteForm((prev) => ({
      title: prev.title || draft.title,
      artist: prev.artist || draft.artist,
      copyright: prev.copyright || draft.copyright,
      text: draft.text,
    }))
    setClipboardNote(`Cleaned ${draft.lineCount} lyric line${draft.lineCount === 1 ? '' : 's'} from the pasted text.`)
  }, [])

  // Opening the Paste tab with an empty form pulls the song the operator just
  // copied off a lyrics site, so importing is one click.
  useEffect(() => {
    if (tab !== 'paste' || clipboardAutoRef.current) return
    if (pasteForm.title.trim() || pasteForm.text.trim()) return
    clipboardAutoRef.current = true
    void applyClipboard(true)
  }, [tab, pasteForm.title, pasteForm.text, applyClipboard])

  useEffect(() => {
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  /**
   * Reads a batch of song files into the queue.
   *
   * Nothing is saved here — each file is only parsed, so the operator reads
   * what came out before any of it reaches the library, and Cancel really does
   * cancel. Files are read one at a time so a dropped folder of fifty does not
   * open fifty parses at once, and one bad file lands in `fileErrors` while
   * the rest carry on.
   */
  const readFiles = useCallback(async (files: File[]): Promise<void> => {
    const accepted = files.filter((f) => IMPORTABLE_SONG_FILE.test(f.name))
    const rejected = files.filter((f) => !accepted.includes(f))

    setFileErrors(rejected.map((f) => ({ name: f.name, message: 'Only .usr, .txt and .rtf files can be imported.' })))
    if (accepted.length === 0) {
      if (rejected.length > 0) setError('Only .usr, .txt and .rtf files are supported.')
      return
    }

    setStatus('importing')
    setError(null)
    setFileProgress({ done: 0, total: accepted.length })

    const read: QueuedSongFile[] = []
    // Songs already queued count as "already there" for the files after them,
    // so a folder holding the same song twice flags the second copy.
    const queuedSoFar = fileQueueRef.current.filter((e) => e.action !== 'skip').map((e) => e.song)

    for (const file of accepted) {
      try {
        const source = await sourceForFile(file)
        const preview = await window.api.lyrics.previewFile(source)
        const inBatch = preview.duplicate ? null : findDuplicate(preview.song, queuedSoFar)
        const duplicate = preview.duplicate ?? (inBatch ? { ...inBatch, inBatch: true } : null)
        read.push({
          key: `${file.name}:${file.size}:${file.lastModified}`,
          fileName: file.name,
          song: preview.song,
          source,
          duplicate,
          action: duplicate ? 'skip' : 'new',
        })
        if (!duplicate) queuedSoFar.push(preview.song)
      } catch (err) {
        setFileErrors((prev) => [...prev, { name: file.name, message: (err as Error).message }])
      }
      setFileProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev))
    }

    // Re-dropping the same file replaces its entry rather than queueing it twice.
    setFileQueue((prev) => {
      const byKey = new Map(prev.map((entry) => [entry.key, entry]))
      for (const entry of read) byKey.set(entry.key, entry)
      return [...byKey.values()]
    })
    setSelectedFileKey((prev) => prev ?? read[0]?.key ?? null)
    setFileProgress(null)
    setStatus(read.length === 0 ? 'error' : 'idle')
    if (read.length === 0) setError('None of those files could be read.')
  }, [])

  const handleDrop = useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) void readFiles(files)
  }, [readFiles])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) void readFiles(files)
    e.target.value = ''
  }, [readFiles])

  /** Writes the queue to the library. This is the only path that saves. */
  const handleConfirmFile = useCallback(async (): Promise<void> => {
    const chosen = fileQueue.filter((entry) => entry.action !== 'skip')
    if (chosen.length === 0) return
    setStatus('importing')
    setError(null)
    setFileProgress({ done: 0, total: chosen.length })

    const failures: { name: string; message: string }[] = []
    const saved: LyricsSong[] = []
    for (const entry of chosen) {
      try {
        if (entry.action === 'replace' && entry.duplicate && !entry.duplicate.inBatch) {
          // Overwrite in place: the existing id keeps playlists, favourites and
          // anything else pointing at that song intact.
          const replaced = await window.api.lyrics.update(entry.duplicate.songId, {
            ...entry.song,
            id: entry.duplicate.songId,
          })
          if (replaced) saved.push(replaced)
          else failures.push({ name: entry.fileName, message: 'The song it replaces is no longer there.' })
        } else {
          const imported = await window.api.lyrics.import(entry.source)
          // The parsers title a song from the file; a hand correction has to be
          // written over that, and only when there was one.
          const corrected =
            entry.renamed &&
            (imported.title !== entry.song.title ||
              (imported.artist ?? '') !== (entry.song.artist ?? ''))
              ? await window.api.lyrics.update(imported.id, {
                  ...imported,
                  title: entry.song.title.trim() || imported.title,
                  artist: entry.song.artist ?? '',
                  sections: entry.song.sections,
                })
              : null
          saved.push(corrected ?? imported)
        }
      } catch (err) {
        failures.push({ name: entry.fileName, message: (err as Error).message })
      }
      setFileProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev))
    }

    setFileProgress(null)
    if (saved.length === 0) {
      setFileErrors(failures)
      setStatus('error')
      setError('None of those songs could be added.')
      return
    }

    // The last one opens in the editor — see `pendingOpenIdRef` in Lyrics.
    for (const song of saved) onImported(song)
    onClose()
  }, [fileQueue, onImported, onClose])

  /**
   * Corrects the title or artist before the song is saved.
   *
   * The edit lands on the queued copy; `handleConfirmFile` writes it over the
   * imported song, because the parsers read whatever the file itself said.
   */
  const renameQueuedFile = useCallback((key: string, fields: { title?: string; artist?: string }): void => {
    setFileQueue((prev) =>
      prev.map((entry) =>
        entry.key === key
          ? {
              ...entry,
              song: {
                ...entry.song,
                ...(fields.title !== undefined ? { title: fields.title } : {}),
                ...(fields.artist !== undefined ? { artist: fields.artist } : {}),
              },
              renamed: true,
            }
          : entry,
      ),
    )
  }, [])

  const setQueuedFileAction = useCallback((key: string, action: QueuedFileAction): void => {
    setFileQueue((prev) => prev.map((entry) => (entry.key === key ? { ...entry, action } : entry)))
  }, [])

  /**
   * Replaces the queued song's lyrics with what the operator typed.
   *
   * The edit becomes a plain-text source, so the same parser that reads a
   * pasted song reads this one — section markers and all.
   */
  const editQueuedLyrics = useCallback((key: string, text: string): void => {
    setFileQueue((prev) =>
      prev.map((entry) => {
        if (entry.key !== key) return entry
        const parsed = parseMarkedSections(text)
        return {
          ...entry,
          song: { ...entry.song, sections: parsed },
          source: {
            type: 'text',
            title: entry.song.title,
            artist: entry.song.artist ?? '',
            text,
            ...(entry.song.copyright ? { copyright: entry.song.copyright } : {}),
          },
          renamed: true,
        }
      }),
    )
  }, [])

  const removeQueuedFile = useCallback((key: string): void => {
    setFileQueue((prev) => {
      const next = prev.filter((entry) => entry.key !== key)
      setSelectedFileKey((current) => (current === key ? next[0]?.key ?? null : current))
      return next
    })
  }, [])

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

  useEffect(() => { fileQueueRef.current = fileQueue }, [fileQueue])

  const selectedFile = fileQueue.find((entry) => entry.key === selectedFileKey) ?? null
  const includedCount = fileQueue.filter((entry) => entry.action !== 'skip').length
  const skippedCount = fileQueue.length - includedCount
  const duplicateCount = fileQueue.filter((entry) => entry.duplicate).length
  // Reading a folder of songs needs the room the search tab already takes.
  const wideLayout = tab === 'online' || (tab === 'file' && fileQueue.length > 0)

  const handleTabChange = useCallback((next: ImportTab): void => {
    setTab(next)
    setError(null)
    setStatus('idle')
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in p-4"
      onClick={() => {
        // Releasing a selection that started inside the panel lands here; that
        // is a finished drag, not a click on the backdrop.
        if (hasTextSelection()) return
        onClose()
      }}
    >
      <div
        className={cn(
          'w-full bg-surface rounded-2xl shadow-2xl flex flex-col overflow-hidden',
          wideLayout ? 'max-w-5xl' : 'max-w-xl'
        )}
        style={{
          maxHeight: 'calc(100vh - 4rem)',
          ...(wideLayout ? { height: 'min(720px, calc(100vh - 4rem))' } : {}),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">Import Song</h2>
            <p className="text-xs text-slate-500 mt-0.5">Search online, upload song files, or paste a song from your clipboard</p>
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
                  ? 'bg-surface-elevated text-white'
                  : 'text-slate-500 hover:text-slate-300'
              )}
            >
              {t === 'online' && <Globe size={12} />}
              {t === 'online' ? 'Search Online' : t === 'file' ? 'Upload File' : 'Paste Lyrics'}
            </button>
          ))}
        </div>

        {/* Body */}
        {tab === 'file' ? (
          fileQueue.length === 0 ? (
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3 min-h-0">
              <FileDropZone
                compact={false}
                dragOver={dragOver}
                progress={fileProgress}
                inputRef={fileInputRef}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onFileInput={handleFileInput}
              />
              <FileImportErrors errors={fileErrors} />
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 px-5 py-4 gap-3">
              <div className="flex-1 min-h-0 flex rounded-xl overflow-hidden bg-surface-secondary">
                {/* Left: the queue */}
                <div className="w-[42%] min-w-[240px] max-w-[380px] flex flex-col">
                  <div className="p-2 shrink-0">
                    <FileDropZone
                      compact
                      dragOver={dragOver}
                      progress={fileProgress}
                      inputRef={fileInputRef}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleDrop}
                      onFileInput={handleFileInput}
                    />
                  </div>
                  <div className="flex items-center justify-between px-3 pb-1.5 shrink-0">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">
                      {includedCount} ready
                      {duplicateCount > 0 && (
                        <span className="text-amber-400/80"> · {duplicateCount} duplicate{duplicateCount === 1 ? '' : 's'}</span>
                      )}
                      {skippedCount > 0 && (
                        <span className="text-slate-600"> · {skippedCount} skipped</span>
                      )}
                    </p>
                    <button
                      onClick={() => { setFileQueue([]); setFileErrors([]); setSelectedFileKey(null) }}
                      className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors focus-visible:outline-none"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
                    {fileQueue.map((entry) => (
                      <QueuedFileRow
                        key={entry.key}
                        entry={entry}
                        selected={selectedFileKey === entry.key}
                        onSelect={() => setSelectedFileKey(entry.key)}
                        onRemove={() => removeQueuedFile(entry.key)}
                      />
                    ))}
                    <FileImportErrors errors={fileErrors} />
                  </div>
                </div>

                {/* Right: what the selected file parsed into */}
                <QueuedFilePreview
                  entry={selectedFile}
                  onRename={(fields) => {
                    if (selectedFile) renameQueuedFile(selectedFile.key, fields)
                  }}
                  onSetAction={(action) => {
                    if (selectedFile) setQueuedFileAction(selectedFile.key, action)
                  }}
                  onEditLyrics={(text) => {
                    if (selectedFile) editQueuedLyrics(selectedFile.key, text)
                  }}
                />
              </div>
            </div>
          )
        ) : tab === 'online' ? (
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
              <div className="shrink-0 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-tint-red text-red-400 text-xs">
                <AlertCircle size={13} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex-1 min-h-0 flex gap-0 rounded-xl overflow-hidden bg-surface-secondary">
              <div className="w-[42%] min-w-[220px] max-w-[360px] overflow-y-auto p-2 space-y-1">
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
          {tab === 'paste' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-secondary">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-slate-300">Import from clipboard</p>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Copy a song from any lyrics site, then paste it here — title, artist and site clutter are sorted out for you.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary flex items-center gap-2 shrink-0 text-[13px]"
                  onClick={() => void applyClipboard()}
                  disabled={clipboardReading}
                >
                  {clipboardReading
                    ? <Loader2 size={13} className="animate-spin" />
                    : <ClipboardPaste size={13} />}
                  Paste from clipboard
                </button>
              </div>

              {clipboardNote && (
                <p className="text-[11px] text-teal-400/80">{clipboardNote}</p>
              )}

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
                  onPaste={handlePasteIntoTextarea}
                />
                <p className="text-[11px] text-slate-600 mt-1">
                  Sections auto-detected from labels or double blank lines.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 px-3.5 py-3 rounded-lg bg-tint-red text-red-400 text-sm">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 shrink-0">
          <button className="btn-secondary" onClick={onClose}>
            {tab === 'online' ? 'Close' : 'Cancel'}
          </button>
          {tab === 'online' ? null : tab === 'file' ? (
            <button
              disabled={includedCount === 0 || status === 'importing'}
              className="btn-primary flex items-center gap-2"
              onClick={() => void handleConfirmFile()}
            >
              {status === 'importing' && <Loader2 size={13} className="animate-spin" />}
              {includedCount > 1 ? `Add ${includedCount} Songs` : 'Add Song'}
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm bg-surface rounded-2xl shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-tint-red flex items-center justify-center shrink-0">
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
            className="px-3.5 py-1.5 rounded-lg bg-tint-red hover:bg-tint-red text-red-400 text-sm font-medium transition-colors focus-visible:outline-none"
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
  const toolbarSlot = useHeaderToolbarSlot()
  const liveRail = useLiveRailWidth()

  // ── Library ──────────────────────────────────────────────────────────────────
  // Seeded from the startup snapshot so returning to this tab never flashes an
  // empty library while a fresh read resolves.
  const [songs, setSongs] = useState<LyricsSong[]>(() => useBootstrapStore.getState().lyrics)
  // The library is already in hand from bootstrap; nothing to wait for.
  const [loading] = useState(false)

  // Songs can arrive while this page is mounted — imported from the ⌘F palette,
  // say — and the list above is seeded once. Merge anything new rather than
  // replacing, so edits held here are not thrown away by the sync.
  const bootstrapLyrics = useBootstrapStore((s) => s.lyrics)
  useEffect(() => {
    setSongs((prev) => {
      const known = new Map(prev.map((song) => [song.id, song]))
      const added = bootstrapLyrics.filter((song) => !known.has(song.id))
      // A newer copy (a song replaced by a .kairo import) wins over the one
      // held here; anything not newer is left alone so local edits survive.
      const fresher = new Map(
        bootstrapLyrics
          .filter((song) => {
            const held = known.get(song.id)
            return held !== undefined && song.updatedAt > held.updatedAt
          })
          .map((song) => [song.id, song]),
      )
      if (added.length === 0 && fresher.size === 0) return prev
      return [...added, ...prev.map((song) => fresher.get(song.id) ?? song)]
    })
  }, [bootstrapLyrics])
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
  const slideZoom = useAppStore((s) => s.lyricsSlideZoom)
  const setSlideZoom = useAppStore((s) => s.setLyricsSlideZoom)
  const setSelectedId = useCallback(
    (id: string | null) => setLyricsViewState({ selectedSongId: id }),
    [setLyricsViewState]
  )
  const setFilter = useCallback(
    (next: FilterType) => setLyricsViewState({ filter: next }),
    [setLyricsViewState]
  )
  // Which setlist the song list is showing, or null for a library view. Local
  // rather than persisted: a service order is picked fresh each time the page
  // opens, and a stale selection would hide the library behind last week's list.
  const [viewingSetlistId, setViewingSetlistId] = useState<string | null>(null)
  const [activeLibraryId, setActiveLibraryId] = useState<string>(DEFAULT_LIBRARY_ID)
  const songLibrary = useLibrary('songs')
  const setlistState = useSetlistStore()
  const viewingSetlist = viewingSetlistId
    ? setlistState.lists.find((list) => list.id === viewingSetlistId) ?? null
    : null
  // A setlist deleted from the rail falls back to the library rather than
  // leaving the list stuck on something that no longer exists.
  useEffect(() => {
    if (viewingSetlistId && !viewingSetlist) setViewingSetlistId(null)
  }, [viewingSetlistId, viewingSetlist])
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
  const libraryWidth = useLibraryWidth()
  const [reorderBusy, setReorderBusy] = useState(false)
  const reorderLock = useRef(false)
  const sortRef = useRef<HTMLDivElement>(null)

  // ── Overlays ─────────────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LyricsSong | null>(null)
  const [showImport, setShowImport] = useState(false)
  useImportRequest(['lyrics'], () => setShowImport(true), !showImport)

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
  const [usageOpen, setUsageOpen] = useState(false)
  const [copiedLyrics, setCopiedLyrics] = useState(false)
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
    // The library narrows the pool first: Favorites inside "Christmas" means
    // favourites of that library, not of everything.
    let pool = itemsInLibrary(songLibrary, songs, activeLibraryId)

    if (q) {
      // Metadata match runs locally so the list responds on every keystroke.
      const matches = new Map<string, LyricsSong>()
      for (const song of pool) {
        if (
          song.title.toLowerCase().includes(q) ||
          (song.artist || '').toLowerCase().includes(q) ||
          (song.ccliNumber ?? '').includes(q)
        ) {
          matches.set(song.id, song)
        }
      }
      // Full-text hits arrive a beat later and add lyric-body matches.
      const inLibrary = new Set(pool.map((song) => song.id))
      for (const hit of ftsMatches ?? []) {
        if (!matches.has(hit.id) && inLibrary.has(hit.id)) {
          matches.set(hit.id, pool.find((s) => s.id === hit.id) ?? hit)
        }
      }
      pool = [...matches.values()]
    }

    // A setlist is an order, so it is never re-sorted — only searched within.
    if (viewingSetlist) {
      const byId = new Map(pool.map((song) => [song.id, song]))
      return viewingSetlist.songIds
        .map((id) => byId.get(id))
        .filter((song): song is LyricsSong => Boolean(song))
    }

    const result = applyFilter(pool, filter)
    return applySort(result, filter === 'recent' ? 'recent' : sortBy)
  }, [songs, filter, sortBy, query, ftsMatches, viewingSetlist, songLibrary, activeLibraryId])

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
  //
  // The bootstrap library counts as "exists" too: a song imported from the ⌘F
  // palette is selected there in the same tick it is added, one render before
  // the merge above brings it into `songs`. Checking only `songs` cleared that
  // selection in the gap, and the song silently never opened.
  useEffect(() => {
    if (pendingOpenIdRef.current) return
    if (!selectedId) return
    const known =
      songs.some((song) => song.id === selectedId) ||
      bootstrapLyrics.some((song) => song.id === selectedId)
    if (!known) setSelectedId(null)
  }, [songs, bootstrapLyrics, selectedId, setSelectedId])

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
  /** The editor's starting point, to tell real edits from an untouched form. */
  const editBaselineRef = useRef<string>('')
  const editDirty = editMode && editSnapshot(editState) !== editBaselineRef.current

  /**
   * With the library visible while editing, picking another song (or New)
   * would silently drop the edit. Ask first — but only when something changed.
   */
  const leaveEditor = useCallback((): boolean => {
    if (!editMode) return true
    if (editDirty && !window.confirm('Discard your unsaved changes to this song?')) return false
    setEditMode(false)
    setEditState(null)
    setSaveError(null)
    setIsNewSong(false)
    return true
  }, [editMode, editDirty])

  const handleSelect = useCallback((id: string): void => {
    if (!leaveEditor()) return
    setSelectedId(id)
    setWebPreviewResult(null)
    setWebPreviewData(null)
    setWebPreviewError(null)
    setSendStatus('idle')
    setSendError(null)
    setTranslateError(null)
    setLiveSlideIndex(null)
  }, [leaveEditor, setSelectedId])

  // ── Edit mode ────────────────────────────────────────────────────────────────
  const handleEdit = useCallback((): void => {
    if (!selectedSong) return
    const initial = songToEdit(selectedSong)
    editBaselineRef.current = editSnapshot(initial)
    setEditState(initial)
    setIsNewSong(false)
    setEditMode(true)
    setSaveError(null)
    setTranslateError(null)
  }, [selectedSong])

  const handleNewSong = useCallback((): void => {
    if (!leaveEditor()) return
    const empty: EditState = {
      title: '',
      artist: '',
      copyright: '',
      ccliNumber: '',
      sections: [{ _key: makeKey(), type: 'verse', label: 'Verse 1', linesText: '' }],
    }
    editBaselineRef.current = editSnapshot(empty)
    setSelectedId(null)
    setEditState(empty)
    setIsNewSong(true)
    setEditMode(true)
    setSaveError(null)
  }, [leaveEditor])

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

  const handleTranslateToEnglish = useCallback(async (sourceLanguage?: string): Promise<void> => {
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
        sourceLanguage: sourceLanguage ?? translateSourceLang,
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
      setSendError(cleanIpcError(err))
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
      setSendError(cleanIpcError(err))
    } finally {
      setPushingSlideIndex(null)
    }
  }, [selectedId, selectedSong, songSlides])

  const handleReorderSlide = async (from: number, target: number, side: 'before' | 'after'): Promise<void> => {
    if (!selectedSong || reorderLock.current || !Number.isInteger(from)) return
    reorderLock.current = true; setReorderBusy(true); setSendError(null)
    try {
      const updated = await window.api.lyrics.update(selectedSong.id, { ...selectedSong, sections: moveLyricSlide(selectedSong.sections, from, target, side) })
      if (!updated) throw new Error('Could not save slide order')
      setSongs(previous => previous.map(song => song.id === updated.id ? updated : song))
      setLiveSlideIndex(null)
    } catch (error) { setSendError(cleanIpcError(error)) }
    finally { reorderLock.current = false; setReorderBusy(false) }
  }

  // ── Picking songs in the setlist on screen: ⌘/Shift-click, ⌘A, Delete ─────
  const setlistSongIds = useMemo(
    () => (viewingSetlist ? filteredSongs.map((song) => song.id) : []),
    [viewingSetlist, filteredSongs],
  )
  const setlistSelect = useMultiSelect<string>(setlistSongIds)
  const removePickedFromSetlist = (): void => {
    if (!viewingSetlist) return
    const ids = setlistSongIds.filter((id) => setlistSelect.selected.has(id))
    if (ids.length === 0) return
    if (ids.length > 1 && !window.confirm(`Remove ${ids.length} songs from ${viewingSetlist.name}? They stay in your library.`)) return
    void (async () => {
      for (const songId of ids) await runSetlistCommand({ action: 'removeSong', songId, listId: viewingSetlist.id })
      setlistSelect.clear()
    })().catch((error) => setSendError(cleanIpcError(error)))
  }

  // ── Dropping songs into the setlist on screen ─────────────────────────────
  const [setlistDropEnd, setSetlistDropEnd] = useState(false)

  /**
   * Insert at a gap in the setlist being viewed. `insertAt` counts gaps in the
   * list as shown; a song already on the list is moved, so its own slot is
   * discounted, which is what `withSong` expects.
   */
  const dropIntoSetlist = useCallback((songId: string, insertAt: number): void => {
    if (!viewingSetlist) return
    const current = viewingSetlist.songIds.indexOf(songId)
    const index = current >= 0 && current < insertAt ? insertAt - 1 : insertAt
    if (current === index) return
    void runSetlistCommand({ action: 'add', songId, index, listId: viewingSetlist.id })
      .catch((error) => setSendError(cleanIpcError(error)))
  }, [viewingSetlist])

  // ── Dragging slides ────────────────────────────────────────────────────────
  const [slideDrag, setSlideDrag] = useState<SlideDrag | null>(null)
  const songScrollRef = useRef<HTMLDivElement>(null)

  // While a slide is carried, the list scrolls when the pointer nears its top
  // or bottom — so a slide can be moved further than one screen.
  const dragging = slideDrag !== null
  useEffect(() => {
    if (!dragging) return
    let frame = 0
    let speed = 0
    const tick = (): void => {
      if (speed !== 0) songScrollRef.current?.scrollBy({ top: speed })
      frame = requestAnimationFrame(tick)
    }
    const onOver = (event: DragEvent): void => {
      const box = songScrollRef.current?.getBoundingClientRect()
      if (!box) return
      const edge = 64
      if (event.clientY < box.top + edge) speed = -Math.ceil((box.top + edge - event.clientY) / 4)
      else if (event.clientY > box.bottom - edge) speed = Math.ceil((event.clientY - (box.bottom - edge)) / 4)
      else speed = 0
    }
    window.addEventListener('dragover', onOver)
    frame = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('dragover', onOver)
      cancelAnimationFrame(frame)
    }
  }, [dragging])

  // ── Labelling slides ───────────────────────────────────────────────────────
  // Select mode: a plain click picks a slide. Outside it, ⌘/Shift-click and
  // dragging across empty space pick slides without sending anything live.
  const [selectingSlides, setSelectingSlides] = useState(false)
  const slideOrder = useMemo(() => songSlides.map((_, index) => index), [songSlides])
  const slideSelect = useMultiSelect<number>(slideOrder)
  const pickedSlides = slideSelect.selected
  const pickSlide = slideSelect.pick
  const clearSlideSelection = slideSelect.clear

  const clearPicked = useCallback((): void => {
    clearSlideSelection()
    setSelectingSlides(false)
  }, [clearSlideSelection])

  // A different song, or the editor, starts with nothing picked.
  useEffect(() => {
    clearPicked()
  }, [selectedSong?.id, editMode, clearPicked])

  // Esc also leaves select mode when nothing is picked yet.
  useEffect(() => {
    if (!selectingSlides || pickedSlides.size > 0) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.stopPropagation(); setSelectingSlides(false) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [selectingSlides, pickedSlides.size])

  const handleLabelSlides = async (target: { type: LyricsSectionType; label: string }): Promise<void> => {
    if (!selectedSong || pickedSlides.size === 0 || reorderLock.current) return
    reorderLock.current = true; setReorderBusy(true); setSendError(null)
    try {
      const sections = labelLyricSlides(selectedSong.sections, pickedSlides, target)
      const updated = await window.api.lyrics.update(selectedSong.id, { ...selectedSong, sections })
      if (!updated) throw new Error('Could not label those slides')
      setSongs(previous => previous.map(song => song.id === updated.id ? updated : song))
      clearPicked()
    } catch (error) { setSendError(cleanIpcError(error)) }
    finally { reorderLock.current = false; setReorderBusy(false) }
  }

  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || event.isComposing) return
      const target = event.target as HTMLElement | null
      if (editMode || !selectedSong || showImport || deleteTarget || webPreviewResult || reorderBusy || pushingSlideIndex !== null || !document.hasFocus() || document.querySelector('.kairo-pp-settings, [role="dialog"], [role="menu"]') || target?.closest('input, textarea, select, [contenteditable="true"], [role="separator"]')) return
      event.preventDefault(); event.stopImmediatePropagation()
      const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
      const next = liveSlideIndex === null ? 0 : Math.max(0, Math.min(songSlides.length - 1, liveSlideIndex + delta))
      if (next === liveSlideIndex || !songSlides.length) return
      document.querySelector(`[data-lyric-slide="${next}"]`)?.scrollIntoView({ block: 'nearest' })
      void handlePushSlide(next)
    }
    window.addEventListener('keydown', navigate, true)
    return () => window.removeEventListener('keydown', navigate, true)
  }, [editMode, selectedSong, showImport, deleteTarget, webPreviewResult, reorderBusy, pushingSlideIndex, liveSlideIndex, songSlides.length, handlePushSlide])

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

  // ⌘S / Ctrl+S saves while editing — the reflex from every other editor.
  useEffect(() => {
    if (!editMode) return
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!saving && !translating) void handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editMode, saving, translating, handleSave])

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

  /** Copies the whole song as plain text — faster than selecting across tiles. */
  const handleCopyLyrics = useCallback((): void => {
    if (!selectedSong) return
    void navigator.clipboard.writeText(toTxt(selectedSong)).then(
      () => { setCopiedLyrics(true); setTimeout(() => setCopiedLyrics(false), 1800) },
      () => undefined,
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
      {toolbarSlot && createPortal(
        <div className="flex h-7 min-w-0 items-center gap-1.5">
          <div className="no-drag flex h-7 w-[26rem] min-w-0 shrink items-center rounded-md border border-transparent bg-surface-secondary transition-colors focus-within:border-teal-500">
            <Search size={13} className="ml-2.5 shrink-0 text-slate-500" aria-hidden="true" />
            <input
              type="text"
              className="h-full min-w-0 flex-1 bg-transparent px-2 text-xs text-slate-100 outline-none placeholder:text-slate-500"
              placeholder="Search your library or the web…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search songs"
            />
            {query && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="mr-1 shrink-0"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <X />
              </Button>
            )}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => setShowImport(true)} aria-label="Import songs" title="Import songs">
            <Upload />
          </Button>
          <Button size="sm" onClick={handleNewSong} title="New song" data-tour="lyrics-new">
            <Plus data-icon="inline-start" /> New
          </Button>
        </div>,
        toolbarSlot,
      )}
      {/* Main split layout */}
      <div ref={libraryWidth.containerRef} className="flex-1 flex min-h-0 min-w-0 overflow-hidden">

        {/* ── Left panel: the library, on its own surface ───────────────────── */}
        {/* A sidebar rather than a card: it runs the full height of the page, so
            the library and the song being edited read as two rooms. Search,
            Import and New live in the app header's toolbar row. */}
        <div
          style={{ width: libraryWidth.width }}
          className={cn(
            "flex shrink-0 flex-col gap-2.5 min-h-0 min-w-0 bg-surface-secondary px-4 pt-3 pb-5",
          )}
        >
          <LibraryRail
            source={filter}
            activeLibraryId={activeLibraryId}
            activeSetlistId={viewingSetlistId}
            libraryCounts={countByLibrary(songLibrary, songs)}
            filterCounts={{
              favorites: songs.filter((song) => song.isFavorite).length,
              recent: songs.length,
            }}
            onSelectLibrary={(libraryId) => {
              setViewingSetlistId(null)
              setActiveLibraryId(libraryId)
              setFilter('all')
            }}
            onSelectSource={(next) => { setViewingSetlistId(null); setFilter(next) }}
            onSelectSetlist={setViewingSetlistId}
          />

          <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
            <p className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              {viewingSetlist
                ? `${filteredSongs.length} ${filteredSongs.length === 1 ? 'song' : 'songs'}`
                : 'Songs'}
            </p>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Share songs" title="Export or import a .kairo file">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onSelect={() => useTransferStore.getState().openSongExport(
                      viewingSetlist ? viewingSetlist.songIds : selectedId ? [selectedId] : [],
                    )}
                  >
                    <Upload size={13} />
                    Export songs…
                  </DropdownMenuItem>
                  {viewingSetlist ? (
                    <DropdownMenuItem onSelect={() => void exportKairo({ kind: 'setlist', listId: viewingSetlist.id })}>
                      <Upload size={13} />
                      Export this setlist…
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onSelect={() => void exportKairo({ kind: 'library' })}>
                    <Upload size={13} />
                    Export whole library…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void importKairo()}>
                    <Download size={13} />
                    Import .kairo file…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setUsageOpen(true)}>
                    <ListMusic size={13} />
                    Song usage report…
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {viewingSetlist && setlistSelect.selected.size > 0 && (
            <div className="flex shrink-0 items-center gap-2 rounded-lg bg-surface-elevated px-2.5 py-1.5 text-[11px]">
              <span className="min-w-0 flex-1 truncate text-zinc-300">
                {setlistSelect.selected.size} song{setlistSelect.selected.size === 1 ? '' : 's'} selected
              </span>
              <button type="button" onClick={removePickedFromSetlist} className="rounded px-1.5 py-0.5 font-medium text-rose-300 hover:bg-tint-rose" title="Remove from setlist (Delete)">
                Remove
              </button>
              <button type="button" onClick={setlistSelect.clear} className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-surface-tertiary hover:text-white" title="Clear (Esc)">
                Clear
              </button>
            </div>
          )}
          {/* Song list. In a setlist, the whole area takes a drop: anywhere
              below the last song adds to the end. */}
          <div
            className={cn('flex-1 overflow-y-auto space-y-px min-h-0 rounded-md transition-colors', setlistDropEnd && 'bg-surface-tertiary')}
            onDragOver={(event) => {
              if (!viewingSetlist || !event.dataTransfer.types.includes(SONG_DRAG_TYPE)) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
              setSetlistDropEnd(true)
            }}
            onDragLeave={(event) => { if (leavesTarget(event)) setSetlistDropEnd(false) }}
            onDrop={(event) => {
              if (!viewingSetlist) return
              event.preventDefault()
              setSetlistDropEnd(false)
              const songId = songIdFromDrag(event.dataTransfer)
              if (songId) dropIntoSetlist(songId, viewingSetlist.songIds.length)
            }}
            tabIndex={-1}
            onKeyDown={viewingSetlist ? listShortcuts({
              selectAll: setlistSelect.selectAll,
              remove: removePickedFromSetlist,
              hasSelection: setlistSelect.selected.size > 0,
            }) : undefined}
          >
            {loading ? (
              <div className="flex items-center justify-center py-16 text-slate-600">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : (
              <>
                {filteredSongs.length === 0 && !query && (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
                    <div className="w-12 h-12 rounded-xl bg-surface-secondary flex items-center justify-center">
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

                {filteredSongs.map((song, index) => (
                  <SongListItem
                    key={song.id}
                    song={song}
                    isSelected={song.id === selectedId}
                    onSelect={handleSelect}
                    onContextMenu={handleContextMenu}
                    onToggleFavorite={handleToggleFavorite}
                    position={viewingSetlist ? index + 1 : undefined}
                    onRemoveFromSetlist={viewingSetlist
                      ? (id) => void runSetlistCommand({ action: 'removeSong', songId: id, listId: viewingSetlist.id })
                      : undefined}
                    onDropAt={viewingSetlist ? dropIntoSetlist : undefined}
                    picked={setlistSelect.isSelected(song.id)}
                    onPick={viewingSetlist ? (gesture) => setlistSelect.pick(song.id, gesture) : undefined}
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
                    <div className="pt-2 mt-1">
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
                  <div className="pt-3 mt-2 space-y-1.5">
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
          className="group flex w-2 shrink-0 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50"
        ><span className="h-12 w-px bg-surface-elevated transition-colors group-hover:bg-teal-400 group-active:bg-teal-400" /></button>
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
              <div className="w-16 h-16 rounded-2xl bg-surface-secondary flex items-center justify-center">
                <Music2 size={24} className="text-slate-600" />
              </div>
              <div>
                <p className="text-slate-400 text-sm font-medium">Select a song from your library</p>
                <p className="text-slate-600 text-xs mt-1">Or add one to get started</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
                  <Upload data-icon="inline-start" /> Import
                </Button>
                <Button size="sm" onClick={handleNewSong}>
                  <FilePlus data-icon="inline-start" /> New song
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Editor header */}
              <div className={cn("z-20 flex flex-shrink-0 flex-wrap items-center justify-between gap-3 bg-surface px-4 py-3", editMode && "sticky top-0")}>
                <div className="flex-1 min-w-0">
                  {editMode ? (
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-tint-amber px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-300">
                        <Edit2 size={10} aria-hidden="true" />
                        {isNewSong ? 'New song' : 'Editing'}
                      </span>
                      <span className="truncate text-sm font-medium text-slate-300">
                        {editState?.title.trim() || (isNewSong ? 'Untitled song' : selectedSong?.title)}
                      </span>
                      {editDirty && (
                        <span className="shrink-0 text-[11px] text-slate-500">· Unsaved changes</span>
                      )}
                    </div>
                  ) : selectedSong ? (
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold tracking-tight text-white">{selectedSong.title}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {[
                          selectedSong.artist || 'Unknown artist',
                          `${songSlides.length} slide${songSlides.length === 1 ? '' : 's'}`,
                          `${selectedSong.sections.length} section${selectedSong.sections.length === 1 ? '' : 's'}`,
                          selectedSong.ccliNumber ? `CCLI #${selectedSong.ccliNumber}` : '',
                          selectedSong.copyright ? `© ${selectedSong.copyright}` : '',
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {!editMode && selectedSong && (
                    <Button
                      variant={selectingSlides ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => (selectingSlides ? clearPicked() : setSelectingSlides(true))}
                      aria-pressed={selectingSlides}
                      title="Select slides to label them as a verse, chorus, bridge… (or ⌘-click a slide)"
                    >
                      <ListChecks data-icon="inline-start" />
                      {selectingSlides ? 'Done' : 'Select'}
                    </Button>
                  )}
                  {!editMode && (
                    <ZoomControl
                      label="Slide size"
                      value={slideZoom}
                      min={SLIDE_ZOOM_MIN}
                      max={SLIDE_ZOOM_MAX}
                      defaultValue={100}
                      onChange={setSlideZoom}
                    />
                  )}
                  {!editMode && selectedSong && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon-sm" aria-label="Song actions" title="Song actions">
                          {translating ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuGroup>
                          <DropdownMenuItem onSelect={handleCopyLyrics}>
                            <ClipboardPaste size={13} />
                            {copiedLyrics ? 'Copied' : 'Copy lyrics'}
                          </DropdownMenuItem>
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger disabled={translating || saving}>
                              <Languages size={13} />
                              {translating ? 'Translating…' : 'Translate to English'}
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="w-44">
                              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-zinc-500">
                                Sung in
                              </DropdownMenuLabel>
                              {TRANSLATE_SOURCES.map((source) => (
                                <DropdownMenuItem
                                  key={source.id}
                                  onSelect={() => {
                                    setTranslateSourceLang(source.id)
                                    void handleTranslateToEnglish(source.id)
                                  }}
                                >
                                  {source.label}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          {canUndoTranslation && (
                            <DropdownMenuItem disabled={translating || saving} onSelect={() => void handleUndoTranslation()}>
                              <RotateCcw size={13} />
                              Undo translation
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem onSelect={() => void exportKairo({ kind: 'songs', songIds: [selectedSong.id] })}>
                            <Upload size={13} />
                            Export as Kairo file…
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => handleExport('txt')}>
                            <Download size={13} />
                            Download as text (.txt)
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => handleExport('usr')}>
                            <Download size={13} />
                            Download for SongSelect (.usr)
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {editMode ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={handleCancelEdit} disabled={saving || translating}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => void handleSave()} disabled={saving || translating} title="Save (⌘S)">
                        {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
                        {saving ? 'Saving…' : 'Save'}
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" onClick={handleEdit}>
                      <Edit2 data-icon="inline-start" /> Edit
                    </Button>
                  )}
                </div>
              </div>

              {sendError && <p role="alert" className="px-4 py-2 text-xs text-red-400">{sendError}</p>}
              {translateError && (
                <div className="mx-4 mt-3 flex items-start gap-2 px-3.5 py-2.5 rounded-lg bg-tint-red text-red-400 text-xs">
                  <AlertCircle size={12} className="shrink-0 mt-0.5" />
                  <span>{translateError}</span>
                </div>
              )}

              {/* Scrollable content */}
              <div ref={songScrollRef} className={cn("flex-1 overflow-y-auto space-y-4 min-h-0 px-4", editMode ? "py-6" : "py-4")}>
                {editMode && editState ? (
                  /* Edit mode: metadata + sections */
                  <div className="mx-auto w-full max-w-3xl space-y-6">
                    <div className="space-y-3">
                      <input
                        className="w-full border-transparent bg-transparent pb-1 text-2xl font-semibold tracking-tight text-white outline-none placeholder:text-white/20"
                        placeholder="Song title"
                        aria-label="Song title"
                        value={editState.title}
                        onChange={(e) => patchEdit('title', e.target.value)}
                        autoFocus={isNewSong}
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="label">Artist</span>
                          <input
                            className="input"
                            placeholder="Artist or band"
                            value={editState.artist}
                            onChange={(e) => patchEdit('artist', e.target.value)}
                          />
                        </label>
                        <label className="block">
                          <span className="label">Copyright</span>
                          <input
                            className="input"
                            placeholder="© Year, author or publisher"
                            value={editState.copyright}
                            onChange={(e) => patchEdit('copyright', e.target.value)}
                          />
                        </label>
                      </div>
                    </div>

                    {saveError && (
                      <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-lg bg-tint-red text-red-400 text-xs">
                        <AlertCircle size={12} className="shrink-0 mt-0.5" />
                        <span>{saveError}</span>
                      </div>
                    )}

                    <div className="space-y-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-0.5">
                        <p className="text-xs font-semibold text-slate-300">
                          Sections
                          <span className="ml-1.5 font-normal tabular-nums text-slate-600">{editState.sections.length}</span>
                        </p>
                        <p className="text-[11px] text-slate-600">
                          Blank line = new slide · ⌘↵ splits a section at the cursor · drag ⋮⋮ to reorder
                        </p>
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
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-surface-secondary py-2.5 text-xs font-medium text-zinc-600 transition-colors hover:border-transparent hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
                        onClick={addSection}
                      >
                        <Plus size={13} /> Add section
                      </button>
                    </div>
                  </div>
                ) : selectedSong && (
                  /* View mode: stage filmstrips in push order */
                  <>
                    <MarqueeSelect
                      className="space-y-5"
                      onBegin={slideSelect.beginMarquee}
                      onChange={(ids) => slideSelect.updateMarquee(ids.map(Number))}
                    >
                      {selectedSong.sections.map((section, i) => (
                        <SectionSlideGrid
                          key={i}
                          zoom={slideZoom}
                          selectedSlides={pickedSlides}
                          selecting={selectingSlides}
                          onSelectSlide={pickSlide}
                          section={section}
                          onReorder={(from, target, side) => void handleReorderSlide(from, target, side)}
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
                          slideDrag={slideDrag}
                          onSlideDrag={setSlideDrag}
                        />
                      ))}
                    </MarqueeSelect>
                    <p className="pt-1 text-center text-[11px] text-slate-600">
                      {paintColor !== undefined
                        ? 'Click a lyric line to paint · Esc turns paint off'
                        : selectingSlides
                          ? 'Click slides to select · Shift-click selects a range · Esc to cancel'
                          : 'Click a slide to go live · ⌘-click or drag across empty space to select · ← → previous / next'}
                    </p>
                    {(selectingSlides || pickedSlides.size > 0) && (
                      <SelectionBar
                        className="sticky bottom-0 -mx-1 mt-2"
                        count={pickedSlides.size}
                        noun="slide"
                        hint="Click slides to select them"
                        onClear={clearPicked}
                      >
                        <span className="text-[11px] text-slate-500">Label as</span>
                        {SLIDE_LABEL_CHOICES.map((choice) => (
                          <button
                            key={choice.label}
                            type="button"
                            disabled={pickedSlides.size === 0 || reorderBusy}
                            onClick={() => void handleLabelSlides(choice)}
                            className="inline-flex items-center rounded px-2.5 py-1 text-[11px] font-semibold transition-[filter] hover:brightness-110 disabled:opacity-35"
                            style={sectionFill(choice.type)}
                          >
                            {choice.label}
                          </button>
                        ))}
                      </SelectionBar>
                    )}
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
            if (contextMenuSong && leaveEditor()) {
              const initial = songToEdit(contextMenuSong)
              editBaselineRef.current = editSnapshot(initial)
              setSelectedId(contextMenuSong.id)
              setEditState(initial)
              setIsNewSong(false)
              setEditMode(true)
            }
          }}
          onDelete={() => {
            if (contextMenuSong) setDeleteTarget(contextMenuSong)
          }}
          onToggleFavorite={() => handleToggleFavorite(contextMenu.songId)}
          onExport={() => void exportKairo({ kind: 'songs', songIds: [contextMenu.songId] })}
          onClose={() => setContextMenu(null)}
        />
      )}
      {usageOpen && <SongUsageModal onClose={() => setUsageOpen(false)} />}
    </>
  )
}
