import { usePresentation } from '@/hooks/useProgramState'
import type { PresentationSettings } from '@shared/program'

// ─── Screens → Transition (standalone phase 2) ─────────────────────────────────
// Stage displays are configured in the Screens window's inspector.

export function TransitionPanel(): React.ReactElement {
  const [presentation, set] = usePresentation()
  const save = (next: PresentationSettings): void => void set(next).catch((err) => console.error(err))
  const { transition } = presentation
  return (
    <div className="space-y-2">
      <div className="flex gap-1" role="radiogroup" aria-label="Transition">
        {(['cut', 'fade'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={transition.kind === kind}
            onClick={() => save({ ...presentation, transition: { ...transition, kind } })}
            className={
              transition.kind === kind
                ? 'flex-1 rounded bg-teal-600 py-1.5 text-xs font-medium text-white'
                : 'btn-secondary flex-1 py-1.5 text-xs'
            }
          >
            {kind === 'cut' ? 'Cut' : 'Fade'}
          </button>
        ))}
      </div>
      {transition.kind === 'fade' && (
        <label className="flex items-center gap-2 text-[11px] text-slate-400">
          <span className="w-16 shrink-0">{(transition.durationMs / 1000).toFixed(2)} s</span>
          <input
            type="range"
            min={100}
            max={2000}
            step={50}
            value={transition.durationMs}
            className="flex-1"
            aria-label="Fade length"
            onChange={(e) =>
              save({ ...presentation, transition: { ...transition, durationMs: Number(e.target.value) } })
            }
          />
        </label>
      )}
      <p className="text-[10px] leading-snug text-slate-500">
        Applies to Kairo screens and NDI feeds: slides, backgrounds, messages, props and the logo.
        Document page turns are always instant.
      </p>
    </div>
  )
}
