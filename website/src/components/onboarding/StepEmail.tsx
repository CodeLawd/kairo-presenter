'use client'

import { useEffect, useRef, useState } from 'react'
import { btnPrimary, linkBtn, msg, msgError, msgOk } from '@/components/auth/styles'
import { api, ApiError } from '@/lib/api'

const LENGTH = 6
const RESEND_COOLDOWN_SEC = 60

/**
 * One input behind a six-box facade, rather than six real inputs.
 *
 * A single field gets paste, backspace and mobile one-time-code autofill right
 * for free; six fields have to reimplement all three and usually get them
 * wrong.
 */
export function StepEmail({
  email,
  onDone,
}: {
  email: string
  onDone: () => void
}): React.ReactElement {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const submitted = useRef(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown((n) => n - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  const verify = async (value: string): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api('/v1/auth/verify-email-code', { method: 'POST', body: { email, code: value } })
      onDone()
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong.')
      submitted.current = false
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const change = (raw: string): void => {
    const digits = raw.replace(/\D/g, '').slice(0, LENGTH)
    setCode(digits)
    // Auto-submit on the sixth digit, as the desktop app does — but only once,
    // or a re-render mid-request would fire a second attempt at the throttle.
    if (digits.length === LENGTH && !submitted.current) {
      submitted.current = true
      void verify(digits)
    }
  }

  const resend = async (): Promise<void> => {
    setError(null)
    // The server allows 3 a minute; hold the button so a person cannot spend
    // that budget and get a throttle message instead of a code.
    setCooldown(RESEND_COOLDOWN_SEC)
    await api('/v1/auth/resend-verification', { method: 'POST', body: { email } }).catch(() => null)
    setNotice('A new code is on its way.')
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="relative">
        <input
          id="code"
          value={code}
          onChange={(e) => change(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={LENGTH}
          aria-label={`Six-digit code sent to ${email}`}
          disabled={busy}
          autoFocus
          className="peer absolute inset-0 h-full w-full cursor-text opacity-0"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none grid grid-cols-6 gap-2 peer-focus:[&>*:first-child]:border-accent/50"
        >
          {Array.from({ length: LENGTH }, (_, i) => (
            <div
              key={i}
              className={`grid h-[52px] place-items-center rounded-[10px] border bg-paper/5 font-mono text-[20px] text-paper ${
                code.length === i ? 'border-accent/50 bg-accent/5' : 'border-line'
              }`}
            >
              {code[i] ?? ''}
            </div>
          ))}
        </div>
      </div>

      <p className={`${msg} ${error ? msgError : msgOk}`} aria-live="polite">
        {error ?? notice}
      </p>

      <button
        className={btnPrimary}
        type="button"
        onClick={() => void verify(code)}
        disabled={busy || code.length < LENGTH}
      >
        {busy ? 'Confirming…' : 'Confirm email'}
      </button>

      <button
        className={`${linkBtn} self-start`}
        type="button"
        onClick={() => void resend()}
        disabled={busy || cooldown > 0}
      >
        {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
      </button>
    </div>
  )
}
