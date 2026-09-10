'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { AuthSplit, type BrandPanel } from '@/components/auth/AuthSplit'
import { linkBtn } from '@/components/auth/styles'
import { Progress } from '@/components/onboarding/Progress'
import { StepChurch } from '@/components/onboarding/StepChurch'
import { StepEmail } from '@/components/onboarding/StepEmail'
import { StepGetKairo } from '@/components/onboarding/StepGetKairo'
import { ApiError } from '@/lib/api'
import { getSession, useAccessToken, type SessionSnapshot } from '@/lib/session'

const TOTAL = 3

const COPY: { title: string; blurb: string; brand: BrandPanel }[] = [
  {
    title: 'Confirm your email',
    blurb: 'We sent a 6-digit code. Enter it here to finish setting up the account.',
    brand: {
      kind: 'quote',
      quote: 'One account for your church, on every machine in the booth.',
      attribution: 'Kairo for ProPresenter',
    },
  },
  {
    title: 'About your church',
    blurb: 'This name follows the account to every machine in the booth.',
    brand: {
      kind: 'quote',
      quote: (
        <>
          One name. <span className="font-semibold">Every booth machine stays in sync.</span>
        </>
      ),
      attribution: 'Kairo for ProPresenter',
    },
  },
  {
    title: 'Get Kairo',
    blurb: 'Install it on the booth machine, or pair one that already has it.',
    brand: {
      kind: 'quote',
      quote: (
        <>
          Your pastor says the verse. <span className="font-semibold">It&rsquo;s already on screen.</span>
        </>
      ),
      attribution: 'Kairo for ProPresenter',
    },
  },
]

function OnboardingContent(): React.ReactElement {
  const router = useRouter()
  const params = useSearchParams()
  const token = useAccessToken()

  const [session, setSession] = useState<SessionSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const returnTo = params.get('returnTo') ?? '/dashboard'
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
      brand={copy.brand}
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
        <AuthSplit title={COPY[0].title} brand={COPY[0].brand}>
          {null}
        </AuthSplit>
      }
    >
      <OnboardingContent />
    </Suspense>
  )
}
