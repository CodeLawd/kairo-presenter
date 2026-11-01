'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { Button } from '@/components/ui/button'
import {
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  MessageCircleQuestionIcon,
  MonitorPlayIcon,
  PlusIcon,
  RadioIcon,
  SendIcon,
  Trash2Icon,
  UserCheckIcon,
} from 'lucide-react'
import type { AudienceQuestion, AudienceQuestionState } from '../../../../../../src/lib/audience'
import { sortAudienceQuestions } from '../../../../../../src/lib/audience'
import { normalizePoll, type EngageSnapshot, type PollView, type Reply } from '../../../../../../src/lib/engage'
import type { AudienceServerEvent } from '../../../../../../src/lib/audience-protocol'
import { engageApiBase } from '@/app/engage/client-api'

type QuestionTab = 'approved' | 'answered' | 'hidden'
type ActivityTab = 'qa' | 'polls'
type SortOrder = 'votes' | 'newest'

const TABS: Array<{ value: QuestionTab; label: string }> = [
  { value: 'approved', label: 'Open' },
  { value: 'answered', label: 'Answered' },
  { value: 'hidden', label: 'Hidden' },
]

const EMPTY_COPY: Record<QuestionTab, { title: string; body: string }> = {
  approved: {
    title: 'No open questions',
    body: 'Questions from the room appear here ready to show on screen.',
  },
  answered: {
    title: 'Nothing answered yet',
    body: 'Mark a question answered and it moves here.',
  },
  hidden: {
    title: 'Nothing hidden',
    body: 'Hidden questions stay out of view.',
  },
}

function matchesTab(state: AudienceQuestionState, tab: QuestionTab): boolean {
  if (tab === 'approved') return state === 'approved' || state === 'review'
  return state === tab
}

function age(createdAt: number, now: number): string {
  const minutes = Math.floor((now - createdAt) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

export default function EngagementLiveView(): React.ReactElement {
  const params = useParams()
  const router = useRouter()
  const code = String(params.code ?? '').toUpperCase()
  const { session, getAccessToken } = useDashboard()

  const [activity, setActivity] = useState<ActivityTab>('qa')
  const [tab, setTab] = useState<QuestionTab>('approved')
  const [sort, setSort] = useState<SortOrder>('votes')
  const [now, setNow] = useState(Date.now)

  // Real-time state
  const [operatorToken, setOperatorToken] = useState<string | null>(null)
  const [questions, setQuestions] = useState<AudienceQuestion[]>([])
  const [engage, setEngage] = useState<EngageSnapshot | null>(null)
  const [title, setTitle] = useState(code)
  const [status, setStatus] = useState<'draft' | 'open' | 'closed'>('draft')
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [togglingLive, setTogglingLive] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  // Question Reply & Poll Editor State
  const [replyingId, setReplyingId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyAudience, setReplyAudience] = useState<'everyone' | 'asker'>('everyone')
  const [creatingPoll, setCreatingPoll] = useState(false)
  const [pollTitle, setPollTitle] = useState('')
  const [pollOptions, setPollOptions] = useState('')
  const [pollMultiple, setPollMultiple] = useState(false)

  const socketRef = useRef<WebSocket | null>(null)

  // Update clock for relative timestamps
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  // Initial resume request to obtain operatorToken and initial room snapshot
  const resume = useCallback(async (): Promise<void> => {
    try {
      setLoading(true)
      setError('')
      const token = await getAccessToken()
      const response = await fetch(`${engageApiBase()}/v1/engage/${encodeURIComponent(code)}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || 'Could not load engagement session.')
      }
      const data = (await response.json()) as {
        operatorToken: string
        title: string
        engagement?: EngageSnapshot['engagement']
      }
      setOperatorToken(data.operatorToken)
      setTitle(data.title || code)
      if (data.engagement) {
        setStatus(data.engagement.status)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resume engagement.')
    } finally {
      setLoading(false)
    }
  }, [code, getAccessToken])

  useEffect(() => {
    void resume()
  }, [resume])

  // WebSocket operator connection
  useEffect(() => {
    if (!operatorToken) return

    let alive = true
    const base = engageApiBase()
    const wsUrl = new URL(`/v1/engage/${encodeURIComponent(code)}/ws?role=operator&operatorToken=${encodeURIComponent(operatorToken)}`, base)
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'

    const ws = new WebSocket(wsUrl.toString())
    socketRef.current = ws

    ws.onopen = () => {
      if (alive) setConnected(true)
    }

    ws.onmessage = (event) => {
      if (!alive) return
      try {
        const payload = JSON.parse(event.data as string) as AudienceServerEvent
        if (payload.type === 'snapshot') {
          setQuestions(payload.questions)
          setTitle(payload.title)
          setConnected(true)
        } else if (payload.type === 'engage') {
          setEngage(payload)
          setTitle(payload.engagement.name)
          setStatus(payload.engagement.status)
        } else if (payload.type === 'question') {
          setQuestions((prev) => {
            const exists = prev.some((q) => q.id === payload.question.id)
            if (exists) {
              return prev.map((q) => (q.id === payload.question.id ? payload.question : q))
            }
            return [payload.question, ...prev]
          })
        } else if (payload.type === 'state') {
          setQuestions((prev) =>
            prev.map((q) => (q.id === payload.id ? { ...q, state: payload.state } : q)),
          )
        } else if (payload.type === 'ended') {
          setStatus('closed')
        }
      } catch {
        /* parse error */
      }
    }

    ws.onclose = () => {
      if (alive) setConnected(false)
    }

    return () => {
      alive = false
      ws.close()
    }
  }, [code, operatorToken])

  // Send an operator command via WebSocket
  const sendCommand = (cmd: Record<string, unknown>): void => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return
    const requestId = crypto.randomUUID()
    socketRef.current.send(JSON.stringify({ ...cmd, requestId }))
  }

  // Toggle Live status
  const toggleLive = async (makeLive: boolean): Promise<void> => {
    setTogglingLive(true)
    try {
      const token = await getAccessToken()
      const response = await fetch(`${engageApiBase()}/v1/engage/${encodeURIComponent(code)}/live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ live: makeLive }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        throw new Error('Could not update live status.')
      }
      setStatus(makeLive ? 'open' : 'closed')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not update live status.')
    } finally {
      setTogglingLive(false)
    }
  }

  const copyAudienceLink = (): void => {
    const url = `${window.location.origin}/q/${code}`
    void navigator.clipboard.writeText(url)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2000)
  }

  // Filtered & sorted questions
  const filteredQuestions = useMemo(() => {
    const tabFiltered = questions.filter((q) => matchesTab(q.state, tab))
    return sortAudienceQuestions(tabFiltered, sort)
  }, [questions, tab, sort])

  const openCount = useMemo(() => questions.filter((q) => matchesTab(q.state, 'approved')).length, [questions])
  const answeredCount = useMemo(() => questions.filter((q) => matchesTab(q.state, 'answered')).length, [questions])
  const hiddenCount = useMemo(() => questions.filter((q) => matchesTab(q.state, 'hidden')).length, [questions])

  const counts: Record<QuestionTab, number> = {
    approved: openCount,
    answered: answeredCount,
    hidden: hiddenCount,
  }

  const isLive = status === 'open'

  // Question actions
  const moderate = (id: string, nextState: AudienceQuestionState): void => {
    sendCommand({ type: 'state', id, state: nextState })
  }

  const sendToPresenter = (id: string): void => {
    sendCommand({ type: 'present', id })
  }

  const submitReply = (questionId: string): void => {
    if (!replyText.trim()) return
    sendCommand({
      type: 'reply',
      questionId,
      text: replyText.trim(),
      audience: replyAudience,
    })
    setReplyingId(null)
    setReplyText('')
  }

  // Poll actions
  const savePoll = (e: React.FormEvent): void => {
    e.preventDefault()
    try {
      const optionsList = pollOptions
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      const poll = normalizePoll({
        title: pollTitle.trim(),
        multiple: pollMultiple,
        options: optionsList,
      })
      sendCommand({ type: 'poll-save', poll })
      setCreatingPoll(false)
      setPollTitle('')
      setPollOptions('')
      setPollMultiple(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Invalid poll format.')
    }
  }

  const setPollState = (id: string, pollState: 'open' | 'closed', showResults: boolean): void => {
    sendCommand({ type: 'poll-state', id, state: pollState, showResults })
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[#141518] text-[#F3F4F6]">
      {/* Top Bar matching user image styling */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#16171B] px-6 py-3">
        {/* Left Segment: [ Open | Answered | Hidden ] */}
        <div className="flex items-center gap-1 rounded-xl bg-[#26282E]/80 p-1 border border-white/5">
          {TABS.map((t) => {
            const on = tab === t.value
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className={`rounded-lg px-3.5 py-1 text-xs font-medium transition-colors ${
                  on
                    ? 'bg-[#383A42] text-white shadow-xs'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {t.label}
                {counts[t.value] > 0 ? (
                  <span className="ml-1.5 tabular-nums opacity-60">({counts[t.value]})</span>
                ) : null}
              </button>
            )
          })}
        </div>

        {/* Center Segment: [ Q&A | Polls ] */}
        <div className="flex items-center gap-1 rounded-xl bg-[#26282E]/80 p-1 border border-white/5">
          <button
            type="button"
            onClick={() => setActivity('qa')}
            className={`rounded-lg px-4 py-1 text-xs font-medium transition-colors ${
              activity === 'qa'
                ? 'bg-[#383A42] text-white shadow-xs'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Q&amp;A
          </button>
          <button
            type="button"
            onClick={() => setActivity('polls')}
            className={`rounded-lg px-4 py-1 text-xs font-medium transition-colors ${
              activity === 'polls'
                ? 'bg-[#383A42] text-white shadow-xs'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Polls
          </button>
        </div>

        {/* Right Segment: [ Popular | Recent ] */}
        <div className="flex items-center gap-1 rounded-xl bg-[#26282E]/80 p-1 border border-white/5">
          <button
            type="button"
            onClick={() => setSort('votes')}
            className={`rounded-lg px-3.5 py-1 text-xs font-medium transition-colors ${
              sort === 'votes'
                ? 'bg-[#383A42] text-white shadow-xs'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Popular
          </button>
          <button
            type="button"
            onClick={() => setSort('newest')}
            className={`rounded-lg px-3.5 py-1 text-xs font-medium transition-colors ${
              sort === 'newest'
                ? 'bg-[#383A42] text-white shadow-xs'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Recent
          </button>
        </div>
      </div>

      {/* Secondary Context & Controls Bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] bg-[#121316] px-6 py-2.5 text-xs">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/engage"
            className="flex items-center gap-1.5 text-zinc-400 transition-colors hover:text-white"
          >
            <ArrowLeftIcon className="size-3.5" />
            <span>Engagements</span>
          </Link>
          <span className="text-zinc-600">/</span>
          <span className="font-semibold text-white">{title}</span>
          <span className="font-mono rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-zinc-300">
            #{code}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              isLive
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${isLive ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`}
            />
            {isLive ? 'Live now' : 'Scheduled'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Live Action Toggle */}
          <Button
            size="sm"
            disabled={togglingLive}
            onClick={() => void toggleLive(!isLive)}
            className={`h-7 px-3 text-xs gap-1.5 font-medium ${
              isLive
                ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            <RadioIcon className={`size-3 ${isLive ? 'text-emerald-400' : 'text-white'}`} />
            {togglingLive ? 'Updating…' : isLive ? 'End Session' : 'Make Live'}
          </Button>

          {/* Copy link */}
          <Button
            variant="ghost"
            size="sm"
            onClick={copyAudienceLink}
            className="h-7 px-2.5 text-xs text-zinc-400 hover:text-white hover:bg-white/10"
            title="Copy audience page link"
          >
            {copiedLink ? <CheckIcon className="size-3 text-emerald-400" /> : <CopyIcon className="size-3" />}
            {copiedLink ? 'Copied' : 'Audience Link'}
          </Button>

          {/* Audience page external link */}
          <Button
            variant="ghost"
            size="sm"
            render={<Link href={`/q/${code}`} target="_blank" rel="noreferrer" />}
            className="h-7 px-2.5 text-xs text-zinc-400 hover:text-white hover:bg-white/10 gap-1"
          >
            <span>Open audience</span>
            <ExternalLinkIcon className="size-3" />
          </Button>
        </div>
      </div>

      {/* Main View Area */}
      <div className="flex flex-1 min-h-0 flex-col overflow-y-auto p-6">
        {loading ? (
          <div className="m-auto flex flex-col items-center justify-center text-center">
            <span className="size-7 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
            <p className="mt-3 text-sm text-zinc-400">Loading engagement session…</p>
          </div>
        ) : error ? (
          <div className="m-auto max-w-md rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void resume()} className="mt-4">
              Try again
            </Button>
          </div>
        ) : activity === 'qa' ? (
          filteredQuestions.length === 0 ? (
            /* Empty State exactly matching the user's uploaded image */
            <div className="m-auto flex flex-col items-center justify-center text-center px-4">
              <h2 className="text-[17px] font-semibold text-white tracking-tight">
                {EMPTY_COPY[tab].title}
              </h2>
              <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-zinc-400">
                {EMPTY_COPY[tab].body}
              </p>
            </div>
          ) : (
            /* Questions List */
            <div className="mx-auto w-full max-w-3xl space-y-3 pb-8">
              {filteredQuestions.map((q) => {
                const isReplying = replyingId === q.id
                const replies = (engage?.replies ?? []).filter((r) => r.questionId === q.id)
                return (
                  <div
                    key={q.id}
                    className="rounded-xl border border-white/[0.08] bg-[#1E2025] p-4 shadow-sm transition-colors hover:border-white/15"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="grid size-7 place-items-center rounded-full bg-[#2A2D35] text-xs font-bold text-zinc-300">
                          {(q.author || 'A')[0].toUpperCase()}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-white">
                            {q.author || 'Anonymous'}
                          </p>
                          <p className="text-[11px] text-zinc-400">{age(q.createdAt, now)} ago</p>
                        </div>
                        {q.sentBy && (
                          <span className="ml-2 rounded-md bg-[#3B6BFF]/15 px-2 py-0.5 text-[11px] font-semibold text-[#8AB4FF]">
                            Sent by {q.sentBy}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 rounded-full bg-[#2A2D35] px-2.5 py-1 text-xs font-bold tabular-nums text-zinc-200">
                        ▲ {q.votes}
                      </div>
                    </div>

                    <p className="mt-3 text-[15px] leading-normal text-zinc-100 whitespace-pre-wrap">
                      {q.text}
                    </p>

                    {/* Replies */}
                    {replies.length > 0 && (
                      <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
                        {replies.map((r) => (
                          <div key={r.id} className="rounded-lg bg-[#272A32] p-2.5 text-xs">
                            <p className="font-semibold text-primary">Answered by {r.by}</p>
                            <p className="mt-0.5 text-zinc-200">{r.text}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3 text-xs">
                      {q.state === 'approved' ? (
                        <button
                          type="button"
                          onClick={() => moderate(q.id, 'answered')}
                          className="rounded-lg bg-white/5 px-2.5 py-1.5 font-medium text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
                        >
                          Mark answered
                        </button>
                      ) : q.state === 'answered' ? (
                        <button
                          type="button"
                          onClick={() => moderate(q.id, 'approved')}
                          className="rounded-lg bg-white/5 px-2.5 py-1.5 font-medium text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
                        >
                          Reopen
                        </button>
                      ) : null}

                      {q.state === 'hidden' ? (
                        <button
                          type="button"
                          onClick={() => moderate(q.id, 'approved')}
                          className="rounded-lg bg-white/5 px-2.5 py-1.5 font-medium text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => moderate(q.id, 'hidden')}
                          className="rounded-lg bg-white/5 px-2.5 py-1.5 font-medium text-zinc-400 hover:bg-white/10 hover:text-white transition-colors"
                        >
                          Hide
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setReplyingId(isReplying ? null : q.id)}
                        className="rounded-lg bg-white/5 px-2.5 py-1.5 font-medium text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
                      >
                        Reply
                      </button>

                      <button
                        type="button"
                        onClick={() => sendToPresenter(q.id)}
                        className="rounded-lg bg-[#3B6BFF]/15 px-2.5 py-1.5 font-medium text-[#8AB4FF] hover:bg-[#3B6BFF]/25 transition-colors"
                      >
                        Send to presenter
                      </button>
                    </div>

                    {/* Inline Reply Form */}
                    {isReplying && (
                      <div className="mt-3 rounded-lg border border-white/10 bg-[#262830] p-3 text-xs">
                        <textarea
                          rows={2}
                          placeholder="Type your response to the question…"
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          className="w-full resize-none rounded-md border border-white/10 bg-[#1A1C22] p-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-primary"
                        />
                        <div className="mt-2 flex items-center justify-between">
                          <label className="flex items-center gap-1.5 text-zinc-400">
                            <span>Visible to:</span>
                            <select
                              value={replyAudience}
                              onChange={(e) => setReplyAudience(e.target.value as 'everyone' | 'asker')}
                              className="rounded border border-white/10 bg-[#1A1C22] px-2 py-1 text-white"
                            >
                              <option value="everyone">Everyone</option>
                              <option value="asker">Only the asker</option>
                            </select>
                          </label>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setReplyingId(null)}
                              className="h-6 px-2 text-xs text-zinc-400"
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => submitReply(q.id)}
                              disabled={!replyText.trim()}
                              className="h-6 px-2.5 text-xs gap-1"
                            >
                              <SendIcon className="size-3" /> Send reply
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        ) : (
          /* Polls View */
          <div className="mx-auto w-full max-w-3xl space-y-4 pb-8">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Polls</h3>
              <Button
                size="sm"
                onClick={() => setCreatingPoll(true)}
                className="h-8 gap-1.5 text-xs"
              >
                <PlusIcon className="size-3.5" /> New Poll
              </Button>
            </div>

            {/* Poll Creation Form */}
            {creatingPoll && (
              <form
                onSubmit={savePoll}
                className="rounded-xl border border-white/10 bg-[#1E2025] p-5 space-y-3.5"
              >
                <h4 className="text-sm font-bold text-white">Create a poll</h4>
                <div>
                  <label className="block text-xs font-medium text-zinc-300">Question</label>
                  <input
                    required
                    value={pollTitle}
                    onChange={(e) => setPollTitle(e.target.value)}
                    placeholder="e.g. Which service do you usually attend?"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-[#16171B] px-3 py-2 text-xs text-white focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300">
                    Options (one per line, 2 to 12 choices)
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={pollOptions}
                    onChange={(e) => setPollOptions(e.target.value)}
                    placeholder="Morning service&#10;Evening service&#10;Midweek group"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-[#16171B] px-3 py-2 text-xs text-white focus:outline-none focus:border-primary"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={pollMultiple}
                    onChange={(e) => setPollMultiple(e.target.checked)}
                  />
                  Allow participants to select more than one option
                </label>
                <div className="flex gap-2 pt-1">
                  <Button type="submit" size="sm" className="h-7 text-xs">
                    Save poll
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCreatingPoll(false)}
                    className="h-7 text-xs text-zinc-400"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}

            {/* Polls list */}
            {(!engage?.polls || engage.polls.length === 0) && !creatingPoll ? (
              <div className="py-12 text-center">
                <p className="text-sm font-semibold text-white">No polls created yet</p>
                <p className="mt-1 text-xs text-zinc-400">
                  Create a poll to take instant audience votes during your service.
                </p>
                <Button
                  size="sm"
                  onClick={() => setCreatingPoll(true)}
                  className="mt-4 h-8 text-xs gap-1.5"
                >
                  <PlusIcon className="size-3.5" /> Create a poll
                </Button>
              </div>
            ) : (
              (engage?.polls ?? []).map((poll) => {
                const isOpen = poll.state === 'open'
                return (
                  <div
                    key={poll.id}
                    className="rounded-xl border border-white/[0.08] bg-[#1E2025] p-5 shadow-xs"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-white">{poll.title}</h4>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          isOpen
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {poll.state}
                      </span>
                    </div>

                    <div className="mt-3.5 space-y-2">
                      {poll.options.map((opt) => {
                        const count = poll.totals?.[opt.id] ?? 0
                        const pct = poll.voters > 0 ? Math.round((count / poll.voters) * 100) : 0
                        return (
                          <div key={opt.id} className="space-y-1">
                            <div className="flex justify-between text-xs text-zinc-300">
                              <span>{opt.text}</span>
                              <span className="tabular-nums font-semibold text-white">
                                {pct}% ({count})
                              </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                              <div
                                className="h-full bg-primary rounded-full transition-all duration-300"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-3 text-xs">
                      <span className="text-zinc-400">{poll.voters} total votes</span>
                      <div className="flex gap-2">
                        {isOpen ? (
                          <button
                            type="button"
                            onClick={() => setPollState(poll.id, 'closed', poll.showResults)}
                            className="rounded-lg bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                          >
                            Close voting
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setPollState(poll.id, 'open', poll.showResults)}
                            className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-500"
                          >
                            Open voting
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setPollState(poll.id, poll.state as 'open' | 'closed', !poll.showResults)}
                          className={`rounded-lg px-2.5 py-1 text-xs border transition-colors ${
                            poll.showResults
                              ? 'border-primary/40 bg-primary/10 text-primary'
                              : 'border-white/10 text-zinc-400 hover:text-white'
                          }`}
                        >
                          {poll.showResults ? 'Results shown on phones' : 'Show results to audience'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}
