import { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import Sidebar from '@/components/layout/Sidebar'
import Dashboard from '@/components/dashboard/Dashboard'
import Scripture from '@/components/scripture/Scripture'
import Transcription from '@/components/transcription/Transcription'
import Lyrics from '@/components/lyrics/Lyrics'
import Operator from '@/components/operator/Operator'
import Settings from '@/components/settings/Settings'
import { useAppStore } from '@/stores/useAppStore'

export type NavRoute =
  | 'dashboard'
  | 'scripture'
  | 'transcription'
  | 'lyrics'
  | 'operator'

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

  // Hydrate state from main process on mount (survives renderer refresh)
  useEffect(() => {
    Promise.all([
      window.api.orchestrator.getStatus(),
      window.api.propresenter.getStatus(),
      window.api.settings.getAll(),
    ]).then(([orchStatus, ppStatus, settings]) => {
      const s = useAppStore.getState()
      s.setIsTranscribing(orchStatus.running)
      s.setAudioCapturing(orchStatus.running)
      s.setPPStatus(ppStatus)
      s.setAutoMode(settings.scripture.autoMode, settings.scripture.confidenceThreshold)
      s.setCaptureDeviceId(settings.audio.deviceId || '')
      useAppStore.setState({ scriptureProjectedCount: orchStatus.totalPresentations })
    }).catch(() => {})
  }, [])

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
        const devId = captureDeviceId || (await window.api.settings.getAll()).audio.deviceId
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

const views: Record<NavRoute, React.ReactNode> = {
  dashboard: <Dashboard />,
  scripture: <Scripture />,
  transcription: <Transcription />,
  lyrics: <Lyrics />,
  operator: <Operator />,
}

export default function App(): React.ReactElement {
  const [route, setRoute] = useState<NavRoute>('dashboard')
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  return (
    <div className="flex h-screen bg-surface text-white overflow-hidden select-none relative">
      <AudioPipeline />
      <Sidebar
        currentRoute={route}
        onNavigate={setRoute}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen(!settingsOpen)}
      />
      <main className="flex-1 overflow-hidden bg-surface-secondary w-full h-full flex flex-col">
        <div key={route} className="animate-fade-in h-full w-full flex flex-col overflow-hidden">
          {views[route]}
        </div>
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

