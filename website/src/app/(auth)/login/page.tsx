'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { AuthSplit } from '@/components/auth/AuthSplit'
import { GoogleButton } from '@/components/auth/GoogleButton'
import { PasswordField } from '@/components/auth/PasswordField'
import { btnPrimary, input, label, linkBtn, msg, msgError, msgOk } from '@/components/auth/styles'
import { api, ApiError } from '@/lib/api'
import { getSession, seedAccessToken } from '@/lib/session'

const BRAND = {
  quote: (
    <>
      Be ready for what&rsquo;s planned. <span className="font-semibold">And what isn&rsquo;t.</span>
    </>
  ),
}

function LoginPageContent(): React.ReactElement {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const returnTo = params.get('returnTo') ?? '/dashboard'

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await api<{ accessToken: string }>('/v1/auth/login', {
        method: 'POST',
        body: { email, password },
      })
      seedAccessToken(result.accessToken)

      // Someone who signed up but never confirmed their address would otherwise
      // land on a page that cannot work for them. One extra round trip on a
      // route already waiting on the network.
      const unverified = await getSession(result.accessToken)
        .then((session) => !session.user.emailVerified)
        .catch(() => false)

      router.push(
        unverified
          ? `/onboarding?step=1&afterVerify=1&returnTo=${encodeURIComponent(returnTo)}`
          : returnTo,
      )
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const forgot = async (): Promise<void> => {
    if (!email) {
      setError('Enter your email above, then choose “Forgot password?” again.')
      return
    }
    await api('/v1/auth/forgot-password', { method: 'POST', body: { email } }).catch(() => null)
    // Unconditional by design — the API will not confirm who has an account.
    setNotice('If that address has an account, a reset link is on its way.')
  }

  return (
    <AuthSplit
      title="Welcome back"
      blurb="Sign in to manage your church, your team, and the computers running Kairo."
      brand={BRAND}
      footer={
        <p className="m-0">
          New to Kairo?{' '}
          <Link
            className="font-medium text-paper underline-offset-2 hover:underline"
            href={params.get('returnTo') ? `/signup?returnTo=${encodeURIComponent(returnTo)}` : '/signup'}
          >
            Create an account
          </Link>
        </p>
      }
    >
      <GoogleButton returnTo={returnTo} />

      <form className="flex flex-col gap-5" onSubmit={submit}>
        <div>
          <label className={label} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className={input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@church.org"
            autoComplete="email"
            spellCheck={false}
            required
          />
        </div>

        <PasswordField
          id="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
          labelAccessory={
            <button className={linkBtn} type="button" onClick={() => void forgot()} disabled={busy}>
              Forgot password?
            </button>
          }
        />

        {error || notice ? (
          <p className={`${msg} ${error ? msgError : msgOk}`} role={error ? 'alert' : 'status'}>
            {error ?? notice}
          </p>
        ) : null}

        <button className={btnPrimary} type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthSplit>
  )
}

/**
 * `useSearchParams` makes a page client-rendered; Next requires the boundary to
 * be explicit so the shell can still be prerendered.
 */
export default function LoginPage(): React.ReactElement {
  return (
    <Suspense fallback={<AuthSplit title="Welcome back" brand={BRAND}>{null}</AuthSplit>}>
      <LoginPageContent />
    </Suspense>
  )
}
