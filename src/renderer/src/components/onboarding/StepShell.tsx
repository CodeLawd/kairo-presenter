import type { ReactNode } from 'react'

/**
 * The frame every wizard step renders inside. Steps supply a title, one line of
 * why-this-matters copy, and their fields — nothing else, so no step can drift
 * into its own layout or its own idea of how loud setup should be.
 */
export default function StepShell({
  title,
  blurb,
  children,
}: {
  title: string
  blurb: string
  children: ReactNode
}): React.ReactElement {
  return (
    <div className="onboarding-step flex flex-1 flex-col animate-fade-in">
      <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-white">{title}</h2>
      <p className="mt-2 max-w-[46ch] text-[13px] leading-relaxed text-slate-500">{blurb}</p>
      <div className="mt-7 flex flex-1 flex-col gap-5">{children}</div>
    </div>
  )
}
