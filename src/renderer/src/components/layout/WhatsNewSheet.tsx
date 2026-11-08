import { useShallow } from "zustand/react/shallow";
import { useCallback, useEffect, useState } from 'react'
import {
  BookOpen,
  Broadcast,
  Cloud,
  FileText,
  FilmStrip,
  Lightbulb,
  Lightning,
  Monitor,
  MusicNotes,
  Palette,
  type Icon,
} from '@phosphor-icons/react'
import type { ChangelogEntry, ChangelogHighlight } from '../../../../../website/src/lib/changelog'
import { hueStyle, type Hue } from '@/lib/hue'
import { useAppStore } from '@/stores/useAppStore'
import {
  CHANGELOG_URL,
  WHATS_NEW_EVENT,
  entryAfterUpdate,
  entryOnRequest,
} from '@/lib/whats-new'

const WHATS_NEW_ICONS: Record<ChangelogHighlight['icon'], { icon: Icon; hue: Hue }> = {
  operator: { icon: Broadcast, hue: 'green' },
  scripture: { icon: BookOpen, hue: 'blue' },
  lyrics: { icon: MusicNotes, hue: 'violet' },
  documents: { icon: FileText, hue: 'cyan' },
  theme: { icon: Palette, hue: 'pink' },
  media: { icon: FilmStrip, hue: 'orange' },
  screens: { icon: Monitor, hue: 'indigo' },
  cloud: { icon: Cloud, hue: 'blue' },
  speed: { icon: Lightning, hue: 'coral' },
  tip: { icon: Lightbulb, hue: 'lime' },
}

// Optional chaining: tests load this outside Vite, where import.meta.env is absent.
const DEV = Boolean(import.meta.env?.DEV)
/** `VITE_WHATS_NEW_PREVIEW=1 npm run dev` opens the draft on launch. */
const PREVIEW_ON_LAUNCH = DEV && Boolean(import.meta.env?.VITE_WHATS_NEW_PREVIEW)
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

/**
 * "What's New in Kairo" — shown once on the first launch after an update,
 * like ProPresenter's and Apple's sheets, and any time from the app menu.
 * Reads the same changelog as the public /changelog page. Waits out a live
 * session so it never covers the operator mid-service.
 */
export default function WhatsNewSheet({ suppressed = false }: { suppressed?: boolean }): React.ReactElement | null {
  const [entry, setEntry] = useState<ChangelogEntry | null>(null)
  const [auto, setAuto] = useState<ChangelogEntry | null>(null)
  const { isTranscribing, liveOutputLabel } = useAppStore(useShallow((state) => ({ isTranscribing: state.isTranscribing, liveOutputLabel: state.liveOutputLabel })))
  const isLive = isTranscribing || Boolean(liveOutputLabel?.trim())

  // After an update: compare with the last version shown. Dev builds never
  // auto-show or record anything, so a dev run can't eat a real release's sheet.
  useEffect(() => {
    if (PREVIEW_ON_LAUNCH) {
      setAuto(entryOnRequest(APP_VERSION, true))
      return
    }
    if (DEV) return
    let cancelled = false
    void window.api.settings.get('whatsNew').then((saved) => {
      if (cancelled) return
      const lastSeen = saved?.lastSeenVersion ?? ''
      const next = entryAfterUpdate(lastSeen, APP_VERSION)
      if (next) setAuto(next)
      // Fresh install, or an update with no notes: nothing to show, just remember.
      else if (lastSeen !== APP_VERSION) void window.api.settings.set('whatsNew', { lastSeenVersion: APP_VERSION })
    })
    return () => { cancelled = true }
  }, [])

  // The auto sheet waits for setup and live sessions to clear.
  useEffect(() => {
    if (!auto || suppressed || isLive || entry) return
    setEntry(auto)
    setAuto(null)
    // Count it as seen the moment it shows, so quitting with it open
    // doesn't bring it back next launch.
    if (!DEV) void window.api.settings.set('whatsNew', { lastSeenVersion: APP_VERSION })
  }, [auto, suppressed, isLive, entry])

  useEffect(() => {
    const open = (): void => setEntry(entryOnRequest(APP_VERSION, DEV))
    window.addEventListener(WHATS_NEW_EVENT, open)
    const unsub = window.api.app.onWhatsNewRequested(open)
    return () => { window.removeEventListener(WHATS_NEW_EVENT, open); unsub() }
  }, [])

  const close = useCallback(() => {
    setEntry(null)
    setAuto(null)
    if (!DEV) void window.api.settings.set('whatsNew', { lastSeenVersion: APP_VERSION })
  }, [])

  useEffect(() => {
    if (!entry) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [entry, close])

  if (!entry) return null
  const unreleased = DEV && entry.version !== APP_VERSION

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 p-6 animate-fade-in"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[min(720px,90vh)] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl modal-glass animate-spring-in motion-reduce:animate-none"
      >
        <header className="px-10 pb-6 pt-10 text-center">
          <h1 id="whats-new-title" className="text-[28px] font-semibold tracking-tight text-zinc-100">
            What's New in Kairo
          </h1>
          <p className="mt-1.5 text-[13px] text-zinc-400">
            Version {entry.version} · {formatDate(entry.date)}
            {unreleased && <span className="ml-2 rounded bg-surface-tertiary px-1.5 py-0.5 text-[11px] text-zinc-300">Preview · not released</span>}
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-12 pb-6">
          {entry.highlights?.length ? (
            <ul className="space-y-7">
              {entry.highlights.map((h) => {
                const mark = WHATS_NEW_ICONS[h.icon] ?? WHATS_NEW_ICONS.tip
                const Glyph = mark.icon
                return (
                  <li key={h.title} className="flex gap-5">
                    <Glyph
                      size={36}
                      weight="fill"
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-[rgb(var(--hue))]"
                      style={hueStyle(mark.hue)}
                    />
                    <div className="min-w-0">
                      <h2 className="text-[16px] font-semibold text-zinc-100">{h.title}</h2>
                      <p className="mt-1 text-[13.5px] leading-relaxed text-zinc-300">{h.body}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <>
              <h2 className="mb-3 text-[16px] font-semibold text-zinc-100">{entry.title}</h2>
              <ul className="list-disc space-y-2.5 pl-5 text-[13.5px] leading-relaxed text-zinc-300 marker:text-zinc-500">
                {entry.notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            </>
          )}
          <p className="mt-8 text-center">
            <a href={CHANGELOG_URL} target="_blank" rel="noreferrer" className="text-[13px] text-teal-400 hover:underline">
              View full release notes
            </a>
          </p>
        </div>

        <footer className="hairline-t flex justify-center bg-surface-secondary px-6 py-4">
          <button type="button" autoFocus onClick={close} className="btn-primary min-w-[140px] justify-center">
            Continue
          </button>
        </footer>
      </div>
    </div>
  )
}
