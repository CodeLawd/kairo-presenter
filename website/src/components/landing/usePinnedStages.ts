'use client'

import { useEffect, useRef, useState } from 'react'

/** Scroll length given to each stage, as a fraction of the viewport height. */
const PER_STAGE = 0.72

/**
 * Drives a section that pins itself and smoothly tracks continuous scroll
 * progress (`0..1`) alongside the active stage index (`0..count-1`).
 *
 * `enhanced` is false on the server and on the first client render, so SSR
 * ships the plain stacked version without hydration mismatch, and mobile /
 * reduced-motion users keep immediate native scrolling.
 */
export function usePinnedStages(count: number): {
  ref: React.RefObject<HTMLElement | null>
  active: number
  /** Continuous normalized progress across the whole pinned section (0..1). */
  progress: number
  /** Continuous progress within the active stage (0..1). */
  stageProgress: number
  enhanced: boolean
  travel: string
  goTo: (i: number) => void
} {
  const ref = useRef<HTMLElement | null>(null)
  const [state, setState] = useState({ active: 0, progress: 0, stageProgress: 0 })
  const [enhanced, setEnhanced] = useState(false)

  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)')
    const still = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = (): void => setEnhanced(wide.matches && !still.matches)
    sync()
    wide.addEventListener('change', sync)
    still.addEventListener('change', sync)
    return () => {
      wide.removeEventListener('change', sync)
      still.removeEventListener('change', sync)
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!enhanced || !el) return

    let frame = 0
    const read = (): void => {
      frame = 0
      const travel = el.offsetHeight - window.innerHeight
      if (travel <= 0) return
      const raw = (window.scrollY - el.offsetTop) / travel
      const progress = Math.min(Math.max(raw, 0), 1)
      const scaled = progress * count
      const active = Math.min(Math.max(Math.floor(scaled), 0), count - 1)
      const stageProgress = active === count - 1 && progress >= 1 ? 1 : Math.min(Math.max(scaled - active, 0), 1)

      setState((prev) =>
        Math.abs(prev.progress - progress) < 0.001 && prev.active === active
          ? prev
          : { active, progress, stageProgress },
      )
    }
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(read)
    }

    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [enhanced, count])

  const goTo = (i: number): void => {
    const el = ref.current
    if (!el) return
    const travel = el.offsetHeight - window.innerHeight
    if (travel <= 0) return
    window.scrollTo({ top: el.offsetTop + travel * ((i + 0.45) / count), behavior: 'smooth' })
  }

  return {
    ref,
    active: state.active,
    progress: state.progress,
    stageProgress: state.stageProgress,
    enhanced,
    travel: `${Math.round((1 + count * PER_STAGE) * 100)}vh`,
    goTo,
  }
}
