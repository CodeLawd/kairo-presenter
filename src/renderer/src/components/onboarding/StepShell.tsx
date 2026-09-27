import type { ReactNode } from 'react'
import { KairoMark } from '@/components/brand/KairoMark'
import { cn } from '@/lib/utils'

/**
 * The frame every wizard step renders inside. Steps supply a title, one line of
 * why-this-matters copy, and their fields — nothing else, so no step can drift
 * into its own layout or its own idea of how loud setup should be.
 */
export default function StepShell({
  title,
  blurb,
  mark,
  brand = false,
  children,
}: {
  title: string
  blurb: string
  /** Optional brand mark above the title — for a step about someone else's product. */
  mark?: ReactNode
  /** Show the Kairo mark above the title (account / welcome moments). */
  brand?: boolean
  children: ReactNode
}): React.ReactElement {
  return (
    <div className="onboarding-step flex flex-1 flex-col animate-fade-in">
      {(brand || mark) && (
        <div className={cn('mb-5', brand && 'flex items-center gap-3')}>
          {brand && <KairoMark size="sm" />}
          {mark}
        </div>
      )}
      <h2 className="text-[20px] font-semibold tracking-[-0.025em] text-white">{title}</h2>
      <p className="mt-2 max-w-[46ch] text-[13px] leading-relaxed text-slate-500">{blurb}</p>
      <div className="mt-7 flex flex-1 flex-col gap-5">{children}</div>
    </div>
  )
}
