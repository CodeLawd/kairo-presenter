import { useEffect, type RefObject } from 'react'
import { formatTimer } from '@shared/program'

/**
 * Keeps a timer object inside rendered prop markup ticking, without asking
 * React to re-render (and rebuild) the whole prop four times a second. The
 * markup carries its run in data attributes, exactly as the screens do.
 */
export function usePropTimerTick(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const root = ref.current
    if (!root || !active) return
    const tick = (): void => {
      const nodes = root.querySelectorAll<HTMLElement>('[data-kairo-timer]')
      for (const node of nodes) updateTimerNode(node)
    }
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [ref, active])
}

function updateTimerNode(node: HTMLElement): void {
  const span = node.firstElementChild as HTMLElement | null
  if (!span) return
  const duration = Number(node.dataset.durationSec) || 0
  const endsAt = node.dataset.endsAt ? Number(node.dataset.endsAt) : null
  const remaining = endsAt !== null ? Math.ceil((endsAt - Date.now()) / 1000) : Number(node.dataset.remainingSec) || 0
  const running = endsAt !== null
  const rollover = node.dataset.rollover === 'true'
  const seconds = rollover ? remaining : Math.max(0, remaining)
  const timeUp = duration > 0 && (remaining < 0 || (remaining === 0 && running))
  const text = formatTimer(seconds)
  if (span.textContent !== text) span.textContent = text
  span.style.color = timeUp ? (node.dataset.overrunColor ?? '#f87171') : (node.dataset.color ?? '#ffffff')
  span.style.opacity = !running && remaining !== duration ? '0.55' : '1'
}
