import { useEffect, useRef, useState } from 'react'

const MIN = 180
const DEFAULT = 250
const STORAGE_KEY = 'kairo.lyrics-library-width'

export function useLibraryWidth() {
  const containerRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; width: number } | null>(null)
  const [preferred, setPreferred] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(STORAGE_KEY))
      return Number.isFinite(stored) && stored >= MIN ? Math.min(420, stored) : DEFAULT
    } catch { return DEFAULT }
  })
  const [maximum, setMaximum] = useState(420)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => setMaximum(Math.max(MIN, Math.min(420, container.clientWidth - 360))))
    observer.observe(container)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(preferred)) } catch { /* Layout remains usable without storage. */ }
  }, [preferred])
  const width = Math.min(preferred, maximum)
  const change = (next: number) => setPreferred(Math.max(MIN, Math.min(maximum, next)))
  return { containerRef, width, separatorProps: {
    role: 'separator' as const,
    'aria-label': 'Resize song library',
    'aria-orientation': 'vertical' as const,
    'aria-valuemin': MIN,
    'aria-valuemax': maximum,
    'aria-valuenow': width,
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.focus()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { x: event.clientX, width }
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (drag.current) change(drag.current.width + event.clientX - drag.current.x)
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      drag.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    },
    onLostPointerCapture: () => { drag.current = null },
    onPointerCancel: () => { drag.current = null },
    onDoubleClick: () => change(DEFAULT),
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault(); event.stopPropagation()
      change(event.key === 'Home' ? MIN : event.key === 'End' ? maximum : width + (event.key === 'ArrowLeft' ? -16 : 16))
    },
  } }
}
