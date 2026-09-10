'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { AuthSplit } from '@/components/auth/AuthSplit'
import { PasswordField } from '@/components/auth/PasswordField'
import { btnPrimary, msg, msgError } from '@/components/auth/styles'
import { api, ApiError } from '@/lib/api'

const BRAND = {
  kind: 'quote',
  quote: <>A reset signs out every device. Sign in again on each one.</>,
  attribution: 'Kairo for ProPresenter',
} as const

function ResetPasswordPageContent(): React.ReactElement {
  const router = useRouter()
  const params = useSearchParams()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const token = params.get('token')
    if (!token) {
      setError('That link is missing its code. Ask for a new one.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api('/v1/auth/reset-password', { method: 'POST', body: { token, password } })
      setDone(true)
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <AuthSplit
        title="Password changed"
        // A reset signs every device out — say so, or the booth machine
        // dropping out looks like a fault.
        blurb="Every device signed into this account has been signed out. Sign in again on each one."
        brand={BRAND}
      >
        <button className={btnPrimary} type="button" onClick={() => router.push('/login')}>
          Sign in
        </button>
      </AuthSplit>
    )
  }

  return (
    <AuthSplit title="Choose a new password" brand={BRAND}>
      <form className="flex flex-col gap-5" onSubmit={submit}>
        <PasswordField
          id="password"
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={10}
          placeholder="At least 10 characters"
          required
        />

        <p className={`${msg} ${msgError}`} aria-live="polite">
          {error}
        </p>

        <button className={btnPrimary} type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </AuthSplit>
  )
}

/**
 * `useSearchParams` makes a page client-rendered; Next requires the boundary to
 * be explicit so the shell can still be prerendered.
 */
export default function ResetPasswordPage(): React.ReactElement {
  return (
    <Suspense fallback={<AuthSplit title="Choose a new password" brand={BRAND}>{null}</AuthSplit>}>
      <ResetPasswordPageContent />
    </Suspense>
  )
}
