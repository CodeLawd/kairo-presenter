'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { api, ApiError } from '@/lib/api'

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
      <div className="card">
        <p className="wordmark">Kairo</p>
        <h1>Password changed</h1>
        {/* A reset signs every device out — say so, or the booth machine
            dropping out looks like a fault. */}
        <p className="lead">
          Every device signed into this account has been signed out. Sign in again on each one.
        </p>
        <button className="primary" type="button" onClick={() => router.push('/login')}>
          Sign in
        </button>
      </div>
    )
  }

  return (
    <form className="card" onSubmit={submit}>
      <p className="wordmark">Kairo</p>
      <h1>Choose a new password</h1>

      <label htmlFor="password">New password</label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        minLength={10}
        placeholder="At least 10 characters"
        required
      />

      <p className="message error" aria-live="polite">{error}</p>

      <button className="primary" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  )
}

/**
 * `useSearchParams` makes a page client-rendered; Next requires the boundary to
 * be explicit so the shell can still be prerendered.
 */
export default function ResetPasswordPage(): React.ReactElement {
  return (
    <Suspense
      fallback={
        <div className="card">
          <p className="wordmark">Kairo</p>
          <h1>Choose a new password</h1>
        </div>
      }
    >
      <ResetPasswordPageContent />
    </Suspense>
  )
}
