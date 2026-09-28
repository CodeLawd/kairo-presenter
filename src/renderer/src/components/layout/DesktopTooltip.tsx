import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface VisibleTooltip {
  label: string
  x: number
  y: number
  side: 'left' | 'right'
}

/** A visible hover/focus tooltip for compact desktop controls. */
export function DesktopTooltip(): React.ReactElement | null {
  const [visible, setVisible] = useState<VisibleTooltip | null>(null)
  const active = useRef<HTMLElement | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    const hide = (): void => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
      active.current = null
      setVisible(null)
    }
    const findAnchor = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null
      const anchor = target.closest<HTMLElement>('[data-tooltip], button[aria-label]:not([title]), a[aria-label]:not([title])')
      if (!anchor) return null
      if (!anchor.dataset.tooltip && anchor.innerText.trim()) return null
      return anchor
    }
    const show = (anchor: HTMLElement): void => {
      const label = anchor.dataset.tooltip || anchor.getAttribute('aria-label')
      if (!label) return
      const rect = anchor.getBoundingClientRect()
      const side = anchor.dataset.tooltipSide === 'left' || rect.right + 240 > window.innerWidth ? 'left' : 'right'
      setVisible({
        label,
        x: side === 'left' ? rect.left - 9 : rect.right + 9,
        y: Math.max(20, Math.min(window.innerHeight - 20, rect.top + rect.height / 2)),
        side,
      })
    }
    const enter = (event: Event): void => {
      const anchor = findAnchor(event.target)
      if (!anchor || active.current === anchor) return
      hide()
      active.current = anchor
      if (event.type === 'focusin') show(anchor)
      else timer.current = window.setTimeout(() => show(anchor), 350)
    }
    const leave = (event: PointerEvent | FocusEvent): void => {
      if (!active.current) return
      if (event.relatedTarget instanceof Node && active.current.contains(event.relatedTarget)) return
      hide()
    }
    document.addEventListener('pointerover', enter, true)
    document.addEventListener('pointerout', leave, true)
    document.addEventListener('focusin', enter, true)
    document.addEventListener('focusout', leave, true)
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('pointerover', enter, true)
      document.removeEventListener('pointerout', leave, true)
      document.removeEventListener('focusin', enter, true)
      document.removeEventListener('focusout', leave, true)
      window.removeEventListener('scroll', hide, true)
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  if (!visible) return null
  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[100] w-max max-w-[calc(100vw-2rem)] whitespace-nowrap rounded-md bg-surface-elevated px-2.5 py-1.5 text-xs font-medium text-zinc-100 shadow-lg"
      style={{ left: visible.x, top: visible.y, transform: visible.side === 'left' ? 'translate(-100%, -50%)' : 'translateY(-50%)' }}
    >
      {visible.label}
    </div>,
    document.body,
  )
}
