import { DeckLinkProvider } from './providers/decklink'
import { deckLinkEnabled, deckLinkHelperPath, deckLinkWorkerPath } from './providers/decklink/paths'
import type { VideoDeviceSnapshot, VideoOutputState, VideoPort } from '../../../lib/video-devices'
import type { VideoDeviceProvider, VideoOutputSink } from './provider'

export interface DeviceOutputBinding {
  id: string
  enabled: boolean
  devicePortId: string
  deviceModeId: string
  deviceKeyFill: boolean
}
interface Entry { captures: number; sampledCaptures: number; sampledAt: number; captureFps: number; binding: DeviceOutputBinding; sink: VideoOutputSink; active: boolean; unsubscribe?: () => void }
const NO_CARDS = 'No video cards detected. Check the card in Blackmagic Desktop Video Setup and that its driver is allowed in System Settings → Privacy & Security, then refresh.'
const message = (error: unknown): string => error instanceof Error ? error.message : 'Video device operation failed'

/** Owns acquisition and lifecycle. Providers own conversion and hardware clocks. */
export class VideoDeviceService {
  private ports: VideoPort[] = []
  private providerStates: VideoDeviceSnapshot['providers'] = []
  private entries = new Map<string, Entry>()
  private states: Record<string, VideoOutputState> = {}
  private bindings: DeviceOutputBinding[] = []
  private listeners = new Set<() => void>()
  private unsubscribers: (() => void)[] = []
  private pending: Promise<void> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private faults = new Map<string, { binding: DeviceOutputBinding; reason: string }>()
  /** Ports are re-enumerated only when this is set — refresh, hotplug, or an acquisition needs fresh state. */
  private scanned = false
  private acquiring = 0

  constructor(private readonly providers: readonly VideoDeviceProvider[] = [], debounceMs = 250) {
    for (const provider of providers) {
      try {
        const unsubscribe = provider.onPortsChanged?.(() => {
          if (this.closed) return
          if (this.timer) clearTimeout(this.timer)
          this.timer = setTimeout(() => { this.timer = null; void this.refresh() }, debounceMs)
        })
        if (unsubscribe) this.unsubscribers.push(unsubscribe)
      } catch { /* Explicit refresh remains available if notifications fail. */ }
    }
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  snapshot(): VideoDeviceSnapshot {
    const outputs = { ...this.states }
    for (const [id, entry] of this.entries) {
      const now = Date.now(), elapsed = now - entry.sampledAt
      if (elapsed >= 500) {
        entry.captureFps = (entry.captures - entry.sampledCaptures) * 1000 / elapsed
        entry.sampledCaptures = entry.captures
        entry.sampledAt = now
      }
      outputs[id] = { ...outputs[id], diagnostics: { capturedFrames: entry.captures, captureFps: entry.captureFps, hardware: entry.sink.diagnostics?.() ?? null } }
    }
    return structuredClone({ ports: this.ports, providers: this.providerStates, outputs })
  }
  outputStatus(id: string): VideoOutputState {
    return { ...(this.states[id] ?? { ready: false, reason: 'Output unavailable' }) }
  }
  sinkFor(id: string): VideoOutputSink | null { return this.entries.get(id)?.sink ?? null }
  /** True while hardware is held or an acquisition is in flight — quit must release it first. */
  holdsHardware(): boolean { return this.entries.size > 0 || this.acquiring > 0 }

  private enqueue(work: () => Promise<void>): Promise<void> {
    this.pending = this.pending.then(work, work)
    return this.pending
  }
  reconcile(bindings: readonly DeviceOutputBinding[]): Promise<void> {
    const copy = bindings.map((binding) => ({ ...binding }))
    return this.enqueue(async () => {
      if (this.closed) return
      this.bindings = copy
      await this.reconcileNow()
    })
  }
  refresh(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.closed) { this.faults.clear(); this.scanned = false; await this.reconcileNow() }
    })
  }

  private sameBinding(a: DeviceOutputBinding, b: DeviceOutputBinding): boolean {
    return a.devicePortId === b.devicePortId && a.deviceModeId === b.deviceModeId && a.deviceKeyFill === b.deviceKeyFill
  }

  private emitChanged(): void {
    if (this.closed) return
    for (const listener of this.listeners) {
      try { listener() } catch { /* One subscriber cannot block others. */ }
    }
  }

  private async drop(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.active = false
    this.entries.delete(id)
    try { await entry.sink.close() } catch { /* Other ports still need cleanup. */ }
  }

  /**
   * Whether this pass must enumerate hardware. Steady-state reconciles (every
   * settings write, every display change) reuse the cached ports; only a
   * binding about to acquire a port it can see gets fresh busy/mode state.
   * Unplugged ports come back through `onPortsChanged` → `refresh`.
   */
  private needsScan(): boolean {
    if (!this.scanned) return true
    return this.bindings.some((binding) => {
      if (!binding.enabled || !binding.devicePortId || this.faults.has(binding.id)) return false
      const entry = this.entries.get(binding.id)
      if (entry && this.sameBinding(entry.binding, binding)) return false
      return this.ports.some((port) => port.id === binding.devicePortId)
    })
  }

  private async scan(): Promise<void> {
    this.ports = []
    this.providerStates = []
    for (const provider of this.providers) {
      try {
        const status = provider.status()
        const ports = status.available ? await provider.listPorts() : []
        this.providerStates.push({ name: provider.name, ...provider.status() })
        this.ports.push(...ports.filter((port) => port.provider === provider.name))
      } catch (error) {
        let diagnostic: ReturnType<VideoDeviceProvider['status']> = { available: false }
        try { diagnostic = provider.status() } catch { /* A broken provider must not prevent other scans. */ }
        this.providerStates.push({ name: provider.name, ...diagnostic, available: false, reason: message(error) })
      }
    }
    this.scanned = true
  }

  /** Change detection only — stringifying the live state needs no clone. */
  private stateKey(): string {
    return JSON.stringify({ ports: this.ports, providers: this.providerStates, outputs: this.states })
  }

  private enabledBinding(id: string): DeviceOutputBinding | undefined {
    return this.bindings.find((binding) => binding.id === id && binding.enabled)
  }

  /** Why this binding cannot hold its port right now, or null when it can. `owners`: port id → output id. */
  private problemFor(binding: DeviceOutputBinding, port: VideoPort | undefined, owners: Map<string, string>): string | null {
    const fault = this.faults.get(binding.id)
    if (fault) return fault.reason
    if (!binding.devicePortId) {
      // The driver answered but listed nothing: picking a port is not the problem.
      return this.ports.length === 0 && this.providerStates.some((provider) => provider.available) ? NO_CARDS : 'Choose a video port'
    }
    if (!port) {
      const failed = this.providerStates.find((provider) =>
        !provider.available && binding.devicePortId.startsWith(`${provider.name}:`))
      if (failed?.reason) return failed.reason
      return this.providers.length ? 'Device disconnected' : 'No video device provider available'
    }
    const owner = owners.get(port.id)
    if (owner !== undefined && owner !== binding.id) return 'Port assigned to another output'
    // A provider may report a port Kairo itself holds as busy — that is this output.
    if (port.unavailableReason && owner === undefined) return port.unavailableReason
    if (!port.modes.some((mode) => mode.id === binding.deviceModeId)) return 'Choose a supported video mode'
    if (binding.deviceKeyFill && !port.supportsKeyFill) return 'Key/fill unavailable for this port'
    return null
  }

  private async reconcileNow(): Promise<void> {
    const before = this.stateKey()
    if (this.needsScan()) await this.scan()
    // Release all changed owners first, so swaps never collide with old bindings.
    for (const [id, entry] of this.entries) {
      const next = this.enabledBinding(id)
      if (!next || !this.sameBinding(entry.binding, next)) await this.drop(id)
    }
    for (const [id, fault] of this.faults) {
      const next = this.enabledBinding(id)
      if (!next || !this.sameBinding(fault.binding, next)) this.faults.delete(id)
    }
    this.states = {}
    // Outputs that kept their binding keep their port; only newcomers can conflict.
    const owners = new Map<string, string>()
    for (const [id, entry] of this.entries) owners.set(entry.binding.devicePortId, id)
    for (const binding of this.bindings) {
      if (!binding.enabled) { this.states[binding.id] = { ready: false, reason: 'Output disabled' }; continue }
      const port = this.ports.find((candidate) => candidate.id === binding.devicePortId)
      const reason = this.problemFor(binding, port, owners)
      if (reason || this.closed) {
        if (port && owners.get(port.id) === binding.id) owners.delete(port.id)
        await this.drop(binding.id)
        this.states[binding.id] = { ready: false, reason: reason ?? 'Service closed' }
        continue
      }
      owners.set(port!.id, binding.id)
      if (!this.entries.has(binding.id)) {
        try {
          const provider = this.providers.find((candidate) => candidate.name === port!.provider)!
          this.acquiring++
          const native = await provider.openOutput(port!.id, binding.deviceModeId, { keyFill: binding.deviceKeyFill })
            .finally(() => { this.acquiring-- })
          if (this.closed) { await native.close(); continue }
          let closing: Promise<void> | null = null
          const fail = (error: unknown): void => {
            if (!entry.active || this.closed) return
            entry.active = false
            const reason = message(error)
            this.faults.set(binding.id, { binding, reason })
            this.states[binding.id] = { ready: false, reason }
            void this.enqueue(async () => { await this.drop(binding.id); this.emitChanged() })
          }
          const mode = port!.modes.find((candidate) => candidate.id === binding.deviceModeId)!
          const frameRate = mode.frameRateN / mode.frameRateD
          const entry: Entry = { captures: 0, sampledCaptures: 0, sampledAt: Date.now(), captureFps: 0, binding, active: true, sink: {
            frameRing: native.frameRing,
            diagnostics: () => native.diagnostics?.() ?? null,
            frameRate: Number.isFinite(frameRate) && frameRate > 0 ? frameRate : undefined,
            setFrame: (frame, width, height) => {
              if (!entry.active) return
              if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
                !Number.isSafeInteger(width * height * 4) || frame.length !== width * height * 4) {
                throw new Error('Invalid BGRA frame dimensions or byte length')
              }
              entry.captures++
              try { native.setFrame(frame, width, height) } catch (error) {
                fail(error)
              }
            },
            close: () => {
              if (closing) return closing
              entry.active = false
              if (this.entries.get(binding.id) === entry) {
                this.entries.delete(binding.id)
                this.states[binding.id] = { ready: false, reason: 'Output closed' }
              }
              try { entry.unsubscribe?.() } catch { /* Still release native resources. */ }
              closing = Promise.resolve().then(() => native.close())
              return closing
            },
          } }
          this.entries.set(binding.id, entry)
          try { entry.unsubscribe = native.onError?.(fail) } catch (error) {
            await this.drop(binding.id)
            throw error
          }
          // A sink can report an already-observed failure during subscription.
          if (!entry.active) continue
        } catch (error) {
          owners.delete(port!.id)
          this.states[binding.id] = { ready: false, reason: message(error) }
          continue
        }
      }
      this.states[binding.id] = { ready: true, reason: '' }
    }
    if (!this.closed && before !== this.stateKey()) {
      this.emitChanged()
    }
  }

  close(): Promise<void> {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      try { unsubscribe() } catch { /* Continue releasing other subscriptions. */ }
    }
    return this.enqueue(async () => {
      for (const id of this.entries.keys()) await this.drop(id)
      this.states = {}
      this.listeners.clear()
    })
  }
}

// On in every macOS build. Without Blackmagic Desktop Video or the bundled
// helper the provider reports why it is unavailable instead of failing.
const providers: VideoDeviceProvider[] = deckLinkEnabled()
  ? [new DeckLinkProvider(deckLinkHelperPath(), deckLinkWorkerPath())]
  : []
export const videoDeviceService = new VideoDeviceService(providers)
