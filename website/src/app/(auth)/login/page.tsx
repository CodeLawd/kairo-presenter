'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { AuthSplit } from '@/components/auth/AuthSplit'
import { PasswordField } from '@/components/auth/PasswordField'
import { btnPrimary, input, label, linkBtn, msg, msgError, msgOk } from '@/components/auth/styles'
import { api, ApiError } from '@/lib/api'
import { getSession, mintAccessToken } from '@/lib/session'

const BRAND = {
  kind: 'quote',
  quote: (
    <>
      Your pastor says the verse. <span className="font-semibold">It&rsquo;s already on screen.</span>
    </>
  ),
  attribution: 'Kairo for ProPresenter',
} as const

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

      // Someone who signed up but never confirmed their address would otherwise
      // land on a page that cannot work for them. One extra round trip on a
      // route already waiting on the network.
      const unverified = await getSession(await mintAccessToken())
        .then((session) => !session.user.emailVerified)
        .catch(() => false)

      router.push(
        unverified
          ? `/onboarding?returnTo=${encodeURIComponent(returnTo)}`
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
      setError('Enter your email address first')
      return
    }
    await api('/v1/auth/forgot-password', { method: 'POST', body: { email } }).catch(() => null)
    // Unconditional by design — the API will not confirm who has an account.
    setNotice('If that address has an account, a reset link is on its way.')
  }

  return (
    <AuthSplit
      title="Sign in"
      blurb="One account for your church, on every machine in the booth."
      brand={BRAND}
      footer={
        <>
          <p className="m-0">
            Don&rsquo;t have an account?{' '}
            <Link className="text-paper underline-offset-2 hover:underline" href="/signup">
              Create one
            </Link>
          </p>
          <p className="m-0 mt-3">
            <a
              className={linkBtn}
              href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'}/v1/auth/google?returnTo=${encodeURIComponent(returnTo)}`}
            >
              Continue with Google
            </a>
          </p>
        </>
      }
    >
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
              Forgot password
            </button>
          }
        />

        <p className={`${msg} ${error ? msgError : msgOk}`} aria-live="polite">
          {error ?? notice}
        </p>

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
    <Suspense fallback={<AuthSplit title="Sign in" brand={BRAND}>{null}</AuthSplit>}>
      <LoginPageContent />
    </Suspense>
  )
}
