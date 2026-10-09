'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { AuthSplit } from '@/components/auth/AuthSplit'
import { btnPrimary, btnSecondary } from '@/components/auth/styles'
import { api, ApiError } from '@/lib/api'

const BRAND = {
  quote: (
    <>
      Almost there. <span className="font-semibold">See you Sunday.</span>
    </>
  ),
}

function VerifyEmailPageContent(): React.ReactElement {
  const params = useSearchParams()
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = params.get('token')
    if (!token) {
      setState('failed')
      setError('That link is missing its code.')
      return
    }
    api('/v1/auth/verify-email', { method: 'POST', body: { token } })
      .then(() => setState('done'))
      .catch((failure) => {
        setState('failed')
        setError(failure instanceof ApiError ? failure.message : 'Something went wrong.')
      })
  }, [params])

  return (
    <AuthSplit
      title={
        state === 'working' ? 'Confirming…' : state === 'done' ? 'Email confirmed' : 'That link didn’t work'
      }
      blurb={
        state === 'done'
          ? 'Your address is confirmed. Head back to the Kairo app, or open your church’s dashboard here.'
          : state === 'failed'
            ? `${error ?? 'This link no longer works.'} Sign in and we’ll send you a fresh code.`
            : 'Checking your link. This only takes a moment.'
      }
      brand={BRAND}
    >
      {state === 'done' ? (
        <Link className={btnPrimary} href="/dashboard">
          Open dashboard
        </Link>
      ) : state === 'failed' ? (
        <Link className={btnSecondary} href="/login">
          Sign in
        </Link>
      ) : null}
    </AuthSplit>
  )
}

/**
 * `useSearchParams` makes a page client-rendered; Next requires the boundary to
 * be explicit so the shell can still be prerendered.
 */
export default function VerifyEmailPage(): React.ReactElement {
  return (
    <Suspense fallback={<AuthSplit title="Confirming…" brand={BRAND}>{null}</AuthSplit>}>
      <VerifyEmailPageContent />
    </Suspense>
  )
}
