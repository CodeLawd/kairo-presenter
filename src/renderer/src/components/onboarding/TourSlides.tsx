import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { BookOpen, Film, Search } from '@/icons'

/**
 * The welcome tour: one large headline per slide, three short bullets, and an
 * HTML illustration with accent callouts — ProPresenter's welcome window, made
 * about Kairo. Illustrations are explanatory mock-ups, never live previews.
 *
 * Motion is CSS (see onboarding.css): content staggers in from the direction of
 * travel, the illustration travels further than the text, and each mock-up plays
 * one small story (select → present, type → result, countdown).
 */
export interface TourSlide {
  id: string
  headline: string
  subhead: string
  bullets: string[]
  art: () => React.ReactElement
}

export const TOUR_SLIDES: TourSlide[] = [
  {
    id: 'present',
    headline: 'Present',
    subhead: 'your whole service from one place',
    bullets: [
      'Build a playlist for the run of service',
      'Send scripture, songs and media to the screen',
      'Clear text or background in one click',
    ],
    art: PresentArt,
  },
  {
    id: 'scripture',
    headline: 'Scripture',
    subhead: 'any verse, in seconds',
    bullets: [
      'Type a reference or search by words',
      'Catch references as they are spoken',
      'Offline translations work with no setup',
    ],
    art: ScriptureArt,
  },
  {
    id: 'songs',
    headline: 'Songs',
    subhead: 'lyrics ready for every service',
    bullets: [
      'Search and import lyrics',
      'Arrange verses, choruses and bridges',
      'Your library lives in a folder you own',
    ],
    art: SongsArt,
  },
  {
    id: 'documents',
    headline: 'Documents',
    subhead: 'sermon slides and handouts, ready to show',
    bullets: [
      'Import PowerPoint and PDF files',
      'Videos inside your slides play too',
      'Step through pages live, one click each',
    ],
    art: DocumentsArt,
  },
  {
    id: 'style',
    headline: 'Themes & Media',
    subhead: 'make every slide look like your church',
    bullets: [
      'Design themes for scripture and lyrics',
      'Keep backgrounds and videos in one dock',
      'Change the look without touching content',
    ],
    art: StyleArt,
  },
  {
    id: 'screens',
    headline: 'Screens',
    subhead: 'audience and stage, set up your way',
    bullets: [
      'Audience screens for the room',
      'Stage displays with next slide, clock and timer',
      'Style each screen with its own theme',
    ],
    art: ScreensArt,
  },
]

/** Stagger index and optional group delay, as CSS custom properties. */
const at = (i: number, base = 0): CSSProperties => ({ '--i': i, '--base': `${base}ms` }) as CSSProperties

/**
 * Shows the current slide and, for one exit animation, the slide it replaced.
 * The outgoing slide keeps its key so it is not remounted (which would replay
 * its entrance); `--dir` on the stage steers both the exit and the entrance.
 */
export function TourStage({ index, dir }: { index: number; dir: 1 | -1 }): React.ReactElement {
  const [view, setView] = useState<{ index: number; leaving: number | null }>({ index, leaving: null })
  if (view.index !== index) setView({ index, leaving: view.index })

  useEffect(() => {
    if (view.leaving === null) return
    const timer = setTimeout(() => setView((v) => ({ ...v, leaving: null })), 320)
    return () => clearTimeout(timer)
  }, [view.leaving, view.index])

  const shown = view.leaving !== null && view.leaving !== index ? [view.leaving, index] : [index]
  return (
    <div className="onboarding-stage" style={{ '--dir': dir } as CSSProperties}>
      {shown.map((i) => <TourSlideView key={TOUR_SLIDES[i].id} slide={TOUR_SLIDES[i]} leaving={i !== index} />)}
    </div>
  )
}

function TourSlideView({ slide, leaving }: { slide: TourSlide; leaving: boolean }): React.ReactElement {
  const Art = slide.art
  return (
    <div className={`onboarding-slide${leaving ? ' is-leaving' : ''}`} aria-hidden={leaving || undefined}>
      <div className="min-w-0">
        <h2 id={leaving ? undefined : 'onboarding-slide-title'} className="onboarding-headline ob-in" style={at(0)}>{slide.headline}</h2>
        <p className="onboarding-subhead ob-in" style={at(1)}>{slide.subhead}</p>
        <ul className="mt-9 space-y-3.5 text-[17px] text-slate-300">
          {slide.bullets.map((text, i) => (
            <li key={text} className="ob-in flex items-start gap-3" style={at(i + 3)}>
              <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
              {text}
            </li>
          ))}
        </ul>
      </div>
      <div className="onboarding-slide-art" aria-hidden="true"><Art /></div>
    </div>
  )
}

// ─── Illustration helpers ───────────────────────────────────────────────────

function useReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Types `text` one character at a time after `delay` ms; whole at once under reduced motion. */
function useTypewriter(text: string, delay: number, speed = 80): string {
  const reduced = useReducedMotion()
  const [count, setCount] = useState(reduced ? text.length : 0)
  useEffect(() => {
    if (reduced) return
    let interval: ReturnType<typeof setInterval> | undefined
    const start = setTimeout(() => {
      interval = setInterval(() => setCount((n) => {
        if (n + 1 >= text.length && interval) clearInterval(interval)
        return Math.min(text.length, n + 1)
      }), speed)
    }, delay)
    return () => { clearTimeout(start); if (interval) clearInterval(interval) }
  }, [text, delay, speed, reduced])
  return text.slice(0, count)
}

/** A seconds counter running down from `from` while the slide is shown. */
function useCountdown(from: number): string {
  const reduced = useReducedMotion()
  const [left, setLeft] = useState(from)
  useEffect(() => {
    if (reduced) return
    const timer = setInterval(() => setLeft((n) => (n > 0 ? n - 1 : from)), 1000)
    return () => clearInterval(timer)
  }, [from, reduced])
  return `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`
}

function Window({ title, base, children }: { title?: string; base: number; children: ReactNode }): React.ReactElement {
  return (
    <div className="onboarding-window ob-in" style={at(0, base)}>
      <div className="onboarding-window-bar">
        <i /><i /><i />
        {title && <span className="ml-2 text-[10px] text-slate-500">{title}</span>}
      </div>
      {children}
    </div>
  )
}

function Callout({ base, children }: { base: number; children: ReactNode }): React.ReactElement {
  // One text run beside the accent line — loose text and <b> must not become
  // separate flex items, or the gap splits the sentence apart.
  return <p className="onboarding-callout ob-in" style={at(0, base)}><span>{children}</span></p>
}

// ─── Illustrations ──────────────────────────────────────────────────────────

/** Rows arrive, the scripture item is selected, then it lands on the audience slide. */
function PresentArt(): React.ReactElement {
  const items = ['Welcome', 'Way Maker', 'Goodness of God', 'John 3:16–17', 'Sermon', 'Closing']
  return (
    <>
      <Callout base={260}>Build a <b>playlist</b> to set your run of service</Callout>
      <Window title="Operator" base={120}>
        <div className="grid grid-cols-[40%_1fr] gap-3 pr-3">
          <div className="onboarding-window-side">
            <p className="px-1.5 pb-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-500">Sunday Morning</p>
            {items.map((name, i) => (
              <div key={name} className="ob-rise" style={at(i, 300)}>
                <div className={`rounded px-1.5 py-1.5 ${i === 3 ? 'ob-select bg-teal-500 text-on-accent' : ''}`} style={i === 3 ? at(0, 900) : undefined}>{name}</div>
              </div>
            ))}
          </div>
          <div className="pb-3">
            <div className="onboarding-audience-slide ob-pop border-2 border-live px-4" style={at(0, 1050)}>
              <p className="font-serif text-[13px] leading-snug">For God so loved the world, that he gave his only begotten Son</p>
              <p className="mt-2 text-[8px] uppercase tracking-[0.18em] text-slate-400">John 3:16</p>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {['#313E4C', '#232B31', '#36362D'].map((bg, i) => <div key={bg} className="ob-pop aspect-video rounded-sm" style={{ ...at(i, 450), background: bg }} />)}
            </div>
          </div>
        </div>
      </Window>
      <Callout base={1150}>See exactly what the <b>room</b> sees</Callout>
    </>
  )
}

/** The search types itself, results follow, then a spoken reference is caught. */
function ScriptureArt(): React.ReactElement {
  const query = 'rom 8 28'
  const typed = useTypewriter(query, 500)
  const done = typed.length === query.length
  return (
    <>
      <Window title="Scripture" base={120}>
        <div className="px-3 pb-3">
          <div className="flex items-center gap-2 rounded-md bg-surface-tertiary px-2.5 py-2">
            <Search size={12} className="text-slate-500" />
            <span className="flex-1 text-slate-200">{typed}<span className="ob-caret" /></span>
            <span className="rounded bg-surface-elevated px-1.5 py-0.5 text-[9px] text-slate-400">KJV</span>
          </div>
          <div className="min-h-[150px]">
            {done && [
              ['Romans 8:28', 'And we know that all things work together for good…'],
              ['Romans 8:29', 'For whom he did foreknow, he also did predestinate…'],
              ['Romans 8:30', 'Moreover whom he did predestinate, them he also called…'],
            ].map(([ref, text], i) => (
              <div key={ref} className={`ob-rise mt-1 rounded px-2.5 py-2 ${i === 0 ? 'bg-surface-elevated' : ''}`} style={at(i)}>
                <p className="font-semibold text-slate-200">{ref}</p>
                <p className="truncate text-slate-500">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </Window>
      <Callout base={300}>Look up a verse <b>by reference or by words</b></Callout>
      <div className="ob-in flex items-center gap-3 rounded-md bg-surface-secondary px-3 py-2.5 text-[12px]" style={at(0, 1500)}>
        <BookOpen size={14} className="shrink-0 text-teal-400" />
        <span className="min-w-0 flex-1 truncate text-slate-400">“…turn with me to <span className="text-slate-200">Psalm 23</span>”</span>
        <span className="ob-pop shrink-0 rounded bg-surface-tertiary px-2 py-0.5 text-slate-300" style={at(0, 1900)}>Psalm 23:1</span>
      </div>
      <Callout base={1700}>Kairo <b>hears the reference</b> and queues it up</Callout>
    </>
  )
}

/** The song is picked, then its arrangement deals out slide by slide. */
function SongsArt(): React.ReactElement {
  const groups: Array<[string, string]> = [
    ['Verse 1', '#3B63D9'], ['Chorus', '#C8372D'], ['Verse 2', '#3B63D9'],
    ['Chorus', '#C8372D'], ['Bridge', '#7C3AED'], ['Chorus', '#C8372D'],
  ]
  return (
    <>
      <Callout base={260}>Every song, <b>searchable</b> in your library</Callout>
      <Window title="Lyrics" base={120}>
        <div className="grid grid-cols-[34%_1fr]">
          <div className="onboarding-window-side">
            {['Amazing Grace', 'Goodness of God', 'Way Maker', 'Build My Life'].map((name, i) => (
              <div key={name} className="ob-rise" style={at(i, 300)}>
                <div className={`truncate rounded px-1.5 py-1.5 ${i === 2 ? 'ob-select bg-surface-elevated text-slate-200' : ''}`} style={i === 2 ? at(0, 650) : undefined}>{name}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5 p-2.5 pt-0">
            {groups.map(([label, color], i) => (
              <div key={i} className="ob-pop overflow-hidden rounded-sm" style={at(i, 750)}>
                <div className="flex aspect-video items-center justify-center bg-ink px-1 text-center font-serif text-[7px] leading-tight text-white">
                  {i % 2 ? 'Way maker, miracle worker' : 'You are here, moving in our midst'}
                </div>
                <div className="px-1 py-0.5 text-[8px] text-white" style={{ background: color }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </Window>
      <Callout base={1200}>Arrange <b>verses and choruses</b> the way your team sings them</Callout>
    </>
  )
}

/** A deck's pages arrive; the current one is outlined as live and steps on. */
function DocumentsArt(): React.ReactElement {
  const pages: Array<{ title: string; bg: string; video?: boolean }> = [
    { title: 'Welcome', bg: '#232B31' },
    { title: 'Walking in Faith', bg: '#313E4C' },
    { title: 'Hebrews 11:1', bg: '#36362D' },
    { title: 'Testimony', bg: '#292922', video: true },
    { title: 'Three Steps', bg: '#232B31' },
    { title: 'Next Week', bg: '#313E4C' },
  ]
  return (
    <>
      <Callout base={260}>Bring in <b>PowerPoint and PDF</b> as they are</Callout>
      <Window title="Documents · Sunday Sermon.pptx" base={120}>
        <div className="px-3 pb-3">
          <div className="onboarding-audience-slide ob-pop mb-2 px-4" style={{ ...at(0, 400), background: '#313E4C' }}>
            <p className="text-[8px] uppercase tracking-[0.2em] text-[#A29F96]">Part one</p>
            <p className="mt-1 text-[15px] font-semibold">Walking in Faith</p>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {pages.map((page, i) => (
              <div
                key={page.title}
                className={`ob-pop relative flex aspect-[4/3] items-center justify-center rounded-sm px-0.5 text-center text-[6px] leading-tight text-[#ECECE9] ${i === 1 ? 'outline outline-2 outline-live' : ''}`}
                style={{ ...at(i, 650), background: page.bg }}
              >
                {page.title}
                {page.video && <Film size={8} className="absolute bottom-0.5 right-0.5 text-[#ECECE9]" />}
              </div>
            ))}
          </div>
        </div>
      </Window>
      <Callout base={1150}>Videos in your deck <b>play right on the slide</b></Callout>
    </>
  )
}

/** Backgrounds deal into the dock, then a theme restyles the same verse. */
function StyleArt(): React.ReactElement {
  const backgrounds = ['#232B31', '#36362D', '#313E4C', '#292922', '#414037', '#3F5268']
  const themes: Array<{ name: string; bg: string; font: string }> = [
    { name: 'Classic', bg: '#11120D', font: 'font-serif' },
    { name: 'Modern', bg: '#313E4C', font: 'font-sans' },
    { name: 'Lower third', bg: '#36362D', font: 'font-sans' },
  ]
  return (
    <>
      <Callout base={260}>Every background and video in <b>one media dock</b></Callout>
      <Window title="Media" base={120}>
        <div className="grid grid-cols-6 gap-1.5 px-3 pb-3">
          {backgrounds.map((bg, i) => (
            <div key={bg} className="ob-pop relative aspect-video rounded-sm" style={{ ...at(i, 350), background: bg }}>
              {i % 3 === 1 && <Film size={8} className="absolute bottom-0.5 right-0.5 text-[#ECECE9]" />}
            </div>
          ))}
        </div>
      </Window>
      <div className="grid grid-cols-3 gap-2">
        {themes.map((theme, i) => (
          <div key={theme.name} className="ob-rise" style={at(i, 800)}>
            <div
              className={`onboarding-audience-slide px-2 ${i === 1 ? 'ob-select outline outline-2 outline-[#ECECE9]' : ''}`}
              style={{ ...(i === 1 ? at(0, 1250) : {}), background: theme.bg, justifyContent: i === 2 ? 'flex-end' : 'center', paddingBottom: i === 2 ? 8 : undefined }}
            >
              <p className={`${theme.font} text-[9px] leading-snug`}>The Lord is my shepherd</p>
              <p className="mt-0.5 text-[6px] uppercase tracking-wider text-[#A29F96]">Psalm 23:1</p>
            </div>
            <p className="mt-1 text-center text-[10px] text-slate-500">{theme.name}</p>
          </div>
        ))}
      </div>
      <Callout base={1350}>One <b>theme</b> restyles every verse and lyric</Callout>
    </>
  )
}

/** Screens list in, the stage display fills in, and its timer runs. */
function ScreensArt(): React.ReactElement {
  const timer = useCountdown(299)
  const screens: Array<[string, string]> = [['Screens', 'Projector'], ['', 'Lobby TV'], ['Stage', 'Stage display']]
  return (
    <>
      <Callout base={260}>Configure each <b>screen</b> to match your room</Callout>
      <Window title="Screens" base={120}>
        <div className="grid grid-cols-[38%_1fr]">
          <div className="onboarding-window-side">
            {screens.map(([section, name], i) => (
              <div key={name} className="ob-rise" style={at(i, 300)}>
                {section && <p className={`px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-slate-500 ${i > 0 ? 'mt-2' : ''}`}>{section}</p>}
                <div className={`rounded px-1.5 py-1.5 ${i === 2 ? 'ob-select bg-surface-elevated text-slate-200' : ''}`} style={i === 2 ? at(0, 700) : undefined}>
                  {name}<span className="block text-[9px] text-slate-500">1920 × 1080</span>
                </div>
              </div>
            ))}
          </div>
          <div className="p-3 pt-0">
            <div className="onboarding-audience-slide ob-pop bg-ink px-3" style={at(0, 800)}>
              <p className="self-start text-[8px] uppercase tracking-wider text-slate-500">Current</p>
              <p className="text-[13px] font-semibold">Way maker, miracle worker</p>
              <p className="mt-1 text-[9px] text-slate-400">Next: Promise keeper, light in the darkness</p>
              <div className="mt-2 flex w-full justify-between px-1 font-mono text-[11px]">
                <span className="text-slate-300">10:42 AM</span>
                <span className="tabular-nums text-teal-400">{timer}</span>
              </div>
            </div>
          </div>
        </div>
      </Window>
      <Callout base={1100}>Give the band a <b>stage display</b> with next slide and timer</Callout>
    </>
  )
}
