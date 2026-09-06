import { useEffect, useState } from 'react'
import type { BootstrapProgress } from '@shared/ipc'
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@shared/brand'
import { getSplashPercent, getSplashStep } from './bootstrap-state'
import kairoIcon from '@/assets/kairo-icon.png'

/**
 * Branded startup screen. Stages advance on a timer so scriptures, lyrics, and
 * the rest each get a readable beat — even when bootstrap finishes early.
 * `motion-reduce` variants keep prefers-reduced-motion on a static screen.
 */
export function LoadingScreen({
  progress: _progress,
  fadingOut,
}: {
  progress: BootstrapProgress
  fadingOut: boolean
}): React.ReactElement {
  const [elapsedMs, setElapsedMs] = useState(0)
  const percent = getSplashPercent(elapsedMs, fadingOut)
  const step = getSplashStep(elapsedMs, fadingOut)

  useEffect(() => {
    if (fadingOut) return
    const started = performance.now()
    let frame = 0
    const tick = (): void => {
      setElapsedMs(performance.now() - started)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [fadingOut])

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
        <div className="splash-mark relative h-[88px] w-[88px]">
          <img
            src={kairoIcon}
            alt=""
            width={88}
            height={88}
            className="h-full w-full object-contain"
          />
          <span className="splash-mark-sheen" aria-hidden="true" />
        </div>

        <div className="splash-copy text-center">
          <h1 className="text-[28px] font-semibold leading-none tracking-[-0.03em] text-white">
            {PRODUCT_NAME}
          </h1>
          <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-300">
            {PRODUCT_TAGLINE}
          </p>
        </div>

        <div className="splash-copy w-full">
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/12">
            <div
              className="h-full rounded-full bg-[#F59E0B] transition-[width] duration-200 ease-out motion-reduce:transition-none"
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
        </div>
      </div>
    </div>
  )
}
