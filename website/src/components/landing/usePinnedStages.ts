'use client'

import { useEffect, useRef, useState } from 'react'

/** Scroll length given to each stage, as a fraction of the viewport height. */
const PER_STAGE = 0.8

/**
 * Drives a section that pins itself and advances its copy as the page scrolls.
 *
 * `enhanced` is false on the server and on the first client render, so the
 * markup that ships is the plain stacked version. It only turns true once we
 * know the viewport is wide and the reader has not asked for reduced motion,
 * which keeps the effect an enhancement rather than a requirement — and means
 * a component can render an entirely different tree for the two cases without
 * a hydration mismatch.
 *
 * The stage comes from measured scroll progress rather than from
 * IntersectionObserver triggers. Triggers have to be sized against the pinned
 * travel — the section height minus one viewport — and read through a band at
 * the very top of the window; getting either wrong silently shifts every stage
 * boundary by half a screen. Dividing the travel directly is the same idea
 * without the offsets to get wrong.
 */
export function usePinnedStages(count: number): {
  ref: React.RefObject<HTMLElement | null>
  active: number
  enhanced: boolean
  travel: string
  goTo: (i: number) => void
} {
  const ref = useRef<HTMLElement | null>(null)
  const [active, setActive] = useState(0)
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
      const progress = (window.scrollY - el.offsetTop) / travel
      const i = Math.floor(progress * count)
      setActive(Math.min(Math.max(i, 0), count - 1))
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

  /**
   * Jump to the middle of a stage's share of the travel.
   *
   * Not a convenience: while pinned, every stage but the live one is hidden, so
   * the only route to that copy is scrolling. Wiring the index rail to this
   * gives it a keyboard- and pointer-reachable way in.
   */
  const goTo = (i: number): void => {
    const el = ref.current
    if (!el) return
    const travel = el.offsetHeight - window.innerHeight
    if (travel <= 0) return
    window.scrollTo({ top: el.offsetTop + travel * ((i + 0.5) / count), behavior: 'smooth' })
  }

  return { ref, active, enhanced, goTo, travel: `${(1 + count * PER_STAGE) * 100}vh` }
}
