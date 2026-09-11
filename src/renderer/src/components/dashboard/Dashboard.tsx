import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Wifi,
  WifiOff,
  Mic,
  MicOff,
  BookOpen,
  Brain,
  Clock,
  TrendingUp,
  DollarSign,
  RefreshCw,
  Play,
  Square,
  ChevronRight,
  Zap,
  AlertCircle,
  CheckCircle,
  Loader,
  Radio,
  Volume2,
  VolumeX,
  Activity,
  type Icon,
} from '@/icons'
import { useAppStore } from '@/stores/useAppStore'
import { listAudioInputDevices, resolveCaptureDeviceId } from '@/audio/devices'
import { cn } from '@/lib/utils'
import type { ProPresenterStatus, AudioLevel, TranscriptResult, ScriptureSuggestion } from '@shared/ipc'

// ─── Types ────────────────────────────────────────────────────────────────────

type PPState = 'disconnected' | 'connecting' | 'connected' | 'error'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatCost(dollars: number): string {
  if (dollars < 0.01) return `$0.00`
  return `$${dollars.toFixed(3)}`
}

// ─── Status dot ───────────────────────────────────────────────────────────────

function StatusDot({ state }: { state: PPState | 'capturing' | 'idle' | 'ready' | 'processing' }): React.ReactElement {
  const cfg: Record<string, string> = {
    connected:   'bg-teal-500 shadow-glow-teal ring-1 ring-teal-400/30',
    capturing:   'bg-teal-500 shadow-glow-teal ring-1 ring-teal-400/30',
    ready:       'bg-teal-500 shadow-glow-teal ring-1 ring-teal-400/30',
    connecting:  'bg-yellow-500 shadow-glow-yellow ring-1 ring-yellow-400/30',
    processing:  'bg-yellow-500 shadow-glow-yellow ring-1 ring-yellow-400/30',
    idle:        'bg-slate-600',
    disconnected:'bg-slate-600',
    error:       'bg-red-500 shadow-glow-red ring-1 ring-red-400/30',
  }
  const pulse = ['connected', 'capturing', 'processing'].includes(state)
  return (
    <span
      className={cn(
        'inline-block w-2.5 h-2.5 rounded-full shrink-0',
        cfg[state] ?? 'bg-slate-600',
        pulse && 'animate-pulse'
      )}
    />
  )
}

// ─── PP state badge ───────────────────────────────────────────────────────────

function PPBadge({ state }: { state: PPState }): React.ReactElement {
  const map: Record<PPState, { label: string; cls: string }> = {
    connected:    { label: 'Connected',    cls: 'text-teal-400 bg-teal-500/10 border-teal-500/20 shadow-glow-teal/10' },
    connecting:   { label: 'Connecting…',  cls: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
    disconnected: { label: 'Disconnected', cls: 'text-slate-400 bg-slate-800/40 border-slate-700/30' },
    error:        { label: 'Error',        cls: 'text-red-400 bg-red-500/10 border-red-500/20 shadow-glow-red/10' },
  }
  const { label, cls } = map[state]
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border', cls)}>
      <StatusDot state={state} />
      {label}
    </span>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────

function CardHeader({
  icon: Icon,
  title,
  badge,
}: {
  icon: Icon
  title: string
  badge?: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between mb-4 pb-2 border-b border-surface-border/20">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-surface-tertiary/60 border border-surface-border/40 flex items-center justify-center">
          <Icon size={14} className="text-teal-400" aria-hidden="true" />
        </div>
        <h2 className="text-sm font-semibold text-white font-sans">{title}</h2>
      </div>
      {badge}
    </div>
  )
}

// ─── Level meter bar ──────────────────────────────────────────────────────────

function LevelBar({ level, clipping }: { level: number; clipping: boolean }): React.ReactElement {
  const pct = Math.round(Math.min(1, Math.max(0, level)) * 100)
  const color = clipping
    ? 'bg-red-500 shadow-glow-red'
    : pct > 75
    ? 'bg-yellow-500 shadow-glow-yellow'
    : 'bg-teal-500 shadow-glow-teal'

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-surface-tertiary/60 overflow-hidden border border-surface-border/30 p-0.5 animate-pulse-slow">
        <div
          className={cn('h-full rounded-full transition-all duration-75', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn('text-xs font-mono w-9 text-right tabular-nums font-semibold', clipping ? 'text-red-400' : 'text-slate-400')}>
        {pct}%
      </span>
    </div>
  )
}

// ─── Stat tile ────────────────────────────────────────────────────────────────

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: Icon
  label: string
  value: string
  sub?: string
  accent?: boolean
}): React.ReactElement {
  return (
    <div className={cn('double-bezel-outer flex-1', accent && 'border-teal-500/30')}>
      <div className={cn('double-bezel-inner flex flex-col justify-between gap-1 min-h-[105px]', accent && 'bg-teal-950/10')}>
        <div className="flex items-center gap-1.5 text-slate-500">
          <Icon size={12} aria-hidden="true" />
          <span className="text-[10px] uppercase tracking-widest font-bold">{label}</span>
        </div>
        <p className={cn('text-2xl font-bold font-sans tabular-nums leading-none tracking-tight', accent ? 'text-teal-300' : 'text-white')}>
          {value}
        </p>
        {sub && <p className="text-[11px] text-slate-500 font-sans truncate">{sub}</p>}
      </div>
    </div>
  )
}

// ─── PP Connection card ───────────────────────────────────────────────────────

function PPConnectionCard({
  onReconnect,
}: {
  onReconnect: () => void
}): React.ReactElement {
  const {
    ppState,
    ppVersion,
    ppActivePresentationName,
    ppActiveSlideIndex,
    ppActivePlaylistName,
  } = useAppStore()

  return (
    <div className="double-bezel-outer col-span-2">
      <div className="double-bezel-inner flex flex-col justify-between gap-4">
        <div>
          <CardHeader
            icon={Radio}
            title="ProPresenter"
            badge={<PPBadge state={ppState} />}
          />

          <div className="grid grid-cols-3 gap-3">
            {/* Version */}
            <div className="bg-surface-tertiary/60 rounded-lg px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1 font-sans">Version</p>
              <p className="text-sm font-medium text-white font-sans">
                {ppVersion ?? <span className="text-slate-600 italic">—</span>}
              </p>
            </div>

            {/* Active presentation */}
            <div className="bg-surface-tertiary/60 rounded-lg px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1 font-sans">Presentation</p>
              <p className="text-sm font-medium text-white truncate font-sans" title={ppActivePresentationName ?? undefined}>
                {ppActivePresentationName
                  ? (
                    <span className="flex items-center gap-1.5">
                      {ppActivePresentationName}
                      {ppActiveSlideIndex !== null && (
                        <span className="text-[10px] text-teal-400 font-mono bg-teal-500/10 border border-teal-500/20 px-1.5 py-0.5 rounded font-semibold">
                          #{ppActiveSlideIndex + 1}
                        </span>
                      )}
                    </span>
                  )
                  : <span className="text-slate-600 italic">None active</span>
                }
              </p>
            </div>

            {/* Active playlist */}
            <div className="bg-surface-tertiary/60 rounded-lg px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1 font-sans">Playlist</p>
              <p className="text-sm font-medium text-white truncate font-sans" title={ppActivePlaylistName ?? undefined}>
                {ppActivePlaylistName ?? <span className="text-slate-600 italic">None active</span>}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mt-1 pt-3 border-t border-surface-border/20">
          <p className="text-xs text-slate-500 font-sans">
            {ppState === 'error' && 'Connection error — check host and port in Settings'}
            {ppState === 'connecting' && 'Establishing connection…'}
            {ppState === 'disconnected' && 'Not connected — configure host in Settings'}
            {ppState === 'connected' && 'Receiving live updates via REST streaming'}
          </p>
          <button
            onClick={onReconnect}
            disabled={ppState === 'connecting'}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ease-out-expo border border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50',
              ppState === 'connecting'
                ? 'text-slate-600 cursor-not-allowed'
                : 'text-slate-300 hover:text-white hover:bg-surface-tertiary/80 hover:border-surface-border/50'
            )}
          >
            <RefreshCw size={12} className={ppState === 'connecting' ? 'animate-spin' : ''} aria-hidden="true" />
            Reconnect
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Audio status card ────────────────────────────────────────────────────────

function AudioStatusCard({
  audioLevel,
  onToggleCapture,
}: {
  audioLevel: AudioLevel | null
  onToggleCapture: () => void
}): React.ReactElement {
  const { audioDeviceName, audioCapturing, audioError } = useAppStore()

  const captureState = audioError ? 'error' : audioCapturing ? 'capturing' : 'idle'
  const stateLabel = { error: 'Error', capturing: 'Capturing', idle: 'Idle' }[captureState]
  const stateColor = { error: 'text-red-400 shadow-glow-red/20', capturing: 'text-teal-400 shadow-glow-teal/20', idle: 'text-slate-400' }[captureState]

  return (
    <div className="double-bezel-outer">
      <div className="double-bezel-inner flex flex-col justify-between gap-3 h-full">
        <div>
          <CardHeader
            icon={Volume2}
            title="Audio"
            badge={
              <span className={cn('flex items-center gap-1.5 text-xs font-semibold', stateColor)}>
                <StatusDot state={captureState} />
                {stateLabel}
              </span>
            }
          />

          {/* Device name */}
          <div className="mb-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1 font-sans">Input Device</p>
            <p className="text-sm text-white truncate font-sans">
              {audioDeviceName ?? <span className="text-slate-600 italic">No device selected</span>}
            </p>
          </div>

          {/* Level meters */}
          <div className="mb-2 space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold font-sans">Level</p>
            <LevelBar
              level={audioLevel?.rms ?? 0}
              clipping={audioLevel?.clipping ?? false}
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>RMS</span>
              <span className="font-semibold">{audioLevel ? `Peak ${Math.round((audioLevel.peak) * 100)}%` : '—'}</span>
            </div>
          </div>

          {/* Error message */}
          {audioError && (
            <div className="mb-2 flex items-center gap-1.5 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1.5">
              <AlertCircle size={12} className="shrink-0" aria-hidden="true" />
              {audioError}
            </div>
          )}
        </div>

        <button
          onClick={onToggleCapture}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ease-out-expo border',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50',
            audioCapturing
              ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border-red-500/20 shadow-glow-red/10'
              : 'bg-teal-500/10 text-teal-300 hover:bg-teal-500/20 border-teal-500/20 shadow-glow-teal/10'
          )}
        >
          {audioCapturing ? <Square size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
          {audioCapturing ? 'Stop Capture' : 'Start Capture'}
        </button>
      </div>
    </div>
  )
}

// ─── Transcription card ───────────────────────────────────────────────────────

function TranscriptionCard({
  onToggle,
}: {
  onToggle: () => void
}): React.ReactElement {
  const {
    isTranscribing,
    transcriptWordCount,
    transcriptRecentLines,
    transcriptLatencyMs,
  } = useAppStore()

  return (
    <div className="double-bezel-outer">
      <div className="double-bezel-inner flex flex-col justify-between gap-3 h-full">
        <div>
          <CardHeader
            icon={Mic}
            title="Transcription"
            badge={
              <span className={cn(
                'flex items-center gap-1.5 text-xs font-semibold',
                isTranscribing ? 'text-teal-400' : 'text-slate-400'
              )}>
                <StatusDot state={isTranscribing ? 'capturing' : 'idle'} />
                {isTranscribing ? 'Live' : 'Stopped'}
              </span>
            }
          />

          {/* Metrics row */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-surface-tertiary/60 rounded-lg px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-0.5 font-sans">Words</p>
              <p className="text-lg font-bold text-white tabular-nums font-sans">{transcriptWordCount.toLocaleString()}</p>
            </div>
            <div className="bg-surface-tertiary/60 rounded-lg px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-0.5 font-sans">Latency</p>
              <p className="text-lg font-bold text-white tabular-nums font-sans">
                {transcriptLatencyMs !== null
                  ? <>{transcriptLatencyMs}<span className="text-xs text-slate-500 font-normal ml-0.5 font-sans">ms</span></>
                  : <span className="text-slate-600">—</span>
                }
              </p>
            </div>
          </div>

          {/* Recent transcript lines */}
          <div className="mb-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2 font-sans">Recent</p>
            <div className="space-y-1.5 min-h-[3.5rem] bg-surface-secondary/40 rounded-lg p-2.5">
              {transcriptRecentLines.length === 0 ? (
                <p className="text-xs text-slate-600 italic font-sans">
                  {isTranscribing ? 'Waiting for speech…' : 'No transcript yet'}
                </p>
              ) : (
                transcriptRecentLines.map((line, i) => (
                  <p
                    key={i}
                    className={cn(
                      'text-xs leading-relaxed font-sans',
                      i === transcriptRecentLines.length - 1
                        ? 'text-slate-200 font-medium'
                        : 'text-slate-500'
                    )}
                  >
                    {line}
                  </p>
                ))
              )}
            </div>
          </div>
        </div>

        <button
          onClick={onToggle}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ease-out-expo border',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50',
            isTranscribing
              ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border-red-500/20 shadow-glow-red/10'
              : 'bg-teal-500/10 text-teal-300 hover:bg-teal-500/20 border-teal-500/20 shadow-glow-teal/10'
          )}
        >
          {isTranscribing ? <Square size={12} aria-hidden="true" /> : <Mic size={12} aria-hidden="true" />}
          {isTranscribing ? 'Stop Transcription' : 'Start Transcription'}
        </button>
      </div>
    </div>
  )
}

// ─── Scripture detection card ─────────────────────────────────────────────────

function ScriptureCard(): React.ReactElement {
  const {
    claudeStatus,
    lastDetectedScripture,
    scriptureDetectionCount,
    scriptureProjectedCount,
    autoModeEnabled,
    confidenceThreshold,
  } = useAppStore()

  const statusConfig = {
    ready:      { icon: CheckCircle, label: 'Ready',      cls: 'text-teal-400' },
    processing: { icon: Loader,      label: 'Processing', cls: 'text-yellow-400' },
    error:      { icon: AlertCircle, label: 'Error',      cls: 'text-red-400' },
  }[claudeStatus]

  const StatusIcon = statusConfig.icon

  return (
    <div className="double-bezel-outer">
      <div className="double-bezel-inner flex flex-col justify-between gap-3 h-full">
        <div>
          <CardHeader
            icon={Brain}
            title="Scripture Detection"
            badge={
              <span className={cn('flex items-center gap-1.5 text-xs font-semibold', statusConfig.cls)}>
                <StatusIcon
                  size={12}
                  className={claudeStatus === 'processing' ? 'animate-spin' : ''}
                  aria-hidden="true"
                />
                {statusConfig.label}
              </span>
            }
          />

          {/* Auto-mode indicator */}
          <div className="flex items-center justify-between mb-3 bg-surface-tertiary/60 rounded-lg px-3 py-2 font-sans">
            <div className="flex items-center gap-2">
              <Zap size={13} className={autoModeEnabled ? 'text-teal-400 shadow-glow-teal' : 'text-slate-600'} aria-hidden="true" />
              <span className="text-xs font-semibold text-slate-300">Auto-Mode</span>
            </div>
            {autoModeEnabled ? (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500">
                  {Math.round(confidenceThreshold * 100)}% confidence
                </span>
                <span className="text-[10px] font-bold text-teal-400 bg-teal-500/10 border border-teal-500/20 px-1.5 py-0.5 rounded shadow-glow-teal/10">
                  ON
                </span>
              </div>
            ) : (
              <span className="text-[10px] font-bold text-slate-600 bg-slate-800/40 border border-slate-700/30 px-1.5 py-0.5 rounded">
                OFF
              </span>
            )}
          </div>

          {/* Counters */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-surface-tertiary/60 rounded-lg px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-0.5 font-sans">Detected</p>
              <p className="text-lg font-bold text-white tabular-nums font-sans">{scriptureDetectionCount}</p>
            </div>
            <div className="bg-surface-tertiary/60 rounded-lg px-3 py-2 bg-teal-950/10">
              <p className="text-[10px] uppercase tracking-wider text-teal-500/60 font-bold mb-0.5 font-sans">Projected</p>
              <p className="text-lg font-bold text-teal-300 tabular-nums font-sans">{scriptureProjectedCount}</p>
            </div>
          </div>

          {/* Last detected */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5 font-sans">Last Detected</p>
            {lastDetectedScripture ? (
              <div className="flex items-center gap-2 bg-teal-500/5 rounded-lg px-3 py-2">
                <BookOpen size={13} className="text-teal-400 shrink-0" aria-hidden="true" />
                <span className="text-sm font-semibold text-teal-300 font-serif truncate">{lastDetectedScripture}</span>
              </div>
            ) : (
              <p className="text-xs text-slate-600 italic font-sans">None this session</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard(): React.ReactElement {
  const {
    ppState,
    sessionStartTime,
    scriptureDetectionCount,
    scriptureProjectedCount,
    audioCapturing,
    isTranscribing,
    transcriptWordCount,
    audioLevel,
    autoModeEnabled,
    setPPStatus,
    setAudioCapturing,
    setAudioError,
    setIsTranscribing,
    addTranscriptLine,
    setClaudeStatus,
    addScriptureDetection,
    setAutoMode,
  } = useAppStore()

  const [elapsed, setElapsed] = useState(0)

  // ─── Session timer ─────────────────────────────────────────────────────────

  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - sessionStartTime), 1000)
    return () => clearInterval(id)
  }, [sessionStartTime])

  // ─── IPC subscriptions ─────────────────────────────────────────────────────

  useEffect(() => {
    const unsubPP = window.api.propresenter.onStatusChange((status: ProPresenterStatus) => {
      setPPStatus(status)
    })

    const unsubTranscript = window.api.transcription.onTranscript((result: TranscriptResult) => {
      const latency = result.duration > 0
        ? Math.round((Date.now() - result.timestamp - result.duration) / 1)
        : null
      addTranscriptLine(result.text, latency ?? undefined)
    })

    const unsubSuggestion = window.api.scripture.onSuggestion((suggestion: ScriptureSuggestion) => {
      addScriptureDetection(suggestion.reference)
      setClaudeStatus('ready')
    })

    // Sync running state — AudioPipeline in App.tsx also handles this,
    // but Dashboard needs it for button labels and autoMode display
    const unsubOrch = window.api.orchestrator.onStatus((status) => {
      setIsTranscribing(status.running)
      setAudioCapturing(status.running)
      setAutoMode(status.autoMode, useAppStore.getState().confidenceThreshold)
    })

    window.api.settings.getAll().then((settings) => {
      setAutoMode(settings.scripture.autoMode, settings.scripture.confidenceThreshold)
    })

    // Initial orchestrator status
    window.api.orchestrator.getStatus().then((status) => {
      setIsTranscribing(status.running)
      setAudioCapturing(status.running)
    })

    return () => {
      unsubPP()
      unsubTranscript()
      unsubSuggestion()
      unsubOrch()
    }
  }, [setPPStatus, addTranscriptLine, addScriptureDetection, setClaudeStatus, setAutoMode, setIsTranscribing, setAudioCapturing])

  // ─── Action handlers ───────────────────────────────────────────────────────

  const handleReconnect = useCallback(async () => {
    try {
      const settings = await window.api.settings.getAll()
      await window.api.propresenter.connect({
        host: settings.propresenter.host,
        port: settings.propresenter.port,
        password: settings.propresenter.password,
      })
      const status = await window.api.propresenter.getStatus()
      setPPStatus(status)
    } catch {
      // connection error handled by IPC service
    }
  }, [setPPStatus])

  const handleToggleCapture = useCallback(async () => {
    if (isTranscribing) {
      try {
        await window.api.orchestrator.stop()
      } catch (err) {
        console.error(err)
      }
    } else {
      try {
        const all = await window.api.settings.getAll()
        const devs = await listAudioInputDevices()
        await window.api.orchestrator.start({
          audioDeviceId: resolveCaptureDeviceId(devs, all.audio.deviceId),
          sttProvider: all.secretsConfigured.deepgram ? 'deepgram' : all.stt.provider,
          sttApiKey: '',
          sttLanguage: all.stt.language || 'en',
          llmProvider: all.stt.llmProvider ?? 'anthropic',
          scriptureModel: all.stt.llmModel?.trim() || undefined,
          llmApiKey: '',
          scriptureTranslation: all.scripture.defaultTranslation,
          autoMode: autoModeEnabled,
          confidenceThreshold: all.scripture.confidenceThreshold,
          autoPresentDelaySec: all.scripture.autoPresentDelaySec ?? 1,
        })
      } catch (err) {
        setAudioError(err instanceof Error ? err.message : 'Capture failed')
      }
    }
  }, [isTranscribing, autoModeEnabled, setAudioError])

  const handleToggleTranscription = useCallback(async () => {
    if (isTranscribing) {
      try {
        await window.api.orchestrator.stop()
      } catch (err) {
        console.error(err)
      }
    } else {
      try {
        const all = await window.api.settings.getAll()
        const devs = await listAudioInputDevices()
        await window.api.orchestrator.start({
          audioDeviceId: resolveCaptureDeviceId(devs, all.audio.deviceId),
          sttProvider: all.secretsConfigured.deepgram ? 'deepgram' : all.stt.provider,
          sttApiKey: '',
          sttLanguage: all.stt.language || 'en',
          llmProvider: all.stt.llmProvider ?? 'anthropic',
          scriptureModel: all.stt.llmModel?.trim() || undefined,
          llmApiKey: '',
          scriptureTranslation: all.scripture.defaultTranslation,
          autoMode: autoModeEnabled,
          confidenceThreshold: all.scripture.confidenceThreshold,
          autoPresentDelaySec: all.scripture.autoPresentDelaySec ?? 1,
        })
      } catch (err) {
        console.error(err)
      }
    }
  }, [isTranscribing, autoModeEnabled])

  // ─── Derived metrics ───────────────────────────────────────────────────────

  const elapsedMinutes = elapsed / 60_000
  const deepgramCost = isTranscribing ? elapsedMinutes * 0.0043 : 0
  const claudeCost = scriptureDetectionCount * 0.003
  const estimatedCost = deepgramCost + claudeCost

  return (
    <div className="p-8 w-full space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-header">Dashboard</h1>
          <p className="page-subtitle">Real-time system status & telemetry</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 bg-surface-tertiary/60 border border-surface-border/40 rounded-lg px-3.5 py-2 font-sans shadow-sm">
          <Activity size={12} className={ppState === 'connected' ? 'text-teal-400 animate-pulse' : 'text-slate-600'} aria-hidden="true" />
          {ppState === 'connected' ? 'Live Connection' : 'Offline Mode'}
        </div>
      </div>

      {/* ── Main grid ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-6 animate-fade-in">

        {/* Row 1: PP (2 cols) + Audio (1 col) */}
        <PPConnectionCard onReconnect={handleReconnect} />
        <AudioStatusCard audioLevel={audioLevel} onToggleCapture={handleToggleCapture} />

        {/* Row 2: Transcription + Scripture */}
        <div className="col-span-3 grid grid-cols-2 gap-6">
          <TranscriptionCard onToggle={handleToggleTranscription} />
          <ScriptureCard />
        </div>

        {/* Row 3: Quick stats */}
        <div className="col-span-3 grid grid-cols-4 gap-6">
          <StatTile
            icon={Clock}
            label="Session Duration"
            value={formatDuration(elapsed)}
            sub="since app launch"
          />
          <StatTile
            icon={TrendingUp}
            label="Scriptures Detected"
            value={String(scriptureDetectionCount)}
            sub={`${transcriptWordCount.toLocaleString()} words transcribed`}
          />
          <StatTile
            icon={ChevronRight}
            label="Scriptures Projected"
            value={String(scriptureProjectedCount)}
            sub="sent to ProPresenter"
            accent={scriptureProjectedCount > 0}
          />
          <StatTile
            icon={DollarSign}
            label="Est. API Cost"
            value={formatCost(estimatedCost)}
            sub="Deepgram + Claude"
          />
        </div>
      </div>
    </div>
  )
}
