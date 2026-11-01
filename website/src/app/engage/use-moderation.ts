'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AudienceQuestion } from '../../../../src/lib/audience'
import type { AudienceClientEvent, AudienceServerEvent } from '../../../../src/lib/audience-protocol'
import type { EngageSnapshot } from '../../../../src/lib/engage'
import { engageApiBase, engagePost, EngageRequestError } from './client-api'

type WithoutRequest<T> = T extends unknown ? Omit<T, 'requestId'> : never
export type ModeratorCommand = WithoutRequest<Extract<AudienceClientEvent, { type: 'state' | 'edit' | 'reply' | 'present' | 'poll-save' | 'poll-state' }>>
type Pending = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
interface ModeratorSessionPayload {
  id?: string
  name?: string
  snapshot?: Extract<AudienceServerEvent, { type: 'snapshot' }>
  engage?: Extract<AudienceServerEvent, { type: 'engage' }>
}
// Strict Mode can run effect setup twice. A cookie may be rotated only once at a time.
const sessions = new Map<string, Promise<ModeratorSessionPayload>>()
function session(code: string): Promise<ModeratorSessionPayload> {
  const current = sessions.get(code)
  if (current) return current
  const next = engagePost<ModeratorSessionPayload>(code, 'moderator-session').finally(() => { sessions.delete(code) })
  sessions.set(code, next)
  return next
}

export function useModeration(code: string) {
  const [loaded, setLoaded] = useState(false)
  const [questions, setQuestions] = useState<AudienceQuestion[]>([])
  const [engage, setEngage] = useState<EngageSnapshot | null>(null)
  const [title, setTitle] = useState('')
  const [org, setOrg] = useState('Kairo')
  const [connected, setConnected] = useState(false)
  const [closed, setClosed] = useState(false)
  const [needsLink, setNeedsLink] = useState(false)
  const [error, setError] = useState('')
  const socket = useRef<WebSocket | null>(null)
  const pending = useRef(new Map<string, Pending>())

  useEffect(() => {
    let alive = true, stopped = false, attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const rejectPending = (): void => {
      for (const item of pending.current.values()) { clearTimeout(item.timer); item.reject(new Error('Connection interrupted. Your draft is still here.')) }
      pending.current.clear()
    }
    const reconnect = (): void => { if (alive && !stopped) timer = setTimeout(() => { void connect() }, Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5))) }
    const connect = async (): Promise<void> => {
      try {
        const initial = await session(code)
        if (!alive || stopped) return
        setNeedsLink(false)
        if (initial?.snapshot) {
          setQuestions(initial.snapshot.questions)
          setTitle(initial.snapshot.title)
          setOrg(initial.snapshot.orgName)
          setLoaded(true)
          if (initial.snapshot.ended) {
            stopped = true
            setClosed(true)
            return
          }
        }
        if (initial?.engage) {
          setEngage(initial.engage)
          setTitle(initial.engage.engagement.name)
          setOrg(initial.engage.engagement.orgName)
          setLoaded(true)
        }
        const url = new URL(`/v1/engage/${code}/ws?role=moderator`, engageApiBase())
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        const ws = new WebSocket(url)
        socket.current = ws
        let responsive = true
        ws.onopen = () => {
          heartbeat = setInterval(() => {
            if (!responsive) { ws.close(); return }
            responsive = false
            if (ws.readyState === WebSocket.OPEN) ws.send('ping')
          }, 15_000)
        }
        ws.onmessage = event => {
          if (!alive || socket.current !== ws) return
          if (event.data === 'pong') { responsive = true; return }
          let data: AudienceServerEvent
          try { data = JSON.parse(event.data) } catch { return }
          if (data.type === 'snapshot') {
            setQuestions(data.questions); setTitle(data.title); setOrg(data.orgName); setConnected(true); setLoaded(true); setError(''); attempts = 0
            if (data.ended) { stopped = true; setClosed(true); ws.close() }
          } else if (data.type === 'engage') {
            setEngage(data); setTitle(data.engagement.name); setOrg(data.engagement.orgName); setLoaded(true)
          } else if (data.type === 'question') {
            setQuestions(current => [...current.filter(question => question.id !== data.question.id), data.question])
          } else if (data.type === 'state') {
            setQuestions(current => current.map(question => question.id === data.id ? { ...question, state: data.state } : question))
          } else if (data.type === 'ack' || data.type === 'error') {
            const item = data.requestId ? pending.current.get(data.requestId) : undefined
            if (item) { clearTimeout(item.timer); pending.current.delete(data.requestId!); if (data.type === 'ack') item.resolve(); else item.reject(new Error(data.message)) }
            if (data.type === 'error') setError(data.message)
          } else if (data.type === 'ended') { stopped = true; setClosed(true); setConnected(false); ws.close() }
        }
        ws.onclose = event => {
          if (heartbeat) clearInterval(heartbeat)
          if (!alive || socket.current !== ws) return
          setConnected(false); rejectPending()
          if (event.code === 4001) { stopped = true; setNeedsLink(true); setLoaded(true); setError('Your moderator access has been removed. Contact the engagement owner.'); return }
          reconnect()
        }
        ws.onerror = () => { if (alive) setError('Connection interrupted. Reconnecting…') }
      } catch (failure) {
        if (!alive) return
        if (failure instanceof EngageRequestError && [401, 403].includes(failure.status)) { stopped = true; setNeedsLink(true); setLoaded(true); setError('Open your invitation email or request a new sign-in link.'); return }
        if (failure instanceof EngageRequestError && [404, 410].includes(failure.status)) { stopped = true; setClosed(true); setLoaded(true); setError(''); return }
        setError('Could not connect. Retrying…'); reconnect()
      }
    }
    void connect()
    return () => { alive = false; if (timer) clearTimeout(timer); if (heartbeat) clearInterval(heartbeat); socket.current?.close(); socket.current = null; rejectPending() }
  }, [code])

  const send = useCallback((command: ModeratorCommand): Promise<void> => new Promise((resolve, reject) => {
    if (socket.current?.readyState !== WebSocket.OPEN) { reject(new Error('Wait for the connection to return.')); return }
    const requestId = crypto.randomUUID()
    const timer = setTimeout(() => { pending.current.delete(requestId); reject(new Error('This action is taking longer than expected. Check the queue before trying again.')) }, 15_000)
    pending.current.set(requestId, { resolve, reject, timer })
    socket.current.send(JSON.stringify({ ...command, requestId }))
  }), [])

  return { loaded, questions, engage, title, org, connected, closed, needsLink, error, send }
}
