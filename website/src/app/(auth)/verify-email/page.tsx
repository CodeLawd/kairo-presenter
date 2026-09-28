'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { AuthSplit } from '@/components/auth/AuthSplit'
import { api, ApiError } from '@/lib/api'

const BRAND = {
  kind: 'quote',
  quote: <>Your church&rsquo;s Kairo account is nearly ready.</>,
  attribution: 'Kairo presentation software',
} as const

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
        state === 'working' ? 'Confirming…' : state === 'done' ? 'Email confirmed' : 'Link expired'
      }
      blurb={
        state === 'done'
          ? 'Thanks — your address is confirmed. You can close this page and go back to Kairo.'
          : state === 'failed'
            ? (error ?? 'Ask for a new link from the app.')
            : 'One moment.'
      }
      brand={BRAND}
    >
      {null}
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
