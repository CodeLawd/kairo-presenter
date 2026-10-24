import { useEffect, useRef, useState } from 'react'
import { BookmarkSimple, ChevronLeft, ChevronRight, Globe, RefreshCw, X } from '@/icons'
import { cn } from '@/lib/utils'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { useProgramState } from '@/hooks/useProgramState'
import { useSidebarWidth } from '@/components/layout/useSidebarWidth'
import { BoothWorkspace } from '@/components/layout/BoothWorkspace'
import { LiveOutputRail } from '@/components/operator/LiveOutputRail'
import { useLiveRailWidth } from '@/components/operator/useLiveRailWidth'
import { ScaledWebFrame } from '@/components/operator/ScaledWebFrame'
import { Switch } from '@/components/ui/switch'
import {
  WEB_PREVIEW_FRAME,
  WEB_SCROLL_MESSAGE,
  displayAddress,
  normalizeWebSettings,
  webAddress,
  type WebSettings,
} from '@shared/web'

const ICON_BUTTON =
  'grid size-8 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-surface-tertiary hover:text-white disabled:opacity-30 disabled:hover:bg-transparent'

interface History {
  entries: string[]
  index: number
}

/**
 * Web: browse a page, then put it on the screens behind the words.
 *
 * Bookmarks on the left; the browser and its preview in the middle, laid out
 * at the screens' width so it shows what the audience sees; the screen
 * controls under it. Screens load their own copy of the same address —
 * while the preview's page is live and "Screens follow" is on, links followed
 * and scrolling here carry over to them. Playback stays with each copy, and
 * the preview is muted (the screens carry the sound).
 *
 * Stays mounted while another page shows, so the site keeps its place.
 */
// `active` is taken for parity with the other kept-mounted pages; nothing here needs it yet.
export default function WebPage(_props: { active?: boolean }): React.ReactElement {
  const sidebar = useSidebarWidth('kairo.web-sidebar-width', 240)
  const liveRail = useLiveRailWidth()
  const live = useProgramState().web
  const settings = normalizeWebSettings(useBootstrapStore((s) => s.settings.web))
  const [history, setHistory] = useState<History>(() => ({ entries: live ? [live.url] : [], index: live ? 0 : -1 }))
  const [src, setSrc] = useState<{ url: string; key: number } | null>(() => (live ? { url: live.url, key: 0 } : null))
  const [address, setAddress] = useState(() => (live ? live.url : ''))
  const [editing, setEditing] = useState(false)
  const [follow, setFollow] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const current = history.index >= 0 ? history.entries[history.index] : null
  const isLive = !!live && !!current && live.url === current

  // The first navigation after a load we started is that load (or its
  // redirect), so it replaces the entry instead of adding one.
  const loading = useRef(false)
  const latest = useRef({ current, live: live?.url ?? null, follow })
  latest.current = { current, live: live?.url ?? null, follow }
  const frame = useRef<HTMLIFrameElement>(null)
  /**
   * Whether the preview's page lays out by the window's height. Until it says
   * (null), and when it doesn't, the preview fills the area with a cut line;
   * when it does, the preview is exactly the screens' shape, or it would lie.
   */
  const [adaptive, setAdaptive] = useState<boolean | null>(null)

  const put = async (url: string | null): Promise<void> => {
    try {
      setError(null)
      await window.api.program.setWeb(url)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // The preview reports its scrolling (script added by the main process); the
  // screens follow while this page is the live one.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (!frame.current || event.source !== frame.current.contentWindow) return
      const data = event.data as { type?: unknown; x?: unknown; y?: unknown; adaptive?: unknown } | null
      if (data?.type !== WEB_SCROLL_MESSAGE || typeof data.x !== 'number' || typeof data.y !== 'number') return
      setAdaptive(data.adaptive === true)
      const { current: here, live: onScreens, follow: following } = latest.current
      if (following && onScreens && onScreens === here) window.api.program.scrollWeb(data.x, data.y)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(
    () =>
      window.api.program.onWebNavigated(({ url }) => {
        const { current: before, live: onScreens, follow: following } = latest.current
        if (url === before) return
        const replace = loading.current
        loading.current = false
        setHistory((h) =>
          replace && h.index >= 0
            ? { entries: h.entries.map((e, i) => (i === h.index ? url : e)), index: h.index }
            : { entries: [...h.entries.slice(0, h.index + 1), url], index: h.index + 1 },
        )
        setAddress(url)
        setAdaptive(null)
        // The page on screens moved on in the preview: take the screens along.
        if (following && onScreens && onScreens === before) void put(url)
      }),
    [],
  )

  const open = (url: string, push = true): void => {
    loading.current = true
    setSrc((s) => ({ url, key: (s?.key ?? 0) + 1 }))
    setAddress(url)
    setAdaptive(null)
    setError(null)
    if (push) setHistory((h) => ({ entries: [...h.entries.slice(0, h.index + 1), url], index: h.index + 1 }))
  }

  const go = (): void => {
    const url = webAddress(address)
    if (url) open(url)
    else setError('Type a web address or something to search for.')
  }

  const step = (by: -1 | 1): void => {
    const index = history.index + by
    const url = history.entries[index]
    if (!url) return
    setHistory((h) => ({ ...h, index }))
    open(url, false)
  }

  const saveBookmarks = (next: WebSettings): void => {
    const normalized = normalizeWebSettings(next)
    useBootstrapStore.getState().patchSettings('web', normalized)
    void window.api.settings.set('web', normalized)
  }
  const bookmarked = !!current && settings.bookmarks.some((b) => b.url === current)
  const toggleBookmark = (): void => {
    if (!current) return
    saveBookmarks({
      bookmarks: bookmarked
        ? settings.bookmarks.filter((b) => b.url !== current)
        : [...settings.bookmarks, { id: crypto.randomUUID(), name: displayAddress(current), url: current }],
    })
  }

  const exact = adaptive === true
  const preview = src ? (
    // Keyed on the load only: switching layout resizes the page, it doesn't reload it.
    <ScaledWebFrame key={src.key} ref={frame} url={src.url} name={WEB_PREVIEW_FRAME} title="Web page preview" interactive fill={!exact} />
  ) : (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-600">
      <Globe size={32} aria-hidden="true" />
      <p className="text-sm">Type a web address or search above</p>
    </div>
  )

  return (
    <BoothWorkspace
      rail={<LiveOutputRail width={liveRail.width} onResizeStart={liveRail.onResizeStart} onResizeKeyDown={liveRail.onResizeKeyDown} />}
    >
      <section className="flex h-full min-h-0 w-full flex-col bg-surface">
        <div ref={sidebar.containerRef} className="flex min-h-0 flex-1">
          <aside
            className="hairline-r flex min-h-0 shrink-0 flex-col bg-surface-secondary"
            style={{ width: sidebar.width }}
            aria-label="Bookmarks"
          >
            {/* As Sermon Notes and Documents do it: one plain card at the top. */}
            <div className="shrink-0 px-3 pt-3">
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg bg-surface-tertiary px-3 py-2.5 text-left transition-colors hover:bg-surface-elevated disabled:opacity-50"
                disabled={!current}
                onClick={toggleBookmark}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-teal-500 text-on-accent">
                  <BookmarkSimple size={15} weight={bookmarked ? 'fill' : 'regular'} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-white">
                    {bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
                  </span>
                  <span className="block truncate text-[11px] text-slate-400">
                    {current ? displayAddress(current) : 'Open a page to save it'}
                  </span>
                </span>
              </button>
            </div>

            <h3 className="shrink-0 px-4 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Bookmarks</h3>
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
              {settings.bookmarks.length === 0 && (
                <li className="px-2 py-1.5 text-xs text-zinc-600">Pages you save show here</li>
              )}
              {settings.bookmarks.map((bookmark) => {
                const onScreens = live?.url === bookmark.url
                return (
                  <li
                    key={bookmark.id}
                    className={cn(
                      'group flex items-center rounded-md',
                      bookmark.url === current ? 'row-selected' : 'hover:bg-surface-tertiary',
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                      title={bookmark.url}
                      onClick={() => open(bookmark.url)}
                    >
                      <Globe size={14} className="shrink-0 text-zinc-500" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-zinc-200">{bookmark.name}</span>
                        <span className="block truncate text-[11px] text-zinc-500">{displayAddress(bookmark.url)}</span>
                      </span>
                      {onScreens && <span className="size-1.5 shrink-0 rounded-full bg-live" aria-label="On screens" />}
                    </button>
                    <button
                      type="button"
                      className="mr-1 grid size-6 shrink-0 place-items-center rounded text-zinc-500 opacity-0 hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`Remove ${bookmark.name}`}
                      onClick={() => saveBookmarks({ bookmarks: settings.bookmarks.filter((b) => b.id !== bookmark.id) })}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>
          <button
            type="button"
            {...sidebar.separatorProps}
            aria-label="Resize bookmarks"
            title="Drag to resize bookmarks · double-click to reset"
            className="z-10 w-1.5 shrink-0 cursor-col-resize bg-surface-secondary hover:bg-surface-elevated focus-visible:bg-surface-elevated focus-visible:outline-none"
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <form
              className="flex shrink-0 items-center gap-1 px-4 pt-3"
              onSubmit={(event) => {
                event.preventDefault()
                go()
              }}
            >
              <button type="button" className={ICON_BUTTON} aria-label="Back" disabled={history.index <= 0} onClick={() => step(-1)}>
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={ICON_BUTTON}
                aria-label="Forward"
                disabled={history.index >= history.entries.length - 1}
                onClick={() => step(1)}
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
              <button type="button" className={ICON_BUTTON} aria-label="Reload" disabled={!current} onClick={() => current && open(current, false)}>
                <RefreshCw size={15} aria-hidden="true" />
              </button>
              <input
                className="input ml-1 h-8 min-w-0 flex-1 py-0 text-[13px]"
                placeholder="Web address or search"
                aria-label="Web address"
                spellCheck={false}
                value={editing ? address : address && displayAddress(address)}
                onFocus={(event) => {
                  setEditing(true)
                  requestAnimationFrame(() => event.target.select())
                }}
                onBlur={() => setEditing(false)}
                onChange={(event) => setAddress(event.target.value)}
              />
            </form>
            {error && <p role="alert" className="shrink-0 px-5 pt-2 text-xs text-red-400">{error}</p>}

            {/* A normal page: the preview fills the area, at the screens' width, and
                scrolls as one long page with a line where the screens end. A page
                that lays out by the window's height: exactly the screens' 1920×1080
                window instead, or the taller preview would show a different layout. */}
            {/* One structure for both, only its styles change, so switching resizes
                the page rather than reloading it. */}
            <div className={cn('flex min-h-0 flex-1 flex-col gap-2 p-4', exact && 'items-center [container-type:size]')}>
              <div
                className={cn(
                  'relative overflow-hidden rounded-lg bg-surface-secondary',
                  exact ? 'aspect-video w-[min(100cqw,calc(100cqh*16/9))] shrink-0' : 'min-h-0 w-full flex-1',
                  isLive && 'ring-2 ring-live',
                )}
              >
                {preview}
              </div>
              {exact && (
                <p className="text-[11px] text-zinc-500">
                  This page arranges itself to fit the window, so the preview shows exactly the screens.
                </p>
              )}
            </div>

            {/* The screen controls, under the preview — as Documents puts Push under its slide. */}
            <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3">
              <p className="min-w-0 truncate text-xs text-zinc-400">
                {live ? (
                  <>
                    <span className="mr-1.5 inline-block size-1.5 rounded-full bg-live align-middle" aria-hidden="true" />
                    <span className="text-zinc-200">On screens:</span> {displayAddress(live.url)}
                  </>
                ) : (
                  'Nothing from the web on screens'
                )}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-zinc-400" title="While the page in the preview is on screens">
                  <Switch size="sm" checked={follow} onCheckedChange={setFollow} aria-label="Screens follow links and scrolling" />
                  Screens follow
                </label>
                {live && (
                  <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => void window.api.program.reloadWeb()}>
                    Reload screens
                  </button>
                )}
                {live && (
                  <button
                    type="button"
                    className={cn('h-8 rounded-md px-3 text-xs font-medium', isLive ? 'bg-live text-white hover:brightness-110' : 'btn-secondary')}
                    onClick={() => void put(null)}
                  >
                    Take down
                  </button>
                )}
                {!isLive && (
                  <button
                    type="button"
                    className="btn-primary h-8 px-3.5 text-xs disabled:opacity-40"
                    disabled={!current}
                    onClick={() => current && void put(current)}
                  >
                    Show on screens
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </BoothWorkspace>
  )
}

