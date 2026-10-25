'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AppTheme } from '@/components/dashboard/app-theme'
import { AuthSplit } from '@/components/auth/AuthSplit'
import { btnPrimary, btnSecondary, codeInput, label, linkBtn, msg, msgError } from '@/components/auth/styles'
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
  const dashboardLink = <Link className="font-medium text-paper underline-offset-2 hover:underline" href="/dashboard">Go to your dashboard</Link>

  if (outcome) {
    return (
      <AuthSplit
        title={outcome === 'approved' ? 'Computer connected' : 'Request declined'}
        blurb={outcome === 'approved' ? 'Return to Kairo. It finishes signing in on its own.' : 'Nothing was connected. You can start again from Kairo.'}
        footer={dashboardLink}
      >
        {null}
      </AuthSplit>
    )
  }

  if (session && device) {
    const rows: Array<[string, string]> = [
      ['Computer', device.deviceName || 'Kairo computer'],
      ['Church', church],
      ['Account', session.user.email],
    ]
    return (
      <AuthSplit
        title="Connect Kairo"
        blurb="Make sure this code matches the one on the computer’s screen."
        footer={<button className={linkBtn} type="button" disabled={busy} onClick={() => { setError(null); setDevice(null) }}>Use a different code</button>}
      >
        <div className="flex flex-col gap-6">
          <div className="overflow-hidden rounded-xl border border-line bg-panel">
            <p className="m-0 px-4 py-5 text-center font-mono text-[26px] tracking-[0.2em] text-paper">{device.userCode}</p>
            <dl className="m-0 border-t border-line">
              {rows.map(([name, value]) => (
                <div key={name} className="flex items-baseline justify-between gap-4 px-4 py-3 border-t border-line text-[14px] first:border-t-0">
                  <dt className="text-mute">{name}</dt>
                  <dd className="m-0 min-w-0 truncate text-right font-medium text-paper" title={value}>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          {error && <p className={`${msg} ${msgError}`} role="alert">{error}</p>}
          <div className="flex flex-col gap-3">
            <button className={btnPrimary} disabled={busy} onClick={() => void decide(true)}>{busy ? 'Working…' : 'Approve'}</button>
            <button className={btnSecondary} disabled={busy} onClick={() => void decide(false)}>Decline</button>
          </div>
        </div>
      </AuthSplit>
    )
  }

  return (
    <AuthSplit title="Connect Kairo" blurb="Enter the code shown in Kairo to sign that computer in to your church." footer={dashboardLink}>
      {!session ? (
        <p className={msg} role="status">{error ?? 'Loading your account…'}</p>
      ) : (
        <form className="flex flex-col gap-5" onSubmit={(event) => { event.preventDefault(); void describe(code) }}>
          <div>
            <label className={label} htmlFor="device-code">Code</label>
            <input className={codeInput} id="device-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="PROA-7K2X" autoComplete="off" spellCheck={false} disabled={busy} required />
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
