import type { ResilienceStatus, ServiceHealth, ServiceName } from '@shared/ipc'
/* eslint-disable @typescript-eslint/no-explicit-any -- Recovery snapshots are unvalidated disk JSON; each consumer validates piecemeal before use. */
import { EventEmitter } from 'events'
import dns from 'dns'
import fs from 'fs'
import path from 'path'
import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { sttService } from './stt'
import { transitionDetectorRecovery } from '@shared/detector-recovery'


const RECOVERY_FILE = 'session-recovery.json'

class ResilienceManager extends EventEmitter {
  private internetConnected = true
  private claudeFallbackActive = false
  private detectorFallbackReason: ResilienceStatus['detectorFallbackReason'] = null
  private claudeErrorCount = 0
  private claudeProbeActive = false
  private recoverySessionAvailable = false

  private healthMap = new Map<ServiceName, ServiceHealth>()
  private prevOverallHealth: 'ALL_GOOD' | 'DEGRADED' | 'CRITICAL' = 'ALL_GOOD'

  private pollInterval: NodeJS.Timeout | null = null
  private saveStateInterval: NodeJS.Timeout | null = null

  private getStateCallback: (() => any) | null = null
  private orch: { detector: { fallbackMode: boolean } | null; restoreSession: (s: any) => Promise<void> } | null = null

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
    const services: ServiceName[] = ['audio', 'stt', 'detector']
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
        this.setClaudeFallback(true, {
          kind: 'offline',
          message: 'No internet — scripture detection is using local matching.',
        })
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
      this.setClaudeFallback(true, {
        // The operator needs the provider's own words here: "offline" would send
        // them to check the wifi when the real answer is a key or a model name.
        kind: 'provider',
        message: `AI detection refused the request: ${err.message}`,
      })
      
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

  private setClaudeFallback(active: boolean, reason?: ResilienceStatus['detectorFallbackReason']): void {
    this.claudeFallbackActive = active
    this.detectorFallbackReason = active ? (reason ?? this.detectorFallbackReason) : null
    if (this.orch?.detector) {
      this.orch.detector.fallbackMode = active
    }
    
    this.updateServiceHealth(
      'detector',
      active ? 'degraded' : 'ok',
      active ? (this.detectorFallbackReason?.message ?? 'AI detection unavailable') : undefined,
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
    
    const isCritical = healths.some((health) => health.service === 'audio' && health.status === 'error')

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
      claudeFallbackActive: this.claudeFallbackActive,
      detectorFallbackReason: this.claudeFallbackActive ? this.detectorFallbackReason : null,
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
