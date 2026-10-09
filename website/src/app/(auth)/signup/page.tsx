'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { AuthSplit } from '@/components/auth/AuthSplit'
import { GoogleButton } from '@/components/auth/GoogleButton'
import { PasswordField } from '@/components/auth/PasswordField'
import { btnPrimary, input, label, msg, msgError } from '@/components/auth/styles'
import { api, ApiError } from '@/lib/api'
import { seedAccessToken } from '@/lib/session'

const BRAND = {
  quote: (
    <>
      Set up once. <span className="font-semibold">Bring the team in when you&rsquo;re ready.</span>
    </>
  ),
}

function SignUpPageContent(): React.ReactElement {
  const router = useRouter()
  const params = useSearchParams()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [orgName, setOrgName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const returnTo = params.get('returnTo')
  // Google sign-up skips the form, and Google has already confirmed the
  // address — onboarding moves past the email step on its own.
  const onboarding = returnTo ? `/onboarding?returnTo=${encodeURIComponent(returnTo)}` : '/onboarding'

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ accessToken: string }>('/v1/auth/signup', {
        method: 'POST',
        body: { name, email, password, orgName: orgName.trim() },
      })
      // Seed the access token so onboarding can load the session even when the
      // cross-origin refresh cookie has not settled yet.
      seedAccessToken(result.accessToken)
      // A new account is unverified and its org is bare, so setup comes first.
      // Anyone who arrived mid-flow keeps their destination through it.
      router.push(onboarding)
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthSplit
      title="Set up Kairo for your church"
      blurb="Free during early access. Next you’ll confirm your email and add your service times."
      brand={BRAND}
      footer={
        <p className="m-0">
          Already have an account?{' '}
          <Link
            className="font-medium text-paper underline-offset-2 hover:underline"
            href={returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login'}
          >
            Sign in
          </Link>
        </p>
      }
    >
      <GoogleButton returnTo={onboarding} />

      <form className="flex flex-col gap-5" onSubmit={submit}>
        <div>
          <label className={label} htmlFor="name">
            Your name
          </label>
          <input
            id="name"
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jordan Lee"
            autoComplete="name"
            required
          />
        </div>

        <div>
          <label className={label} htmlFor="orgName">
            Church name
          </label>
          <input
            id="orgName"
            className={input}
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="Grace Chapel"
            autoComplete="organization"
            required
          />
        </div>

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
          autoComplete="new-password"
          minLength={10}
          placeholder="At least 10 characters"
          required
        />

        {error ? (
          <p className={`${msg} ${msgError}`} role="alert">
            {error}
          </p>
        ) : null}

        <button className={btnPrimary} type="submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthSplit>
  )
}

/**
 * `useSearchParams` makes a page client-rendered; Next requires the boundary to
 * be explicit so the shell can still be prerendered.
 */
export default function SignUpPage(): React.ReactElement {
  return (
    <Suspense fallback={<AuthSplit title="Set up Kairo for your church" brand={BRAND}>{null}</AuthSplit>}>
      <SignUpPageContent />
    </Suspense>
  )
}
