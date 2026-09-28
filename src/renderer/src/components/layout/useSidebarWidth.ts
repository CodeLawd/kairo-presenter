import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

const MIN = 200
const MAX = 480

export function useSidebarWidth(storageKey: string, initialWidth: number) {
  const containerRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; width: number } | null>(null)
  const [preferred, setPreferred] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey))
      return Number.isFinite(saved) && saved >= MIN ? Math.min(MAX, saved) : initialWidth
    } catch {
      return initialWidth
    }
  })
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

  useEffect(() => {
    try { localStorage.setItem(storageKey, String(preferred)) } catch { /* Resizing still works. */ }
  }, [preferred, storageKey])

  const width = Math.min(preferred, maximum)
  const change = (next: number): void => setPreferred(Math.max(MIN, Math.min(maximum, next)))
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
