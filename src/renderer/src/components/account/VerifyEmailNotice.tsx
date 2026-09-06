import { useEffect, useState } from 'react'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { useAccountStore } from '@/stores/useAccountStore'

const CODE_LENGTH = 6

/**
 * Confirm the address without leaving the app.
 *
 * A booth machine often has no mail client, so the operator reads the code off
 * their phone and types it here — no browser, no link, no window switching.
 *
 * Submitting on the sixth digit: asking someone to type six digits and then
 * reach for a button is one interaction too many.
 */
export default function VerifyEmailNotice(): React.ReactElement {
  const email = useAccountStore((s) => s.session.user?.email)
  const setSession = useAccountStore((s) => s.setSession)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resent, setResent] = useState(false)

  // Submitting on the sixth digit — asking someone to type six digits and then
  // reach for a button is one interaction too many.
  useEffect(() => {
    if (code.length !== CODE_LENGTH || busy) return

    let cancelled = false
    setBusy(true)
    setError(null)
    void window.api.account
      .verifyEmailCode(code)
      .then((result) => {
        if (cancelled) return
        if (result.ok && result.data) {
          setSession(result.data)
          return
        }
        setError(result.error ?? 'That code did not work.')
        setCode('')
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })

    return () => {
      cancelled = true
    }
  }, [code, busy, setSession])

  const resend = async (): Promise<void> => {
    setError(null)
    setCode('')
    const result = await window.api.account.resendVerification()
    setResent(result.ok)
    if (!result.ok) setError(result.error ?? 'Could not send it. Try again shortly.')
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-relaxed text-slate-500">
        Sent to <span className="text-slate-300">{email}</span>
      </p>

      <InputOTP
        maxLength={CODE_LENGTH}
        value={code}
        onChange={setCode}
        disabled={busy}
        autoFocus
        aria-label="Confirmation code"
      >
        <InputOTPGroup>
          {Array.from({ length: CODE_LENGTH }, (_, index) => (
            <InputOTPSlot key={index} index={index} />
          ))}
        </InputOTPGroup>
      </InputOTP>

      <div className="flex items-center gap-3 text-[12px]" aria-live="polite">
        <button
          type="button"
          className="text-slate-500 underline-offset-2 transition-colors hover:text-slate-300 hover:underline disabled:opacity-50"
          onClick={() => void resend()}
          disabled={busy}
        >
          Send a new code
        </button>
        {busy && <span className="text-slate-500">Checking…</span>}
        {error && <span className="text-rose-400">{error}</span>}
        {resent && !error && !busy && (
          // A new code kills the previous one, so say which to use.
          <span className="text-slate-500">Sent — use the newest one.</span>
        )}
      </div>
    </div>
  )
}
