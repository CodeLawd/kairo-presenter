import { engagementDeadline, normalizePoll, type Engagement, type Moderator, type Reply, type Poll, type PollView } from '../../src/lib/engage'
import { engageInternal } from './engage-internal'
// eslint-disable-next-line import/no-unresolved -- Provided by the Cloudflare runtime.
import { DurableObject } from 'cloudflare:workers'
import { normalizeAudienceText, type AudienceQuestion } from '../../src/lib/audience'
import { DEFAULT_AUDIENCE_ROOM_SETTINGS, normalizeAudienceRoomSettings, parseAudienceEvent, type AudienceRoomSettings, type AudienceServerEvent } from '../../src/lib/audience-protocol'

interface Room {
  code: string
  orgId?: string
  startsAt?: number | null
  endsAt?: number | null
  status?: Engagement['status']
  lastActivityAt?: number
  activePollId?: string | null
  title: string
  orgName: string
  tokenHash: string
  ended: boolean
  deleteAt: number
  /** Absent on rooms created before settings existed. */
  settings?: AudienceRoomSettings
}
interface Participant { id: string; operator: boolean; moderatorId?: string; sessionHash?: string; name?: string }
interface StoredModerator extends Moderator { inviteHash?: string; inviteExpires?: number }
type QuestionRow = { id: string; body: string; participant: string; request: string }
const DAY = 86_400_000

export async function audienceTokenHash(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** One SQLite-backed room. No socket or message passes through the container. */
export class AudienceRoom extends DurableObject<Record<string, unknown>> {
  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, body TEXT NOT NULL, participant TEXT NOT NULL, request TEXT NOT NULL, UNIQUE(participant, request))')
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS votes (question TEXT NOT NULL, participant TEXT NOT NULL, PRIMARY KEY(question, participant))')
    for (const table of ['moderators', 'replies', 'polls']) ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, body TEXT NOT NULL)` )
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS moderator_sessions (hash TEXT PRIMARY KEY, moderator TEXT NOT NULL, expires INTEGER NOT NULL)')
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS poll_votes (poll TEXT NOT NULL, participant TEXT NOT NULL, options TEXT NOT NULL, PRIMARY KEY(poll, participant))')
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS limits (participant TEXT PRIMARY KEY, lastAsk INTEGER NOT NULL DEFAULT 0, voteStart INTEGER NOT NULL DEFAULT 0, voteCount INTEGER NOT NULL DEFAULT 0)')
  }
  private room(): Room | null {
    const row = this.ctx.storage.sql.exec<{ body: string }>('SELECT body FROM room WHERE id=1').toArray()[0]
    return row ? JSON.parse(row.body) : null
  }
  availability(participantId?: string): { exists: boolean; ended: boolean; snapshot?: Extract<AudienceServerEvent, { type: 'snapshot' }>; engage?: Extract<AudienceServerEvent, { type: 'engage' }> } {
    const room = this.room()
    const ended = room ? room.ended || room.status === 'draft' : true
    if (!room || ended || !participantId) return { exists: !!room, ended }
    const participant: Participant = { id: participantId, operator: false }
    return { exists: true, ended: false, snapshot: this.buildSnapshot(room, participant), engage: this.buildEngage(room, participant) }
  }
  private save(room: Room): void {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO room (id, body) VALUES (1, ?)', JSON.stringify(room))
  }
  private settings(room: Room): AudienceRoomSettings { return normalizeAudienceRoomSettings(room.settings ?? DEFAULT_AUDIENCE_ROOM_SETTINGS) }
  async initialize(input: Omit<Room, 'ended' | 'deleteAt'>): Promise<boolean> {
    if (this.room()) return false
    const room: Room = { ...input, status: input.status ?? 'open', ended: false, lastActivityAt: Date.now(), deleteAt: 0 }
    this.save(room)
    await this.ctx.storage.setAlarm(engagementDeadline({ lastActivityAt: room.lastActivityAt!, endsAt: room.endsAt ?? null }))
    return true
  }
  private questions(): AudienceQuestion[] {
    return this.ctx.storage.sql.exec<QuestionRow>('SELECT * FROM questions ORDER BY rowid').toArray().map(row => JSON.parse(row.body))
  }
  private participant(ws: WebSocket): Participant { return ws.deserializeAttachment() as Participant }
  private send(ws: WebSocket, event: AudienceServerEvent): void {
    try { ws.send(JSON.stringify(event)) } catch { /* A disconnected client catches up from its next snapshot. */ }
  }
  private broadcast(event: AudienceServerEvent, operatorsOnly = false, exclude?: WebSocket): void {
    for (const ws of this.ctx.getWebSockets()) if (ws !== exclude && (!operatorsOnly || this.staff(this.participant(ws)))) this.send(ws, event)
  }
  private buildSnapshot(room: Room, participant: Participant): Extract<AudienceServerEvent, { type: 'snapshot' }> {
    const settings = this.settings(room)
    const voted = this.ctx.storage.sql.exec<{ question: string }>('SELECT question FROM votes WHERE participant=?', participant.id).toArray().map(row => row.question)
    const ownQuestions = this.staff(participant) ? [] : this.ctx.storage.sql.exec<{ body: string }>('SELECT body FROM questions WHERE participant=? ORDER BY rowid', participant.id).toArray().map(row => JSON.parse(row.body) as AudienceQuestion)
    // With the list off, people only ask: they never receive anyone else's questions.
    const questions = this.staff(participant) ? this.questions() : settings.showQuestions ? this.questions().filter(q => q.state === 'approved') : []
    return { type: 'snapshot', questions, ownQuestions, title: room.title, orgName: room.orgName, joined: 0, ended: room.ended, voted, settings }
  }
  private snapshot(ws: WebSocket): void {
    const room = this.room()
    if (!room) return
    this.send(ws, this.buildSnapshot(room, this.participant(ws)))
    this.engageSnapshot(ws)
  }
  async fetch(request: Request): Promise<Response> {
    const room = this.room()
    if (!room) return new Response('Room not found', { status: 404 })
    const url = new URL(request.url)
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 })
    const role = url.searchParams.get('role')
    const operator = role === 'operator' || role === 'owner'
    if (!operator && (room.ended || room.status === 'draft')) return new Response('This engagement is closed', { status: 410 })
    const moderatorSession = role === 'moderator' ? await this.authenticateModerator(request) : null
    if (role === 'moderator' && !moderatorSession) return new Response('Sign in from your email link', { status: 401 })
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || url.searchParams.get('operatorToken') || ''
    if (operator && (!token || await audienceTokenHash(token) !== room.tokenHash)) return new Response('Not authorised', { status: 403 })
    if (!operator && this.room()?.ended) return new Response('This Q&A has ended', { status: 410 })
    const id = request.headers.get('X-Audience-Participant')
    if (!operator && !moderatorSession && (!id || !/^[a-f0-9-]{36}$/.test(id))) return new Response('Join the session first', { status: 401 })
    if (this.ctx.getWebSockets().length >= 1000) return new Response('This room is full', { status: 503 })
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ id: operator ? 'operator' : moderatorSession?.moderator.id ?? id!, operator, ...(moderatorSession ? { moderatorId: moderatorSession.moderator.id, sessionHash: moderatorSession.hash, name: moderatorSession.moderator.name || moderatorSession.moderator.email } : {}) } satisfies Participant)
    this.snapshot(server)
    return new Response(null, { status: 101, webSocket: client })
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const event = typeof raw === 'string' ? parseAudienceEvent(raw) : null
    if (!event) { this.send(ws, { type: 'error', message: 'That message could not be read.' }); return }
    const room = this.room()
    const who = this.participant(ws)
    if (!room || (room.ended && !who.operator)) { this.send(ws, { type: 'ended' }); return }
    if (who.moderatorId && !this.validModerator(who)) { ws.close(4001, 'Access revoked'); return }
    const error = (message: string): void => this.send(ws, { type: 'error', message, ...('requestId' in event ? { requestId: event.requestId } : {}) })
    if (event.type === 'snapshot') { this.snapshot(ws); return }
    this.touch(room)
    if (['edit', 'reply', 'present', 'poll-save', 'poll-state', 'poll-vote'].includes(event.type)) { this.engageEvent(ws, event, room, error); return }
    if (event.type === 'state' || event.type === 'end' || event.type === 'settings') {
      if (!this.staff(who) || (!who.operator && event.type !== 'state')) { error('Only the presenter can change engagement settings.'); return }
      if (event.type === 'end') {
        await this.closeEngagement(room)
        this.send(ws, { type: 'ack', requestId: event.requestId })
        this.broadcast({ type: 'ended' })
        for (const socket of this.ctx.getWebSockets()) socket.close(1000, 'Session ended')
        return
      }
      if (event.type === 'settings') {
        this.save({ ...room, settings: event.settings })
        this.send(ws, { type: 'ack', requestId: event.requestId })
        // Everyone re-reads the room: phones show or hide the list and name field.
        for (const socket of this.ctx.getWebSockets()) this.snapshot(socket)
        return
      }
      const row = this.ctx.storage.sql.exec<QuestionRow>('SELECT * FROM questions WHERE id=?', event.id).toArray()[0]
      if (!row) { error('That question no longer exists.'); return }
      const q: AudienceQuestion = { ...JSON.parse(row.body), state: event.state }
      this.ctx.storage.sql.exec('UPDATE questions SET body=? WHERE id=?', JSON.stringify(q), q.id)
      this.broadcast({ type: 'question', question: q }, true)
      if (q.state === 'approved') {
        if (this.settings(room).showQuestions) for (const socket of this.ctx.getWebSockets()) if (!this.staff(this.participant(socket))) this.send(socket, { type: 'question', question: q })
      } else this.broadcast({ type: 'state', id: q.id, state: q.state })
      this.send(ws, { type: 'ack', requestId: event.requestId })
      return
    }
    if (this.staff(who)) { error('Use the audience page to ask and vote.'); return }
    const now = Date.now()
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO limits (participant) VALUES (?)', who.id)
    const limits = this.ctx.storage.sql.exec<{ lastAsk: number; voteStart: number; voteCount: number }>('SELECT * FROM limits WHERE participant=?', who.id).one()
    if (event.type === 'ask') {
      const existing = this.ctx.storage.sql.exec<QuestionRow>('SELECT * FROM questions WHERE participant=? AND request=?', who.id, event.requestId).toArray()[0]
      if (existing) { this.send(ws, { type: 'ack', requestId: event.requestId, question: JSON.parse(existing.body) as AudienceQuestion }); return }
      const text = normalizeAudienceText(event.text)
      if (!text || Array.from(event.text.trim()).length > 280) { error('Questions must be between 1 and 280 characters.'); return }
      if (now - limits.lastAsk < 20_000) { error('Please wait 20 seconds between questions.'); return }
      if (this.ctx.storage.sql.exec<{ count: number }>('SELECT count(*) AS count FROM questions').one().count >= 5000) { error('This session has reached its question limit.'); return }
      const settings = this.settings(room)
      const q: AudienceQuestion = {
        id: `kairo:${crypto.randomUUID()}`, sourceId: 'kairo', text,
        author: settings.names === 'off' ? null : event.author?.trim().slice(0, 80) || null,
        votes: 0, state: settings.review ? 'review' : 'approved', createdAt: now,
      }
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec('INSERT INTO questions (id,body,participant,request) VALUES (?,?,?,?)', q.id, JSON.stringify(q), who.id, event.requestId)
        this.ctx.storage.sql.exec('UPDATE limits SET lastAsk=? WHERE participant=?', now, who.id)
      })
      // Without review a question is approved at once, so phones get it too.
      this.broadcast({ type: 'question', question: q }, !(q.state === 'approved' && settings.showQuestions))
      this.send(ws, { type: 'ack', requestId: event.requestId, question: q })
      return
    }
    if (event.type !== 'vote') return
    if (!this.settings(room).showQuestions) { error('Voting is off for this Q&A.'); return }
    const row = this.ctx.storage.sql.exec<QuestionRow>('SELECT * FROM questions WHERE id=?', event.id).toArray()[0]
    if (!row) { error('That question is no longer available.'); return }
    const q: AudienceQuestion = JSON.parse(row.body)
    if (q.state !== 'approved') { error('That question is no longer open for voting.'); return }
    const hasVote = this.ctx.storage.sql.exec('SELECT 1 FROM votes WHERE question=? AND participant=?', q.id, who.id).toArray().length > 0
    const nextVoted = event.voted ?? !hasVote
    if (hasVote === nextVoted) {
      if (event.requestId) this.send(ws, { type: 'ack', requestId: event.requestId })
      return
    }
    const count = now - limits.voteStart >= 60_000 ? 0 : limits.voteCount
    if (count >= 30) { error('Please wait before voting again.'); return }
    q.votes = Math.max(0, q.votes + (nextVoted ? 1 : -1))
    this.ctx.storage.transactionSync(() => {
      if (nextVoted) this.ctx.storage.sql.exec('INSERT INTO votes (question, participant) VALUES (?,?)', q.id, who.id)
      else this.ctx.storage.sql.exec('DELETE FROM votes WHERE question=? AND participant=?', q.id, who.id)
      this.ctx.storage.sql.exec('UPDATE questions SET body=? WHERE id=?', JSON.stringify(q), q.id)
      this.ctx.storage.sql.exec('UPDATE limits SET voteStart=?,voteCount=? WHERE participant=?', count === 0 ? now : limits.voteStart, count + 1, who.id)
    })
    this.broadcast({ type: 'question', question: q })
    if (event.requestId) this.send(ws, { type: 'ack', requestId: event.requestId })
  }
  webSocketClose(_ws: WebSocket): void {}
  webSocketError(_ws: WebSocket): void {}
  describe(): Engagement | null { const room=this.room(); return room ? this.engagement(room) : null }
  async abortCreation(): Promise<void> { await this.ctx.storage.deleteAll() }
  private staff(p: Participant): boolean { return p.operator || !!p.moderatorId }
  private rows<T>(table: 'moderators' | 'replies' | 'polls'): T[] {
    return this.ctx.storage.sql.exec<{body: string}>(`SELECT body FROM ${table} ORDER BY rowid`).toArray().map(r => JSON.parse(r.body))
  }
  private put(table: 'moderators' | 'replies' | 'polls', value: {id: string}): void {
    this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO ${table} (id,body) VALUES (?,?)`, value.id, JSON.stringify(value))
  }
  private engagement(room: Room): Engagement {
    return { id: room.code, code: room.code, name: room.title, orgName: room.orgName, startsAt: room.startsAt ?? null, endsAt: room.endsAt ?? null, status: room.ended ? 'closed' : room.status ?? 'open', activities: { qa: {...this.settings(room), enabled: true}, polls: {enabled: true} }, activePollId: room.activePollId ?? null }
  }
  private touch(room: Room): void {
    room.lastActivityAt = Date.now()
    this.save(room)
    // An earlier alarm re-checks this deadline, avoiding an alarm write per vote.
  }
  private async index(room: Room, deleted = false): Promise<void> {
    if (!room.orgId) return // Pre-Engage rooms have no organisation index.
    const response = await engageInternal(this.env, 'index', { orgId: room.orgId, id: room.code, code: room.code, name: room.title, status: room.ended ? 'closed' : room.status ?? 'open', startsAt: room.startsAt ?? null, endsAt: room.endsAt ?? null, deleted })
    if (!response.ok) throw new Error('Could not update the engagement list. Try again.')
  }
  private async closeEngagement(room: Room): Promise<void> {
    const closed: Room = { ...room, status: 'closed', ended: true, deleteAt: Date.now() + 30 * DAY }
    this.save(closed)
    await this.ctx.storage.setAlarm(closed.deleteAt)
    await this.index(closed)
  }
  private buildEngage(room: Room, p: Participant): Extract<AudienceServerEvent, { type: 'engage' }> {
    const staff = this.staff(p)
    const questions = this.questions()
    const own = new Set(this.ctx.storage.sql.exec<{id: string}>('SELECT id FROM questions WHERE participant=?', p.id).toArray().map(q => q.id))
    const visible = new Set(questions.filter(q => (q.state === 'approved' || q.state === 'answered') && this.settings(room).showQuestions).map(q => q.id))
    const replies = this.rows<Reply>('replies').filter(r => staff || (r.audience === 'asker' ? own.has(r.questionId) : visible.has(r.questionId) || own.has(r.questionId)))
    const polls: PollView[] = this.rows<Poll>('polls').filter(poll => staff || poll.state !== 'draft').map(poll => {
      const votes = this.ctx.storage.sql.exec<{participant: string; options: string}>('SELECT participant,options FROM poll_votes WHERE poll=?', poll.id).toArray()
      const totals: Record<string, number> = {}
      if (staff || poll.showResults) for (const row of votes) for (const id of JSON.parse(row.options) as string[]) totals[id] = (totals[id] ?? 0) + 1
      return {...poll, totals, voters: staff || poll.showResults ? votes.length : 0, voted: JSON.parse(votes.find(v => v.participant === p.id)?.options ?? '[]')}
    })
    const moderators = p.operator ? this.rows<StoredModerator>('moderators').map(({id,email,name,invitedAt,lastSeenAt,revoked}) => ({id,email,name,invitedAt,lastSeenAt,revoked})) : undefined
    return {type:'engage', engagement:this.engagement(room), replies, polls, ...(moderators ? {moderators} : {})}
  }
  private engageSnapshot(ws: WebSocket): void {
    const room = this.room()
    if (!room) return
    this.send(ws, this.buildEngage(room, this.participant(ws)))
  }
  private engagePending = false
  private broadcastEngage(): void {
    if (this.engagePending) return
    this.engagePending = true
    this.ctx.waitUntil(new Promise<void>(resolve => setTimeout(() => {
      this.engagePending = false
      for (const ws of this.ctx.getWebSockets()) this.engageSnapshot(ws)
      resolve()
    }, 50)))
  }
  private validModerator(p: Participant): boolean {
    const moderator = this.rows<StoredModerator>('moderators').find(m => m.id === p.moderatorId)
    if (!moderator || moderator.revoked || !p.sessionHash) return false
    return !!this.ctx.storage.sql.exec('SELECT hash FROM moderator_sessions WHERE hash=? AND moderator=? AND expires>?', p.sessionHash, moderator.id, Date.now()).toArray().length
  }
  private async authenticateModerator(request: Request): Promise<{moderator: StoredModerator; hash: string} | null> {
    const code = this.room()!.code
    const token = request.headers.get('Cookie')?.split(';').map(c=>c.trim()).find(c=>c.startsWith(`kairo-mod-${code}=`))?.split('=')[1]
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
    const hash = await audienceTokenHash(token)
    const session = this.ctx.storage.sql.exec<{moderator: string}>('SELECT moderator FROM moderator_sessions WHERE hash=? AND expires>?', hash, Date.now()).toArray()[0]
    const moderator = session && this.rows<StoredModerator>('moderators').find(m => m.id === session.moderator && !m.revoked)
    if (!moderator) return null
    moderator.lastSeenAt = Date.now(); this.put('moderators', moderator)
    return {moderator,hash}
  }
  private async owner(request: Request): Promise<boolean> {
    const room = this.room(), token = request.headers.get('Authorization')?.replace(/^Bearer /,'')
    return !!room && !!token && await audienceTokenHash(token) === room.tokenHash
  }
  /** RPC methods are reached only by the Worker, never via audience messages. */
  async manage(request: Request, action: string): Promise<Response> {
    const room = this.room()
    if (!room) return new Response('Not found',{status:404})
    if (!await this.owner(request)) return new Response('Not authorised',{status:403})
    if (action === 'credentials') return Response.json(this.engagement(room))
    if (action === 'close') {
      await this.closeEngagement(room); this.broadcast({type:'ended'})
      for(const ws of this.ctx.getWebSockets()) ws.close(1000,'Engagement closed')
      return Response.json({ok:true})
    }
    if (action === 'delete') {
      await this.index(room,true)
      for(const ws of this.ctx.getWebSockets()) ws.close(1000,'Engagement deleted')
      await this.ctx.storage.deleteAll(); return Response.json({ok:true})
    }
    if (action === 'open') {
      if (room.endsAt && room.endsAt + DAY <= Date.now()) return new Response('Change the end date before reopening this engagement.', {status:400})
      const next: Room = {...room, ended:false,status:'open',lastActivityAt:Date.now(),deleteAt:0}
      this.save(next)
      this.ctx.waitUntil(this.index(next))
      await this.ctx.storage.setAlarm(engagementDeadline({lastActivityAt:next.lastActivityAt!,endsAt:next.endsAt??null}))
      for(const ws of this.ctx.getWebSockets()) this.snapshot(ws)
      return Response.json(this.engagement(next))
    }
    if (action === 'moderators') {
      const body = await request.json() as {email?:unknown;name?:unknown}
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return new Response('Enter a valid email.',{status:400})
      const existing = this.rows<StoredModerator>('moderators').find(m=>m.email===email)
      const m: StoredModerator = existing ?? {id:crypto.randomUUID(),email,name:null,invitedAt:Date.now(),lastSeenAt:null,revoked:false}
      m.name = typeof body.name === 'string' ? body.name.trim().slice(0,80)||null : m.name
      m.revoked=false
      const result = await this.invite(room,m)
      if (!result.ok) return new Response('Could not send the invitation. Check email configuration and try again.',{status:503})
      this.broadcastEngage(); return Response.json({ok:true})
    }
    if (action.startsWith('revoke/')) {
      const m = this.rows<StoredModerator>('moderators').find(m=>m.id===action.slice(7))
      if (!m) return new Response('Not found',{status:404})
      m.revoked=true; m.inviteHash=undefined; this.put('moderators',m)
      this.ctx.storage.sql.exec('DELETE FROM moderator_sessions WHERE moderator=?',m.id)
      for(const ws of this.ctx.getWebSockets()) if(this.participant(ws).moderatorId===m.id) ws.close(4001,'Access revoked')
      this.broadcastEngage(); return Response.json({ok:true})
    }
    return new Response('Not found',{status:404})
  }
  async resume(orgId: string, tokenHash: string): Promise<boolean> {
    const room = this.room()
    if (!room || room.orgId !== orgId) return false
    this.save({...room,tokenHash})
    // Credential rotation closes old owner sockets; audience/moderators keep their sessions.
    for(const ws of this.ctx.getWebSockets()) if(this.participant(ws).operator) ws.close(4000,'Presenter reconnected')
    return true
  }
  private async invite(room: Room, m: StoredModerator): Promise<Response> {
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('')
    // The code routes the exchange to its DO; the random part is the sole credential.
    const link = `${typeof this.env.PUBLIC_WEB_URL === 'string' ? this.env.PUBLIC_WEB_URL.replace(/\/$/,'') : 'https://kairopresenter.com'}/engage/m/${room.code}.${token}`
    const hash = await audienceTokenHash(token)
    // Persist only a hash. Raw token exists only in this request and outbound email.
    const response = await engageInternal(this.env,'invite',{to:m.email,engagementName:room.title,orgName:room.orgName,link})
    if (response.ok) { m.inviteHash=hash; m.inviteExpires=Date.now()+3*DAY; m.invitedAt=Date.now(); this.put('moderators',m) }
    return response
  }
  async moderatorAccess(request: Request, action: 'exchange' | 'request-link' | 'session'): Promise<Response> {
    const room=this.room()
    if(!room || room.ended || room.status==='draft') return new Response('Engagement unavailable',{status:410})
    const local=['localhost','127.0.0.1'].includes(new URL(request.url).hostname)
    const cookie = (token: string): string => `kairo-mod-${room.code}=${token}; HttpOnly; SameSite=Lax; Path=/v1/engage/${room.code}; Max-Age=2592000${local?'':'; Secure'}`
    if(action==='request-link') {
      const {email} = await request.json() as {email?: unknown}
      const normalized=typeof email==='string'?email.trim().toLowerCase():''
      const key=`link:${normalized.slice(0,254)}`
      const last=await this.ctx.storage.get<number>(key)??0
      // Rate limit persisted for each invited address; same public response in all cases.
      const m=this.rows<StoredModerator>('moderators').find(m=>m.email===normalized&&!m.revoked)
      if(m && Date.now()-last>60000){await this.ctx.storage.put(key,Date.now());await this.invite(room,m)}
      return Response.json({ok:true})
    }
    let moderator: StoredModerator | undefined
    let oldHash: string | undefined
    if(action==='session') {
      const auth=await this.authenticateModerator(request)
      if(!auth)return new Response('Sign in again',{status:401})
      moderator=auth.moderator;oldHash=auth.hash
    } else {
      const {token}=await request.json() as {token?:unknown}
      if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return new Response('Link invalid or expired',{status:401})
      const hash=await audienceTokenHash(token)
      moderator=this.rows<StoredModerator>('moderators').find(m=>!m.revoked&&m.inviteHash===hash&&(m.inviteExpires??0)>Date.now())
      if(!moderator)return new Response('Link invalid or expired',{status:401})
      moderator.inviteHash=undefined;moderator.inviteExpires=undefined
    }
    const token=[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('')
    const hash=await audienceTokenHash(token)
    // Recheck after digest awaits: simultaneous exchanges must not redeem twice.
    if(action==='exchange' && !this.rows<StoredModerator>('moderators').some(m=>m.id===moderator!.id&&m.inviteHash&&!m.revoked))return new Response('Link already used',{status:401})
    this.ctx.storage.transactionSync(()=>{
      if(oldHash)this.ctx.storage.sql.exec('DELETE FROM moderator_sessions WHERE hash=?',oldHash)
      moderator!.lastSeenAt=Date.now();this.put('moderators',moderator!)
      this.ctx.storage.sql.exec('INSERT INTO moderator_sessions(hash,moderator,expires) VALUES(?,?,?)',hash,moderator!.id,Date.now()+30*DAY)
    })
    this.broadcastEngage()
    const modParticipant: Participant = { id: moderator.id, operator: false, moderatorId: moderator.id, sessionHash: hash, name: moderator.name || moderator.email }
    return Response.json({id:room.code,name:moderator.name||moderator.email,snapshot:this.buildSnapshot(room,modParticipant),engage:this.buildEngage(room,modParticipant)},{headers:{'Set-Cookie':cookie(token),'Cache-Control':'no-store'}})
  }
  private engageEvent(ws: WebSocket, event: import('../../src/lib/audience-protocol').AudienceClientEvent, room: Room, error: (message:string)=>void): void {
    const p=this.participant(ws), staff=this.staff(p)
    if(!('requestId' in event)||!event.requestId)return
    const by=p.operator?'Presenter':p.name||'Moderator'
    if(event.type!=='poll-vote'&&!staff){error('Only the team can do that.');return}
    if(event.type==='edit'||event.type==='present'||event.type==='reply') {
      const id=event.type==='reply'?event.questionId:event.id
      const row=this.ctx.storage.sql.exec<QuestionRow>('SELECT * FROM questions WHERE id=?',id).toArray()[0]
      if(!row){error('Question not found.');return}
      const q:AudienceQuestion=JSON.parse(row.body)
      if(event.type==='edit') {
        const text=normalizeAudienceText(event.text)
        if(q.state!=='review'||!text||Array.from(event.text.trim()).length>280){error('Only questions in Review can be edited (up to 280 characters).');return}
        q.originalText??=q.text;q.text=text;q.editedBy=by
      } else if(event.type==='present') {q.sentBy=by;q.sentAt=Date.now()}
      else {
        const text=event.text.trim()
        if(!text||text.length>2000){error('Replies need between 1 and 2,000 characters.');return}
        // Correlated request id makes reconnect retries idempotent.
        const id=`${p.id}:${event.requestId}`
        this.put('replies',{id,questionId:q.id,text,by,audience:event.audience,at:Date.now()} as Reply)
        this.broadcastEngage();this.send(ws,{type:'ack',requestId:event.requestId});return
      }
      this.ctx.storage.sql.exec('UPDATE questions SET body=? WHERE id=?',JSON.stringify(q),q.id)
      this.broadcast({type:'question',question:q},true)
    } else if(event.type==='poll-save') {
      let poll:Poll
      try{poll=normalizePoll(event.poll)}catch(e){error(e instanceof Error?e.message:'Invalid poll');return}
      const existing=this.rows<Poll>('polls').find(p=>p.id===poll.id)
      if(existing&&existing.state!=='draft'){error('Only draft polls can be edited.');return}
      this.put('polls',poll)
    } else if(event.type==='poll-state') {
      const poll=this.rows<Poll>('polls').find(p=>p.id===event.id)
      if(!poll){error('Poll not found.');return}
      if(event.state==='open') for(const other of this.rows<Poll>('polls')) if(other.id!==poll.id&&other.state==='open')this.put('polls',{...other,state:'closed'} as Poll)
      this.put('polls',{...poll,state:event.state,showResults:event.showResults} as Poll)
      room.activePollId=event.state==='open'?poll.id:null;this.save(room)
    } else if(event.type==='poll-vote') {
      if(staff){error('Use the audience page to vote.');return}
      const poll=this.rows<Poll>('polls').find(p=>p.id===event.id)
      if(!poll||poll.state!=='open'){error('This poll is closed.');return}
      const options=[...new Set(event.options)]
      if(!options.length||(!poll.multiple&&options.length!==1)||options.some(id=>!poll.options.some(o=>o.id===id))){error('Choose valid poll options.');return}
      if(this.ctx.storage.sql.exec('SELECT 1 FROM poll_votes WHERE poll=? AND participant=?',poll.id,p.id).toArray().length){this.send(ws,{type:'ack',requestId:event.requestId});return}
      this.ctx.storage.sql.exec('INSERT OR IGNORE INTO poll_votes(poll,participant,options) VALUES(?,?,?)',poll.id,p.id,JSON.stringify(options))
    } else return
    this.broadcastEngage();this.send(ws,{type:'ack',requestId:event.requestId})
  }
  async alarm(): Promise<void> {
    const room = this.room()
    if (!room) return
    if (!room.ended) {
      const deadline = engagementDeadline({ lastActivityAt: room.lastActivityAt ?? Date.now(), endsAt: room.endsAt ?? null })
      if (Date.now() < deadline) { await this.ctx.storage.setAlarm(deadline); return }
      await this.closeEngagement(room)
      this.broadcast({ type: 'ended' })
      for (const ws of this.ctx.getWebSockets()) ws.close(1000, 'Engagement closed')
    } else if (Date.now() >= room.deleteAt) {
      await this.index(room, true)
      for (const ws of this.ctx.getWebSockets()) ws.close(1000, 'Engagement deleted')
      await this.ctx.storage.deleteAll()
    } else await this.ctx.storage.setAlarm(room.deleteAt)
  }
}
