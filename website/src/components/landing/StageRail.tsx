'use client'

import { cx } from './primitives'

/**
 * The index down the left of a pinned panel: what the stages are, which one is
 * live, and a way into the others.
 *
 * These are buttons rather than decoration because a pinned panel hides every
 * stage but the live one — without them the hidden copy is reachable only by
 * scrolling, which leaves it off the keyboard entirely.
 */
export function StageRail({
  labels,
  active,
  onSelect,
}: {
  labels: string[]
  active: number
  onSelect: (i: number) => void
}): React.ReactElement {
  return (
    <ol className="m-0 grid list-none content-start gap-y-[14px] self-start pl-0">
      {labels.map((label, i) => {
        const live = i === active
        return (
          <li key={label}>
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-current={live ? 'step' : undefined}
              className={cx(
                'group flex w-full items-center gap-3 rounded-sm text-left text-[14px] tracking-[-0.01em]',
                'transition-colors duration-300',
                live ? 'text-paper' : 'text-faint hover:text-dim',
              )}
            >
              <span
                aria-hidden="true"
                className={cx(
                  'h-[2px] flex-none rounded-full transition-all duration-500',
                  live ? 'w-8 bg-accent' : 'w-4 bg-line group-hover:bg-mute',
                )}
              />
              {label}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
