import { cn } from '@/lib/utils'

/**
 * Pick one of a few options: a darker strip with the chosen one lifted. The one
 * pill style used for tabs and choices across Theme, Screens and the booth.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  role = 'radiogroup',
  className,
  itemClassName,
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: React.ReactNode }>
  onChange: (value: T) => void
  /** Accessible name for the group. */
  label: string
  /** `tablist` when the options switch panels rather than set a value. */
  role?: 'radiogroup' | 'tablist'
  /** Container overrides — e.g. a different strip colour or a fixed width. */
  className?: string
  itemClassName?: string
}): React.ReactElement {
  const itemRole = role === 'tablist' ? 'tab' : 'radio'
  return (
    <div className={cn('flex rounded-lg bg-surface p-0.5', className)} role={role} aria-label={label}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role={itemRole}
            aria-selected={itemRole === 'tab' ? selected : undefined}
            aria-checked={itemRole === 'radio' ? selected : undefined}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-w-0 flex-1 truncate rounded-md px-2 py-1 text-[12px] font-medium transition-colors',
              selected ? 'bg-surface-elevated text-white' : 'text-slate-500 hover:text-slate-300',
              itemClassName,
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
