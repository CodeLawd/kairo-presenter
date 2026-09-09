'use client'

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { cx } from './primitives'

/**
 * Fades its children up as they scroll into view.
 *
 * This is a client component, but its children are not: they are passed in as
 * `children` and so stay server-rendered. The only JavaScript that reaches the
 * browser is the observer below.
 */
export function Reveal({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('is-in')
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in')
            io.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.06 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={ref} className={cx('reveal', className)}>
      {children}
    </div>
  )
}
