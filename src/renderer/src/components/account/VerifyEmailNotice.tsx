import { useEffect, useRef, useState } from 'react'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { useAccountStore } from '@/stores/useAccountStore'
import { cn } from '@/lib/utils'

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
export default function VerifyEmailNotice({ showEmail = true, centered = false }: {
  /** Off when the surrounding page already names the address. */
  showEmail?: boolean
  /** Centre the boxes and links (setup); left-aligned in Settings. */
  centered?: boolean
} = {}): React.ReactElement {
  const email = useAccountStore((s) => s.session.user?.email)
  const setSession = useAccountStore((s) => s.setSession)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resent, setResent] = useState(false)

  // One request at a time, and none landing on a page that has gone.
  const inFlight = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  // Set on every mount, not just in the initial value: Strict Mode mounts,
  // cleans up and mounts again, and a flag only ever cleared would stay false
  // and discard every answer.
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Submitting on the sixth digit — asking someone to type six digits and then
  // reach for a button is one interaction too many. Sent from the change itself,
  // not an effect: an effect keyed on `busy` re-ran when it set `busy`, and its
  // cleanup discarded the answer, leaving "Checking…" up forever.
  const submit = async (value: string): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    setResent(false)
    try {
      const result = await window.api.account.verifyEmailCode(value)
      if (!mounted.current) return
      if (result.ok && result.data) {
        setSession(result.data)
        return
      }
      setError(result.error ?? 'That code didn’t work. Check it and try again.')
      setCode('')
    } catch {
      if (!mounted.current) return
      setError('Couldn’t reach Kairo. Check your connection and try again.')
      setCode('')
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }

  // After a wrong code the boxes were disabled while checking; put the cursor
  // back so the next attempt can be typed straight away.
  useEffect(() => {
    if (!busy && error) inputRef.current?.focus()
  }, [busy, error])

  const onCodeChange = (value: string): void => {
    setCode(value)
    if (value.length === CODE_LENGTH) void submit(value)
  }

  const resend = async (): Promise<void> => {
    setError(null)
    setCode('')
    const result = await window.api.account.resendVerification()
    setResent(result.ok)
    if (!result.ok) setError(result.error ?? 'Could not send it. Try again shortly.')
  }

  return (
    <div className={cn('flex flex-col gap-4', centered && 'items-center text-center')}>
      {showEmail && (
        <p className="text-[13px] leading-relaxed text-slate-500">
          Sent to <span className="text-slate-300">{email}</span>
        </p>
      )}

      <InputOTP
        maxLength={CODE_LENGTH}
        value={code}
        ref={inputRef}
        onChange={onCodeChange}
        disabled={busy}
        autoFocus
        aria-label="Confirmation code"
        containerClassName={cn(centered && 'justify-center')}
      >
        <InputOTPGroup>
          {Array.from({ length: CODE_LENGTH }, (_, index) => (
            <InputOTPSlot key={index} index={index} />
          ))}
        </InputOTPGroup>
      </InputOTP>

      {/* One quiet line under the boxes: what is happening, or how to get a new code. */}
      <p className="min-h-[18px] text-[12px] text-slate-500" aria-live="polite">
        {busy ? (
          'Checking…'
        ) : (
          <>
            {error ? (
              <span key={error} className="onboarding-error inline-block text-rose-400">{error}</span>
            ) : resent ? (
              // A new code kills the previous one, so say which to use.
              'New code sent — use the newest one.'
            ) : (
              'Didn’t get it?'
            )}{' '}
            {/* Always offered: an error such as "expired" is only fixed by a new code. */}
            {!resent && (
              <button
                type="button"
                className="font-medium text-slate-300 transition-colors hover:text-white disabled:opacity-50"
                onClick={() => void resend()}
              >
                Send a new code
              </button>
            )}
          </>
        )}
      </p>
    </div>
  )
}
