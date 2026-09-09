'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { api, ApiError } from '@/lib/api'

function LoginPageContent(): React.ReactElement {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const returnTo = params.get('returnTo') ?? '/activate'

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/v1/auth/login', { method: 'POST', body: { email, password } })
      router.push(returnTo)
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const forgot = async (): Promise<void> => {
    if (!email) {
      setError('Enter your email address first')
      return
    }
    await api('/v1/auth/forgot-password', { method: 'POST', body: { email } }).catch(() => null)
    // Unconditional by design — the API will not confirm who has an account.
    setNotice('If that address has an account, a reset link is on its way.')
  }

  return (
    <form className="card" onSubmit={submit}>
      <p className="wordmark">Kairo</p>
      <h1>Sign in</h1>

      <label htmlFor="email">Email</label>
      <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />

      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        required
      />

      <p className={`message ${error ? 'error' : 'ok'}`} aria-live="polite">{error ?? notice}</p>

      <button className="primary" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <button className="link" type="button" onClick={() => void forgot()}>
        Forgot password
      </button>
      <br />
      <button className="link" type="button" onClick={() => router.push('/signup')}>
        Create an account instead
      </button>

      <hr className="divider" />
      <a href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'}/v1/auth/google?returnTo=${encodeURIComponent(returnTo)}`}>
        Continue with Google
      </a>
    </form>
  )
}

/**
 * `useSearchParams` makes a page client-rendered; Next requires the boundary to
 * be explicit so the shell can still be prerendered.
 */
export default function LoginPage(): React.ReactElement {
  return (
    <Suspense
      fallback={
        <div className="card">
          <p className="wordmark">Kairo</p>
          <h1>Sign in</h1>
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  )
}
