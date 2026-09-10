import type { ReactNode } from 'react'
import { cx } from '../primitives'

/**
 * The shared chrome for a stage panel: a schematic of one screen of the app,
 * not a screenshot of it.
 *
 * Deliberately simplified. A pixel-faithful recreation would be far more code
 * and would go stale the moment the app's chrome moved, while reading worse at
 * this size — the panel has to be legible as a thumbnail beside a headline.
 */
export function Frame({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}): React.ReactElement {
  return (
    <div
      className={cx(
        'overflow-hidden rounded-xl border border-line bg-panel',
        'shadow-[0_40px_80px_-48px_rgba(0,0,0,0.9)]',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
          {label}
        </span>
        <span className="flex gap-1.5" aria-hidden="true">
          <i className="block h-[5px] w-[5px] rounded-full bg-line" />
          <i className="block h-[5px] w-[5px] rounded-full bg-line" />
          <i className="block h-[5px] w-[5px] rounded-full bg-line" />
        </span>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  )
}
