'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/lib/api'

/**
 * Approves a booth machine.
 *
 * The desktop shows a code; this page is where a person with an account grants
 * it. Approval binds the machine to whichever org the approver is currently in,
 * so pairing can never widen access beyond what they already had.
 */
export default function ActivatePage(): React.ReactElement {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [approved, setApproved] = useState<string | null>(null)

  const approve = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // The page has no access token in memory (the refresh cookie is HttpOnly),
      // so mint one first. A 401 here means "not signed in" — send them to do so
      // and come straight back.
      const { accessToken } = await api<{ accessToken: string }>('/v1/auth/refresh', {
        method: 'POST',
        body: {},
      })
      const result = await api<{ deviceName: string }>('/v1/auth/device/approve', {
        method: 'POST',
        body: { userCode: code },
        accessToken,
      })
      setApproved(result.deviceName || 'That machine')
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        router.push(`/login?returnTo=${encodeURIComponent('/activate')}`)
        return
      }
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (approved) {
    return (
      <div className="card">
        <p className="wordmark">Kairo</p>
        <h1>{approved} is signed in</h1>
        <p className="lead">
          You can close this page. The machine will finish signing itself in within a few seconds.
        </p>
      </div>
    )
  }

  return (
    <form className="card" onSubmit={approve}>
      <p className="wordmark">Kairo</p>
      <h1>Activate a machine</h1>
      <p className="lead">Enter the code shown in Kairo on the computer you are signing in.</p>

      <label htmlFor="code">Code</label>
      <input
        id="code"
        className="code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="PROA-7K2X"
        autoComplete="off"
        spellCheck={false}
        required
      />

      <p className="message error" aria-live="polite">{error}</p>

      <button className="primary" type="submit" disabled={busy}>
        {busy ? 'Approving…' : 'Approve this machine'}
      </button>
    </form>
  )
}
