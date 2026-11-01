import type { EngageCommand, PollView } from '../../../lib/engage'
import {
  mergeAudienceQuestions, normalizeAudienceText, setAudienceQuestionState,
  type AudienceQuestionState, type AudienceState,
} from '../../../lib/audience'
import type { AudienceRoomSettings } from '../../../lib/audience-protocol'
import type { ProgramQuestion } from '../../../lib/program'
import type { AudienceSource } from './source'

interface QuestionOutput {
  showQuestion(question: ProgramQuestion): unknown
  clearQuestion(): unknown
  showPoll?(poll: PollView): unknown
  clearPoll?(): unknown
}

/** Queue ownership lives here, independent of Electron and each remote source. */
export class AudienceService {
  private state: AudienceState = { sampleAvailable: false, questions: [], sources: [], liveId: null, session: null }
  private sources = new Map<string, { source: AudienceSource; unsubscribe: () => void }>()
  private listeners = new Set<(state: AudienceState) => void>()
  constructor(private readonly output: QuestionOutput, options: { sampleAvailable?: boolean } = {}) {
    this.state.sampleAvailable = options.sampleAvailable === true
  }
  getState(): AudienceState { return structuredClone(this.state) }
  onChanged(callback: (state: AudienceState) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }
  private emit(): AudienceState {
    for (const callback of this.listeners) callback(this.getState())
    return this.getState()
  }
  async start(source: AudienceSource): Promise<AudienceState> {
    if (this.sources.has(source.id)) return this.getState()
    const unsubscribe = source.onUpdate(update => {
      if (update.engage) {
        this.state.engage = update.engage
        if(this.state.livePollId) { const poll=update.engage.polls.find(p=>p.id===this.state.livePollId); if(poll)this.output.showPoll?.(poll) }
      }
      if (update.questions) {
        const valid = update.questions.flatMap(q => {
          const text = normalizeAudienceText(q.text)
          return text && q.sourceId === source.id && q.id.startsWith(`${source.id}:`)
            ? [{ ...q, text, author: q.author?.trim().slice(0, 80) || null, votes: Number.isFinite(q.votes) ? Math.max(0, Math.floor(q.votes)) : 0 }] : []
        })
        this.state.questions = mergeAudienceQuestions(this.state.questions, valid, update.moderation)
      }
      if (update.status) this.state.sources = [...this.state.sources.filter(s => s.id !== source.id), update.status]
      if (update.session && update.session.roomId !== this.state.session?.roomId) {
        // Previous rooms remain private to their own session; never send their
        // moderation IDs to a newly created room using the same source name.
        this.state.questions = this.state.questions.filter(q => q.sourceId !== source.id)
      }
      if (update.session !== undefined) this.state.session = update.session
      if (update.status?.state === 'stopped') {
        this.sources.get(source.id)?.unsubscribe()
        this.sources.delete(source.id)
        if (source.id === 'kairo') { this.state.session = null; this.state.engage = undefined; this.clearPoll() }
        if ((source.id === 'kairo' && this.state.liveId === 'join') || this.state.questions.some(q => q.id === this.state.liveId && q.sourceId === source.id)) this.clear()
        this.state.questions = this.state.questions.filter(q => q.sourceId !== source.id)
      }
      this.emit()
    })
    this.sources.set(source.id, { source, unsubscribe })
    try { await source.start() } catch (error) {
      unsubscribe()
      this.sources.delete(source.id)
      await source.stop().catch(() => undefined)
      throw error
    }
    return this.emit()
  }
  /** Quit must close local windows/sockets even when the room is unreachable. */
  shutdown(): void {
    for (const { source, unsubscribe } of this.sources.values()) {
      unsubscribe()
      source.dispose?.()
    }
    this.sources.clear()
    this.state = { ...this.state, liveId: null, session: null, sources: this.state.sources.map(source => ({ ...source, state: 'stopped' })) }
  }
  open(id: string): AudienceState {
    this.sources.get(id)?.source.open?.()
    return this.getState()
  }
  async stop(id: string): Promise<AudienceState> {
    const entry = this.sources.get(id)
    if (!entry) return this.getState()
    await entry.source.stop()
    entry.unsubscribe()
    this.sources.delete(id)
    this.state.sources = this.state.sources.map(s => s.id === id ? { ...s, state: 'stopped' } : s)
    if (id === 'kairo') { this.state.session = null; this.state.engage = undefined; this.clearPoll() }
    if ((id === 'kairo' && this.state.liveId === 'join') || this.state.questions.some(q => q.id === this.state.liveId && q.sourceId === id)) this.clear()
    this.state.questions = this.state.questions.filter(q => q.sourceId !== id)
    return this.emit()
  }
  detachEngagement(): void {
    const entry=this.sources.get('kairo');entry?.unsubscribe();entry?.source.dispose?.();this.sources.delete('kairo')
    this.clear();this.clearPoll();this.state.session=null;this.state.engage=undefined
    this.state.questions=this.state.questions.filter(q=>q.sourceId!=='kairo')
    this.state.sources=this.state.sources.filter(s=>s.id!=='kairo')
  }
  async command(command: EngageCommand): Promise<AudienceState> {
    const source=this.sources.get('kairo')?.source
    if(!source?.command)throw new Error('Open an engagement first.')
    await source.command(command);return this.getState()
  }
  async manage(action: string, body: unknown): Promise<AudienceState> {
    const source=this.sources.get('kairo')?.source
    if(!source?.manage)throw new Error('Open an engagement first.')
    await source.manage(action,body);return this.getState()
  }
  showPoll(id: string): AudienceState {
    const poll=this.state.engage?.polls.find(p=>p.id===id)
    if(!poll)throw new Error('Choose an existing poll.')
    this.output.showPoll?.(poll);this.state.livePollId=id;return this.emit()
  }
  clearPoll(): AudienceState { this.output.clearPoll?.();this.state.livePollId=null;return this.emit() }
  async setRoomSettings(settings: AudienceRoomSettings): Promise<AudienceState> {
    const kairo = this.sources.get('kairo')?.source
    if (!kairo?.setSettings || !this.state.session) throw new Error('Start a Q&A first.')
    await kairo.setSettings(settings)
    return this.getState()
  }
  /** The join link of the running room — only ever this one, never a renderer-supplied URL. */
  audiencePageUrl(): string {
    if (!this.state.session) throw new Error('Start a Q&A first.')
    return this.state.session.url
  }
  async moderate(id: string, state: AudienceQuestionState): Promise<AudienceState> {
    if (!['review', 'approved', 'answered', 'hidden'].includes(state)) throw new Error('Choose a valid question state.')
    const question = this.state.questions.find(q => q.id === id)
    if (!question) throw new Error('That question no longer exists.')
    // Send upstream first; on disconnection the source queues the desired state.
    await this.sources.get(question.sourceId)?.source.setState?.(id, state)
    this.state.questions = setAudienceQuestionState(this.state.questions, id, state)
    if (state !== 'approved' && this.state.liveId === id) this.clear()
    return this.emit()
  }
  show(id: string): AudienceState {
    const question = this.state.questions.find(q => q.id === id)
    if (!question || question.state !== 'approved') throw new Error('Approve this question before showing it.')
    this.output.showQuestion({ text: question.text, author: question.author })
    this.state.liveId = id
    return this.emit()
  }
  clear(): AudienceState {
    this.output.clearQuestion()
    this.state.liveId = null
    return this.emit()
  }
  /** Called when Clear All or another program control takes the layer down. */
  syncCleared(): void {
    if (this.state.liveId !== null) { this.state.liveId = null; this.emit() }
  }
  showJoinCode(): AudienceState {
    const room = this.state.session
    if (!room) throw new Error('Start a Q&A session first.')
    this.output.showQuestion({ kind: 'join', code: room.code, url: room.url, qrDataUrl: room.qrDataUrl })
    this.state.liveId = 'join'
    return this.emit()
  }
}
