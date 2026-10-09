'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AppTheme } from '@/components/dashboard/app-theme'
import { AuthSplit } from '@/components/auth/AuthSplit'
import { btnPrimary, btnSecondary, input, label, msg, msgError, msgOk } from '@/components/auth/styles'
import { api, authedApi, ApiError } from '@/lib/api'
import { getSession, useAccessToken, type SessionSnapshot } from '@/lib/session'
import { isValidUserCode, normalizeUserCode } from '@contracts/device-code'

function ActivateContent(): React.ReactElement {
  const params = useSearchParams()
  const router = useRouter()
  const tokens = useAccessToken()
  const initialCode = params.get('userCode') ?? ''
  const returnTo = `/activate${initialCode ? `?userCode=${encodeURIComponent(initialCode)}` : ''}`
  const [session, setSession] = useState<SessionSnapshot | null>(null)
  const [code, setCode] = useState(initialCode)
  const [device, setDevice] = useState<{ deviceName: string; expiresAt: string; userCode: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<'approved' | 'denied' | null>(null)

  useEffect(() => {
    let active = true
    void tokens.get().then(getSession).then((value) => {
      if (!active) return
      if (!value.user.emailVerified) {
        router.replace(`/onboarding?step=1&afterVerify=1&returnTo=${encodeURIComponent(returnTo)}`)
      } else { setSession(value) }
    }).catch((failure) => {
      if (!active) return
      if (failure instanceof ApiError && failure.status === 401) router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`)
      else setError(failure instanceof Error ? failure.message : 'Could not load your account.')
    })
    return () => { active = false }
  }, [tokens, router, returnTo])

  const describe = useCallback(async (value: string): Promise<void> => {
    if (!isValidUserCode(value)) { setError('Enter the code shown in Kairo, such as PROA-7K2X.'); return }
    setBusy(true)
    setError(null)
    try {
      const userCode = normalizeUserCode(value)
      const details = await api<{ deviceName: string; expiresAt: string }>(`/v1/auth/device/describe?userCode=${encodeURIComponent(userCode)}`)
      setDevice({ ...details, userCode })
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not find that computer.') }
    finally { setBusy(false) }
  }, [])

  useEffect(() => {
    if (session && initialCode && isValidUserCode(initialCode)) void describe(initialCode)
  }, [session, initialCode, describe])

  const decide = async (approve: boolean): Promise<void> => {
    if (!device || busy) return
    if (Date.parse(device.expiresAt) <= Date.now()) { setError('This code has expired. Start sign-in again in Kairo.'); return }
    setBusy(true)
    setError(null)
    try {
      await authedApi(`/v1/auth/device/${approve ? 'approve' : 'deny'}`, tokens, { method: 'POST', body: { userCode: device.userCode } })
      setOutcome(approve ? 'approved' : 'denied')
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`)
      else setError(failure instanceof Error ? failure.message : 'Could not finish pairing.')
    } finally { setBusy(false) }
  }

  const church = session?.orgs.find((org) => org.id === session.orgId)?.name ?? 'your church'
  return (
    <AuthSplit title={outcome === 'approved' ? 'Your computer is connected' : 'Connect Kairo'} blurb="Approve the computer you’re signing in on." footer={<Link className="text-paper hover:underline" href="/dashboard">Go to your dashboard</Link>}>
      {outcome ? (
        <p className={`${msg} ${msgOk}`} role="status">
          {outcome === 'approved' ? 'Return to Kairo. It will finish signing in automatically.' : 'That request was declined. You can start again in Kairo.'}
        </p>
      ) : !session ? (
        <p className={msg} role="status">{error ?? 'Loading your account…'}</p>
      ) : device ? (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-paper">Sign in <strong>{device.deviceName || 'Kairo computer'}</strong> to <strong>{church}</strong> as {session.user.email}.</p>
          <p className="font-mono text-2xl tracking-widest text-paper">{device.userCode}</p>
          <p className="text-sm text-faint">Check that this code matches the one shown in Kairo before approving.</p>
          {error && <p className={`${msg} ${msgError}`} role="alert">{error}</p>}
          <button className={btnPrimary} disabled={busy} onClick={() => void decide(true)}>{busy ? 'Working…' : 'Approve this computer'}</button>
          <button className={btnSecondary} disabled={busy} onClick={() => void decide(false)}>Decline</button>
          <button className="text-sm text-faint hover:text-paper" disabled={busy} onClick={() => setDevice(null)}>Use a different code</button>
        </div>
      ) : (
        <form className="flex flex-col gap-5" onSubmit={(event) => { event.preventDefault(); void describe(code) }}>
          <div>
            <label className={label} htmlFor="device-code">Code shown in Kairo</label>
            <input className={input} id="device-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="PROA-7K2X" autoComplete="off" spellCheck={false} disabled={busy} required />
          </div>
          {error && <p className={`${msg} ${msgError}`} role="alert">{error}</p>}
          <button className={btnPrimary} disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button>
        </form>
      )}
    </AuthSplit>
  )
}

export default function ActivatePage(): React.ReactElement {
  return (
    <>
      <AppTheme />
      <Suspense fallback={<AuthSplit title="Connect Kairo">{null}</AuthSplit>}><ActivateContent /></Suspense>
    </>
  )
}
