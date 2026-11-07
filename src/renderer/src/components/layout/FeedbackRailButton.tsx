import { useEffect, useRef, useState } from 'react'
import { Popover } from 'radix-ui'
import { ChatCircleDots, CheckCircle, Heart, Lightbulb, WarningCircle, type Icon } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { hueStyle, railHueClass, RAIL_LABEL } from '@/lib/hue'
import { useAccountStore } from '@/stores/useAccountStore'
import { FEEDBACK_MAX_CHARS, type FeedbackKind } from '@shared/cloud/feedback'

const KINDS: { id: FeedbackKind; label: string; icon: Icon; placeholder: string }[] = [
  { id: 'idea', label: 'Idea', icon: Lightbulb, placeholder: 'What would make Sunday easier? A feature, a shortcut, anything.' },
  { id: 'problem', label: 'Problem', icon: WarningCircle, placeholder: 'What happened, and what did you expect? Steps help us fix it fast.' },
  { id: 'praise', label: 'Praise', icon: Heart, placeholder: 'What do you love? It tells us what to keep.' },
]

type Phase = 'idle' | 'sending' | 'sent'

/**
 * Feedback, at the foot of the workspace rail: an idea, a problem or a kind
 * word, sent straight to the Kairo team's admin console. The sender (name,
 * email, church) is attached by the server from the signed-in account, so
 * nobody types contact details and we can always write back.
 */
export function FeedbackRailButton({ context }: { context?: string }): React.ReactElement {
  const session = useAccountStore((s) => s.session)
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<FeedbackKind>('idea')
  const [message, setMessage] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const signedIn = session.state !== 'signed-out' && Boolean(session.user)
  const name = session.user?.name?.trim()
  const email = session.user?.email
  const trimmed = message.trim()
  const canSend = signedIn && trimmed.length > 0 && phase === 'idle'

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  const onOpenChange = (next: boolean): void => {
    setOpen(next)
    // After a thank-you, the next open starts fresh; a draft survives a stray click away.
    if (!next && phase === 'sent') {
      setPhase('idle')
      setMessage('')
      setKind('idea')
    }
    if (!next) setError(null)
  }

  const send = async (): Promise<void> => {
    if (!canSend) return
    setPhase('sending')
    setError(null)
    const result = await window.api.feedback.send({ kind, message: trimmed, context })
    if (!result.ok) {
      setPhase('idle')
      setError(result.error ?? 'Could not send. Check your connection and try again.')
      return
    }
    setPhase('sent')
    closeTimer.current = setTimeout(() => onOpenChange(false), 2200)
  }

  const current = KINDS.find((k) => k.id === kind) ?? KINDS[0]

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger className={railHueClass(open)} style={hueStyle('coral')}>
        <span className="grid size-5 place-items-center">
          <ChatCircleDots size={20} weight={open ? 'fill' : 'regular'} aria-hidden="true" />
        </span>
        <span className={RAIL_LABEL}>Feedback</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="end"
          sideOffset={10}
          collisionPadding={12}
          className="z-50 w-80 overflow-hidden rounded-xl bg-surface-elevated text-zinc-200 animate-spring-in"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() }
          }}
        >
          {phase === 'sent' ? (
            <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
              <CheckCircle size={36} weight="fill" className="text-emerald-400 animate-spring-in" aria-hidden="true" />
              <p className="text-[14px] font-semibold text-zinc-50">Thank you</p>
              <p className="text-[12px] leading-snug text-zinc-400">
                It's with the Kairo team. We read every note{email ? ` and may reply to ${email}` : ''}.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 p-3">
              {/* Title and the kind of note, on one line. */}
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold tracking-tight text-zinc-50">Feedback</p>
                <div role="radiogroup" aria-label="Kind of feedback" className="flex gap-0.5">
                  {KINDS.map((k) => {
                    const Glyph = k.icon
                    const selected = k.id === kind
                    return (
                      <button
                        key={k.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setKind(k.id)}
                        className={cn(
                          'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30',
                          selected ? 'bg-white/[0.1] text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                        )}
                      >
                        <Glyph size={12} weight={selected ? 'fill' : 'regular'} aria-hidden="true" />
                        {k.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <textarea
                autoFocus
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, FEEDBACK_MAX_CHARS))}
                placeholder={current.placeholder}
                rows={5}
                disabled={!signedIn || phase === 'sending'}
                aria-label="Your feedback"
                className="min-h-[104px] w-full resize-none rounded-lg bg-white/[0.04] px-2.5 py-2 text-[12.5px] leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:bg-white/[0.06] focus:outline-none disabled:opacity-60"
              />

              {error && <p className="text-[11px] leading-snug text-red-400">{error}</p>}

              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[11px] text-zinc-500" title={email}>
                  {signedIn ? `Sent as ${name || email}` : 'Sign in to send feedback'}
                </p>
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={!canSend}
                  className="shrink-0 rounded-md bg-teal-500 px-3 py-1 text-[12px] font-medium text-on-accent transition-[background-color,opacity] hover:bg-teal-600 disabled:bg-white/[0.08] disabled:text-zinc-500"
                  title="Send (⌘↵)"
                >
                  {phase === 'sending' ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
