'use client'

import { safeReturnPath } from '@contracts/return-path'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { AuthSplit } from '@/components/auth/AuthSplit'
import { linkBtn } from '@/components/auth/styles'
import { Progress } from '@/components/onboarding/Progress'
import { StepChurch } from '@/components/onboarding/StepChurch'
import { StepEmail } from '@/components/onboarding/StepEmail'
import { StepGetKairo } from '@/components/onboarding/StepGetKairo'
import { ApiError } from '@/lib/api'
import { getSession, useAccessToken, type SessionSnapshot } from '@/lib/session'

const TOTAL = 3

const COPY: { title: string; blurb: string }[] = [
  {
    title: 'Confirm your email',
    blurb: 'We sent a six-digit code to your inbox. It’s good for 24 hours.',
  },
  {
    title: 'About your church',
    blurb: 'Add the church name and service times your team will use.',
  },
  {
    title: 'You’re all set for now',
    blurb: 'Your account is ready. Choose a download for your computer, then sign in to Kairo with this account.',
  },
]

function OnboardingContent(): React.ReactElement {
  const router = useRouter()
  const params = useSearchParams()
  const token = useAccessToken()

  const [session, setSession] = useState<SessionSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const returnTo = safeReturnPath(params.get('returnTo'))
  const afterVerify = params.get('afterVerify') === '1'
  const raw = Number(params.get('step'))
  const step = Number.isFinite(raw) && raw >= 1 && raw <= TOTAL ? Math.trunc(raw) : 1

  const goTo = useCallback(
    (next: number): void => {
      const query = new URLSearchParams()
      query.set('step', String(next))
      if (params.get('returnTo')) query.set('returnTo', returnTo)
      if (afterVerify) query.set('afterVerify', '1')
      router.replace(`/onboarding?${query.toString()}`, { scroll: false })
    },
    [afterVerify, params, returnTo, router],
  )

  const finish = useCallback((): void => router.push(returnTo), [router, returnTo])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const snapshot = await getSession(await token.get())
        if (cancelled) return
        setSession(snapshot)
        // Someone who confirmed their address already should not be asked again.
        if (snapshot.user.emailVerified && step === 1) {
          if (afterVerify) finish()
          else goTo(2)
        }
      } catch (failure) {
        if (cancelled) return
        if (failure instanceof ApiError && failure.status === 401) {
          router.push(`/login?returnTo=${encodeURIComponent(returnTo)}`)
          return
        }
        setLoadError(
          failure instanceof ApiError ? failure.message : 'Could not load your account.',
        )
      }
    })()
    return () => {
      cancelled = true
    }
    // Runs once: re-running on every step change would re-fetch the session and
    // could bounce someone off step 1 again mid-flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const copy = COPY[step - 1]

  return (
    <AuthSplit
      title={copy.title}
      blurb={loadError ?? copy.blurb}
      header={<Progress step={step} total={TOTAL} />}
      footer={
        <div className="flex items-center justify-between gap-4">
          <button className={linkBtn} type="button" onClick={finish}>
            Finish later
          </button>
          {step > 1 && (
            <button className={linkBtn} type="button" onClick={() => goTo(step - 1)}>
              Back
            </button>
          )}
        </div>
      }
    >
      {step === 1 && session && (
        <StepEmail
          email={session.user.email}
          onDone={() => {
            // Login of an unverified account only needs the email step — then
            // take them where they were headed (activate / dashboard).
            if (afterVerify) finish()
            else goTo(2)
          }}
        />
      )}
      {step === 2 && (
        <StepChurch
          orgId={session?.orgId ?? null}
          role={session?.role ?? null}
          getToken={token.get}
          onDone={() => goTo(3)}
        />
      )}
      {step === 3 && <StepGetKairo onFinish={finish} />}
    </AuthSplit>
  )
}

/**
 * `useSearchParams` makes a page client-rendered; Next requires the boundary to
 * be explicit so the shell can still be prerendered.
 */
export default function OnboardingPage(): React.ReactElement {
  return (
    <Suspense
      fallback={
        <AuthSplit title={COPY[0].title}>
          {null}
        </AuthSplit>
      }
    >
      <OnboardingContent />
    </Suspense>
  )
}
