import { IMPORT_OPTIONS, isImportKind } from '@shared/import-menu'
import { requestImport } from '@/hooks/useImportRequest'
import Documents from '@/components/documents/Documents'
import { useState, useEffect, useRef, type PointerEvent } from 'react'
import { AlertTriangle, RefreshCw, X } from '@/icons'
import AppShell from '@/components/layout/AppShell'
import MediaDock from '@/components/media/MediaDock'
import { TracksPlayer } from '@/components/tracks/TracksPlayer'
import OperatorToolbar from '@/components/operator/OperatorToolbar'
import Scripture from '@/components/scripture/Scripture'
import Lyrics from '@/components/lyrics/Lyrics'
import Operator from '@/components/operator/Operator'
import ThemeEditor from '@/components/theme/ThemeEditor'
import Settings from '@/components/settings/Settings'
import { useAppStore } from '@/stores/useAppStore'
import { LoadingScreen } from '@/bootstrap/LoadingScreen'
import PpConnectGate from '@/components/setup/PpConnectGate'
import OnboardingWizard from '@/components/onboarding/OnboardingWizard'
import AccountGate from '@/components/account/AccountGate'
import {
  BOOTSTRAP_MIN_VISIBLE_MS,
  describeBootstrapWarning,
} from '@/bootstrap/bootstrap-state'
import { hydrateIntegrations, useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import {
  ppLaunchOutcomeFromStatus,
  shouldOfferPpConnectGate,
  type PpLaunchOutcome,
} from '@shared/pp-connect-gate'
import { shouldOfferOnboarding } from '@shared/cloud/onboarding'
import { shouldOfferAccountGate } from '@shared/cloud/auth-state'
import { useAccountStore } from '@/stores/useAccountStore'

export type NavRoute =
  | 'scripture'
  | 'lyrics'
  | 'operator'
  | 'theme'
  | 'documents'

/**
 * One silent handshake per renderer session. Shared so Strict Mode's remount
 * reuses the in-flight result instead of starting a second connect.
 */
let ppLaunchProbe: Promise<PpLaunchOutcome> | null = null

function probePpOnLaunch(): Promise<PpLaunchOutcome> {
  if (ppLaunchProbe) return ppLaunchProbe
  ppLaunchProbe = (async () => {
    if (useAppStore.getState().ppState === 'connected') return 'connected'
    const pp = useBootstrapStore.getState().settings.propresenter
    try {
      await window.api.propresenter.connect({
        host: pp.host,
        port: pp.port,
        password: pp.password,
      })
      const status = await window.api.propresenter.getStatus()
      useAppStore.getState().setPPStatus(status)
      const outcome = ppLaunchOutcomeFromStatus(status.state)
      // A miss schedules reconnects — stop them so the connect gate (if shown)
      // is not permanently locked on "Connecting…".
      if (outcome !== 'connected') {
        try {
          await window.api.propresenter.disconnect()
        } catch {
          /* ignore */
        }
      }
      return outcome
    } catch {
      try {
        await window.api.propresenter.disconnect()
      } catch {
        /* ignore */
      }
      return 'unavailable'
    }
  })()
  return ppLaunchProbe
}

/**
 * Keeps account state current from the main process. Its own component so the
 * cloud never becomes a reason to re-render the audio pipeline, or vice versa.
 */
function CloudSubscriptions(): null {
  useEffect(() => {
    const unsubSession = window.api.account.onSessionChange((session) => {
      useAccountStore.getState().setSession(session)
    })
    const unsubPairing = window.api.account.onPairingChange((pairing) => {
      useAccountStore.getState().setPairing(pairing)
    })
    return () => { unsubSession(); unsubPairing() }
  }, [])
  return null
}

// ─── Persistent audio pipeline (lives at app root, not tied to any route) ──────

function AudioPipeline(): null {
  const {
    isTranscribing, setIsTranscribing,
    setAudioCapturing, setAudioLevel,
    captureDeviceId,
  } = useAppStore()

  const micStreamRef = useRef<MediaStream | null>(null)
  const audioCtxRef  = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)

  // Runtime state is hydrated once by the startup bootstrap; the push
  // subscriptions below keep it current from then on.
  // Sync running state from orchestrator push events
  useEffect(() => {
    const unsubOrch = window.api.orchestrator.onStatus((s) => {
      useAppStore.getState().setIsTranscribing(s.running)
      useAppStore.getState().setAudioCapturing(s.running)
      useAppStore.setState({ scriptureProjectedCount: s.totalPresentations })
    })
    const unsubPP = window.api.propresenter.onStatusChange((status) => {
      useAppStore.getState().setPPStatus(status)
    })
    return () => { unsubOrch(); unsubPP() }
  }, [])

  // Start / stop capture when isTranscribing changes
  useEffect(() => {
    if (!isTranscribing) {
      processorRef.current?.disconnect()
      processorRef.current = null
      audioCtxRef.current?.close().catch(() => {})
      audioCtxRef.current = null
      micStreamRef.current?.getTracks().forEach((t) => t.stop())
      micStreamRef.current = null
      setAudioCapturing(false)
      setAudioLevel(null)
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const constraints: MediaTrackConstraints = {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
        const devId = captureDeviceId || useBootstrapStore.getState().settings.audio.deviceId
        if (devId && devId !== 'default') constraints.deviceId = { exact: devId }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        micStreamRef.current = stream

        const ctx = new AudioContext({ sampleRate: 16000 })
        audioCtxRef.current = ctx
        const source = ctx.createMediaStreamSource(stream)
        // eslint-disable-next-line deprecation/deprecation
        const processor = ctx.createScriptProcessor(4096, 1, 1)
        processorRef.current = processor

        processor.onaudioprocess = (e) => {
          const float32 = e.inputBuffer.getChannelData(0)
          const int16 = new Int16Array(float32.length)
          let sum = 0, peak = 0
          for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]))
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
            sum += s * s
            if (Math.abs(s) > peak) peak = Math.abs(s)
          }
          setAudioLevel({ rms: Math.sqrt(sum / float32.length), peak, clipping: peak > 0.99, timestamp: Date.now() })
          window.api.audio.sendPCMChunk(int16.buffer)
        }

        source.connect(processor)
        processor.connect(ctx.destination)
        setAudioCapturing(true)
      } catch (err) {
        if (!cancelled) {
          console.error('[AudioPipeline] getUserMedia failed:', err)
          setIsTranscribing(false)
          setAudioCapturing(false)
        }
      }
    })()

    return () => { cancelled = true }
  }, [isTranscribing, captureDeviceId])

  return null
}

const views: Record<Exclude<NavRoute, 'operator' | 'theme' | 'documents'>, React.ReactNode> = {
  scripture: <Scripture />,
  lyrics: <Lyrics />,
}

const SETTINGS_FRAME = { w: 780, h: 700 }
const SETTINGS_DRAG_EDGE = 48

function isSettingsChromeDrag(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (
    target.closest(
      'button, a, input, textarea, select, label, [role="switch"], [role="slider"], [data-slot="switch"], [data-slot="slider"]',
    )
  ) {
    return false
  }
  return Boolean(target.closest('[data-settings-drag]'))
}

function clampSettingsOffset(x: number, y: number): { x: number; y: number } {
  const viewW = window.innerWidth
  const viewH = window.innerHeight
  const left = (viewW - SETTINGS_FRAME.w) / 2 + x
  const top = (viewH - SETTINGS_FRAME.h) / 2 + y
  const nextLeft = Math.min(Math.max(left, SETTINGS_DRAG_EDGE - SETTINGS_FRAME.w), viewW - SETTINGS_DRAG_EDGE)
  const nextTop = Math.min(Math.max(top, 8), viewH - SETTINGS_DRAG_EDGE)
  return {
    x: nextLeft - (viewW - SETTINGS_FRAME.w) / 2,
    y: nextTop - (viewH - SETTINGS_FRAME.h) / 2,
  }
}

function DraggableSettingsFrame({ onClose }: { onClose: () => void }): React.ReactElement {
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{
    pointerId: number
    startX: number
    startY: number
    origX: number
    origY: number
  } | null>(null)
  const offsetRef = useRef(offset)
  offsetRef.current = offset

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    if (!isSettingsChromeDrag(event.target)) return
    event.preventDefault()
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origX: offsetRef.current.x,
      origY: offsetRef.current.y,
    }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const active = drag.current
    if (!active || event.pointerId !== active.pointerId) return
    setOffset(
      clampSettingsOffset(
        active.origX + event.clientX - active.startX,
        active.origY + event.clientY - active.startY,
      ),
    )
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current || event.pointerId !== drag.current.pointerId) return
    drag.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div
      className={dragging ? 'relative cursor-grabbing select-none' : 'relative'}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="h-[700px] w-[780px] overflow-hidden rounded-[10px] shadow-[0_24px_80px_rgba(0,0,0,0.72)] ring-1 ring-white/10 animate-spring-in">
        <Settings onClose={onClose} />
      </div>
    </div>
  )
}

export default function App(): React.ReactElement {
  const [route, setRoute] = useState<NavRoute>('operator')
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => window.api.app.onImportRequested((kind) => {
    if (!isImportKind(kind)) return
    const option = IMPORT_OPTIONS.find(option => option.kind === kind)!
    setSettingsOpen(false)
    setRoute(option.route)
    requestImport(kind)
  }), [])
  const [ppGateResolved, setPpGateResolved] = useState(false)
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)
  const [ppLaunch, setPpLaunch] = useState<PpLaunchOutcome>('pending')

  const phase = useBootstrapStore((s) => s.phase)
  const progress = useBootstrapStore((s) => s.progress)
  const errors = useBootstrapStore((s) => s.errors)
  const warningDismissed = useBootstrapStore((s) => s.warningDismissed)
  const ppSettings = useBootstrapStore((s) => s.settings.propresenter)
  const onboarding = useBootstrapStore((s) => s.onboarding)
  const accountSession = useAccountStore((s) => s.session)
  const ppState = useAppStore((s) => s.ppState)
  const ppVersion = useAppStore((s) => s.ppVersion)
  const [minDurationElapsed, setMinDurationElapsed] = useState(false)
  const [loaderMounted, setLoaderMounted] = useState(true)

  // Start bootstrap once. The runner behind this is memoized at module level,
  // so Strict Mode's double effect cannot produce a second IPC call.
  useEffect(() => {
    void useBootstrapStore.getState().start()
    const timer = setTimeout(() => setMinDurationElapsed(true), BOOTSTRAP_MIN_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [])

  const bootstrapped = phase === 'ready' || phase === 'ready-with-warnings'
  const ready = bootstrapped && minDurationElapsed

  // Sign-in is a wall, not a prompt: the booth is unreachable until a
  // confirmed session exists. Setup waits behind it, including the OTP
  // that follows a new account.
  const accountGateOpen = ready && shouldOfferAccountGate(accountSession)

  // Setup only ever appears over a fully loaded, signed-in app, and only until
  // it is answered — a finished or dismissed wizard never comes back on its own.
  const onboardingOpen =
    ready &&
    !accountGateOpen &&
    shouldOfferOnboarding({ state: onboarding, dismissedThisSession: onboardingDismissed })

  // Cross-fade: the loader stays mounted, transparent, for one transition.
  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => setLoaderMounted(false), 320)
    return () => clearTimeout(timer)
  }, [ready])

  // "Run setup again" from Settings clears the wizard's saved progress; this
  // also clears a dismissal made earlier in the same launch, which would
  // otherwise keep the wizard hidden and make that button look broken.
  useEffect(() => {
    return window.api.onboarding.onStateChange((state) => {
      useBootstrapStore.getState().setOnboarding(state)
      if (state.completedAt === null) setOnboardingDismissed(false)
    })
  }, [])

  // Integrations that must never gate startup — but also must not run for a
  // signed-out operator who has not been let into the booth yet.
  useEffect(() => {
    if (!ready || accountGateOpen) return
    void hydrateIntegrations()
  }, [ready, accountGateOpen])

  useEffect(() => {
    if (accountGateOpen) setSettingsOpen(false)
  }, [accountGateOpen])

  // Silent handshake as soon as saved host/port exist. The connect modal is
  // only for a failed attempt — if ProPresenter is already up, skip it.
  useEffect(() => {
    if (!bootstrapped) return
    let cancelled = false
    void probePpOnLaunch().then((outcome) => {
      if (!cancelled) setPpLaunch(outcome)
    })
    return () => {
      cancelled = true
    }
  }, [bootstrapped])

  // Listen to Escape key to close settings modal
  useEffect(() => {
    if (!settingsOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [settingsOpen])

  if (!ready) {
    return (
      <div className="relative h-screen w-screen bg-surface text-white overflow-hidden select-none">
        <CloudSubscriptions />
        <LoadingScreen progress={progress} fadingOut={false} />
      </div>
    )
  }

  if (accountGateOpen) {
    return (
      <div className="relative h-screen w-screen overflow-hidden bg-surface text-white select-none">
        <CloudSubscriptions />
        {loaderMounted && <LoadingScreen progress={progress} fadingOut />}
        <AccountGate />
      </div>
    )
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-transparent text-white select-none animate-fade-in">
      <AudioPipeline />
      <TracksPlayer />
      {loaderMounted && <LoadingScreen progress={progress} fadingOut />}
      {errors.length > 0 && !warningDismissed && (
        <div
          className="absolute inset-x-0 top-0 z-40 flex items-start gap-2.5 border-b border-yellow-500/20 bg-yellow-500/10 px-4 py-2.5 text-xs text-yellow-300"
          role="alert"
        >
          <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" />
          <span className="flex-1">{describeBootstrapWarning(errors)}</span>
          <button
            type="button"
            className="shrink-0 inline-flex items-center gap-1 rounded border border-yellow-500/30 px-2 py-0.5 hover:bg-yellow-500/10"
            onClick={() => { void useBootstrapStore.getState().retry() }}
          >
            <RefreshCw size={11} aria-hidden="true" />
            Retry
          </button>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 hover:bg-yellow-500/10"
            onClick={() => useBootstrapStore.getState().dismissWarning()}
            aria-label="Dismiss startup warning"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}
      <AppShell
        currentRoute={route}
        onNavigate={setRoute}
        onOpenSettings={() => setSettingsOpen(true)}
        toolbar={route === 'operator' ? <OperatorToolbar /> : undefined}
      />
      <main className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-transparent">
        {/* Keep Operator and Theme mounted across navigation so live session
            state and the theme library/draft survive tab switches. */}
        <div
          className={`${route === 'operator' ? 'flex' : 'hidden'} min-h-0 w-full flex-1 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1`}
          aria-hidden={route !== 'operator'}
        >
          <Operator />
        </div>
        <div
          className={`${route === 'theme' ? 'flex' : 'hidden'} min-h-0 w-full flex-1 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1`}
          aria-hidden={route !== 'theme'}
        >
          <ThemeEditor />
        </div>
        <div
          className={`${route === 'documents' ? 'flex' : 'hidden'} min-h-0 w-full flex-1 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1`}
          aria-hidden={route !== 'documents'}
        >
          <Documents />
        </div>
        {route !== 'operator' && route !== 'theme' && route !== 'documents' && (
          <div key={route} className="flex min-h-0 w-full flex-1 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1">
            {views[route]}
          </div>
        )}
      </main>

      {/* Documents has no right rail, so the dock can span the window.
          Operator / Scripture / Lyrics host it inside BoothWorkspace. */}
      {route === 'documents' && <MediaDock />}

      <CloudSubscriptions />

      {onboardingOpen && (
        <OnboardingWizard
          onDismiss={() => {
            setOnboardingDismissed(true)
            // The wizard asks for the ProPresenter host itself, so the launch
            // gate must not ask again the moment it closes.
            setPpGateResolved(true)
          }}
        />
      )}

      {!onboardingOpen &&
        shouldOfferPpConnectGate({
          sessionResolved: ppGateResolved,
          launch: ppLaunch,
          accountGateOpen,
        }) && (
        <PpConnectGate
          initialHost={ppSettings.host}
          initialPort={ppSettings.port}
          password={ppSettings.password}
          ppState={ppState}
          ppVersion={ppVersion}
          onResolved={() => setPpGateResolved(true)}
        />
      )}

      {/* Settings Modal Overlay */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 animate-fade-in">
          <div
            className="absolute inset-0"
            onClick={() => setSettingsOpen(false)}
          />
          <DraggableSettingsFrame onClose={() => setSettingsOpen(false)} />
        </div>
      )}
    </div>
  )
}
