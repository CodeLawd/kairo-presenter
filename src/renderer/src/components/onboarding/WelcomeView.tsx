import type { CSSProperties } from 'react'
import type { NavRoute } from '@/App'
import { KAIRO_MARK_URL, KairoMark } from '@/components/brand/KairoMark'
import { BookOpen, ChevronRight, FileText, Music2 } from '@/icons'

const at = (i: number, base = 0): CSSProperties => ({ '--i': i, '--base': `${base}ms` }) as CSSProperties

const QUICK_STARTS: Array<{ route: NavRoute; title: string; detail: string; icon: typeof BookOpen }> = [
  { route: 'scripture', title: 'Find a verse', detail: 'Search by reference or words', icon: BookOpen },
  { route: 'lyrics', title: 'Add a song', detail: 'Import or type in lyrics', icon: Music2 },
  { route: 'documents', title: 'Import a document', detail: 'PowerPoint or PDF', icon: FileText },
]

/**
 * The title, letter by letter: each word is a window the letters rise into, then
 * a wave of light runs across them. Every letter shows its own slice of one
 * gradient (`--k` of `--n`), so the shading stays continuous across the line.
 */
function AnimatedTitle({ text }: { text: string }): React.ReactElement {
  const total = text.replace(/\s/g, '').length
  let k = 0
  return (
    <h2 id="onboarding-slide-title" className="onboarding-welcome-title" aria-label={text}>
      {text.split(' ').map((word, w) => (
        <span key={w} aria-hidden="true">
          {w > 0 && ' '}
          <span className="ob-word">
            {[...word].map((char, c) => (
              <span key={c} className="ob-letter" style={{ '--k': k++, '--n': total } as CSSProperties}>{char}</span>
            ))}
          </span>
        </span>
      ))}
    </h2>
  )
}

/**
 * The closing moment of setup — shown after the last step and when setup is
 * skipped, so everyone lands on the same welcome. The mark comes into focus and
 * a band of shade sweeps across it, the title rises in letter by letter, then
 * three ways to begin.
 */
export default function WelcomeView({ churchName, onStart }: {
  churchName: string
  /** Close setup; with a route, open that workspace. */
  onStart: (route?: NavRoute) => void
}): React.ReactElement {
  const church = churchName.trim()
  return (
    <div className="onboarding-welcome">
      {/* The sweep is masked to the mark itself, so it crosses the shape, not a box. */}
      <div className="onboarding-welcome-mark" style={{ '--mark-url': `url(${KAIRO_MARK_URL})` } as CSSProperties} aria-hidden="true">
        <KairoMark size="lg" />
      </div>

      <AnimatedTitle text="Welcome to Kairo" />
      <p className="ob-rise mt-3 text-center text-[17px] text-slate-400" style={at(0, 1350)}>
        {church ? `${church} is ready for your next service.` : 'You’re ready for your next service.'}
      </p>

      <div className="mt-10 grid w-full max-w-[640px] grid-cols-3 gap-3">
        {QUICK_STARTS.map(({ route, title, detail, icon: Icon }, i) => (
          <button key={route} type="button" className="onboarding-quickstart ob-rise" style={at(i, 1550)} onClick={() => onStart(route)}>
            <Icon size={18} className="text-slate-300" aria-hidden="true" />
            <span className="mt-4 flex items-center gap-1 text-[15px] font-semibold text-slate-200">
              {title}
              <ChevronRight size={13} className="onboarding-quickstart-arrow" aria-hidden="true" />
            </span>
            <span className="mt-1 text-[12px] text-slate-500">{detail}</span>
          </button>
        ))}
      </div>

      <button type="button" className="btn-primary onboarding-cta ob-rise mt-10" style={at(0, 1850)} onClick={() => onStart()} autoFocus>
        Start using Kairo
      </button>
    </div>
  )
}
