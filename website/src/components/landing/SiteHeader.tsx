'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Wordmark } from '@/components/brand/Wordmark'
import { btn, btnPrimary, cx, wrap } from './primitives'

const NAV = [
  { href: '#features', label: 'Features' },
  { href: '#privacy', label: 'Privacy' },
  { href: '#faq', label: 'FAQ' },
]

/**
 * Client-side only for the scroll listener: the header's bottom hairline stays
 * invisible until the page has moved, so the hero meets the top of the window
 * without a rule across it.
 */
export function SiteHeader(): React.ReactElement {
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const onScroll = (): void => setStuck(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cx(
        'sticky top-0 z-50 border-b bg-ink/70 backdrop-blur-[14px] backdrop-saturate-150 transition-colors duration-300',
        stuck ? 'border-line-soft' : 'border-transparent',
      )}
    >
      <div className={cx(wrap, 'flex h-[62px] items-center gap-[26px]')}>
        <Wordmark href="#top" />
        <nav className="hidden gap-[22px] sm:flex" aria-label="Sections">
          {NAV.map((item) => (
            <a
              key={item.href}
              className="text-sm text-mute transition-colors hover:text-paper"
              href={item.href}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <span className="flex-1" />
        <Link
          className="hidden text-sm text-mute transition-colors hover:text-paper sm:block"
          href="/login"
        >
          Sign in
        </Link>
        <a className={cx(btn, btnPrimary, 'px-[17px] py-2 text-[13px]')} href="#get">
          Get early access
        </a>
      </div>
    </header>
  )
}
