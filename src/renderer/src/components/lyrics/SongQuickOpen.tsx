import { useEffect, useMemo, useRef, useState } from 'react'
import { Music2, Search, X } from '@/icons'
import { cn } from '@/lib/utils'
import type { LyricsSong } from '@shared/ipc'

interface SongQuickOpenProps {
  songs: LyricsSong[]
  onClose: () => void
  onOpen: (song: LyricsSong) => void
}

function searchable(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function SongQuickOpen({ songs, onClose, onOpen }: SongQuickOpenProps): React.ReactElement {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([])

  const results = useMemo(() => {
    const needle = searchable(query)
    const ranked = songs.map((song) => {
      const title = searchable(song.title)
      const artist = searchable(song.artist || '')
      const lyricLines = song.sections.flatMap((section) => section.lines)
      const matchedLyric = needle
        ? lyricLines.find((line) => searchable(line).includes(needle))
        : undefined
      const score = !needle
        ? 4
        : title === needle
          ? 0
          : title.startsWith(needle)
            ? 1
            : title.includes(needle)
              ? 2
              : artist.includes(needle)
                ? 3
                : matchedLyric
                  ? 4
                  : 99
      return { song, score, matchedLyric }
    }).filter(({ score }) => score < 99)
    ranked.sort((a, b) => a.score - b.score || b.song.updatedAt - a.song.updatedAt || a.song.title.localeCompare(b.song.title))
    return ranked.slice(0, 10)
  }, [query, songs])

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setActiveIndex(0) }, [query])
  useEffect(() => { rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' }) }, [activeIndex])

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(results.length - 1, index + 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(0, index - 1))
      return
    }
    if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault()
      onOpen(results[activeIndex].song)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/55 px-4 pt-[12vh] backdrop-blur-[2px] animate-fade-in motion-reduce:animate-none"
      role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section role="dialog" aria-modal="true" aria-label="Search song library"
        onKeyDown={handleKeyDown}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-white/10 bg-[#191919] shadow-[0_28px_90px_rgba(0,0,0,0.72)] ring-1 ring-black/60 animate-spring-in motion-reduce:animate-none">
        <div className="flex h-14 items-center gap-3 border-b border-white/[0.08] px-4">
          <Search size={21} className="shrink-0 text-zinc-400" aria-hidden="true" />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles, artists, or lyrics…" aria-label="Search songs and lyrics"
            className="min-w-0 flex-1 bg-transparent text-[17px] text-zinc-100 outline-none placeholder:text-zinc-600" />
          <kbd className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-500">ESC</kbd>
          <button type="button" onClick={onClose} aria-label="Close song search" className="grid size-7 place-items-center rounded text-zinc-500 hover:bg-white/5 hover:text-zinc-200"><X size={14} /></button>
        </div>
        <div className="max-h-[min(420px,58vh)] overflow-y-auto p-2">
          {results.length ? results.map(({ song, matchedLyric }, index) => (
            <button key={song.id} ref={(element) => { rowRefs.current[index] = element }} type="button"
              onMouseMove={() => setActiveIndex(index)} onClick={() => onOpen(song)}
              className={cn('group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                index === activeIndex ? 'bg-teal-500/12 text-zinc-50' : 'text-zinc-300 hover:bg-white/[0.04]')}>
              <span className={cn('grid size-8 shrink-0 place-items-center rounded-md', index === activeIndex ? 'bg-teal-500/15 text-teal-300' : 'bg-white/[0.04] text-zinc-500')}>
                <Music2 size={15} weight={index === activeIndex ? 'fill' : 'regular'} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{song.title}</span>
                <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{song.artist || 'Unknown artist'}</span>
                {matchedLyric && (
                  <span className="mt-1 block truncate text-[11px] text-teal-400/75">“{matchedLyric.trim()}”</span>
                )}
              </span>
              {index === activeIndex && <span className="text-[10px] text-zinc-500">↵ Open</span>}
            </button>
          )) : (
            <div className="flex min-h-32 flex-col items-center justify-center px-5 text-center">
              <Music2 size={22} className="text-zinc-700" aria-hidden="true" />
              <p className="mt-3 text-xs font-medium text-zinc-400">No songs found</p>
              <p className="mt-1 text-[11px] text-zinc-600">Try another title, artist, or lyric.</p>
            </div>
          )}
        </div>
        <div className="flex h-9 items-center justify-between border-t border-white/[0.07] px-4 text-[10px] text-zinc-600">
          <span>↑↓ Navigate</span><span>↵ Open song</span>
        </div>
      </section>
    </div>
  )
}
