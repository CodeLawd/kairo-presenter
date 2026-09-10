'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { AuthSplit } from '@/components/auth/AuthSplit'
import { btnPrimary, codeInput, label, msg, msgError } from '@/components/auth/styles'
import { api, ApiError } from '@/lib/api'
import { mintAccessToken } from '@/lib/session'

const BRAND = {
  kind: 'shot',
  src: '/shots/theme.png',
  alt: 'The Kairo theme editor, running on a booth machine.',
  caption: 'Pair a booth machine — no password typed at the desk',
} as const

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
      const accessToken = await mintAccessToken()
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
      <AuthSplit
        title={`${approved} is signed in`}
        blurb="You can close this page. The machine will finish signing itself in within a few seconds."
        brand={BRAND}
      >
        {null}
      </AuthSplit>
    )
  }

  return (
    <AuthSplit
      title="Activate a machine"
      blurb="Enter the code shown in Kairo on the computer you are signing in."
      brand={BRAND}
    >
      <form className="flex flex-col gap-5" onSubmit={approve}>
        <div>
          <label className={label} htmlFor="code">
            Code
          </label>
          <input
            id="code"
            className={codeInput}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="PROA-7K2X"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </div>

        <p className={`${msg} ${msgError}`} aria-live="polite">
          {error}
        </p>

        <button className={btnPrimary} type="submit" disabled={busy}>
          {busy ? 'Approving…' : 'Approve this machine'}
        </button>
      </form>
    </AuthSplit>
  )
}
