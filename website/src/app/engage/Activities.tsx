'use client'

import { useState } from 'react'
import type { PollView, Reply } from '../../../../src/lib/engage'
import { pollPercent } from './view-model'

export function Replies({ replies }: { replies: Reply[] }): React.ReactElement | null {
  if (!replies.length) return null
  return (
    <div className="col-span-full mt-3 border-t border-black/8 dark:border-white/8">
      {replies.map(reply => (
        <div className="mt-3 border-l-2 border-[#3B6BFF] pt-3 pl-3.5" key={reply.id}>
          <p className="text-xs font-semibold text-[#2F5BE0] dark:text-[#8AB4FF]">
            Answered by the team
            {reply.audience === 'asker' && <span className="font-normal text-[#565B6E] dark:text-[#8D93AD]"> · Only the asker</span>}
          </p>
          <p className="mt-1.5 text-[15px] leading-[1.55] whitespace-pre-wrap wrap-anywhere text-[#0A0B10] dark:text-[#F6F3EB]">
            {reply.text}
          </p>
        </div>
      ))}
    </div>
  )
}

export function AudiencePoll({ poll, connected, onVote }: {
  poll: PollView; connected: boolean; onVote: (id: string, options: string[]) => Promise<void>
}): React.ReactElement {
  const [selection, setSelection] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const voted = poll.voted.length > 0 || submitted
  const canVote = poll.state === 'open' && !voted && connected && !pending
  return (
    <article className="mb-2.5 rounded-[14px] border border-black/8 bg-white px-4 pt-3.5 pb-4 shadow-[0_1px_2px_rgba(26,28,31,0.04),0_6px_18px_rgba(26,28,31,0.05)] dark:border-white/8 dark:bg-[#1B1E24] dark:shadow-[0_1px_2px_rgba(0,0,0,0.25),0_6px_18px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-2.5 text-[13px] font-medium text-[#6B7280] dark:text-[#9CA3AF]">
        <span>{poll.state === 'open' ? 'Open for votes' : 'Voting closed'}</span>
        {poll.multiple && <span>· Choose more than one</span>}
      </div>
      <h2 className="mt-1 mb-3 text-lg leading-[1.35] font-semibold tracking-[-0.015em] wrap-anywhere text-[#1A1C1F] dark:text-[#F3F4F6]">
        {poll.title}
      </h2>
      <form
        onSubmit={event => {
          event.preventDefault()
          if (!canVote || !selection.length) return
          setPending(true)
          setError('')
          void onVote(poll.id, selection)
            .then(() => setSubmitted(true))
            .catch(failure => setError(failure instanceof Error ? failure.message : 'Could not send your vote.'))
            .finally(() => setPending(false))
        }}
      >
        <fieldset className="mb-4 grid gap-2 border-0 p-0" disabled={!canVote} aria-label={poll.title}>
          {poll.options.map(option => (
            <label
              key={option.id}
              className="relative flex min-h-12 flex-wrap items-center gap-2.5 rounded-xl border border-black/8 bg-[#F2F3F5] px-3.5 py-3 dark:border-white/8 dark:bg-[#111317]"
            >
              <input
                type={poll.multiple ? 'checkbox' : 'radio'}
                name={`poll-${poll.id}`}
                value={option.id}
                className="h-[18px] w-[18px] shrink-0 accent-[#3B6BFF]"
                checked={voted ? poll.voted.includes(option.id) || selection.includes(option.id) : selection.includes(option.id)}
                onChange={() =>
                  setSelection(current =>
                    poll.multiple
                      ? current.includes(option.id)
                        ? current.filter(id => id !== option.id)
                        : [...current, option.id]
                      : [option.id],
                  )
                }
              />
              <span className="min-w-0 flex-1 wrap-anywhere text-[#0A0B10] dark:text-[#F6F3EB]">{option.text}</span>
              {poll.showResults && (
                <strong className="text-[13px] text-[#2E3240] tabular-nums dark:text-[#C9CCD6]">
                  {pollPercent(poll.totals[option.id] ?? 0, poll.voters)}%
                </strong>
              )}
              {poll.showResults && (
                <span className="block h-1 w-full overflow-hidden rounded bg-[#E8EAF0] dark:bg-[#1D212B]" aria-hidden="true">
                  <span className="block h-full bg-[#3B6BFF]" style={{ width: `${pollPercent(poll.totals[option.id] ?? 0, poll.voters)}%` }} />
                </span>
              )}
            </label>
          ))}
        </fieldset>
        {poll.state === 'open' && !voted && (
          <button
            className="min-h-10 cursor-pointer rounded-full border-0 bg-[#3B6BFF] px-[18px] text-[15px] font-semibold text-white hover:enabled:brightness-105 disabled:cursor-default disabled:opacity-45"
            disabled={!canVote || !selection.length}
          >
            {pending ? 'Sending…' : 'Vote'}
          </button>
        )}
        {voted && (
          <p className="mt-3 px-1 text-sm leading-normal text-[#1F7A55]">
            Your vote is in.{!poll.showResults && ' Results will appear when the team shares them.'}
          </p>
        )}
        {poll.showResults && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#6B7280] tabular-nums dark:text-[#9CA3AF]">
            {poll.voters} {poll.voters === 1 ? 'person voted' : 'people voted'}
          </p>
        )}
        {error && (
          <p className="mt-3 px-1 text-sm leading-normal text-[#C0392B]" role="alert">
            {error}
          </p>
        )}
      </form>
    </article>
  )
}
