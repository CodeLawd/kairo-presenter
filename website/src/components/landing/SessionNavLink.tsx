'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ApiError } from '@/lib/api'
import { getSession, mintAccessToken } from '@/lib/session'

/** Public navigation uses the same HttpOnly session as the dashboard. */
export function SessionNavLink(): React.ReactElement {
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

  return (
    <Link
      className="inline-flex min-h-11 min-w-[124px] items-center justify-center rounded-lg bg-[#F4F0E9] px-5 text-sm font-semibold text-[#11120D] transition-colors hover:bg-[#E9E5DE] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#F4F0E9]"
      href={signedIn === false ? '/login' : '/dashboard'}
    >
      {signedIn === null ? (
        <>
          <span className="sr-only">Checking session…</span>
          <span aria-hidden="true" className="h-3 w-16 rounded bg-[#11120D]/15" />
        </>
      ) : signedIn ? 'Dashboard' : 'Sign in'}
    </Link>
  )
}
