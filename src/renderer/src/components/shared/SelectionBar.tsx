import { X } from '@/icons'
import { cn } from '@/lib/utils'

/**
 * The bar that appears while items are selected: how many, what can be done
 * with them, and a way out. Same place and shape on every screen.
 */
export function SelectionBar({
  count,
  noun,
  onClear,
  hint,
  className,
  children,
}: {
  count: number
  /** Singular noun, e.g. "slide", "verse", "item". */
  noun: string
  onClear: () => void
  /** Shown before anything is selected (select mode). */
  hint?: string
  className?: string
  children?: React.ReactNode
}): React.ReactElement {
  return (
    <div
      data-no-marquee
      className={cn(
        'z-30 rounded-xl bg-surface-elevated px-3 py-2.5 shadow-2xl',
        className,
      )}
      role="region"
      aria-label="Selection"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-[12px] font-medium text-white">
          {count === 0 && hint ? hint : `${count} ${noun}${count === 1 ? '' : 's'} selected`}
        </p>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-slate-400 hover:bg-surface-tertiary hover:text-white"
          title="Clear selection (Esc)"
        >
          <X size={12} aria-hidden="true" />
          Clear
        </button>
      </div>
    </div>
  )
}

/** A small action button for the selection bar. */
export function SelectionAction({
  onClick,
  disabled,
  danger,
  children,
  title,
}: {
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
  title?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors disabled:opacity-40',
        danger ? 'text-rose-300 hover:bg-tint-rose' : 'bg-surface-elevated text-white hover:bg-surface-border',
      )}
    >
      {children}
    </button>
  )
}
