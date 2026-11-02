import type { CSSProperties } from 'react'

/**
 * The icon palette (index.css `--hue-*`, tuned for dark and light). A colour
 * marks the same tool wherever it appears — rail, header, toolbox, docks.
 */
export type Hue = 'green' | 'orange' | 'violet' | 'cyan' | 'blue' | 'pink' | 'coral' | 'lime' | 'amber' | 'indigo'

/** Sets `--hue` for one element, so a shared class list can paint any colour. */
export function hueStyle(hue: Hue): CSSProperties {
  return { ['--hue' as string]: `var(--hue-${hue})` }
}

/**
 * A rail item: the mark with its name underneath, the whole column clickable.
 * Grey at rest so the rail stays quiet, its hue on hover, and the hue on a
 * quiet elevated fill when active (`active`) or while its popover is open
 * (`data-state=open`).
 */
export function railHueClass(active = false): string {
  return [
    'relative flex w-full flex-col items-center justify-center gap-[3px] rounded-lg px-0.5 py-1 transition-colors duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--hue)/0.6)]',
    'data-[state=open]:bg-surface-elevated data-[state=open]:text-[rgb(var(--hue))]',
    active
      ? 'bg-surface-elevated text-[rgb(var(--hue))]'
      : 'text-zinc-500 hover:bg-surface-tertiary hover:text-[rgb(var(--hue))]',
  ].join(' ')
}

/**
 * The name under a rail mark. Inherits the item's colour, so a live workspace
 * reads in its hue without a second rule. Truncates rather than wraps — a
 * two-line name would make the rows jump in height.
 */
export const RAIL_LABEL = 'max-w-full truncate text-[10px] font-medium leading-[11px] tracking-[-0.01em]'

/** Just the colour — for an icon inside a row or label. */
export const HUE_TEXT = 'text-[rgb(var(--hue))]'
