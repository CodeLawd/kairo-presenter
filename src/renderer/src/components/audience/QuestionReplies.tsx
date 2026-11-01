import { useState } from 'react'
import type { AudienceQuestion, AudienceState } from '@shared/audience'
import { SegmentedControl } from '@/components/shared/SegmentedControl'

type Act = (action: () => Promise<AudienceState>) => void

const TEXT_BUTTON = 'text-[11px] text-zinc-500 hover:text-zinc-200 disabled:opacity-40'

/**
 * What sits under a question in an engagement: who sent or edited it, the
 * team's replies, and the Reply / Fix typo composers. Slido questions get none.
 */
export function QuestionReplies({ question: q, state, busy, act }: { question: AudienceQuestion; state: AudienceState; busy: boolean; act: Act }): React.ReactElement | null {
  const [open, setOpen] = useState<'reply' | 'edit' | null>(null)
  const [reply, setReply] = useState('')
  const [audience, setAudience] = useState<'everyone' | 'asker'>('everyone')
  const [text, setText] = useState(q.text)
  if (q.sourceId !== 'kairo' || !state.session) return null
  const replies = state.engage?.replies.filter((r) => r.questionId === q.id) ?? []

  return (
    <div className="mt-1.5 space-y-2">
      {(q.sentBy || q.editedBy) && (
        <p className="flex flex-wrap gap-x-2 text-[11px]">
          {q.sentBy && <span className="text-teal-300">Sent to you by {q.sentBy}</span>}
          {q.editedBy && (
            <span className="text-zinc-500" title={q.originalText ? `Originally: ${q.originalText}` : undefined}>
              Edited by {q.editedBy}
            </span>
          )}
        </p>
      )}

      {replies.map((r) => (
        <div key={r.id} className="rounded-md bg-surface-tertiary px-2.5 py-2">
          <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-zinc-200">{r.text}</p>
          <p className="mt-1 text-[11px] text-zinc-500">
            {r.by} · {r.audience === 'asker' ? 'Only the asker sees this' : 'Everyone sees this'}
          </p>
        </div>
      ))}

      {open === 'reply' && (
        <form
          className="rounded-md bg-surface-tertiary p-2"
          onSubmit={(event) => {
            event.preventDefault()
            act(async () => {
              const next = await window.api.audience.command({ type: 'reply', questionId: q.id, text: reply.trim(), audience })
              setReply('')
              setOpen(null)
              return next
            })
          }}
        >
          <textarea
            aria-label="Reply"
            autoFocus
            rows={2}
            maxLength={2000}
            placeholder="Write a reply"
            className="input resize-none bg-surface-secondary text-[13px]"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
          />
          <div className="mt-2 flex items-center gap-2">
            <SegmentedControl
              label="Who sees this reply"
              fit
              className="bg-surface-secondary"
              value={audience}
              onChange={setAudience}
              options={[
                { value: 'everyone', label: 'Everyone' },
                { value: 'asker', label: 'Only the asker' },
              ]}
            />
            <button type="button" className={`${TEXT_BUTTON} ml-auto`} onClick={() => setOpen(null)}>
              Cancel
            </button>
            <button className="btn-primary h-7 px-3 py-0 text-xs" disabled={busy || !reply.trim()}>
              Reply
            </button>
          </div>
        </form>
      )}

      {open === 'edit' && (
        <form
          className="rounded-md bg-surface-tertiary p-2"
          onSubmit={(event) => {
            event.preventDefault()
            act(async () => {
              const next = await window.api.audience.command({ type: 'edit', id: q.id, text: text.trim() })
              setOpen(null)
              return next
            })
          }}
        >
          <textarea aria-label="Question text" autoFocus rows={2} maxLength={280} className="input resize-none bg-surface-secondary text-[13px]" value={text} onChange={(event) => setText(event.target.value)} />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button type="button" className={TEXT_BUTTON} onClick={() => setOpen(null)}>
              Cancel
            </button>
            <button className="btn-primary h-7 px-3 py-0 text-xs" disabled={busy || !text.trim() || text.trim() === q.text}>
              Save
            </button>
          </div>
        </form>
      )}

      {open === null && (
        <div className="flex gap-3">
          <button type="button" className={TEXT_BUTTON} disabled={busy} onClick={() => setOpen('reply')}>
            Reply
          </button>
          {q.state === 'review' && (
            <button
              type="button"
              className={TEXT_BUTTON}
              disabled={busy}
              onClick={() => {
                setText(q.text)
                setOpen('edit')
              }}
            >
              Fix typo
            </button>
          )}
        </div>
      )}
    </div>
  )
}
