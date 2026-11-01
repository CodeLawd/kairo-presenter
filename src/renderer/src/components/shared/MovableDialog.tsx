import { useState, useRef, type PointerEvent } from 'react'
import { cn } from '@/lib/utils'

const DRAG_EDGE = 48

function isDragHandle(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (
    target.closest(
      'button, a, input, textarea, select, label, [role="switch"], [role="slider"], [role="tab"], [role="option"], [role="menuitem"], [contenteditable="true"], [data-slot="switch"], [data-slot="slider"], [data-no-modal-drag]',
    )
  ) {
    return false
  }
  return Boolean(target.closest('[data-modal-drag], [data-settings-drag]'))
}

function clampOffset(x: number, y: number, rect: DOMRect | null): { x: number; y: number } {
  if (!rect) return { x, y }
  const viewW = window.innerWidth
  const viewH = window.innerHeight
  const baseLeft = (viewW - rect.width) / 2
  const baseTop = (viewH - rect.height) / 2
  const left = baseLeft + x
  const top = baseTop + y
  const nextLeft = Math.min(Math.max(left, DRAG_EDGE - rect.width), viewW - DRAG_EDGE)
  const nextTop = Math.min(Math.max(top, 8), viewH - DRAG_EDGE)
  return {
    x: Math.round(nextLeft - baseLeft),
    y: Math.round(nextTop - baseTop),
  }
}

/**
 * Wraps a modal dialog so the user can drag it around the screen by grabbing
 * any header/sidebar marked with `data-modal-drag` (or `data-settings-drag`).
 */
export function MovableDialog({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef(offset)
  offsetRef.current = offset

  const active = useRef<{
    pointerId: number
    startX: number
    startY: number
    origX: number
    origY: number
    rect: DOMRect | null
  } | null>(null)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !isDragHandle(event.target)) return
    event.preventDefault()
    const rect = rootRef.current?.getBoundingClientRect() ?? null
    active.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origX: offsetRef.current.x,
      origY: offsetRef.current.y,
      rect,
    }
    setDragging(true)
    rootRef.current?.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const cur = active.current
    if (!cur || event.pointerId !== cur.pointerId) return
    const dx = event.clientX - cur.startX
    const dy = event.clientY - cur.startY
    setOffset(clampOffset(cur.origX + dx, cur.origY + dy, cur.rect))
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const cur = active.current
    if (!cur || event.pointerId !== cur.pointerId) return
    active.current = null
    setDragging(false)
    if (rootRef.current?.hasPointerCapture(event.pointerId)) {
      rootRef.current.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div
      ref={rootRef}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      className={cn(
        'no-drag pointer-events-auto flex justify-center',
        dragging && 'select-none cursor-grabbing',
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  )
}
