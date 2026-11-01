'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Logo } from '@/components/brand/Logo'
import type { AudienceQuestion, AudienceQuestionState } from '../../../../src/lib/audience'
import { sortAudienceQuestions } from '../../../../src/lib/audience'
import { normalizePoll, type PollView, type Reply } from '../../../../src/lib/engage'
import { Replies } from './Activities'
import RequestLink from './RequestLink'
import { pollPercent } from './view-model'
import { useModeration, type ModeratorCommand } from './use-moderation'

type Send = (command: ModeratorCommand) => Promise<void>
const TABS: Array<{ value: AudienceQuestionState; label: string; matches: (state: AudienceQuestionState) => boolean }> = [
  { value: 'approved', label: 'Open', matches: (state) => state === 'approved' || state === 'review' },
  { value: 'answered', label: 'Answered', matches: (state) => state === 'answered' },
  { value: 'hidden', label: 'Hidden', matches: (state) => state === 'hidden' },
]

const BTN_SECONDARY =
  'min-h-9 cursor-pointer rounded-lg border border-black/10 bg-[#F3F4F7] px-3 py-1.5 text-[13px] font-semibold text-[#2E3240] transition-colors hover:enabled:bg-[#E8EAF0] hover:enabled:text-[#0A0B10] disabled:cursor-default disabled:opacity-45'
const BTN_PRIMARY =
  'min-h-10 cursor-pointer rounded-full border-0 bg-[#3B6BFF] px-[18px] text-sm font-semibold text-white transition-all hover:enabled:brightness-105 disabled:cursor-default disabled:opacity-45'
const INPUT_CLASS =
  'block min-h-11 w-full rounded-xl border border-black/10 bg-[#F3F4F7] px-3.5 py-2.5 text-[15px] text-[#0A0B10] placeholder:text-[#666B7E] focus:border-[#3B6BFF] focus:bg-white focus:outline-none disabled:opacity-60'

function ModerationQuestion({ question: q, replies, send, connected }: { question: AudienceQuestion; replies: Reply[]; send: Send; connected: boolean }): React.ReactElement {
  const [editing, setEditing] = useState(false), [text, setText] = useState(q.text)
  const [replying, setReplying] = useState(false), [reply, setReply] = useState('')
  const [audience, setAudience] = useState<'everyone' | 'asker'>('everyone')
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const run = async (command: ModeratorCommand, after?: () => void): Promise<void> => {
    setPending(true); setError(''); setNotice('')
    try { await send(command); after?.() } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not complete the action.') } finally { setPending(false) }
  }
  const disabled = !connected || pending
  return (
    <article className="mb-3 rounded-[14px] border border-black/8 bg-white p-4 shadow-[0_1px_2px_rgba(26,28,31,0.04),0_6px_18px_rgba(26,28,31,0.05)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#E8EAED] text-xs font-semibold text-[#6B7280]" aria-hidden="true">
            {(q.author || '?').trim().charAt(0).toUpperCase()}
          </span>
          <span className="truncate text-sm font-semibold text-[#1A1C1F]">{q.author || 'Anonymous'}</span>
          {q.sentBy && (
            <span className="inline-flex rounded-md bg-[#3B6BFF]/12 px-2 py-0.5 text-xs font-semibold text-[#2F5BE0]">
              Sent by {q.sentBy}
            </span>
          )}
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-[#F2F3F5] px-2.5 py-1 text-xs font-semibold text-[#3C4048] tabular-nums">
          {q.votes} {q.votes === 1 ? 'vote' : 'votes'}
        </span>
      </div>

      {editing && q.state === 'review' ? (
        <form
          className="mt-3.5 grid gap-3"
          onSubmit={event => {
            event.preventDefault()
            void run({ type: 'edit', id: q.id, text }, () => setEditing(false))
          }}
        >
          <label className="grid gap-1.5 text-sm font-medium text-[#1A1C1F]">
            Fix a typo
            <textarea
              rows={3}
              value={text}
              onChange={event => setText(event.target.value)}
              required
              maxLength={560}
              className={`${INPUT_CLASS} min-h-[88px] resize-y`}
            />
          </label>
          <p className="text-xs text-[#6B7280]">{Array.from(text).length}/280 characters. The original question is kept.</p>
          <div className="flex flex-wrap gap-2">
            <button className={BTN_PRIMARY} disabled={disabled || !text.trim() || Array.from(text.trim()).length > 280}>Save edit</button>
            <button type="button" className={BTN_SECONDARY} onClick={() => setEditing(false)} disabled={pending}>Cancel</button>
          </div>
        </form>
      ) : (
        <p className="mt-2.5 text-[15px] leading-normal whitespace-pre-wrap wrap-anywhere text-[#1A1C1F]">{q.text}</p>
      )}

      {q.editedBy && (
        <details className="mt-2.5 text-xs text-[#6B7280]">
          <summary className="cursor-pointer font-medium">Edited by {q.editedBy}</summary>
          <p className="mt-1.5 whitespace-pre-wrap wrap-anywhere">{q.originalText}</p>
        </details>
      )}

      <Replies replies={replies} />

      <div className="mt-3.5 flex flex-wrap gap-2 border-t border-black/6 pt-3">
        {q.state === 'review' && (
          <>
            <button
              type="button"
              disabled={disabled}
              className="min-h-9 cursor-pointer rounded-lg border-0 bg-[#3B6BFF] px-3.5 py-1.5 text-[13px] font-semibold text-white transition-all hover:enabled:brightness-105 disabled:cursor-default disabled:opacity-45"
              onClick={() => { void run({ type: 'state', id: q.id, state: 'approved' }) }}
            >
              Approve
            </button>
            <button type="button" className={BTN_SECONDARY} disabled={disabled || editing} onClick={() => { setText(q.text); setEditing(true) }}>
              Fix typo
            </button>
          </>
        )}
        {q.state === 'approved' && (
          <button type="button" className={BTN_SECONDARY} disabled={disabled} onClick={() => { void run({ type: 'state', id: q.id, state: 'answered' }) }}>
            Mark answered
          </button>
        )}
        {q.state === 'answered' && (
          <button type="button" className={BTN_SECONDARY} disabled={disabled} onClick={() => { void run({ type: 'state', id: q.id, state: 'approved' }) }}>
            Move to open
          </button>
        )}
        {q.state === 'hidden' ? (
          <button type="button" className={BTN_SECONDARY} disabled={disabled} onClick={() => { void run({ type: 'state', id: q.id, state: 'approved' }) }}>
            Restore to open
          </button>
        ) : (
          <button type="button" className={BTN_SECONDARY} disabled={disabled} onClick={() => { void run({ type: 'state', id: q.id, state: 'hidden' }) }}>
            Hide
          </button>
        )}
        <button type="button" className={BTN_SECONDARY} disabled={disabled} aria-expanded={replying} onClick={() => setReplying(value => !value)}>
          Reply
        </button>
        {(q.state === 'approved' || q.state === 'answered') && (
          <button
            type="button"
            className="min-h-9 cursor-pointer rounded-lg border border-[#3B6BFF]/30 bg-[#3B6BFF]/10 px-3.5 py-1.5 text-[13px] font-semibold text-[#2F5BE0] transition-colors hover:enabled:bg-[#3B6BFF]/16 disabled:cursor-default disabled:opacity-45"
            disabled={disabled}
            onClick={() => { void run({ type: 'present', id: q.id }, () => setNotice('Sent to the presenter.')) }}
          >
            Send to presenter
          </button>
        )}
      </div>

      {replying && (
        <form
          className="mt-3.5 grid gap-3 rounded-xl bg-[#F2F3F5] p-3.5"
          onSubmit={event => {
            event.preventDefault()
            void run({ type: 'reply', questionId: q.id, text: reply, audience }, () => { setReply(''); setReplying(false); setNotice('Reply sent.') })
          }}
        >
          <label className="grid gap-1.5 text-sm font-medium text-[#1A1C1F]">
            Your reply
            <textarea
              required
              rows={3}
              maxLength={2000}
              value={reply}
              onChange={event => setReply(event.target.value)}
              disabled={pending}
              className="block min-h-[84px] w-full resize-y rounded-lg border border-black/10 bg-white px-3 py-2 text-[15px] text-[#0A0B10] focus:border-[#3B6BFF] focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-[#3C4048]">
              Visible to:
              <select
                value={audience}
                onChange={event => setAudience(event.target.value as 'everyone' | 'asker')}
                disabled={pending}
                className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#1A1C1F]"
              >
                <option value="everyone">Everyone</option>
                <option value="asker">Only the asker</option>
              </select>
            </label>
            <button className={BTN_PRIMARY} disabled={disabled || !reply.trim()}>{pending ? 'Sending…' : 'Send reply'}</button>
          </div>
        </form>
      )}
      {error && <p className="mt-2.5 text-sm text-[#C0392B]" role="alert">{error}</p>}
      {notice && <p className="mt-2.5 text-sm text-[#1F7A55]" role="status">{notice}</p>}
    </article>
  )
}

function PollEditor({ poll, send, connected, onDone }: { poll?: PollView; send: Send; connected: boolean; onDone: () => void }): React.ReactElement {
  const [id, setId] = useState(poll?.id ?? ''), [title, setTitle] = useState(poll?.title ?? '')
  const [options, setOptions] = useState(poll?.options.map(option => option.text).join('\n') ?? '')
  const [multiple, setMultiple] = useState(poll?.multiple ?? false), [pending, setPending] = useState(false), [error, setError] = useState('')
  return (
    <form
      className="grid gap-3.5"
      onSubmit={event => {
        event.preventDefault(); setError('')
        let normalized
        try { normalized = normalizePoll({ id: id || crypto.randomUUID(), title, multiple, options: options.split('\n').filter(option => option.trim()) }) } catch (failure) { setError(failure instanceof Error ? failure.message : 'Check the poll.'); return }
        setId(normalized.id); setPending(true)
        void send({ type: 'poll-save', poll: normalized }).then(onDone).catch(failure => setError(failure instanceof Error ? failure.message : 'Could not save the poll.')).finally(() => setPending(false))
      }}
    >
      <h2 className="text-lg font-bold text-[#1A1C1F]">{poll ? 'Edit draft poll' : 'New poll'}</h2>
      <label className="grid gap-1.5 text-sm font-medium text-[#1A1C1F]">
        Title
        <input value={title} required maxLength={200} onChange={event => setTitle(event.target.value)} disabled={pending} className={INPUT_CLASS} />
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-[#1A1C1F]">
        Options · one per line
        <textarea value={options} required rows={5} onChange={event => setOptions(event.target.value)} disabled={pending} className={`${INPUT_CLASS} min-h-[110px] resize-y`} />
      </label>
      <p className="text-xs text-[#6B7280]">Add between 2 and 12 different options, up to 120 characters each.</p>
      <label className="flex min-h-9 items-center gap-2.5 text-sm font-medium text-[#0A0B10]">
        <input type="checkbox" className="h-[18px] w-[18px] accent-[#3B6BFF]" checked={multiple} onChange={event => setMultiple(event.target.checked)} disabled={pending} />
        Allow more than one choice
      </label>
      <div className="flex flex-wrap gap-2">
        <button className={BTN_PRIMARY} disabled={!connected || pending}>{pending ? 'Saving…' : 'Save draft'}</button>
        <button type="button" className={BTN_SECONDARY} onClick={onDone} disabled={pending}>Cancel</button>
      </div>
      {error && <p className="text-sm text-[#C0392B]" role="alert">{error}</p>}
    </form>
  )
}

function ModerationPoll({ poll, send, connected }: { poll: PollView; send: Send; connected: boolean }): React.ReactElement {
  const [editing, setEditing] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('')
  const change = (state: 'open' | 'closed', showResults = poll.showResults): void => {
    setPending(true); setError('')
    void send({ type: 'poll-state', id: poll.id, state, showResults }).catch(failure => setError(failure instanceof Error ? failure.message : 'Could not update the poll.')).finally(() => setPending(false))
  }
  return (
    <article className="mb-3 rounded-[14px] border border-black/8 bg-white p-4 shadow-[0_1px_2px_rgba(26,28,31,0.04),0_6px_18px_rgba(26,28,31,0.05)]">
      {editing && poll.state === 'draft' ? (
        <PollEditor poll={poll} send={send} connected={connected} onDone={() => setEditing(false)} />
      ) : (
        <>
          <span className="inline-flex rounded-md bg-[#3B6BFF]/12 px-2 py-0.5 text-xs font-semibold text-[#2F5BE0]">
            {poll.state === 'draft' ? 'Draft' : poll.state === 'open' ? 'Open for votes' : 'Closed'}
          </span>
          <h2 className="mt-2 mb-3 text-lg leading-[1.35] font-semibold tracking-[-0.015em] wrap-anywhere text-[#0A0B10]">{poll.title}</h2>
          <div className="my-3.5 grid gap-3">
            {poll.options.map(option => (
              <div key={option.id}>
                <div className="mb-1.5 flex items-baseline justify-between gap-4 text-sm">
                  <span className="min-w-0 wrap-anywhere text-[#0A0B10]">{option.text}</span>
                  <strong className="shrink-0 text-xs text-[#2E3240] tabular-nums">
                    {poll.totals[option.id] ?? 0} · {pollPercent(poll.totals[option.id] ?? 0, poll.voters)}%
                  </strong>
                </div>
                <span className="block h-1.5 w-full overflow-hidden rounded bg-[#E8EAF0]">
                  <span className="block h-full bg-[#3B6BFF]" style={{ width: `${pollPercent(poll.totals[option.id] ?? 0, poll.voters)}%` }} />
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs font-medium text-[#565B6E] tabular-nums">
            {poll.voters} {poll.voters === 1 ? 'person voted' : 'people voted'} · Results {poll.showResults ? 'shared with audience' : 'visible to the team'}
          </p>
          <div className="mt-3.5 flex flex-wrap gap-2 border-t border-black/6 pt-3">
            {poll.state === 'draft' && <button type="button" className={BTN_SECONDARY} disabled={!connected || pending} onClick={() => setEditing(true)}>Edit draft</button>}
            {poll.state !== 'open' ? (
              <button
                type="button"
                className="min-h-9 cursor-pointer rounded-lg border-0 bg-[#3B6BFF] px-3.5 py-1.5 text-[13px] font-semibold text-white hover:enabled:brightness-105 disabled:cursor-default disabled:opacity-45"
                disabled={!connected || pending}
                onClick={() => change('open')}
              >
                Open voting
              </button>
            ) : (
              <button type="button" className={BTN_SECONDARY} disabled={!connected || pending} onClick={() => change('closed')}>Close voting</button>
            )}
            {poll.state !== 'draft' && (
              <button type="button" className={BTN_SECONDARY} disabled={!connected || pending} onClick={() => change(poll.state as 'open' | 'closed', !poll.showResults)}>
                {poll.showResults ? 'Hide audience results' : 'Share results with audience'}
              </button>
            )}
          </div>
        </>
      )}
      {error && <p role="alert" className="mt-2.5 text-sm text-[#C0392B]">{error}</p>}
    </article>
  )
}

export default function Moderation({ code }: { code: string }): React.ReactElement {
  const room = useModeration(code)
  const [activity, setActivity] = useState<'qa' | 'polls'>('qa'), [filter, setFilter] = useState<AudienceQuestionState>('approved')
  const [sort, setSort] = useState<'votes' | 'newest'>('votes'), [creatingPoll, setCreatingPoll] = useState(false)
  const activeTab = TABS.find(tab => tab.value === filter) ?? TABS[0]
  const sorted = sortAudienceQuestions(room.questions.filter(question => activeTab.matches(question.state)), sort)
  const canAct = room.connected && !room.closed && !room.needsLink
  const isConnecting = !room.loaded && !room.closed && !room.needsLink

  return (
    <main className="flex min-h-dvh flex-col bg-[#F3F4F7] font-sans text-[#0A0B10] antialiased" style={{ colorScheme: 'light' }}>
      <header className="sticky top-0 z-10 bg-[#3B6BFF] text-white">
        <div className="mx-auto flex min-h-[58px] max-w-[900px] items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium text-white/75">{room.org} · Engage moderation</p>
            <h1 className="mt-px truncate text-base leading-tight font-semibold tracking-[-0.01em] text-white">
              {room.title || `Room #${code}`}
            </h1>
          </div>

          {!room.needsLink && !room.closed && room.loaded && (
            <nav className="flex items-center gap-0.5 rounded-xl bg-black/18 p-1" aria-label="Activities">
              <button
                type="button"
                aria-pressed={activity === 'qa'}
                onClick={() => setActivity('qa')}
                className="inline-flex min-h-8 min-w-[84px] cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border-0 bg-transparent px-3.5 py-1 text-xs font-semibold text-white/82 transition-colors aria-pressed:bg-white/22 aria-pressed:text-white"
              >
                Q&amp;A
              </button>
              <button
                type="button"
                aria-pressed={activity === 'polls'}
                onClick={() => setActivity('polls')}
                className="inline-flex min-h-8 min-w-[84px] cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border-0 bg-transparent px-3.5 py-1 text-xs font-semibold text-white/82 transition-colors aria-pressed:bg-white/22 aria-pressed:text-white"
              >
                Polls
              </button>
            </nav>
          )}

          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/16 px-2.5 py-1 text-[11px] font-semibold tracking-wider text-white tabular-nums"
            role="status"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                canAct ? 'bg-[#7DFFB3]' : room.closed ? 'bg-white/40' : 'animate-pulse bg-white/75'
              }`}
              aria-hidden="true"
            />
            {room.closed ? 'Closed' : room.needsLink ? 'Sign in' : room.connected ? code : 'Connecting'}
          </span>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[900px] flex-1 flex-col px-4 pt-6 pb-8">
        {isConnecting ? (
          <section className="mx-auto my-auto flex w-full max-w-[460px] flex-col items-center rounded-2xl border border-black/8 bg-white p-8 text-center shadow-[0_1px_2px_rgba(10,11,16,0.04),0_6px_18px_rgba(10,11,16,0.05)]" role="status">
            <span className="mb-3.5 inline-block h-6 w-6 animate-spin rounded-full border-2 border-[#3B6BFF]/25 border-t-[#3B6BFF]" aria-hidden="true" />
            <h2 className="text-base font-semibold text-[#0A0B10]">Connecting to #{code}…</h2>
            <p className="mt-1 text-sm text-[#565B6E]">Checking your moderator session and loading the live queue.</p>
          </section>
        ) : room.needsLink ? (
          <div className="my-auto py-6">
            {room.error && (
              <p className="mx-auto mb-4 max-w-[480px] rounded-xl bg-[#3B6BFF]/10 px-4 py-3 text-sm text-[#0A0B10]" role="alert">
                {room.error}
              </p>
            )}
            <RequestLink code={code} />
          </div>
        ) : room.closed ? (
          <section className="mx-auto my-auto max-w-[460px] rounded-2xl border border-black/8 bg-white p-8 text-center shadow-[0_1px_2px_rgba(10,11,16,0.04)]">
            <h2 className="text-xl font-semibold tracking-[-0.02em] text-[#0A0B10]">This engagement has closed</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#565B6E]">Contact the engagement owner if you need to reopen it.</p>
            <Link href={`/q/${code}`} className="mt-4 inline-block text-sm font-semibold text-[#2F5BE0] no-underline hover:underline">
              ← Back to audience view
            </Link>
          </section>
        ) : (
          <>
            <p className="mb-4 text-sm leading-relaxed text-[#565B6E]">
              Help the conversation along. Send questions to the presenter; the owner chooses what appears on screen.
            </p>
            {room.error && (
              <p className="mb-4 rounded-xl bg-[#C0392B]/10 px-4 py-2.5 text-sm text-[#C0392B]" role="alert">
                {room.error}
              </p>
            )}

            {activity === 'qa' ? (
              <>
                <div className="flex flex-wrap gap-2 pb-1" aria-label="Question state">
                  {TABS.map(tab => {
                    const active = filter === tab.value
                    const count = room.questions.filter(question => tab.matches(question.state)).length
                    return (
                      <button
                        key={tab.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setFilter(tab.value)}
                        className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors ${
                          active
                            ? 'border-[#3B6BFF] bg-[#3B6BFF]/10 text-[#2F5BE0]'
                            : 'border-black/8 bg-white text-[#565B6E] hover:text-[#0A0B10]'
                        }`}
                      >
                        {tab.label}
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${
                            active ? 'bg-[#3B6BFF]/15 text-[#2F5BE0]' : 'bg-[#F3F4F7] text-[#565B6E]'
                          }`}
                        >
                          {count}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <div className="mt-4 mb-3 flex items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-1.5" role="radiogroup" aria-label="Sort questions">
                    {(['votes', 'newest'] as const).map(value => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={sort === value}
                        onClick={() => setSort(value)}
                        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] transition-colors ${
                          sort === value
                            ? 'border-black/8 bg-white font-semibold text-[#1A1C1F]'
                            : 'border-transparent bg-transparent font-medium text-[#9AA0A6] hover:text-[#6B7280]'
                        }`}
                      >
                        {value === 'votes' ? 'Popular' : 'Recent'}
                      </button>
                    ))}
                  </div>
                  <span className="text-[13px] font-medium text-[#6B7280] tabular-nums">
                    {sorted.length} {sorted.length === 1 ? 'question' : 'questions'}
                  </span>
                </div>

                {!sorted.length ? (
                  <div className="rounded-2xl border border-black/6 bg-white/70 px-4 py-12 text-center text-sm text-[#6B7280]">
                    No questions in {activeTab.label.toLowerCase()} yet.
                  </div>
                ) : (
                  sorted.map(question => (
                    <ModerationQuestion
                      key={question.id}
                      question={question}
                      replies={(room.engage?.replies ?? []).filter(reply => reply.questionId === question.id)}
                      send={room.send}
                      connected={canAct}
                    />
                  ))
                )}
              </>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between gap-4">
                  <h2 className="text-lg font-bold text-[#1A1C1F]">Polls</h2>
                  <button type="button" className={BTN_PRIMARY} disabled={!canAct || creatingPoll} onClick={() => setCreatingPoll(true)}>
                    New poll
                  </button>
                </div>
                {creatingPoll && (
                  <section className="mb-3 rounded-[14px] border border-black/8 bg-white p-4 shadow-[0_1px_2px_rgba(26,28,31,0.04)]">
                    <PollEditor send={room.send} connected={canAct} onDone={() => setCreatingPoll(false)} />
                  </section>
                )}
                {!room.engage?.polls.length && !creatingPoll && (
                  <div className="rounded-2xl border border-black/6 bg-white/70 px-4 py-12 text-center text-sm text-[#6B7280]">
                    Create a poll, then open it when the audience is ready.
                  </div>
                )}
                {room.engage?.polls.map(poll => <ModerationPoll key={poll.id} poll={poll} send={room.send} connected={canAct} />)}
              </>
            )}
          </>
        )}

        <footer className="mt-auto flex items-center justify-center pt-10 pb-2">
          <Logo height={22} tone="adaptive" />
        </footer>
      </div>
    </main>
  )
}
