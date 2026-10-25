import { cn } from '@/lib/utils'

/**
 * A header button the way ProPresenter's toolbar draws them: the icon in a
 * rounded pill, a short label underneath. A tooltip carries the detail.
 */
export function ToolbarButton({
  label,
  title,
  children,
  onClick,
  disabled,
  tone = 'default',
  labelClassName,
  pressed,
}: {
  label: string
  /** Tooltip and screen-reader text: what it is and what clicking does. */
  title: string
  /** What sits in the pill: an icon or a status dot. */
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  /** `live`: something is on screen (red); `muted`: nothing to act on yet. */
  tone?: 'default' | 'live' | 'muted'
  labelClassName?: string
  pressed?: boolean
}): React.ReactElement {
  const pill = cn(
    'grid h-7 w-11 place-items-center rounded-full transition-colors duration-150',
    tone === 'live' ? 'bg-tint-live text-live' : 'bg-surface-tertiary text-zinc-200',
    onClick && !disabled && 'group-hover:bg-surface-elevated',
  )
  const body = (
    <>
      <span className={pill}>{children}</span>
      <span
        className={cn(
          'max-w-[10rem] truncate text-[10px] font-medium leading-none',
          tone === 'live' ? 'text-live' : tone === 'muted' ? 'text-zinc-600' : 'text-zinc-400',
          labelClassName,
        )}
      >
        {label}
      </span>
    </>
  )
  const className =
    'header-tool no-drag group flex shrink-0 flex-col items-center gap-1 rounded-md px-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-40'
  return onClick ? (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={pressed} className={className} title={title} aria-label={title}>
      {body}
    </button>
  ) : (
    <div className={className} title={title} aria-label={title} role="status">
      {body}
    </div>
  )
}
