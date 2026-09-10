'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { AuthSplit } from '@/components/auth/AuthSplit'
import { PasswordField } from '@/components/auth/PasswordField'
import { btnPrimary, input, label, msg, msgError } from '@/components/auth/styles'
import { api, ApiError } from '@/lib/api'

const BRAND = {
  kind: 'quote',
  quote: (
    <>
      One account for the booth. <span className="font-semibold">Every machine, same church.</span>
    </>
  ),
  attribution: 'Kairo for ProPresenter',
} as const

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
      await api('/v1/auth/signup', {
        method: 'POST',
        body: { name, email, password, orgName: orgName.trim() },
      })
      // A new account is unverified and its org is bare, so setup comes first.
      // Anyone who arrived mid-flow keeps their destination through it.
      const returnTo = params.get('returnTo')
      router.push(returnTo ? `/onboarding?returnTo=${encodeURIComponent(returnTo)}` : '/onboarding')
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthSplit
      title="Create your account"
      blurb="One account for your church, on every machine in the booth."
      brand={BRAND}
      footer={
        <p className="m-0">
          Already have an account?{' '}
          <Link className="text-paper underline-offset-2 hover:underline" href="/login">
            Sign in
          </Link>
        </p>
      }
    >
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
            placeholder="Joshua Alexander"
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

        <p className={`${msg} ${msgError}`} aria-live="polite">
          {error}
        </p>

        <button className={btnPrimary} type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
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
    <Suspense fallback={<AuthSplit title="Create your account" brand={BRAND}>{null}</AuthSplit>}>
      <SignUpPageContent />
    </Suspense>
  )
}
