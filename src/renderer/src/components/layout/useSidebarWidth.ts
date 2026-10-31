import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

const MIN = 200
const MAX = 480
/** Every page's library sidebar shares one width, so switching pages never jumps. */
const STORAGE_KEY = 'kairo.page-sidebar-width'
/** The widths each page kept before they were shared — the first found seeds the shared one. */
const LEGACY_KEYS = ['kairo.scripture-sidebar-width', 'kairo.lyrics-library-width', 'kairo.documents-sidebar-width', 'kairo.web-sidebar-width']
const DEFAULT_WIDTH = 280
const CHANGE_EVENT = 'kairo:page-sidebar-width'

function savedWidth(): number {
  try {
    for (const key of [STORAGE_KEY, ...LEGACY_KEYS]) {
      const saved = Number(localStorage.getItem(key))
      if (localStorage.getItem(key) !== null && Number.isFinite(saved) && saved >= MIN) return Math.min(MAX, saved)
    }
  } catch { /* Fall back to the default. */ }
  return DEFAULT_WIDTH
}

/** The page sidebar's width: one value for Scripture, Lyrics, Documents and Web, kept in step live. */
export function useSidebarWidth() {
  const initialWidth = DEFAULT_WIDTH
  const containerRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; width: number } | null>(null)
  const [preferred, setPreferred] = useState(savedWidth)
  const [maximum, setMaximum] = useState(MAX)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => {
      setMaximum(Math.max(MIN, Math.min(MAX, container.clientWidth - 360)))
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Pages stay mounted while hidden, so tell the others when this one is resized.
  useEffect(() => {
    const follow = (event: Event): void => setPreferred((event as CustomEvent<number>).detail)
    window.addEventListener(CHANGE_EVENT, follow)
    return () => window.removeEventListener(CHANGE_EVENT, follow)
  }, [])

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(preferred)) } catch { /* Resizing still works. */ }
  }, [preferred])

  const width = Math.min(preferred, maximum)
  const change = (next: number): void => {
    const clamped = Math.max(MIN, Math.min(maximum, next))
    setPreferred(clamped)
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: clamped }))
  }
  const separatorProps = {
    role: 'separator' as const,
    'aria-orientation': 'vertical' as const,
    'aria-valuemin': MIN,
    'aria-valuemax': maximum,
    'aria-valuenow': width,
    onPointerDown: (event: PointerEvent<HTMLButtonElement>): void => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.focus()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { x: event.clientX, width }
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>): void => {
      if (drag.current) change(drag.current.width + event.clientX - drag.current.x)
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>): void => {
      drag.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    },
    onPointerCancel: (): void => { drag.current = null },
    onLostPointerCapture: (): void => { drag.current = null },
    onDoubleClick: (): void => change(initialWidth),
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>): void => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      change(event.key === 'Home' ? MIN : event.key === 'End' ? maximum : width + (event.key === 'ArrowLeft' ? -16 : 16))
    },
  }

  return { containerRef, width, separatorProps }
}
