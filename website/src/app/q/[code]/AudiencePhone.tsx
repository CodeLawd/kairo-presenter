'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Logo } from '@/components/brand/Logo'
import type { AudienceQuestion } from '../../../../../src/lib/audience'
import { DEFAULT_AUDIENCE_ROOM_SETTINGS, type AudienceRoomSettings, type AudienceServerEvent } from '../../../../../src/lib/audience-protocol'
import type { EngageSnapshot } from '../../../../../src/lib/engage'
import { AudiencePoll, Replies } from '../../engage/Activities'
import { orphanReplies } from '../../engage/view-model'
import { audiencePhoneApiBase } from '../api-base'

interface Draft { text: string; author: string; requestId: string | null }
interface RoomCache {
  title: string
  org: string
  questions: AudienceQuestion[]
  ownQuestions: AudienceQuestion[]
  voted: string[]
  settings: AudienceRoomSettings
  engage: EngageSnapshot | null
}
const EMPTY: Draft = { text: '', author: '', requestId: null }
type SheetView = null | 'menu' | 'switch' | 'account' | 'profile' | 'my-questions'

export default function AudiencePhone({ code }: { code: string }): React.ReactElement {
  const router = useRouter()
  const [loaded, setLoaded] = useState(false)
  const [title, setTitle] = useState('')
  const [engage, setEngage] = useState<EngageSnapshot | null>(null)
  const [activity, setActivity] = useState<'qa' | 'polls'>('qa')
  const pollRequests = useRef(new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>())
  const [org, setOrg] = useState('')
  const [questions, setQuestions] = useState<AudienceQuestion[]>([])
  const [ownQuestions, setOwnQuestions] = useState<AudienceQuestion[]>([])
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const draftRef = useRef<Draft>(EMPTY)
  const [connected, setConnected] = useState(false)
  const [ended, setEnded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [voted, setVoted] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<'votes' | 'newest'>('votes')
  const [settings, setSettings] = useState<AudienceRoomSettings>(DEFAULT_AUDIENCE_ROOM_SETTINGS)
  const settingsRef = useRef(settings)
  const [composing, setComposing] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [sheet, setSheet] = useState<SheetView>(null)
  const [darkMode, setDarkMode] = useState(false)
  const [copied, setCopied] = useState(false)
  const [switchCode, setSwitchCode] = useState('')
  const [profileName, setProfileName] = useState('')
  const socket = useRef<WebSocket | null>(null)
  const pendingVotes = useRef(new Map<string, { id: string; voted: boolean }>())
  const storageKey = `kairo-q-draft:${code}`
  const cacheKey = `kairo-q-cache:${code}`
  const themeKey = 'kairo-q-theme'

  const save = (next: Draft): void => {
    draftRef.current = next
    setDraft(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* Draft still survives reconnection in memory. */ }
  }

  useEffect(() => {
    try {
      const storedTheme = localStorage.getItem(themeKey)
      if (storedTheme === 'dark') setDarkMode(true)
    } catch { /* Ignore storage errors. */ }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!sheet) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSheet(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sheet])

  useEffect(() => {
    if (!loaded || !title) return
    try {
      const cached: RoomCache = { title, org, questions, ownQuestions, voted: [...voted], settings, engage }
      sessionStorage.setItem(cacheKey, JSON.stringify(cached))
    } catch { /* Ignore storage quota errors. */ }
  }, [loaded, title, org, questions, ownQuestions, voted, settings, engage, cacheKey])

  useEffect(() => {
    const API = audiencePhoneApiBase(window.location.hostname, process.env.NEXT_PUBLIC_AUDIENCE_API_URL)
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || 'null')
      if (value && typeof value.text === 'string' && typeof value.author === 'string') {
        const restored = { text: value.text, author: value.author, requestId: typeof value.requestId === 'string' ? value.requestId : null }
        draftRef.current = restored
        setDraft(restored)
        setProfileName(restored.author)
      }
    } catch { /* A corrupt or unavailable browser store starts with an empty draft. */ }
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null') as RoomCache | null
      if (cached && typeof cached.title === 'string' && Array.isArray(cached.questions)) {
        setTitle(cached.title)
        setOrg(cached.org || 'Kairo')
        setQuestions(cached.questions)
        if (Array.isArray(cached.ownQuestions)) setOwnQuestions(cached.ownQuestions)
        if (Array.isArray(cached.voted)) setVoted(new Set(cached.voted))
        if (cached.settings) { settingsRef.current = cached.settings; setSettings(cached.settings) }
        if (cached.engage) setEngage(cached.engage)
        setLoaded(true)
      }
    } catch { /* Ignore corrupt cache. */ }
    let alive = true
    let closed = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout>
    let heartbeat: ReturnType<typeof setInterval> | null = null
    const applySnapshot = (data: Extract<AudienceServerEvent, { type: 'snapshot' }>): void => {
      setTitle(data.title); setOrg(data.orgName); setQuestions(data.questions)
      if (data.ownQuestions) setOwnQuestions(data.ownQuestions)
      if (data.settings) { settingsRef.current = data.settings; setSettings(data.settings) }
      pendingVotes.current.clear(); setVoted(new Set(data.voted)); setLoaded(true); setError('')
    }
    const applyEngage = (data: Extract<AudienceServerEvent, { type: 'engage' }>): void => {
      setEngage(data); setTitle(data.engagement.name); setOrg(data.engagement.orgName); setLoaded(true)
      if (!data.engagement.activities.qa.enabled) setActivity('polls')
    }
    const reconnect = (): void => { if (alive && !closed) timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5)) + Math.random() * 500) }
    const connect = async (): Promise<void> => {
      if (!alive || closed) return
      try {
        const response = await fetch(`${API}/v1/engage/${code}/session`, { credentials: 'include', signal: AbortSignal.timeout(10_000) })
        if (!alive) return
        if (response.status === 410 || response.status === 404) { closed = true; setEnded(true); setLoaded(true); setError(response.status === 404 ? 'Check the code on the screen and try again.' : ''); return }
        if (!response.ok) throw new Error('Could not join this session. Retrying…')
        try {
          const initial = await response.json() as { snapshot?: Extract<AudienceServerEvent, { type: 'snapshot' }>; engage?: Extract<AudienceServerEvent, { type: 'engage' }> }
          if (!alive) return
          if (initial.snapshot) applySnapshot(initial.snapshot)
          if (initial.engage) applyEngage(initial.engage)
        } catch { /* Proceed to WebSocket snapshot if response body wasn't JSON. */ }
        const url = new URL(`/v1/engage/${code}/ws?role=audience`, API)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        const ws = new WebSocket(url)
        socket.current = ws
        let responsive = true
        ws.onopen = () => {
          heartbeat = setInterval(() => {
            if (!responsive) {
              if (heartbeat) clearInterval(heartbeat)
              socket.current = null
              setConnected(false)
              ws.close()
              reconnect()
              return
            }
            responsive = false
            if (ws.readyState === WebSocket.OPEN) ws.send('ping')
          }, 15_000)
        }
        ws.onmessage = event => {
          if (!alive || socket.current !== ws) return
          if (event.data === 'pong') { responsive = true; return }
          let data: AudienceServerEvent
          try { data = JSON.parse(event.data) } catch { return }
          if (data.type === 'engage') {
            applyEngage(data)
          } else if (data.type === 'ack' && pollRequests.current.has(data.requestId)) {
            const pending = pollRequests.current.get(data.requestId)!
            clearTimeout(pending.timer); pollRequests.current.delete(data.requestId); pending.resolve()
          } else if (data.type === 'snapshot') {
            applySnapshot(data)
            setConnected(true); attempts = 0
            if (data.ended) { closed = true; setEnded(true); ws.close(); return }
            const pending = draftRef.current
            if (pending.requestId) ws.send(JSON.stringify({ type: 'ask', ...pending }))
          } else if (data.type === 'question') {
            setQuestions(current => [...current.filter(q => q.id !== data.question.id), ...(data.question.state === 'approved' ? [data.question] : [])])
            setOwnQuestions(current => current.some(q => q.id === data.question.id) ? current.map(q => q.id === data.question.id ? data.question : q) : current)
          } else if (data.type === 'state') {
            if (data.state !== 'approved') setQuestions(current => current.filter(q => q.id !== data.id))
            setOwnQuestions(current => current.map(q => q.id === data.id ? { ...q, state: data.state } : q))
          } else if (data.type === 'ack' && pendingVotes.current.has(data.requestId)) {
            pendingVotes.current.delete(data.requestId)
          } else if (data.type === 'ack' && data.requestId === draftRef.current.requestId) {
            if (data.question) {
              const asked = data.question
              setOwnQuestions(current => [...current.filter(q => q.id !== asked.id), asked])
            }
            const next = { ...EMPTY, author: draftRef.current.author }
            draftRef.current = next; setDraft(next)
            try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* Keep the in-memory acknowledgement. */ }
            setNotice('Sent.')
          } else if (data.type === 'error') {
            setError(data.message)
            if (data.requestId && pollRequests.current.has(data.requestId)) {
              const pending = pollRequests.current.get(data.requestId)!
              clearTimeout(pending.timer); pollRequests.current.delete(data.requestId); pending.reject(new Error(data.message))
            }
            const rejectedVote = data.requestId && pendingVotes.current.get(data.requestId)
            if (rejectedVote) {
              pendingVotes.current.delete(data.requestId!)
              setVoted(current => {
                const next = new Set(current)
                if (rejectedVote.voted) next.delete(rejectedVote.id)
                else next.add(rejectedVote.id)
                return next
              })
              setQuestions(current => current.map(item => item.id === rejectedVote.id ? { ...item, votes: Math.max(0, item.votes + (rejectedVote.voted ? -1 : 1)) } : item))
            }
            if (data.requestId === draftRef.current.requestId) {
              const next = { ...draftRef.current, requestId: null }
              draftRef.current = next; setDraft(next)
              try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* Keep the draft in memory. */ }
            }
          } else if (data.type === 'ended') { closed = true; setEnded(true); setConnected(false); ws.close() }
        }
        ws.onclose = () => {
          for (const pending of pollRequests.current.values()) { clearTimeout(pending.timer); pending.reject(new Error('Connection interrupted. Check your vote after reconnecting.')) }
          pollRequests.current.clear()
          if (alive && socket.current === ws) { if (heartbeat) clearInterval(heartbeat); setConnected(false); reconnect() }
        }
        ws.onerror = () => { if (alive && socket.current === ws) setError('Connection interrupted. Your draft is saved while we reconnect.') }
      } catch (e) {
        if (alive) { setError(e instanceof Error ? e.message : 'Could not connect. Retrying…'); reconnect() }
      }
    }
    void connect()
    return () => { alive = false; clearTimeout(timer); if (heartbeat) clearInterval(heartbeat); socket.current?.close(); socket.current = null }
  }, [code, storageKey, cacheKey])

  const ask = (): void => {
    if (!connected || !socket.current || draft.requestId || !draft.text.trim()) return
    const next = { ...draft, requestId: crypto.randomUUID() }
    save(next); setError(''); setNotice('')
    socket.current.send(JSON.stringify({ type: 'ask', ...next, author: settings.names === 'off' ? '' : next.author }))
  }
  const vote = (q: AudienceQuestion): void => {
    if (!socket.current || socket.current.readyState !== WebSocket.OPEN) return
    const nextVoted = !voted.has(q.id)
    const requestId = crypto.randomUUID()
    pendingVotes.current.set(requestId, { id: q.id, voted: nextVoted })
    socket.current.send(JSON.stringify({ type: 'vote', id: q.id, voted: nextVoted, requestId }))
    setVoted(current => {
      const next = new Set(current)
      if (nextVoted) next.add(q.id)
      else next.delete(q.id)
      return next
    })
    setQuestions(current => current.map(item => item.id === q.id ? { ...item, votes: Math.max(0, item.votes + (nextVoted ? 1 : -1)) } : item))
    setOwnQuestions(current => current.map(item => item.id === q.id ? { ...item, votes: Math.max(0, item.votes + (nextVoted ? 1 : -1)) } : item))
  }
  const votePoll = (id: string, options: string[]): Promise<void> => new Promise((resolve, reject) => {
    if (socket.current?.readyState !== WebSocket.OPEN) { reject(new Error('Wait for the connection to return.')); return }
    const requestId = crypto.randomUUID()
    const timer = setTimeout(() => { pollRequests.current.delete(requestId); reject(new Error('Your vote is taking longer than expected. Reconnect to check it.')) }, 15_000)
    pollRequests.current.set(requestId, { resolve, reject, timer })
    socket.current.send(JSON.stringify({ type: 'poll-vote', id, options, requestId }))
  })

  const toggleDarkMode = (): void => {
    setDarkMode(current => {
      const next = !current
      try { localStorage.setItem(themeKey, next ? 'dark' : 'light') } catch { /* Ignore storage errors. */ }
      return next
    })
  }

  const copyCode = (): void => {
    void navigator.clipboard?.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const submitSwitchCode = (event: React.FormEvent): void => {
    event.preventDefault()
    const cleaned = switchCode.trim().replace(/^#/, '').replace(/\s+/g, '').toUpperCase()
    if (!cleaned) return
    setSheet(null)
    router.push(`/q/${encodeURIComponent(cleaned)}`)
  }

  const saveProfile = (event: React.FormEvent): void => {
    event.preventDefault()
    const trimmed = profileName.trim().slice(0, 80)
    save({ ...draftRef.current, author: trimmed })
    setProfileName(trimmed)
    setSheet(null)
  }

  const missingReplies = orphanReplies(engage?.replies ?? [], questions)
  const qaEnabled = engage?.engagement.activities.qa.enabled !== false
  const pollsEnabled = engage?.engagement.activities.polls.enabled !== false
  const length = Array.from(draft.text).length
  const expanded = composing || !!draft.text || !!draft.requestId
  const sorted = [...questions].sort((a, b) => (sort === 'votes' ? b.votes - a.votes : 0) || b.createdAt - a.createdAt)
  const ownIds = new Set(ownQuestions.map(q => q.id))
  const myQuestionsList = [...ownQuestions].sort((a, b) => b.createdAt - a.createdAt)
  const dateSubtitle = formatEventDates(engage?.engagement.startsAt, engage?.engagement.endsAt) || org || 'Kairo'

  const askRef = useRef<HTMLTextAreaElement | null>(null)
  const openAsk = (): void => {
    setSheet(null)
    setActivity('qa')
    setComposing(true)
    requestAnimationFrame(() => askRef.current?.focus())
  }

  return (
    <div className={darkMode ? 'dark' : ''}>
      <main
        className="flex min-h-dvh flex-col bg-[#F3F4F7] font-sans text-[#0A0B10] antialiased dark:bg-[#0A0B10] dark:text-[#F6F3EB]"
        style={{ colorScheme: darkMode ? 'dark' : 'light' }}
      >
        <header className="sticky top-0 z-10 bg-[#3B6BFF] text-white dark:bg-[#15171E]">
          <div className="mx-auto flex min-h-[58px] max-w-[560px] items-center justify-between gap-3 px-4 py-2.5">
            <button
              type="button"
              className="grid h-[38px] w-[38px] shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-white transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              aria-label="Event menu"
              aria-expanded={sheet === 'menu' || sheet === 'switch'}
              onClick={() => setSheet(current => (current === 'menu' || current === 'switch' ? null : 'menu'))}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="4" y1="7" x2="20" y2="7" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="17" x2="20" y2="17" />
              </svg>
            </button>

            {qaEnabled && pollsEnabled ? (
              <nav className="flex items-center gap-0.5 rounded-xl bg-black/18 p-1" aria-label="Activities">
                <button
                  type="button"
                  aria-pressed={activity === 'qa'}
                  onClick={() => setActivity('qa')}
                  className="inline-flex min-h-9 min-w-[110px] cursor-pointer items-center justify-center gap-[7px] rounded-[9px] border-0 bg-transparent px-[18px] py-1.5 text-sm font-semibold text-white/82 transition-colors aria-pressed:bg-white/22 aria-pressed:text-white aria-pressed:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></svg>
                  Q&amp;A
                </button>
                <button
                  type="button"
                  aria-pressed={activity === 'polls'}
                  onClick={() => setActivity('polls')}
                  className="inline-flex min-h-9 min-w-[110px] cursor-pointer items-center justify-center gap-[7px] rounded-[9px] border-0 bg-transparent px-[18px] py-1.5 text-sm font-semibold text-white/82 transition-colors aria-pressed:bg-white/22 aria-pressed:text-white aria-pressed:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="6" y1="20" x2="6" y2="14" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="18" y1="20" x2="18" y2="10" /></svg>
                  Polls
                </button>
              </nav>
            ) : (
              <div className="min-w-0 flex-1 text-center">
                <p className="truncate text-[11px] font-medium text-white/72">{org || 'Kairo'}</p>
                <h1 className="mt-px truncate text-base leading-tight font-semibold tracking-[-0.01em] text-white">{title || code}</h1>
              </div>
            )}

            <button
              type="button"
              className="grid h-[38px] w-[38px] shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-white/24 p-0 text-white transition-colors hover:bg-white/32 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              aria-label="Participant options"
              aria-expanded={sheet === 'account' || sheet === 'profile' || sheet === 'my-questions'}
              onClick={() => {
                setProfileName(draftRef.current.author)
                setSheet(current => (current === 'account' || current === 'profile' || current === 'my-questions' ? null : 'account'))
              }}
            >
              {draft.author.trim() ? (
                <span className="text-sm leading-none font-bold">{draft.author.trim().charAt(0).toUpperCase()}</span>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 21a8 8 0 0 0-16 0" />
                  <circle cx="12" cy="8" r="4" />
                </svg>
              )}
            </button>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col px-4 pt-4 pb-7">
          {qaEnabled && pollsEnabled && (
            <div className="mb-3.5 min-w-0">
              {!loaded ? (
                <div className="animate-pulse py-0.5" aria-hidden="true">
                  <div className="h-3.5 w-24 rounded bg-black/8 dark:bg-white/10" />
                  <div className="mt-2 h-6 w-52 rounded-md bg-black/10 dark:bg-white/12" />
                </div>
              ) : (
                <>
                  <p className="truncate text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">{org}</p>
                  <h1 className="mt-0.5 truncate text-xl leading-tight font-bold tracking-[-0.02em] text-[#1A1C1F] dark:text-[#F3F4F6]">{title}</h1>
                </>
              )}
            </div>
          )}

          {ended ? (
            <section className="px-4 pt-14 pb-4 text-center">
              <h2 className="text-[22px] font-semibold tracking-[-0.02em]">{error ? 'Join code not found' : 'This engagement has closed'}</h2>
              <p className="mt-2 text-[15px] leading-normal text-[#565B6E] dark:text-[#8D93AD]">{error || 'Thanks for joining.'}</p>
            </section>
          ) : activity === 'qa' && qaEnabled ? (
            <form
              className="flex flex-col overflow-hidden rounded-[14px] border border-black/8 bg-white shadow-[0_1px_2px_rgba(10,11,16,0.04),0_6px_18px_rgba(10,11,16,0.05)] transition-all focus-within:border-[#3B6BFF]/45 focus-within:ring-3 focus-within:ring-[#3B6BFF]/15 dark:border-white/8 dark:bg-[#15171E] dark:shadow-[0_1px_2px_rgba(0,0,0,0.25),0_6px_18px_rgba(0,0,0,0.35)]"
              onSubmit={event => {
                event.preventDefault()
                ask()
              }}
            >
              <div className={`flex gap-3 p-4 ${expanded ? 'items-start' : 'items-center'}`}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#E8EAF0] text-[#565B6E] dark:bg-[#1D212B] dark:text-[#8D93AD]" aria-hidden="true">
                  {draft.author.trim() ? (
                    <span className="text-[13px] font-bold text-[#2E3240] dark:text-[#C9CCD6]">{draft.author.trim().charAt(0).toUpperCase()}</span>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="8" r="4" /></svg>
                  )}
                </span>
                <label htmlFor="question" className="sr-only">Your question</label>
                <textarea
                  id="question"
                  ref={askRef}
                  rows={expanded ? 3 : 1}
                  placeholder="Type your question"
                  value={draft.text}
                  disabled={!!draft.requestId}
                  onFocus={() => setComposing(true)}
                  onBlur={() => { if (!draft.text && !draft.requestId) setComposing(false) }}
                  onChange={e => { if (Array.from(e.target.value).length <= 280) save({ ...draft, text: e.target.value }) }}
                  required
                  className="block min-w-0 flex-1 resize-none border-0 bg-transparent py-1 text-base leading-[1.45] text-[#0A0B10] placeholder:text-[#666B7E] focus:outline-none dark:text-[#F6F3EB] dark:placeholder:text-[#7D8399]"
                />
              </div>
              {expanded && (
                <div className="flex items-center gap-2 border-t border-black/8 px-3 pt-2 pb-3 dark:border-white/8">
                  {settings.names === 'optional' ? (
                    <>
                      <label htmlFor="author" className="sr-only">Your name (optional)</label>
                      <input
                        id="author"
                        autoComplete="off"
                        placeholder="Your name (optional)"
                        maxLength={80}
                        value={draft.author}
                        disabled={!!draft.requestId}
                        onChange={e => save({ ...draft, author: e.target.value })}
                        className="min-w-0 flex-1 border-0 bg-transparent px-1 py-2 text-[15px] text-[#0A0B10] placeholder:text-[#666B7E] focus:outline-none dark:text-[#F6F3EB] dark:placeholder:text-[#7D8399]"
                      />
                    </>
                  ) : (
                    <span className="flex-1 px-1 py-2 text-sm text-[#666B7E] dark:text-[#7D8399]">Anonymous</span>
                  )}
                  <span className={`text-xs tabular-nums ${length > 250 ? 'text-[#C0392B]' : 'text-[#666B7E] dark:text-[#7D8399]'}`}>{280 - length}</span>
                  <button
                    className="min-h-10 cursor-pointer rounded-full border-0 bg-[#3B6BFF] px-[18px] text-[15px] font-semibold text-white hover:enabled:brightness-105 disabled:cursor-default disabled:opacity-45"
                    disabled={!connected || !!draft.requestId || !draft.text.trim()}
                  >
                    {draft.requestId ? 'Sending…' : 'Send'}
                  </button>
                </div>
              )}
            </form>
          ) : null}

          {error && !ended && <p role="alert" className="mt-3 px-1 text-sm leading-normal text-[#C0392B]">{error}</p>}
          {notice && !ended && <p role="status" className="mt-3 px-1 text-sm leading-normal text-[#1F7A55]">{notice}</p>}

          {activity === 'qa' && !ended && loaded && !settings.showQuestions && (
            <p className="px-4 py-10 text-center text-sm leading-relaxed text-[#6B7280] dark:text-[#9CA3AF]">Only the host sees your question.</p>
          )}
          {activity === 'qa' && settings.showQuestions && (!ended || sorted.length > 0) && (
            <section aria-label="Questions">
              <div className="mx-0.5 mt-[18px] mb-2.5 flex items-center justify-between gap-3">
                <div className="inline-flex items-center gap-1.5" role="radiogroup" aria-label="Sort questions">
                  {(['votes', 'newest'] as const).map(value => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={sort === value}
                      onClick={() => setSort(value)}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[9px] border px-3 py-1.5 text-[13px] transition-colors ${
                        sort === value
                          ? 'border-black/8 bg-white font-semibold text-[#1A1C1F] dark:border-white/8 dark:bg-[#1B1E24] dark:text-[#F3F4F6]'
                          : 'border-transparent bg-transparent font-medium text-[#9AA0A6] dark:text-[#6B7280]'
                      }`}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70" aria-hidden="true"><path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" /></svg>
                      {value === 'votes' ? 'Popular' : 'Recent'}
                      {sort === value && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-70" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                      )}
                    </button>
                  ))}
                </div>
                {loaded ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#6B7280] tabular-nums dark:text-[#9CA3AF]">
                    {questions.length}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></svg>
                  </span>
                ) : (
                  <span className="h-4 w-8 animate-pulse rounded bg-black/8 dark:bg-white/10" aria-hidden="true" />
                )}
              </div>

              {!loaded ? (
                <div className="flex flex-col gap-2.5" role="status" aria-label="Loading questions">
                  {[0, 1, 2].map(index => (
                    <div
                      key={index}
                      className="animate-pulse rounded-[14px] border border-black/8 bg-white px-4 pt-3.5 pb-4 shadow-[0_1px_2px_rgba(26,28,31,0.04)] dark:border-white/8 dark:bg-[#1B1E24]"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 rounded-full bg-[#E8EAED] dark:bg-[#262A33]" />
                          <div className="flex flex-col gap-1.5">
                            <div className="h-3.5 w-24 rounded bg-[#E8EAED] dark:bg-[#262A33]" />
                            <div className="h-2.5 w-14 rounded bg-[#E8EAED] dark:bg-[#262A33]" />
                          </div>
                        </div>
                        <div className="h-9 w-14 rounded-full bg-[#E8EAED] dark:bg-[#262A33]" />
                      </div>
                      <div className="mt-3.5 h-3.5 w-11/12 rounded bg-[#E8EAED] dark:bg-[#262A33]" />
                      <div className="mt-2 h-3.5 w-3/5 rounded bg-[#E8EAED] dark:bg-[#262A33]" />
                    </div>
                  ))}
                </div>
              ) : !sorted.length ? (
                <p className="px-4 py-10 text-center text-sm leading-relaxed text-[#6B7280] dark:text-[#9CA3AF]">
                  {settings.review
                    ? 'No questions yet. Approved ones show up here for voting.'
                    : 'No questions yet — be the first to ask.'}
                </p>
              ) : (
                sorted.map(q => {
                  const mine = voted.has(q.id)
                  const isOwn = ownIds.has(q.id)
                  return (
                    <article
                      key={q.id}
                      className="mb-2.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 rounded-[14px] border border-black/8 bg-white px-4 pt-3.5 pb-4 shadow-[0_1px_2px_rgba(26,28,31,0.04),0_6px_18px_rgba(26,28,31,0.05)] dark:border-white/8 dark:bg-[#1B1E24] dark:shadow-[0_1px_2px_rgba(0,0,0,0.25),0_6px_18px_rgba(0,0,0,0.35)]"
                    >
                      <div className="col-start-1 flex min-w-0 items-center gap-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#E8EAED] text-xs font-semibold text-[#6B7280] dark:bg-[#262A33] dark:text-[#9CA3AF]" aria-hidden="true">
                          {q.author ? (
                            q.author.trim().charAt(0).toUpperCase()
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="8" r="4" /></svg>
                          )}
                        </span>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-sm leading-tight font-semibold text-[#1A1C1F] dark:text-[#F3F4F6]">{q.author || 'Anonymous'}</span>
                          <span className="shrink-0 text-xs leading-tight text-[#6B7280] dark:text-[#9CA3AF]">{age(q.createdAt, now)}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        aria-label={`${mine ? 'Remove vote for' : 'Vote for'}: ${q.text}`}
                        aria-pressed={mine}
                        disabled={!connected || ended}
                        onClick={() => vote(q)}
                        className={`col-start-2 row-start-1 inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 self-center rounded-full border px-3.5 py-1.5 text-sm font-semibold tabular-nums transition-colors disabled:cursor-default ${
                          mine
                            ? 'border-[#3B6BFF]/35 bg-[#3B6BFF]/12 text-[#2F5BE0] dark:border-[#8AB4FF]/35 dark:bg-[#3B6BFF]/20 dark:text-[#8AB4FF]'
                            : 'border-black/8 bg-[#E8EAF0] text-[#2E3240] hover:enabled:brightness-97 disabled:opacity-50 dark:border-white/8 dark:bg-[#1D212B] dark:text-[#C9CCD6]'
                        }`}
                      >
                        <span>{q.votes}</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill={mine ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" /><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" /></svg>
                      </button>

                      <div className="col-span-full flex items-end justify-between gap-3">
                        <p className="mt-0.5 flex-1 text-[15px] leading-normal whitespace-pre-wrap wrap-anywhere">{q.text}</p>
                        {isOwn && (
                          <button
                            type="button"
                            className="grid h-[30px] w-[30px] shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-[#6B7280] transition-colors hover:bg-[#E8EAED] hover:text-[#1A1C1F] dark:text-[#9CA3AF] dark:hover:bg-[#262A33] dark:hover:text-[#F3F4F6]"
                            aria-label="Your question options"
                            onClick={() => setSheet('my-questions')}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                              <circle cx="5" cy="12" r="1.8" />
                              <circle cx="12" cy="12" r="1.8" />
                              <circle cx="19" cy="12" r="1.8" />
                            </svg>
                          </button>
                        )}
                      </div>
                      <Replies replies={(engage?.replies ?? []).filter(reply => reply.questionId === q.id)} />
                    </article>
                  )
                })
              )}
            </section>
          )}

          {activity === 'qa' && missingReplies.length > 0 && (
            <section
              aria-label="Replies to your questions"
              className="mb-2.5 rounded-[14px] border border-black/8 bg-white px-4 pt-3.5 pb-4 shadow-[0_1px_2px_rgba(26,28,31,0.04),0_6px_18px_rgba(26,28,31,0.05)] dark:border-white/8 dark:bg-[#1B1E24]"
            >
              <h2 className="mt-1 mb-3 text-lg leading-[1.35] font-semibold tracking-[-0.015em]">Replies to your questions</h2>
              <Replies replies={missingReplies} />
            </section>
          )}

          {activity === 'polls' && pollsEnabled && (
            <section aria-label="Polls">
              {!loaded ? (
                <div className="animate-pulse rounded-[14px] border border-black/8 bg-white p-4 dark:border-white/8 dark:bg-[#1B1E24]" aria-hidden="true">
                  <div className="h-3.5 w-28 rounded bg-[#E8EAED] dark:bg-[#262A33]" />
                  <div className="mt-3 h-5 w-3/4 rounded bg-[#E8EAED] dark:bg-[#262A33]" />
                  <div className="mt-4 h-12 w-full rounded-xl bg-[#E8EAED] dark:bg-[#262A33]" />
                  <div className="mt-2 h-12 w-full rounded-xl bg-[#E8EAED] dark:bg-[#262A33]" />
                </div>
              ) : !engage?.polls.length ? (
                <p className="px-4 py-10 text-center text-sm leading-relaxed text-[#6B7280] dark:text-[#9CA3AF]">
                  Polls will appear here when the team opens them.
                </p>
              ) : (
                engage.polls.map(poll => <AudiencePoll key={poll.id} poll={poll} connected={connected && !ended} onVote={votePoll} />)
              )}
            </section>
          )}

          <footer className="mt-auto flex items-center justify-center pt-10 pb-3">
            <Logo height={24} tone="adaptive" />
          </footer>
        </div>

        {!ended && qaEnabled && activity === 'qa' && !expanded && (
          <button
            type="button"
            onClick={openAsk}
            style={{ right: 'max(20px, calc(50% - 280px + 20px))' }}
            className="fixed bottom-6 z-10 inline-flex h-[60px] w-[60px] cursor-pointer items-center justify-center rounded-full border-0 bg-[#3B6BFF] p-0 text-base font-bold text-white shadow-[0_6px_20px_rgba(59,107,255,0.35)] hover:brightness-105"
          >
            Ask
          </button>
        )}

        {sheet && (
          <div
            className="fixed inset-0 z-30 flex items-end justify-center bg-[#0F1218]/48"
            onClick={() => setSheet(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={
                sheet === 'menu' || sheet === 'switch'
                  ? 'Event menu'
                  : sheet === 'profile'
                    ? 'My profile'
                    : sheet === 'my-questions'
                      ? 'My questions'
                      : 'Participant options'
              }
              onClick={event => event.stopPropagation()}
              className="max-h-[86dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[22px] bg-white px-6 pt-[22px] pb-[26px] text-[#1A1C1F] shadow-[0_-8px_32px_rgba(0,0,0,0.18)] dark:bg-[#1B1E24] dark:text-[#F3F4F6]"
            >
              {sheet === 'menu' && (
                <>
                  <div className="pb-3.5">
                    <h2 className="m-0 text-[17px] leading-[1.3] font-bold text-[#1A1C1F] dark:text-[#F3F4F6]">{title || code}</h2>
                    <p className="mt-2 text-sm leading-[1.45] text-[#6B7280] dark:text-[#9CA3AF]">{dateSubtitle}</p>
                    <div className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-[#6B7280] tabular-nums dark:text-[#9CA3AF]">
                      <span>#{code}</span>
                      <button
                        type="button"
                        onClick={copyCode}
                        aria-label="Copy event code"
                        className="inline-grid h-[26px] w-[26px] cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-[#6B7280] transition-colors hover:bg-[#E8EAED] hover:text-[#1A1C1F] dark:text-[#9CA3AF] dark:hover:bg-[#262A33] dark:hover:text-[#F3F4F6]"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </button>
                      {copied && <span className="text-xs font-semibold text-[#2F5BE0] dark:text-[#8AB4FF]">Copied</span>}
                    </div>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSwitchCode('')
                        setSheet('switch')
                      }}
                      className="flex min-h-[46px] w-full cursor-pointer items-center gap-3.5 rounded-[10px] border-0 bg-transparent px-1 py-2 text-left text-[15px] font-medium text-[#1A1C1F] transition-colors hover:bg-[#E8EAED] dark:text-[#F3F4F6] dark:hover:bg-[#262A33]"
                    >
                      <span className="inline-grid h-[22px] w-[22px] shrink-0 place-items-center text-[#6B7280] dark:text-[#9CA3AF]" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 3l4 4-4 4" />
                          <path d="M3 7h18" />
                          <path d="M7 21l-4-4 4-4" />
                          <path d="M21 17H3" />
                        </svg>
                      </span>
                      <span>Switch Kairo event</span>
                    </button>

                    <div className="flex min-h-[46px] w-full items-center gap-3.5 rounded-[10px] px-1 py-2 text-[15px] font-medium text-[#1A1C1F] dark:text-[#F3F4F6]">
                      <span className="inline-grid h-[22px] w-[22px] shrink-0 place-items-center text-[#6B7280] dark:text-[#9CA3AF]" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="4" />
                          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                        </svg>
                      </span>
                      <span className="flex-1">Dark mode</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={darkMode}
                        aria-label="Dark mode"
                        onClick={toggleDarkMode}
                        className={`relative h-6 w-11 cursor-pointer rounded-full border-0 p-0.5 transition-colors ${
                          darkMode ? 'bg-[#3B6BFF]' : 'bg-[#6B7280]'
                        }`}
                      >
                        <span
                          className={`block h-5 w-5 rounded-full bg-white transition-transform ${
                            darkMode ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    <Link
                      href="/"
                      onClick={() => setSheet(null)}
                      className="flex min-h-[46px] w-full items-center gap-3.5 rounded-[10px] px-1 py-2 text-[15px] font-medium text-[#1A1C1F] no-underline transition-colors hover:bg-[#E8EAED] dark:text-[#F3F4F6] dark:hover:bg-[#262A33]"
                    >
                      <span className="inline-grid h-[22px] w-[22px] shrink-0 place-items-center text-[#6B7280] dark:text-[#9CA3AF]" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="16" x2="12" y2="12" />
                          <line x1="12" y1="8" x2="12.01" y2="8" />
                        </svg>
                      </span>
                      <span>About Kairo</span>
                    </Link>
                  </div>

                  <hr className="my-2.5 border-0 border-t border-black/8 dark:border-white/8" />

                  <div className="flex flex-col gap-0.5">
                    <Link
                      href="/terms"
                      onClick={() => setSheet(null)}
                      className="flex min-h-11 w-full items-center rounded-[10px] px-1 py-2 text-[15px] font-medium text-[#1A1C1F] no-underline transition-colors hover:bg-[#E8EAED] dark:text-[#F3F4F6] dark:hover:bg-[#262A33]"
                    >
                      Acceptable Use
                    </Link>
                    <Link
                      href="/privacy"
                      onClick={() => setSheet(null)}
                      className="flex min-h-11 w-full items-center rounded-[10px] px-1 py-2 text-[15px] font-medium text-[#1A1C1F] no-underline transition-colors hover:bg-[#E8EAED] dark:text-[#F3F4F6] dark:hover:bg-[#262A33]"
                    >
                      Kairo Privacy
                    </Link>
                  </div>

                  <hr className="my-2.5 border-0 border-t border-black/8 dark:border-white/8" />

                  <div className="flex flex-col gap-0.5">
                    <Link
                      href={`/engage/${code}/moderate`}
                      onClick={() => setSheet(null)}
                      className="flex min-h-11 w-full items-center rounded-[10px] px-1 py-2 text-[15px] font-medium text-[#1A1C1F] no-underline transition-colors hover:bg-[#E8EAED] dark:text-[#F3F4F6] dark:hover:bg-[#262A33]"
                    >
                      Login as host
                    </Link>
                  </div>

                  <p className="mt-3.5 px-1 text-xs text-[#6B7280] dark:text-[#9CA3AF]">© {new Date().getFullYear()} Kairo</p>
                </>
              )}

              {sheet === 'switch' && (
                <form className="flex flex-col gap-3" onSubmit={submitSwitchCode}>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSheet('menu')}
                      aria-label="Back to menu"
                      className="-ml-1.5 grid h-8 w-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-[#3C4048] transition-colors hover:bg-[#E8EAED] dark:text-[#D1D5DB] dark:hover:bg-[#262A33]"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                    </button>
                    <h2 className="m-0 text-[17px] leading-[1.3] font-bold">Switch event</h2>
                  </div>
                  <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">Enter the 6-character code shown on screen.</p>
                  <input
                    placeholder="Event code (e.g. 2AGXU8)"
                    value={switchCode}
                    onChange={e => setSwitchCode(e.target.value)}
                    maxLength={16}
                    autoFocus
                    className="min-h-11 w-full rounded-xl border border-black/8 bg-[#F3F4F7] px-3.5 py-2.5 text-[15px] text-[#0A0B10] focus:border-[#3B6BFF] focus:outline-none dark:border-white/8 dark:bg-[#0A0B10] dark:text-[#F6F3EB]"
                  />
                  <div className="mt-1 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setSheet('menu')}
                      className="min-h-10 cursor-pointer rounded-full border border-black/8 bg-transparent px-4 text-sm font-semibold text-[#2E3240] hover:bg-[#E8EAF0] dark:border-white/8 dark:text-[#C9CCD6] dark:hover:bg-[#1D212B]"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!switchCode.trim()}
                      className="min-h-10 cursor-pointer rounded-full border-0 bg-[#3B6BFF] px-[18px] text-[15px] font-semibold text-white hover:enabled:brightness-105 disabled:cursor-default disabled:opacity-45"
                    >
                      Join
                    </button>
                  </div>
                </form>
              )}

              {sheet === 'account' && (
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setProfileName(draftRef.current.author)
                      setSheet('profile')
                    }}
                    className="flex min-h-[46px] w-full cursor-pointer items-center gap-3.5 rounded-[10px] border-0 bg-transparent px-1 py-2 text-left text-[15px] font-medium text-[#1A1C1F] transition-colors hover:bg-[#E8EAED] dark:text-[#F3F4F6] dark:hover:bg-[#262A33]"
                  >
                    <span className="inline-grid h-[22px] w-[22px] shrink-0 place-items-center text-[#6B7280] dark:text-[#9CA3AF]" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21a8 8 0 0 0-16 0" />
                        <circle cx="12" cy="8" r="4" />
                      </svg>
                    </span>
                    <span>My profile</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSheet('my-questions')}
                    className="flex min-h-[46px] w-full cursor-pointer items-center gap-3.5 rounded-[10px] border-0 bg-transparent px-1 py-2 text-left text-[15px] font-medium text-[#1A1C1F] transition-colors hover:bg-[#E8EAED] dark:text-[#F3F4F6] dark:hover:bg-[#262A33]"
                  >
                    <span className="inline-grid h-[22px] w-[22px] shrink-0 place-items-center text-[#6B7280] dark:text-[#9CA3AF]" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                      </svg>
                    </span>
                    <span>My questions</span>
                    {myQuestionsList.length > 0 && (
                      <span className="ml-auto rounded-full bg-[#E8EAED] px-2 py-0.5 text-xs font-semibold text-[#3C4048] dark:bg-[#262A33] dark:text-[#D1D5DB]">
                        {myQuestionsList.length}
                      </span>
                    )}
                  </button>
                </div>
              )}

              {sheet === 'profile' && (
                <form className="flex flex-col gap-3" onSubmit={saveProfile}>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSheet('account')}
                      aria-label="Back"
                      className="-ml-1.5 grid h-8 w-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-[#3C4048] transition-colors hover:bg-[#E8EAED] dark:text-[#D1D5DB] dark:hover:bg-[#262A33]"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                    </button>
                    <h2 className="m-0 text-[17px] leading-[1.3] font-bold">My profile</h2>
                  </div>
                  {settings.names === 'off' ? (
                    <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">Questions in this session are anonymous.</p>
                  ) : (
                    <>
                      <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">Set the name shown when you ask a question.</p>
                      <input
                        placeholder="Your name (optional)"
                        maxLength={80}
                        value={profileName}
                        onChange={e => setProfileName(e.target.value)}
                        autoFocus
                        className="min-h-11 w-full rounded-xl border border-black/8 bg-[#F3F4F7] px-3.5 py-2.5 text-[15px] text-[#0A0B10] focus:border-[#3B6BFF] focus:outline-none dark:border-white/8 dark:bg-[#0A0B10] dark:text-[#F6F3EB]"
                      />
                      <div className="mt-1 flex items-center justify-end gap-2">
                        {profileName.trim() && (
                          <button
                            type="button"
                            onClick={() => {
                              save({ ...draftRef.current, author: '' })
                              setProfileName('')
                              setSheet(null)
                            }}
                            className="min-h-10 cursor-pointer rounded-full border border-black/8 bg-transparent px-4 text-sm font-semibold text-[#2E3240] hover:bg-[#E8EAF0] dark:border-white/8 dark:text-[#C9CCD6] dark:hover:bg-[#1D212B]"
                          >
                            Stay anonymous
                          </button>
                        )}
                        <button
                          type="submit"
                          className="min-h-10 cursor-pointer rounded-full border-0 bg-[#3B6BFF] px-[18px] text-[15px] font-semibold text-white hover:enabled:brightness-105"
                        >
                          Save
                        </button>
                      </div>
                    </>
                  )}
                </form>
              )}

              {sheet === 'my-questions' && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSheet('account')}
                      aria-label="Back"
                      className="-ml-1.5 grid h-8 w-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-[#2E3240] transition-colors hover:bg-[#E8EAF0] dark:text-[#C9CCD6] dark:hover:bg-[#1D212B]"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                    </button>
                    <h2 className="m-0 text-[17px] leading-[1.3] font-bold">My questions</h2>
                  </div>
                  {!myQuestionsList.length ? (
                    <div className="flex flex-col items-start gap-3.5 pt-2 pb-1">
                      <p className="text-sm text-[#565B6E] dark:text-[#8D93AD]">You haven’t asked any questions yet.</p>
                      {!ended && qaEnabled && (
                        <button
                          type="button"
                          onClick={openAsk}
                          className="min-h-10 cursor-pointer rounded-full border-0 bg-[#3B6BFF] px-[18px] text-[15px] font-semibold text-white hover:enabled:brightness-105"
                        >
                          Ask a question
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="mt-1 flex flex-col gap-2.5">
                      {myQuestionsList.map(q => (
                        <div
                          key={q.id}
                          className="rounded-xl border border-black/8 bg-[#F3F4F7] px-3.5 py-3 dark:border-white/8 dark:bg-[#0A0B10]"
                        >
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                q.state === 'approved'
                                  ? 'bg-[#3B6BFF]/12 text-[#2F5BE0] dark:bg-[#3B6BFF]/20 dark:text-[#8AB4FF]'
                                  : q.state === 'answered'
                                    ? 'bg-[#1F7A55]/15 text-[#1F7A55]'
                                    : 'bg-[#E8EAF0] text-[#2E3240] dark:bg-[#1D212B] dark:text-[#C9CCD6]'
                              }`}
                            >
                              {q.state === 'review' ? 'In review' : q.state === 'answered' ? 'Answered' : q.state === 'approved' ? 'Live' : 'Hidden'}
                            </span>
                            <span className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">{age(q.createdAt, now)}</span>
                          </div>
                          <p className="mt-0.5 text-[15px] leading-normal whitespace-pre-wrap wrap-anywhere">{q.text}</p>
                          <Replies replies={(engage?.replies ?? []).filter(reply => reply.questionId === q.id)} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

/** "just now", "4 min ago", "2 h ago" — enough to tell fresh questions from old. */
function age(createdAt: number, now: number): string {
  const minutes = Math.floor((now - createdAt) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`
}

function formatEventDates(startsAt?: number | null, endsAt?: number | null): string | null {
  if (!startsAt && !endsAt) return null
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const shortFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
  if (startsAt && endsAt) {
    const start = new Date(startsAt)
    const end = new Date(endsAt)
    if (start.getFullYear() === end.getFullYear()) {
      return `${shortFmt.format(start)} – ${fmt.format(end)}`
    }
    return `${fmt.format(start)} – ${fmt.format(end)}`
  }
  return fmt.format(new Date((startsAt ?? endsAt)!))
}
