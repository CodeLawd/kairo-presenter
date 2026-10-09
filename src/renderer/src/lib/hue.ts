import type { CSSProperties } from 'react'

/**
 * The icon palette (index.css `--hue-*`, tuned for dark and light). A colour
 * marks the same tool wherever it appears — rail, header, toolbox, docks.
 */
export type Hue = 'green' | 'orange' | 'violet' | 'cyan' | 'pink' | 'coral' | 'lime' | 'amber' | 'indigo'

/** Sets `--hue` for one element, so a shared class list can paint any colour. */
export function hueStyle(hue: Hue): CSSProperties {
  return { ['--hue' as string]: `var(--hue-${hue})` }
}

/**
 * A square rail button: the icon always in its hue, a soft wash of it when
 * active (`active`) or while its popover is open (`data-state=open`).
 */
export function railHueClass(active = false): string {
  return [
    'relative flex size-10 items-center justify-center rounded-md text-[rgb(var(--hue))] transition-colors duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--hue)/0.6)]',
    'data-[state=open]:bg-[rgb(var(--hue)/0.2)]',
    active ? 'bg-[rgb(var(--hue)/0.2)]' : 'hover:bg-[rgb(var(--hue)/0.1)]',
  ].join(' ')
}

/** Just the colour — for an icon inside a row or label. */
export const HUE_TEXT = 'text-[rgb(var(--hue))]'
