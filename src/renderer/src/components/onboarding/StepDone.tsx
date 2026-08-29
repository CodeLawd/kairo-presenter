import { Check, Minus } from 'lucide-react'
import { onboardingSummary } from '@shared/cloud/onboarding'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'

/**
 * The closing screen.
 *
 * Setup ending by having the dialog vanish leaves the operator wondering
 * whether anything was saved. So it ends by saying what this machine will now
 * do — read off the settings themselves, not off which steps were pressed, so
 * an unfinished line reads as a plain "not set" rather than a failure.
 */
export default function StepDone({
  onStart,
  busy,
}: {
  onStart: () => void
  busy: boolean
}): React.ReactElement {
  const settings = useBootstrapStore((s) => s.settings)
  const summary = onboardingSummary(settings)
  const outstanding = summary.filter((line) => !line.done)
  const church = settings.church.name.trim()

  return (
    <div className="flex flex-1 flex-col animate-fade-in">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-teal-500/15 ring-1 ring-teal-400/30">
        <Check className="h-6 w-6 text-teal-400" strokeWidth={2.5} aria-hidden="true" />
      </span>

      <h2 className="mt-5 text-[19px] font-semibold tracking-[-0.02em] text-white">
        {church ? `${church} is set up` : 'You are set up'}
      </h2>
      <p className="mt-2 max-w-[46ch] text-[13px] leading-relaxed text-slate-500">
        {outstanding.length === 0
          ? 'Everything is configured. Search a passage and send it to the wall.'
          : 'You can finish the rest any time from Settings — nothing here is locked in.'}
      </p>

      <ul className="mt-6 divide-y divide-surface-border/40">
        {summary.map((line) => (
          <li key={line.step} className="flex items-center gap-3 py-2.5">
            <span
              className={`grid h-4 w-4 shrink-0 place-items-center rounded-full ${
                line.done ? 'bg-teal-500/15 text-teal-400' : 'bg-surface-secondary text-slate-600'
              }`}
              aria-hidden="true"
            >
              {line.done ? <Check size={11} strokeWidth={3} /> : <Minus size={11} strokeWidth={3} />}
            </span>
            <span className="w-[6.5rem] shrink-0 text-[12px] text-slate-400">{line.label}</span>
            <span
              className={`min-w-0 flex-1 truncate text-[12px] ${
                line.done ? 'text-slate-300' : 'text-slate-600'
              }`}
              title={line.detail}
            >
              {line.detail}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-auto flex items-center justify-end pt-8">
        <button type="button" className="btn-primary min-w-[10rem]" onClick={onStart} disabled={busy} autoFocus>
          Start using ProAutomate
        </button>
      </div>
    </div>
  )
}
