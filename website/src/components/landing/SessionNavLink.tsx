'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ApiError } from '@/lib/api'
import { getSession, mintAccessToken } from '@/lib/session'

/**
 * Whether the visitor has a dashboard session: `null` while checking. Uses the
 * same HttpOnly session as the dashboard, and re-checks when the tab returns.
 */
export function useSignedIn(): boolean | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    let checking = false
    const check = async (): Promise<void> => {
      if (checking || document.visibilityState === 'hidden') return
      checking = true
      try {
        await getSession(await mintAccessToken())
        if (!cancelled) setSignedIn(true)
      } catch (error) {
        // A temporary network failure must not erase a known session.
        if (!cancelled && error instanceof ApiError && error.status === 401) {
          setSignedIn(false)
        }
      } finally {
        checking = false
      }
    }
    const recheck = (): void => { void check() }
    recheck()
    window.addEventListener('focus', recheck)
    window.addEventListener('pageshow', recheck)
    document.addEventListener('visibilitychange', recheck)
    return () => {
      cancelled = true
      window.removeEventListener('focus', recheck)
      window.removeEventListener('pageshow', recheck)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [])

  return signedIn
}

/** "Sign in" or "Dashboard", given a known session state. */
export function SessionLink({
  signedIn,
  variant = 'button',
  className = '',
  onClick,
}: {
  signedIn: boolean | null
  variant?: 'button' | 'text'
  className?: string
  onClick?: () => void
}): React.ReactElement {
  return (
    <Link
      className={`landing-press inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#F4F0E9] ${variant === 'text' ? 'min-w-[76px] text-[#EBE8E0] hover:text-white' : 'min-w-[124px] rounded-lg bg-[#F4F0E9] px-5 text-[#11120D] hover:bg-[#E9E5DE]'} ${className}`}
      href={signedIn === false ? '/login' : '/dashboard'}
      onClick={onClick}
    >
      {signedIn === null ? (
        <>
          <span className="sr-only">Checking session…</span>
          <span aria-hidden="true" className={`h-3 w-16 rounded ${variant === 'text' ? 'bg-white/15' : 'bg-[#11120D]/15'}`} />
        </>
      ) : signedIn ? 'Dashboard' : 'Sign in'}
    </Link>
  )
}

/** Public navigation uses the same HttpOnly session as the dashboard. */
export function SessionNavLink({ variant = 'button' }: { variant?: 'button' | 'text' }): React.ReactElement {
  return <SessionLink signedIn={useSignedIn()} variant={variant} />
}
