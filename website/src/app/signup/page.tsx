'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { api, ApiError } from '@/lib/api'

function SignUpPageContent(): React.ReactElement {
  const router = useRouter()
  const params = useSearchParams()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [orgName, setOrgName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/v1/auth/signup', { method: 'POST', body: { name, email, password, orgName: orgName.trim() } })
      // Someone who came here to activate a booth machine should land back on
      // that flow, now signed in, rather than on a generic page.
      router.push(params.get('returnTo') ?? '/activate')
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <p className="wordmark">Kairo</p>
      <h1>Create your account</h1>
      <p className="lead">One account for your church, on every machine in the booth.</p>

      <label htmlFor="name">Your name</label>
      <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />

      <label htmlFor="orgName">Church name</label>
      <input
        id="orgName"
        value={orgName}
        onChange={(e) => setOrgName(e.target.value)}
        placeholder="Grace Chapel"
        required
      />

      <label htmlFor="email">Email</label>
      <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />

      <label htmlFor="password">Password</label>
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
        {busy ? 'Creating…' : 'Create account'}
      </button>
      <button className="link" type="button" onClick={() => router.push('/login')}>
        I already have an account
      </button>
    </form>
  )
}

/**
 * `useSearchParams` makes a page client-rendered; Next requires the boundary to
 * be explicit so the shell can still be prerendered.
 */
export default function SignUpPage(): React.ReactElement {
  return (
    <Suspense
      fallback={
        <div className="card">
          <p className="wordmark">Kairo</p>
          <h1>Create your account</h1>
        </div>
      }
    >
      <SignUpPageContent />
    </Suspense>
  )
}
