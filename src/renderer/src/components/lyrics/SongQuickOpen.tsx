import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Globe, ListMusic, Loader2, Music2, Search, X } from '@/icons'
import { cn } from '@/lib/utils'
import { activeSetlist, runSetlistCommand, startSongDrag, useSetlistStore } from '@/stores/useSetlist'
import { startLibraryItemDrag } from '@/stores/useLibraries'
import { DEFAULT_SETLIST_NAME } from '@shared/setlist'
import { formatOnlineLyricsError } from '@shared/lyrics-online-error'
import type { LyricsOnlinePreview, LyricsOnlineResult, LyricsSong } from '@shared/ipc'

/** Shortest query worth sending to the catalogues. */
const MIN_ONLINE_QUERY = 3

/**
 * A row in the result list: a song in the library, or a hit from the web that
 * would have to be imported first.
 */
type QuickOpenRow =
  | { kind: 'local'; key: string; song: LyricsSong; matchedLyric?: string }
  | { kind: 'online'; key: string; result: LyricsOnlineResult }

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
    // With nothing typed this is the whole library, A–Z, so it can be scanned.
    // With a query, best match first.
    ranked.sort((a, b) =>
      needle
        ? a.score - b.score || a.song.title.localeCompare(b.song.title)
        : a.song.title.localeCompare(b.song.title))
    return ranked
  }, [query, songs])

  // ── The web tier, for when the library does not have it ──────────────────
  const [onlineResults, setOnlineResults] = useState<LyricsOnlineResult[]>([])
  const [onlineSearching, setOnlineSearching] = useState(false)
  const [onlineError, setOnlineError] = useState<string | null>(null)
  const [onlinePreview, setOnlinePreview] = useState<LyricsOnlinePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  /** Guards against a slow earlier response overwriting a newer one. */
  const searchSeq = useRef(0)
  const previewSeq = useRef(0)

  const canSearchWeb = query.trim().length >= MIN_ONLINE_QUERY

  /**
   * Searches the catalogues, on the operator's word.
   *
   * Deliberately not automatic: every keystroke would be a request to three
   * providers, and mid-service the library is nearly always the answer — the
   * web is the fallback you reach for, not the one you get handed.
   */
  const searchWeb = useCallback((): void => {
    const needle = query.trim()
    if (needle.length < MIN_ONLINE_QUERY) return
    const seq = ++searchSeq.current
    setOnlineSearching(true)
    setOnlineError(null)
    window.api.lyrics
      .searchOnline(needle)
      .then((hits) => {
        if (searchSeq.current !== seq) return
        setOnlineResults(hits)
        if (hits.length === 0) setOnlineError('Nothing found online for that.')
      })
      .catch((err: Error) => {
        if (searchSeq.current !== seq) return
        setOnlineResults([])
        setOnlineError(formatOnlineLyricsError(err))
      })
      .finally(() => { if (searchSeq.current === seq) setOnlineSearching(false) })
  }, [query])

  // A new query drops the old web hits — they answered a different question.
  useEffect(() => {
    searchSeq.current++
    setOnlineResults([])
    setOnlineError(null)
    setOnlineSearching(false)
  }, [query])

  /** Library first, web underneath — the local copy is always the right answer. */
  const rows = useMemo<QuickOpenRow[]>(() => [
    ...results.map(({ song, matchedLyric }) => ({
      kind: 'local' as const, key: song.id, song, matchedLyric,
    })),
    ...onlineResults.map((result) => ({ kind: 'online' as const, key: result.id, result })),
  ], [results, onlineResults])

  const activeRow = rows[activeIndex] ?? null
  const active = activeRow?.kind === 'local' ? activeRow.song : null
  /** The flyout stays shut until a row is actually chosen — the list alone is
   *  what an operator scans, and a panel opening under the cursor is noise. */
  const [previewOpen, setPreviewOpen] = useState(false)

  // A new query is a new question; close the panel rather than leave a stale
  // song beside an unrelated list.
  useEffect(() => { setPreviewOpen(false) }, [query])

  // Fetching a web hit's lyrics is a click away from importing it, so it only
  // happens for the row being previewed.
  useEffect(() => {
    if (!previewOpen || activeRow?.kind !== 'online') {
      setOnlinePreview(null)
      setPreviewLoading(false)
      return
    }
    const { result } = activeRow
    const seq = ++previewSeq.current
    setOnlinePreview(null)
    setPreviewLoading(true)
    window.api.lyrics
      .previewOnline({ provider: result.provider, url: result.url, title: result.title, artist: result.artist })
      .then((data) => { if (previewSeq.current === seq) setOnlinePreview(data) })
      .catch((err: Error) => {
        if (previewSeq.current !== seq) return
        setOnlinePreview(null)
        setOnlineError(formatOnlineLyricsError(err))
      })
      .finally(() => { if (previewSeq.current === seq) setPreviewLoading(false) })
  }, [activeRow, previewOpen])

  /** Imports a web hit into the library, then opens it like any other song. */
  const importOnline = useCallback(async (result: LyricsOnlineResult): Promise<void> => {
    setImportingId(result.id)
    setOnlineError(null)
    try {
      const song = await window.api.lyrics.import({
        type: 'online',
        provider: result.provider,
        url: result.url,
        title: result.title,
        artist: result.artist,
      })
      onOpen(song)
    } catch (err) {
      setOnlineError(formatOnlineLyricsError(err))
    } finally {
      setImportingId(null)
    }
  }, [onOpen])

  /** Enter on either kind of row: open the song, or fetch then open it. */
  const openRow = useCallback((row: QuickOpenRow): void => {
    if (row.kind === 'local') onOpen(row.song)
    else void importOnline(row.result)
  }, [onOpen, importOnline])
  const setlist = useSetlistStore((state) => activeSetlist(state))
  const [added, setAdded] = useState<string | null>(null)

  /** Queue the song on the active setlist without leaving the search. */
  const addToSetlist = (song: LyricsSong): void => {
    // With no setlist yet, start one rather than refusing the first add.
    const queue = setlist
      ? Promise.resolve()
      : runSetlistCommand({ action: 'create', name: DEFAULT_SETLIST_NAME })
    void queue
      .then(() => runSetlistCommand({ action: 'add', songId: song.id }))
      .then(() => setAdded(song.id))
      .catch(() => undefined)
  }
  const previewRef = useRef<HTMLDivElement>(null)
  /** While a song is being dragged the finder steps aside, so the sidebar's
   *  libraries and setlists underneath can take the drop. */
  const [dragging, setDragging] = useState(false)

  useEffect(() => { inputRef.current?.focus() }, [])
  // Each song's preview starts at the top, not where the last one was left.
  useEffect(() => { previewRef.current?.scrollTo({ top: 0 }) }, [activeRow?.key])
  useEffect(() => { setActiveIndex(0) }, [query])
  useEffect(() => { rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' }) }, [activeIndex])

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(rows.length - 1, index + 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(0, index - 1))
      return
    }
    if (event.key === 'Enter' && activeRow) {
      event.preventDefault()
      // Cmd/Ctrl+Enter queues for the service; plain Enter opens the song.
      // A web hit has to be imported before it can be queued, so it opens.
      if ((event.metaKey || event.ctrlKey) && activeRow.kind === 'local') addToSetlist(activeRow.song)
      else openRow(activeRow)
      return
    }
    // Nothing matched locally: ⌘↵ (or ↵) sends the query to the web instead.
    if (event.key === 'Enter' && !activeRow && canSearchWeb && !onlineSearching) {
      event.preventDefault()
      searchWeb()
    }
  }

  return (
    <div className={cn(
        'fixed inset-0 z-[100] flex items-start justify-center bg-black/50 px-4 pt-[10vh] animate-fade-in motion-reduce:animate-none transition-opacity duration-150',
        // During a drag the dim lifts and the finder lets the pointer through
        // to the sidebar, but stays visible so you can see what you picked up.
        dragging && 'pointer-events-none bg-transparent [&_section]:opacity-60 [&_aside]:opacity-0',
      )}
      role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="flex w-full max-w-5xl items-start justify-center gap-3" onKeyDown={handleKeyDown}>
      <section role="dialog" aria-modal="true" aria-label="Search song library"
        className="flex w-[30rem] shrink-0 flex-col overflow-hidden rounded-xl bg-[#1c1c1e] animate-spring-in motion-reduce:animate-none">
        <div className="flex h-12 shrink-0 items-center gap-2.5 px-3.5">
          <Search size={17} className="shrink-0 text-zinc-500" aria-hidden="true" />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles, artists or lyrics" aria-label="Search songs and lyrics"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-zinc-100 outline-none placeholder:text-zinc-600" />
          {query && (
            <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus() }} aria-label="Clear search"
              className="grid size-6 place-items-center rounded text-zinc-500 hover:bg-surface-tertiary hover:text-zinc-200"><X size={13} /></button>
          )}
        </div>

        <div className="flex min-h-0 h-[min(560px,70vh)] flex-col">
          <p className="shrink-0 px-3.5 pb-1 pt-2 text-[11px] text-zinc-500">
            {query.trim()
              ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}`
              : `${results.length} ${results.length === 1 ? 'song' : 'songs'}`}
          </p>
          {/* Results. A click previews; opening is a deliberate second act —
              the wrong song going live is worse than one extra keystroke. */}
          <div className="flex-1 overflow-y-auto px-1.5 pb-1.5">
            {rows.length ? rows.map((row, index) => {
              const isActive = index === activeIndex
              const first = row.kind === 'online' && rows[index - 1]?.kind !== 'online'
              return (
                <div key={row.key}>
                  {first && (
                    <p className="flex items-center gap-1.5 px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                      <Globe size={10} aria-hidden="true" /> From the web
                    </p>
                  )}
                  <button ref={(element) => { rowRefs.current[index] = element }} type="button"
                    draggable={row.kind === 'local'}
                    onDragStart={(event) => {
                      if (row.kind !== 'local') return
                      startSongDrag(event, row.song.id, row.song.title)
                      startLibraryItemDrag(event, row.song.id, row.song.title, 'songs')
                      // After the drag image is captured, or the drag is cancelled.
                      setTimeout(() => setDragging(true), 0)
                    }}
                    onDragEnd={() => setDragging(false)}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => { setActiveIndex(index); setPreviewOpen(true) }}
                    onDoubleClick={() => openRow(row)}
                    aria-current={isActive}
                    className={cn('group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
                      isActive ? 'row-selected' : 'text-zinc-300')}>
                    {row.kind === 'local'
                      ? <Music2 size={13} className="shrink-0 text-zinc-500" aria-hidden="true" />
                      : <Globe size={13} className="shrink-0 text-zinc-500" aria-hidden="true" />}
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className="truncate text-[13px] text-zinc-100">
                          {row.kind === 'local' ? row.song.title : row.result.title}
                        </span>
                        <span className="shrink truncate text-[11px] text-zinc-500">
                          {row.kind === 'local'
                            ? row.song.artist
                            : `${row.result.artist || 'Unknown artist'} · ${row.result.provider}`}
                        </span>
                      </span>
                      {row.kind === 'local' && row.matchedLyric && (
                        <span className="block truncate text-[11px] text-zinc-400">“{row.matchedLyric.trim()}”</span>
                      )}
                      {row.kind === 'online' && row.result.snippet && (
                        <span className="block truncate text-[11px] text-zinc-400">“{row.result.snippet.trim()}”</span>
                      )}
                    </span>
                    {row.kind === 'local' && setlist?.songIds.includes(row.song.id) && (
                      <ListMusic size={12} className="shrink-0 text-teal-400/70" aria-label={`On ${setlist.name}`} />
                    )}
                    {row.kind === 'online' && importingId === row.result.id && (
                      <Loader2 size={12} className="shrink-0 animate-spin text-teal-300" aria-label="Importing" />
                    )}
                  </button>
                </div>
              )
            }) : (
              <div className="flex min-h-32 flex-col items-center justify-center px-5 text-center">
                {onlineSearching ? (
                  <>
                    <Loader2 size={20} className="animate-spin text-teal-400" aria-hidden="true" />
                    <p className="mt-3 text-xs font-medium text-zinc-400">Searching the web…</p>
                  </>
                ) : (
                  <>
                    <Music2 size={22} className="text-zinc-700" aria-hidden="true" />
                    <p className="mt-3 text-xs font-medium text-zinc-400">Not in your library</p>
                    <p className="mt-1 text-[11px] text-zinc-600">
                      {onlineError ?? 'Try another title, artist, or lyric.'}
                    </p>
                  </>
                )}
              </div>
            )}

            {/* The web is a fallback the operator reaches for, so it waits to be
                asked rather than firing on every keystroke. */}
            {canSearchWeb && !onlineSearching && onlineResults.length === 0 && (
              <button
                type="button"
                onClick={searchWeb}
                className="mt-1 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-zinc-300 transition-colors hover:bg-surface-tertiary"
              >
                <Globe size={13} className="shrink-0 text-zinc-500" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">
                    Search the web for “{query.trim()}”
                  </span>
                </span>
                <kbd className="shrink-0 rounded bg-surface-tertiary px-1.5 py-0.5 text-[10px] text-zinc-500">⌘↵</kbd>
              </button>
            )}

            {onlineSearching && rows.length > 0 && (
              <p className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-zinc-600">
                <Loader2 size={11} className="animate-spin" aria-hidden="true" /> Searching the web…
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 text-[11px] text-zinc-500">
            <span><kbd className="font-sans text-zinc-400">↑↓</kbd> move</span>
            <span><kbd className="font-sans text-zinc-400">↵</kbd> open</span>
            <span><kbd className="font-sans text-zinc-400">⌘↵</kbd> add to setlist</span>
            <span className="ml-auto">Drag a song onto a library or setlist</span>
          </div>
        </div>
      </section>

      {/* Reading a song is a second step, like ProPresenter: the panel flies
          out beside the list once a row is chosen, instead of taking half the
          window before anything is picked. */}
      {previewOpen && activeRow && (
        <aside
          aria-label="Song preview"
          className="flex h-[min(520px,68vh)] w-[28rem] shrink-0 flex-col overflow-hidden rounded-xl bg-[#1d1d1d] ring-1 ring-black/60 animate-spring-in motion-reduce:animate-none"
        >
              <div ref={previewRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4 select-text" aria-live="polite">
                {activeRow?.kind === 'online' ? (
                  <>
                    <h2 className="text-[17px] font-semibold tracking-tight text-zinc-50">{activeRow.result.title}</h2>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
                      <Globe size={11} aria-hidden="true" />
                      {activeRow.result.artist || 'Unknown artist'} · {activeRow.result.provider}
                      {activeRow.result.existingSongId && <span className="text-teal-400/80">· already in your library</span>}
                    </p>
                    {previewLoading ? (
                      <p className="mt-6 flex items-center gap-2 text-[12px] text-zinc-500">
                        <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Fetching lyrics…
                      </p>
                    ) : onlinePreview ? (
                      <div className="mt-4 space-y-4">
                        {onlinePreview.sections.map((section, index) => (
                          <div key={`${section.label}-${index}`}>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                              {section.label || section.type}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-300">
                              {section.lines.join('\n')}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-6 text-[12px] text-zinc-600">
                        {onlineError ?? 'Could not read the lyrics on that page.'}
                      </p>
                    )}
                  </>
                ) : active ? (
                  <>
                    <h2 className="text-[17px] font-semibold tracking-tight text-zinc-50">{active.title}</h2>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {active.artist || 'Unknown artist'}
                      {active.sections.length ? <span> · {active.sections.length} sections</span> : null}
                    </p>
                    {active.sections.length ? (
                      <div className="mt-4 space-y-4">
                        {active.sections.map((section, index) => (
                          <div key={`${section.label}-${index}`}>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                              {section.label || section.type}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-300">
                              {section.lines.join('\n')}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-6 text-[12px] text-zinc-600">This song has no lyrics saved yet.</p>
                    )}
                  </>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <Music2 size={22} className="text-zinc-700" aria-hidden="true" />
                    <p className="mt-3 text-[12px] text-zinc-600">Select a song to preview its lyrics.</p>
                  </div>
                )}
              </div>
          <div className="flex shrink-0 items-center justify-end gap-2 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!active}
                title={activeRow?.kind === 'online' ? 'Import the song first' : undefined}
                onClick={() => active && addToSetlist(active)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-surface-tertiary hover:text-zinc-100 disabled:opacity-40"
              >
                {active && added === active.id ? 'Added' : setlist ? `Add to ${setlist.name}` : 'Add to setlist'}
                <kbd className="font-sans text-[10px] opacity-60">⌘↵</kbd>
              </button>
              <button
                type="button"
                disabled={!activeRow || importingId !== null}
                onClick={() => activeRow && openRow(activeRow)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-teal-500 px-3 text-[11px] font-semibold text-[#111827] transition-colors hover:bg-teal-400 disabled:opacity-40"
              >
                {activeRow?.kind === 'online' ? (
                  importingId === activeRow.result.id ? (
                    <><Loader2 size={11} className="animate-spin" aria-hidden="true" /> Importing</>
                  ) : (
                    <><Download size={11} aria-hidden="true" /> Import &amp; open</>
                  )
                ) : (
                  'Open'
                )}
                <kbd className="font-sans text-[10px] opacity-70">↵</kbd>
              </button>
            </div>
          </div>
        </aside>
      )}
      </div>
    </div>
  )
}
