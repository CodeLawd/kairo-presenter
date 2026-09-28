import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'

const START_DISTANCE = 4
const EDGE = 36
const SCROLL_STEP = 14

/** Things a press on should behave normally, never start a rubber band. */
const INTERACTIVE = 'input, textarea, select, a, [role="menu"], [role="dialog"], [data-no-marquee]'

function scrollParent(node: HTMLElement | null): HTMLElement | null {
  for (let el = node; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el)
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) return el
  }
  return null
}

/**
 * Rubber-band selection over any grid whose items carry `data-select-id`.
 *
 * Starts from empty space between items, or from anywhere with ⌘/Ctrl held
 * (so a plain press on a card still sends it live, and a plain drag on a
 * draggable card still moves it). ⌘ or Shift adds to the current selection.
 * The list scrolls when the band reaches its top or bottom edge.
 */
export function MarqueeSelect({
  onBegin,
  onChange,
  className,
  children,
}: {
  onBegin: (additive: boolean) => void
  onChange: (ids: string[]) => void
  className?: string
  children: React.ReactNode
}): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  const onMouseDown = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest(INTERACTIVE)) return
    const modifier = event.metaKey || event.ctrlKey
    const onItem = target.closest('[data-select-id]')
    const onControl = target.closest('button, [role="button"]')
    // A plain press on a card or button is a click — leave it alone.
    if (!modifier && (onItem || onControl)) return

    // With ⌘ held, stop the native drag and text selection a card would start.
    event.preventDefault()

    const root = rootRef.current
    if (!root) return
    const scroller = scrollParent(root)
    const startX = event.clientX
    const startY = event.clientY
    const startScroll = scroller?.scrollTop ?? 0
    const additive = modifier || event.shiftKey
    let active = false
    let lastX = startX
    let lastY = startY

    const measure = (): void => {
      const scrolled = (scroller?.scrollTop ?? 0) - startScroll
      const top = Math.min(startY - scrolled, lastY)
      const bottom = Math.max(startY - scrolled, lastY)
      const left = Math.min(startX, lastX)
      const right = Math.max(startX, lastX)
      setBand({ x: left, y: top, w: right - left, h: bottom - top })
      const ids: string[] = []
      root.querySelectorAll<HTMLElement>('[data-select-id]').forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.right >= left && r.left <= right && r.bottom >= top && r.top <= bottom) {
          ids.push(el.dataset.selectId!)
        }
      })
      onChange(ids)
    }

    const onMove = (move: MouseEvent): void => {
      lastX = move.clientX
      lastY = move.clientY
      if (!active) {
        if (Math.hypot(lastX - startX, lastY - startY) < START_DISTANCE) return
        active = true
        onBegin(additive)
      }
      if (scroller) {
        const box = scroller.getBoundingClientRect()
        if (lastY < box.top + EDGE) scroller.scrollTop -= SCROLL_STEP
        else if (lastY > box.bottom - EDGE) scroller.scrollTop += SCROLL_STEP
      }
      measure()
    }

    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setBand(null)
      if (!active) return
      // The release would otherwise click the card under the pointer.
      const swallow = (click: MouseEvent): void => {
        click.stopPropagation()
        click.preventDefault()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div ref={rootRef} onMouseDown={onMouseDown} className={cn('relative', className)}>
      {children}
      {band && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50 rounded-none border border-white/60 bg-surface-elevated"
          style={{ left: band.x, top: band.y, width: band.w, height: band.h }}
        />
      )}
    </div>
  )
}
