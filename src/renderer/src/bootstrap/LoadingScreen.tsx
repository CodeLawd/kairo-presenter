import type { BootstrapProgress } from '@shared/ipc'
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@shared/brand'
import { getBootstrapPercent } from './bootstrap-state'
import kairoStacked from '@/assets/kairo-stacked.png'

/**
 * Branded startup screen, shown briefly on every launch. The progress row only
 * appears when loading outlasts that beat; bar and step then come straight
 * from main's progress events, so the line names whatever is actually still
 * loading. `motion-reduce` variants keep prefers-reduced-motion static.
 */
export function LoadingScreen({
  progress,
  showProgress,
  fadingOut,
}: {
  progress: BootstrapProgress
  showProgress: boolean
  fadingOut: boolean
}): React.ReactElement {
  const percent = fadingOut ? 100 : getBootstrapPercent(progress)
  const step = fadingOut ? 'Ready' : progress.step

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
      <div className="flex w-[340px] flex-col items-center gap-7">
        {/* The stacked logo (mark over "Kairo") under a glass lens — a top
            specular and a slowly drifting caustic, every layer masked to the
            logo's own shape. Off-white in dark, ink in light. */}
        <div className="splash-mark relative h-[100px] w-[152px]" role="img" aria-label={PRODUCT_NAME}>
          <span
            aria-hidden
            className="absolute inset-0 bg-[rgb(var(--text-primary))]"
            style={{
              WebkitMaskImage: `url(${kairoStacked})`,
              maskImage: `url(${kairoStacked})`,
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center',
              maskPosition: 'center',
            }}
          />
          {(['splash-glass-caustic', 'splash-glass-lens'] as const).map((layer) => (
            <div
              key={layer}
              aria-hidden
              className={`splash-glass-layer ${layer}`}
              style={{ WebkitMaskImage: `url(${kairoStacked})`, maskImage: `url(${kairoStacked})` }}
            />
          ))}
        </div>

        <div className="splash-copy -mt-2 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-300">
            {PRODUCT_TAGLINE}
          </p>
        </div>

        {/* One fixed-height row: the boot line normally, real progress only when
            loading outlasts the splash — so the logo never shifts. */}
        <div className="splash-copy h-[30px] w-full">
          {showProgress ? (
            <>
              <div className="h-1 w-full overflow-hidden bg-surface-elevated">
                <div
                  className="h-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="mt-2.5 flex items-baseline justify-between gap-3">
                <p
                  key={step}
                  className="splash-step min-w-0 truncate text-[12px] font-medium text-zinc-300"
                >
                  {step}
                </p>
                <p className="shrink-0 font-mono text-[12px] tabular-nums text-zinc-400">{percent}%</p>
              </div>
            </>
          ) : (
            <p className="splash-boot text-center font-mono text-[11px] uppercase tracking-[0.3em]">
              {fadingOut ? 'Ready' : 'Booting up'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
