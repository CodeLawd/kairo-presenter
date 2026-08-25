import { useState, useEffect, useRef } from 'react'
import { AlertTriangle, RefreshCw, X } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import OperatorToolbar from '@/components/operator/OperatorToolbar'
import Scripture from '@/components/scripture/Scripture'
import Lyrics from '@/components/lyrics/Lyrics'
import Operator from '@/components/operator/Operator'
import ThemeEditor from '@/components/theme/ThemeEditor'
import Settings from '@/components/settings/Settings'
import { useAppStore } from '@/stores/useAppStore'
import { LoadingScreen } from '@/bootstrap/LoadingScreen'
import {
  BOOTSTRAP_MIN_VISIBLE_MS,
  describeBootstrapWarning,
} from '@/bootstrap/bootstrap-state'
import { hydrateIntegrations, useBootstrapStore } from '@/bootstrap/useBootstrapStore'

export type NavRoute =
  | 'scripture'
  | 'lyrics'
  | 'operator'
  | 'theme'

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

const views: Record<Exclude<NavRoute, 'operator'>, React.ReactNode> = {
  scripture: <Scripture />,
  lyrics: <Lyrics />,
  theme: <ThemeEditor />,
}

export default function App(): React.ReactElement {
  const [route, setRoute] = useState<NavRoute>('operator')
  const [settingsOpen, setSettingsOpen] = useState(false)

  const phase = useBootstrapStore((s) => s.phase)
  const progress = useBootstrapStore((s) => s.progress)
  const errors = useBootstrapStore((s) => s.errors)
  const warningDismissed = useBootstrapStore((s) => s.warningDismissed)
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
        {/* Keep the live Operator mounted across navigation. Unmounting it used
            to discard transcript, detections, queue, follow state, and scroll. */}
        <div
          className={`${route === 'operator' ? 'flex' : 'hidden'} min-h-0 w-full flex-1 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1`}
          aria-hidden={route !== 'operator'}
        >
          <Operator />
        </div>
        {route !== 'operator' && (
          <div key={route} className="flex min-h-0 w-full flex-1 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1">
            {views[route]}
          </div>
        )}
      </main>

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
