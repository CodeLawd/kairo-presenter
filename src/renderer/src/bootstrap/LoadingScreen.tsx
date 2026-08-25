import type { BootstrapProgress } from '@shared/ipc'
import { getBootstrapPercent } from './bootstrap-state'

/**
 * Branded startup screen. Everything animated here carries `motion-reduce`
 * variants so `prefers-reduced-motion` leaves a static, legible screen.
 */
export function LoadingScreen({
  progress,
  fadingOut,
}: {
  progress: BootstrapProgress
  fadingOut: boolean
}): React.ReactElement {
  const percent = getBootstrapPercent(progress)

  return (
    <div
      className={[
        'absolute inset-0 z-[60] flex flex-col items-center justify-center bg-surface',
        'transition-opacity duration-300 motion-reduce:transition-none',
        fadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100',
      ].join(' ')}
      role="status"
      aria-live="polite"
      aria-busy={!fadingOut}
    >
      <div className="flex flex-col items-center gap-6 w-[320px]">
        <div className="relative flex h-16 w-16 items-center justify-center">
          <span className="absolute inset-0 rounded-2xl bg-teal-500/15 animate-ping motion-reduce:animate-none" />
          <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-teal-500/40 bg-surface-secondary">
            <span className="text-2xl font-black tracking-tighter text-teal-500">PA</span>
          </span>
        </div>

        <div className="text-center">
          <h1 className="text-xl font-black tracking-tight text-white">
            Pro<span className="text-teal-500">Automate</span>
          </h1>
          <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-slate-600">
            Church tech automation
          </p>
        </div>

        <div className="w-full">
          <div className="h-1 w-full overflow-hidden rounded-full bg-surface-tertiary">
            <div
              className="h-full rounded-full bg-teal-500 transition-[width] duration-300 ease-out motion-reduce:transition-none"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate text-[11px] text-slate-400">{progress.step}</p>
            <p className="shrink-0 font-mono text-[11px] tabular-nums text-slate-500">{percent}%</p>
          </div>
        </div>
      </div>
    </div>
  )
}
