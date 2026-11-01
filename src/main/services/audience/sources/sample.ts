import type { AudienceSource, AudienceUpdate } from '../source'

/** Instantiated only by the main-process development flag, never by production. */
export class SampleAudienceSource implements AudienceSource {
  readonly id = 'sample'
  private listeners = new Set<(update: AudienceUpdate) => void>()
  onUpdate(callback: (update: AudienceUpdate) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }
  async start(): Promise<void> {
    const update: AudienceUpdate = {
      status: { id: this.id, kind: 'kairo', label: 'Sample questions', state: 'live', joined: 3 },
      questions: [
        { text: 'How can we put what we learned today into practice this week?', author: 'Ruth', votes: 8 },
        { text: 'Where can I find out more about volunteering?', author: null, votes: 5 },
        { text: 'Will there be another Q&A next week?', author: 'James', votes: 2 },
      ].map((q, index) => ({ ...q, id: `sample:${index}`, sourceId: this.id, state: 'review', createdAt: Date.now() + index })),
    }
    for (const listener of this.listeners) listener(update)
  }
  async stop(): Promise<void> {
    for (const listener of this.listeners) listener({ status: { id: this.id, kind: 'kairo', label: 'Sample questions', state: 'stopped' } })
  }
}
