import type { LocalBibleInstallProgress, LocalBiblePackInstallResult } from '@shared/ipc'

type TransferProgress = Pick<LocalBibleInstallProgress, 'phase' | 'receivedBytes' | 'totalBytes'>
interface InstallerDependencies {
  download: (translation: string, update: (progress: TransferProgress) => void) => Promise<Buffer>
  install: (translation: string, bytes: Buffer) => LocalBiblePackInstallResult
}

function recoveryMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/timeout|timed out|aborted/i.test(message)) return 'The download took too long. Check your internet connection and try again.'
  if (/fetch|network|internet|ENOTFOUND|ECONN/i.test(message)) return 'Could not download this Bible. Check your internet connection and try again.'
  if (/security check|invalid size|decompress/i.test(message)) return 'The download could not be verified. Please try downloading it again.'
  if (/HTTP/.test(message)) return 'The download is unavailable right now. Please try again shortly.'
  return 'This Bible could not be installed. Please try again. If it continues, restart Kairo.'
}

/** Session-owned progress survives renderer navigation and shares duplicate requests. */
export class LocalBibleInstaller {
  private progress = new Map<string, LocalBibleInstallProgress>()
  private pending = new Map<string, Promise<LocalBiblePackInstallResult>>()
  private listeners = new Set<(progress: LocalBibleInstallProgress) => void>()
  private revision = 0
  private lastNotification = new Map<string, number>()

  constructor(private readonly dependencies: InstallerDependencies) {}

  getProgress(translation: string): LocalBibleInstallProgress | undefined {
    return this.progress.get(translation.toUpperCase())
  }

  clear(translation: string): void {
    this.progress.delete(translation.toUpperCase())
  }

  subscribe(listener: (progress: LocalBibleInstallProgress) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private update(translation: string, change: Partial<LocalBibleInstallProgress>): void {
    const previous = this.progress.get(translation)
    const progress: LocalBibleInstallProgress = {
      phase: 'downloading', receivedBytes: 0, ...this.progress.get(translation),
      ...change, translation, revision: ++this.revision,
    }
    this.progress.set(translation, progress)
    const now = Date.now()
    if (progress.phase === 'downloading' && previous?.phase === 'downloading'
      && now - (this.lastNotification.get(translation) ?? 0) < 100) return
    this.lastNotification.set(translation, now)
    for (const listener of this.listeners) listener(progress)
  }

  start(translation: string): Promise<LocalBiblePackInstallResult> {
    const id = translation.toUpperCase()
    const existing = this.pending.get(id)
    if (existing) return existing
    const task = Promise.resolve().then(async () => {
      this.update(id, { phase: 'downloading', receivedBytes: 0, totalBytes: undefined, error: undefined })
      try {
        const bytes = await this.dependencies.download(id, progress => this.update(id, progress))
        this.update(id, { phase: 'installing' })
        await new Promise<void>(resolve => setImmediate(resolve))
        const result = this.dependencies.install(id, bytes)
        this.update(id, { phase: 'ready' })
        return result
      } catch (error) {
        const message = recoveryMessage(error)
        this.update(id, { phase: 'failed', error: message })
        throw new Error(message, { cause: error })
      } finally {
        this.pending.delete(id)
      }
    })
    this.pending.set(id, task)
    return task
  }
}
