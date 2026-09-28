/** Inline SVGs. Server components — none of this reaches the browser as JS. */

export function IconApple(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.4 12.8c0-2.4 2-3.6 2.1-3.6-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.6.9s-1.9-.9-3.1-.8c-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.5.8 1.2 1.8 2.4 3 2.4 1.2 0 1.7-.8 3.1-.8s1.9.8 3.1.7c1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.6-1-2.6-3.8zM14 5.4c.7-.8 1.1-1.9 1-3-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.2-.6 2.9-1.4z" />
    </svg>
  )
}

export function IconWindows(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 5.6 10.4 4.5v7.1H3zM11.4 4.4 21 3v8.6h-9.6zM3 12.6h7.4v7.1L3 18.6zM11.4 12.6H21V21l-9.6-1.4z" />
    </svg>
  )
}

export function IconLinux(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="10" rx="4.6" ry="7.5" />
      <path d="M8.3 11.5c-2.1 1.6-3.6 4.2-3.3 6.5.2 1.6 1.2 2.4 2.8 2.4h8.4c1.6 0 2.6-.8 2.8-2.4.3-2.3-1.2-4.9-3.3-6.5M9 20.4l-2 1.4M15 20.4l2 1.4" />
      <path d="M10.5 8.3h.1M13.4 8.3h.1M11 10.5l1 1 1-1M9.4 15.6c.7 1.1 1.5 1.7 2.6 1.7s1.9-.6 2.6-1.7" />
    </svg>
  )
}

export function IconShield(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.1 7.5 9.5 4.3-1.4 7.5-4.9 7.5-9.5V6z" />
      <path d="m9.5 12 1.8 1.8 3.4-3.6" />
    </svg>
  )
}

export function IconLock(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

export function IconPlug(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3v5M15 3v5M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0z" />
      <path d="M12 17v4" />
    </svg>
  )
}

export function IconMonitor(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12.5" rx="2" />
      <path d="M9 20.5h6M12 16.5v4" />
    </svg>
  )
}

export function IconMic(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v4" />
    </svg>
  )
}

export function IconCamera(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7.5h11v9H3zM14 11l7-3.5v9L14 13z" />
    </svg>
  )
}

export function IconArrow(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  )
}

/**
 * Lets `content.ts` stay a plain data module: the cards name an icon by key and
 * the render site looks it up, instead of the content file importing JSX.
 */
export const ICONS = {
  apple: IconApple,
  windows: IconWindows,
  shield: IconShield,
  lock: IconLock,
  plug: IconPlug,
  monitor: IconMonitor,
  mic: IconMic,
  camera: IconCamera,
  arrow: IconArrow,
} as const

export type IconName = keyof typeof ICONS
