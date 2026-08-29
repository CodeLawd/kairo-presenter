import { useState, useEffect, useRef } from 'react'
import { AlertTriangle, RefreshCw, X } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import MediaDock from '@/components/media/MediaDock'
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

export type NavRoute =
  | 'scripture'
  | 'lyrics'
  | 'operator'
  | 'theme'

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
      return ppLaunchOutcomeFromStatus(status.state)
    } catch {
      return 'unavailable'
    }
  })()
  return ppLaunchProbe
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

const views: Record<Exclude<NavRoute, 'operator' | 'theme'>, React.ReactNode> = {
  scripture: <Scripture />,
  lyrics: <Lyrics />,
}

export default function App(): React.ReactElement {
  const [route, setRoute] = useState<NavRoute>('operator')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ppGateResolved, setPpGateResolved] = useState(false)
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)
  const [ppLaunch, setPpLaunch] = useState<PpLaunchOutcome>('pending')

  const phase = useBootstrapStore((s) => s.phase)
  const progress = useBootstrapStore((s) => s.progress)
  const errors = useBootstrapStore((s) => s.errors)
  const warningDismissed = useBootstrapStore((s) => s.warningDismissed)
  const ppSettings = useBootstrapStore((s) => s.settings.propresenter)
  const onboarding = useBootstrapStore((s) => s.onboarding)
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

  // Setup only ever appears over a fully loaded app, and only until it is
  // answered — a finished or dismissed wizard never comes back on its own.
  const onboardingOpen =
    ready && shouldOfferOnboarding({ state: onboarding, dismissedThisSession: onboardingDismissed })

  // Cross-fade: the loader stays mounted, transparent, for one transition.
  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => setLoaderMounted(false), 320)
    return () => clearTimeout(timer)
  }, [ready])

  // Integrations that must never gate startup.
  useEffect(() => {
    if (!ready) return
    void hydrateIntegrations()
  }, [ready])

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
        <LoadingScreen progress={progress} fadingOut={false} />
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-surface text-white overflow-hidden select-none relative animate-fade-in">
      <AudioPipeline />
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
      <main className="relative flex-1 min-h-0 overflow-hidden bg-surface-secondary w-full flex flex-col">
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
        {route !== 'operator' && route !== 'theme' && (
          <div key={route} className="flex min-h-0 w-full flex-1 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1">
            {views[route]}
          </div>
        )}
      </main>

      {/* Background dock — docked under every live-output tab so a background can
          be changed mid-song without leaving the song. Hidden on Theme, where a
          pushed background would fight the theme preview. */}
      {route !== 'theme' && <MediaDock />}

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
        shouldOfferPpConnectGate({ sessionResolved: ppGateResolved, launch: ppLaunch }) && (
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
          {/* Modal Click Backdrop to close */}
          <div
            className="absolute inset-0"
            onClick={() => setSettingsOpen(false)}
          />
          {/* Modal Container */}
          <div className="relative w-[840px] h-[640px] bg-surface border border-surface-border/60 rounded-xl shadow-2xl animate-spring-in overflow-hidden flex flex-col">
            {/* Header / Top Bar */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border/40 bg-surface/50">
              <span className="text-sm font-bold text-white tracking-tight font-sans">Settings</span>
              <button
                onClick={() => setSettingsOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg border border-surface-border/40 hover:bg-surface-secondary text-slate-400 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50"
                aria-label="Close Settings modal"
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
            {/* Body Content */}
            <div className="flex-1 min-h-0">
              <Settings />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
