import { EventEmitter } from 'events'
import dns from 'dns'
import fs from 'fs'
import path from 'path'
import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import type { ResilienceStatus, ScriptureSuggestion, ServiceHealth, ServiceName } from '@shared/ipc'
import { proPresenterService } from './propresenter'
import { sttService } from './stt'
import { transitionDetectorRecovery } from '@shared/detector-recovery'


const RECOVERY_FILE = 'session-recovery.json'

class ResilienceManager extends EventEmitter {
  private internetConnected = true
  private ppReconnectCountdown: number | null = null
  private ppCountdownTimer: NodeJS.Timeout | null = null
  private claudeFallbackActive = false
  private claudeErrorCount = 0
  private claudeProbeActive = false
  private recoverySessionAvailable = false

  private healthMap = new Map<ServiceName, ServiceHealth>()
  private prevOverallHealth: 'ALL_GOOD' | 'DEGRADED' | 'CRITICAL' = 'ALL_GOOD'

  private pollInterval: NodeJS.Timeout | null = null
  private saveStateInterval: NodeJS.Timeout | null = null

  private ppQueuedProjections: ScriptureSuggestion[] = []
  private wasPPConnected = false
  private getStateCallback: (() => any) | null = null
  private orch: { presentScriptureDirectly: (s: ScriptureSuggestion) => Promise<void>; detector: { fallbackMode: boolean } | null; restoreSession: (s: any) => Promise<void> } | null = null

  setOrchestrator(orch: ResilienceManager['orch']): void {
    this.orch = orch
  }

  constructor() {
    super()
    this.initHealth()
    this.checkRecoverySessionAvailable()
  }

  // ─── Initialize ────────────────────────────────────────────────────────────

  private initHealth(): void {
    const services: ServiceName[] = ['audio', 'stt', 'detector', 'propresenter']
    for (const service of services) {
      this.healthMap.set(service, {
        service,
        status: 'ok',
        lastUpdated: Date.now(),
      })
    }
  }

  private checkRecoverySessionAvailable(): void {
    const recoveryPath = this.getRecoveryPath()
    this.recoverySessionAvailable = fs.existsSync(recoveryPath)
    log.info('[Resilience] Checked recovery session', { available: this.recoverySessionAvailable })
  }

  // ─── Lifecycle / Listeners ──────────────────────────────────────────────────

  setup(getStateFn: () => any): void {
    this.getStateCallback = getStateFn

    // 1. Listen to ProPresenter Client events
    proPresenterService.onStatusChange((status) => {
      if (status.state === 'connected') {
        this.ppReconnectCountdown = null
        if (this.ppCountdownTimer) {
          clearInterval(this.ppCountdownTimer)
          this.ppCountdownTimer = null
        }
        this.updateServiceHealth('propresenter', 'ok')

        // Replay queued slides
        if (this.ppQueuedProjections.length > 0) {
          log.info(`[Resilience] ProPresenter reconnected. Replaying ${this.ppQueuedProjections.length} projections.`);
          this.drainQueuedProjections()
        }
        this.wasPPConnected = true
      } else if (status.state === 'disconnected' || status.state === 'error') {
        if (this.wasPPConnected) {
          log.warn('[Resilience] ProPresenter connection lost! Triggering warning beep.')
          this.emit('play-beep')
          this.wasPPConnected = false
        }
        this.updateServiceHealth('propresenter', 'error')
      }
    })

    // Listen to PP Client reconnect attempts
    proPresenterService.rawClient.on('reconnecting', (attempt, delayMs) => {
      log.info('[Resilience] PP Client reconnecting', { attempt, delayMs })
      this.ppReconnectCountdown = Math.round(delayMs / 1000)
      this.startPPCountdown()
    })

    // 2. Listen to Deepgram STT state
    sttService.deepgram.on('connected', () => {
      this.updateServiceHealth('stt', 'ok')
    })
    sttService.deepgram.on('reconnecting', (attempt, delayMs) => {
      this.updateServiceHealth('stt', 'degraded', `Deepgram reconnecting (Attempt ${attempt}, delay ${delayMs}ms)`)
    })
    sttService.deepgram.on('disconnected', () => {
      this.updateServiceHealth('stt', 'degraded', 'Deepgram disconnected')
    })
    sttService.deepgram.on('error', (err) => {
      this.updateServiceHealth('stt', 'error', `Deepgram error: ${err.message}`)
    })

    // Audio errors now come from renderer-side capture; no listener needed here
  }

  startMonitoring(): void {
    if (this.pollInterval) return
    log.info('[Resilience] Starting health & connection monitoring')

    // Run health check immediately, then poll every 10s
    this.pollHealthAndHardware()
    this.pollInterval = setInterval(() => this.pollHealthAndHardware(), 10000)

    // Save session recovery state every 30s
    this.saveStateInterval = setInterval(() => this.saveSessionState(), 30000)
  }

  stopMonitoring(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    if (this.saveStateInterval) {
      clearInterval(this.saveStateInterval)
      this.saveStateInterval = null
    }
    if (this.ppCountdownTimer) {
      clearInterval(this.ppCountdownTimer)
      this.ppCountdownTimer = null
    }
    log.info('[Resilience] Stopped resilience monitoring')
  }

  // ─── Connection & Hardware Check Loop ───────────────────────────────────────

  private async pollHealthAndHardware(): Promise<void> {
    // 1. Internet Connection
    const prevInternet = this.internetConnected
    this.internetConnected = await this.checkInternetConnection()
    
    if (this.internetConnected !== prevInternet) {
      log.info('[Resilience] Internet status changed', { online: this.internetConnected })
      this.emitStatus()
      
      // Auto-toggle Claude fallback state depending on overall connectivity
      if (!this.internetConnected) {
        log.warn('[Resilience] Went offline. Switching Claude detector to local regex fallback.')
        this.setClaudeFallback(true)
      } else {
        log.info('[Resilience] Internet restored. Normalizing detector API check.')
        this.setClaudeFallback(false)
      }
    }

    // Update aggregate health
    this.evaluateOverallHealth()
  }

  private checkInternetConnection(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      }, 3000);

      dns.lookup('api.deepgram.com', (err: NodeJS.ErrnoException | null) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        if (err) {
          let resolved2 = false;
          const timer2 = setTimeout(() => {
            if (!resolved2) {
              resolved2 = true;
              resolve(false);
            }
          }, 3000);

          dns.lookup('google.com', (err2: NodeJS.ErrnoException | null) => {
            if (resolved2) return;
            resolved2 = true;
            clearTimeout(timer2);
            resolve(err2 === null);
          });
        } else {
          resolve(true);
        }
      });
    });
  }

  // ─── ProPresenter Timers and Countdown ─────────────────────────────────────

  private startPPCountdown(): void {
    if (this.ppCountdownTimer) clearInterval(this.ppCountdownTimer)
    
    this.ppCountdownTimer = setInterval(() => {
      if (this.ppReconnectCountdown !== null && this.ppReconnectCountdown > 0) {
        this.ppReconnectCountdown--
        this.emitStatus()
      } else {
        if (this.ppCountdownTimer) {
          clearInterval(this.ppCountdownTimer)
          this.ppCountdownTimer = null
        }
      }
    }, 1000)
    this.emitStatus()
  }

  queueProjection(suggestion: ScriptureSuggestion): void {
    if (!this.ppQueuedProjections.some((s) => s.id === suggestion.id)) {
      this.ppQueuedProjections.push(suggestion)
      log.info(`[Resilience] Scripture queued. Queue length: ${this.ppQueuedProjections.length}`)
    }
  }

  private async drainQueuedProjections(): Promise<void> {
    if (!this.orch) {
      log.warn('[Resilience] Orchestrator not set — cannot drain queued projections')
      return
    }
    const queue = [...this.ppQueuedProjections]
    this.ppQueuedProjections = []
    for (const sug of queue) {
      try {
        log.info(`[Resilience] Replaying queued scripture: ${sug.reference}`)
        await this.orch.presentScriptureDirectly(sug)
      } catch (err) {
        log.error(`[Resilience] Replay of ${sug.reference} failed:`, (err as Error).message)
      }
    }
  }

  // ─── Claude / API Failures ─────────────────────────────────────────────────

  handleClaudeError(err: Error): void {
    const previousFallback = this.claudeFallbackActive
    const next = transitionDetectorRecovery({
      consecutiveErrors: this.claudeErrorCount,
      fallbackActive: this.claudeFallbackActive,
      probing: this.claudeProbeActive,
    }, 'request_failed')
    this.claudeErrorCount = next.consecutiveErrors
    this.claudeFallbackActive = next.fallbackActive
    this.claudeProbeActive = next.probing
    this.updateServiceHealth('detector', 'degraded', `Claude failure: ${err.message}`)
    
    if (!previousFallback && this.claudeFallbackActive) {
      log.warn('[Resilience] Claude API failed twice consecutively. Activating local regex fallback.')
      this.setClaudeFallback(true)
      
      // Schedule Claude API test retry in 30 seconds
      setTimeout(() => {
        log.info('[Resilience] Probing Claude API connectivity after 30 seconds')
        const probing = transitionDetectorRecovery({
          consecutiveErrors: this.claudeErrorCount,
          fallbackActive: this.claudeFallbackActive,
          probing: this.claudeProbeActive,
        }, 'begin_probe')
        this.claudeErrorCount = probing.consecutiveErrors
        this.claudeFallbackActive = probing.fallbackActive
        this.claudeProbeActive = probing.probing
        if (this.orch?.detector) this.orch.detector.fallbackMode = false
        this.updateServiceHealth('detector', 'degraded', 'Testing AI detector connectivity')
        this.emitStatus()
      }, 30000)
    }
  }

  handleClaudeSuccess(): void {
    const recovered = transitionDetectorRecovery({
      consecutiveErrors: this.claudeErrorCount,
      fallbackActive: this.claudeFallbackActive,
      probing: this.claudeProbeActive,
    }, 'request_succeeded')
    this.claudeErrorCount = recovered.consecutiveErrors
    this.claudeFallbackActive = recovered.fallbackActive
    this.claudeProbeActive = recovered.probing
    if (this.orch?.detector) this.orch.detector.fallbackMode = false
    this.updateServiceHealth('detector', 'ok')
    this.emitStatus()
  }

  private setClaudeFallback(active: boolean): void {
    this.claudeFallbackActive = active
    if (this.orch?.detector) {
      this.orch.detector.fallbackMode = active
    }
    
    this.updateServiceHealth(
      'detector',
      active ? 'degraded' : 'ok',
      active ? 'Claude API offline — Local regex fallback active' : undefined
    )
    this.emitStatus()
  }

  // ─── Health Calculations ────────────────────────────────────────────────────

  private updateServiceHealth(
    service: ServiceName,
    status: ServiceHealth['status'],
    lastError?: string
  ): void {
    this.healthMap.set(service, {
      service,
      status,
      ...(lastError ? { lastError } : {}),
      lastUpdated: Date.now(),
    })
    this.evaluateOverallHealth()
  }

  private evaluateOverallHealth(): void {
    const healths = Array.from(this.healthMap.values())
    
    // Critical: ProPresenter or Audio disconnected
    const isCritical = healths.some(
      (h) => (h.service === 'propresenter' || h.service === 'audio') && h.status === 'error'
    )
    
    // Degraded: offline, STT reconnecting/error, or Claude in fallback/error
    const isDegraded = 
      !this.internetConnected ||
      healths.some((h) => h.status === 'degraded') ||
      healths.some((h) => (h.service === 'stt' || h.service === 'detector') && h.status === 'error')

    const currentOverall = isCritical ? 'CRITICAL' : isDegraded ? 'DEGRADED' : 'ALL_GOOD'

    if (currentOverall !== this.prevOverallHealth) {
      log.info(`[Health] Status changed from ${this.prevOverallHealth} to ${currentOverall}`)
      this.prevOverallHealth = currentOverall
    }
    
    this.emitStatus()
  }

  // ─── Recovery Session Serialization ────────────────────────────────────────

  private getRecoveryPath(): string {
    return path.join(app.getPath('userData'), RECOVERY_FILE)
  }

  private saveSessionState(): void {
    if (!this.getStateCallback) return
    
    try {
      const state = this.getStateCallback()
      if (!state) return

      const recoveryPath = this.getRecoveryPath()
      fs.writeFileSync(recoveryPath, JSON.stringify(state, null, 2), 'utf8')
    } catch (err) {
      log.error('[Resilience] Failed to save session state:', (err as Error).message)
    }
  }

  hasRecoverySession(): boolean {
    return this.recoverySessionAvailable
  }

  loadRecoverySession(): any | null {
    const recoveryPath = this.getRecoveryPath()
    if (!fs.existsSync(recoveryPath)) return null

    try {
      const raw = fs.readFileSync(recoveryPath, 'utf8')
      const state = JSON.parse(raw)
      log.info('[Resilience] Session state loaded from recovery file')
      return state
    } catch (err) {
      log.error('[Resilience] Failed to load recovery state:', (err as Error).message)
      return null
    }
  }

  discardRecoverySession(): void {
    const recoveryPath = this.getRecoveryPath()
    if (fs.existsSync(recoveryPath)) {
      try {
        fs.unlinkSync(recoveryPath)
        this.recoverySessionAvailable = false
        log.info('[Resilience] Recovery file discarded')
        this.emitStatus()
      } catch (err) {
        log.error('[Resilience] Discard recovery failed:', (err as Error).message)
      }
    }
  }

  registerStateCallback(getStateFn: (() => any) | null): void {
    this.getStateCallback = getStateFn
  }

  async restoreSession(): Promise<void> {
    const state = this.loadRecoverySession()
    if (state && this.orch) {
      await this.orch.restoreSession(state)
    }
  }

  async discardSession(): Promise<void> {
    this.discardRecoverySession()
  }

  onStatusChange(cb: (status: ResilienceStatus) => void): () => void {
    const handler = (status: ResilienceStatus) => cb(status)
    this.on('status-change', handler)
    return () => {
      this.off('status-change', handler)
    }
  }

  // ─── Get Status ─────────────────────────────────────────────────────────────

  getStatus(): ResilienceStatus {
    return {
      overallHealth: this.prevOverallHealth,
      internetConnected: this.internetConnected,
      ppReconnectCountdown: this.ppReconnectCountdown,
      ppQueueSize: this.ppQueuedProjections.length,
      claudeFallbackActive: this.claudeFallbackActive,
      recoverySessionAvailable: this.recoverySessionAvailable,
      health: Array.from(this.healthMap.values()),
    }
  }

  private emitStatus(): void {
    const status = this.getStatus()
    // Broadcast status to all renderer windows
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('resilience:status', status)
      }
    })
    this.emit('status-change', status)
  }
}

export const resilienceManager = new ResilienceManager()
