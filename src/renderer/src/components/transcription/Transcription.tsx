import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Mic,
  MicOff,
  Trash2,
  Lock,
  Unlock,
  Download,
  ChevronDown,
  Circle,
  AlertTriangle,
  BookOpen,
  Send,
  X,
  CheckCircle,
  type Icon,
} from '@/icons'
import { useAppStore } from '@/stores/useAppStore'
import { listAudioInputDevices, resolveCaptureDeviceId } from '@/audio/devices'
import { cn, downloadFile } from '@/lib/utils'
import type {
  AudioDevice,
  AudioLevel,
  TranscriptResult,
  InterimResult,
  ScriptureSuggestion,
  OrchestratorConfig,
  OrchestratorStatus,
  PendingAutoPresent,
  SessionStats,
} from '@shared/ipc'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScriptureHighlight {
  id: string
  triggerText: string
  reference: string
  confidence: number
}

interface DisplaySegment {
  id: string
  text: string
  isFinal: boolean
  timestamp: number
  confidence: number
  scriptureHighlights: ScriptureHighlight[]
}

type TextRun =
  | { type: 'plain'; text: string }
  | { type: 'trigger'; text: string }
  | { type: 'scripture'; text: string; reference: string }

// ─── Constants ────────────────────────────────────────────────────────────────

const TRIGGER_PHRASES = [
  "turn your bibles to",
  "turn to",
  "let's read",
  "the scripture says",
  "the bible says",
  "it is written",
  "as it says in",
  "chapter",
  "verse",
]

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'ko', label: 'Korean' },
  { code: 'ja', label: 'Japanese' },
  { code: 'zh', label: 'Chinese' },
]

// ─── Text highlight parser ────────────────────────────────────────────────────

function buildRuns(
  text: string,
  scriptureHighlights: ScriptureHighlight[]
): TextRun[] {
  if (!text) return []

  const styles: Array<null | { type: 'trigger' } | { type: 'scripture'; reference: string }> =
    Array.from({ length: text.length }, () => null)

  const lower = text.toLowerCase()

  for (const phrase of TRIGGER_PHRASES) {
    const phraseLower = phrase.toLowerCase()
    let pos = 0
    while ((pos = lower.indexOf(phraseLower, pos)) !== -1) {
      for (let i = pos; i < pos + phrase.length && i < text.length; i++) {
        if (!styles[i]) styles[i] = { type: 'trigger' }
      }
      pos += phrase.length
    }
  }

  for (const h of scriptureHighlights) {
    const trigLower = h.triggerText.toLowerCase()
    const pos = lower.indexOf(trigLower)
    if (pos !== -1) {
      for (let i = pos; i < pos + h.triggerText.length && i < text.length; i++) {
        styles[i] = { type: 'scripture', reference: h.reference }
      }
    }
  }

  const runs: TextRun[] = []
  let i = 0
  while (i < text.length) {
    const style = styles[i]
    let j = i + 1

    if (!style) {
      while (j < text.length && !styles[j]) j++
      runs.push({ type: 'plain', text: text.slice(i, j) })
    } else if (style.type === 'trigger') {
      while (j < text.length && styles[j]?.type === 'trigger') j++
      runs.push({ type: 'trigger', text: text.slice(i, j) })
    } else {
      const ref = style.reference
      while (j < text.length) {
        const s = styles[j]
        if (!s || s.type !== 'scripture' || s.reference !== ref) break
        j++
      }
      runs.push({ type: 'scripture', text: text.slice(i, j), reference: ref })
    }
    i = j
  }

  return runs
}

// ─── HighlightedText ──────────────────────────────────────────────────────────

function HighlightedText({
  text,
  scriptureHighlights,
}: {
  text: string
  scriptureHighlights: ScriptureHighlight[]
}): React.ReactElement {
  const runs = buildRuns(text, scriptureHighlights)

  return (
    <>
      {runs.map((run, idx) => {
        if (run.type === 'trigger') {
          return (
            <mark
              key={idx}
              className="bg-transparent text-teal-300 font-medium not-italic"
            >
              {run.text}
            </mark>
          )
        }
        if (run.type === 'scripture') {
          return (
            <span key={idx} className="relative inline">
              <mark className="bg-teal-500/20 text-teal-200 rounded px-0.5 not-italic">
                {run.text}
              </mark>
              <span className="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-600/30 text-teal-300 border border-teal-500/30 align-middle leading-none">
                <BookOpen size={9} />
                {run.reference}
              </span>
            </span>
          )
        }
        return <span key={idx}>{run.text}</span>
      })}
    </>
  )
}

// ─── Audio level bar ──────────────────────────────────────────────────────────

function AudioLevelBar({ level }: { level: AudioLevel | null }): React.ReactElement {
  const rms     = level?.rms  ?? 0
  const clip    = level?.clipping ?? false
  const percent = Math.min(rms * 300, 100)

  const color = clip
    ? 'bg-red-500'
    : percent < 8
    ? 'bg-yellow-500/60'
    : 'bg-teal-500'

  return (
    <div className="h-1 w-full bg-surface-border rounded-full overflow-hidden">
      <div
        className={cn('h-full rounded-full transition-all', color)}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

// ─── Segment block ────────────────────────────────────────────────────────────

function SegmentBlock({
  seg,
  indexFromEnd,
}: {
  seg: DisplaySegment
  indexFromEnd: number
}): React.ReactElement {
  const time = new Date(seg.timestamp)
  const hh   = String(time.getHours()).padStart(2, '0')
  const mm   = String(time.getMinutes()).padStart(2, '0')
  const ss   = String(time.getSeconds()).padStart(2, '0')

  // Calculate opacity decay: latest is 100%, 1 back is 80%, 2 back is 60%, 3 back is 40%, older is 25%
  let opacityClass = 'opacity-100'
  if (seg.isFinal) {
    if (indexFromEnd === 1) opacityClass = 'opacity-[0.80]'
    else if (indexFromEnd === 2) opacityClass = 'opacity-[0.60]'
    else if (indexFromEnd === 3) opacityClass = 'opacity-[0.40]'
    else if (indexFromEnd > 3) opacityClass = 'opacity-[0.25]'
  } else {
    opacityClass = 'opacity-[0.60]'
  }

  return (
    <div className={cn('group flex gap-3 px-1 py-0.5 rounded transition-opacity duration-300 ease-out-expo', opacityClass)}>
      <span className="flex-shrink-0 text-[11px] text-slate-600 font-mono pt-px select-none tabular-nums" aria-hidden="true">
        {hh}:{mm}:{ss}
      </span>
      <p
        className={cn(
          'flex-1 font-mono text-sm leading-relaxed break-words',
          seg.isFinal ? 'text-slate-200 font-medium' : 'text-slate-500 italic'
        )}
      >
        {seg.isFinal ? (
          <HighlightedText
            text={seg.text}
            scriptureHighlights={seg.scriptureHighlights}
          />
        ) : (
          seg.text
        )}
      </p>
    </div>
  )
}

// ─── AutoPresentToast ─────────────────────────────────────────────────────────

function AutoPresentToast({
  items,
  onPresentNow,
  onDismiss,
}: {
  items: PendingAutoPresent[]
  onPresentNow: (id: string) => void
  onDismiss: (id: string) => void
}): React.ReactElement | null {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (items.length === 0) return
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [items.length])

  if (items.length === 0) return null

  return (
    <div className="absolute top-4 right-4 z-50 flex flex-col gap-2 w-64 animate-fade-in" role="alert" aria-live="polite">
      {items.map((item) => {
        const secsLeft = Math.max(0, Math.ceil((item.expiresAt - now) / 1000))
        // AutoPresent interval is 8 seconds (8000ms)
        const pct = Math.max(0, Math.min(100, ((item.expiresAt - now) / 8000) * 100))
        return (
          <div
            key={item.suggestionId}
            className="px-3.5 py-3 rounded-xl bg-teal-950/90 border border-teal-500/30 shadow-2xl backdrop-blur-md space-y-2.5 shadow-glow-teal/10 relative overflow-hidden"
          >
            {/* Absolute countdown progress bar on bottom edge */}
            <div
              className="absolute bottom-0 left-0 h-1 bg-teal-400 transition-all duration-100 ease-linear"
              style={{ width: `${pct}%` }}
            />

            <div className="flex items-center gap-2">
              <Circle size={6} className="text-teal-400 fill-teal-400 animate-pulse shrink-0" aria-hidden="true" />
              <span className="flex-1 text-xs font-semibold text-teal-200 truncate">
                {item.reference}
              </span>
              <span className="tabular-nums text-xs font-bold text-teal-400">{secsLeft}s</span>
            </div>
            <p className="text-[10px] text-teal-500">Auto-presenting in {secsLeft}s…</p>
            <div className="flex gap-1.5">
              <button
                onClick={() => onPresentNow(item.suggestionId)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-1 focus-visible:ring-offset-teal-950"
              >
                <Send size={10} aria-hidden="true" /> Present Now
              </button>
              <button
                onClick={() => onDismiss(item.suggestionId)}
                className="px-2.5 py-1.5 rounded-lg bg-surface-elevated border border-surface-border text-slate-400 hover:text-white text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50"
                aria-label={`Dismiss auto projection for ${item.reference}`}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── SuggestionsPanel ─────────────────────────────────────────────────────────

function SuggestionsPanel({
  suggestions,
  onApprove,
  onDismiss,
}: {
  suggestions: ScriptureSuggestion[]
  onApprove: (id: string) => void
  onDismiss: (id: string) => void
}): React.ReactElement | null {
  if (suggestions.length === 0) return null

  return (
    <div className="w-60 shrink-0 flex flex-col gap-3 overflow-y-auto pl-1">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 pt-1 font-sans">
        Detected
      </p>
      {suggestions.map((s) => (
        <div key={s.id} className="double-bezel-outer animate-spring-in">
          <div className="double-bezel-inner p-3.5 flex flex-col justify-between gap-2.5">
            <div>
              <p className="text-sm font-semibold text-teal-300 leading-tight font-sans tracking-tight">{s.reference}</p>
              <p className="text-[10px] text-slate-500 mt-0.5 font-sans font-medium">
                {s.translation} · {Math.round(s.confidence * 100)}% Match
              </p>
            </div>
            {s.verses.length > 0 && (
              <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-3 font-serif italic">
                “{s.verses.slice(0, 2).map((v) => v.text).join(' ')}”
              </p>
            )}
            <div className="flex gap-1.5 mt-0.5">
              <button
                onClick={() => onApprove(s.id)}
                className="flex-1 flex items-center justify-center gap-1.5 btn-primary py-1.5 text-xs font-semibold focus-visible:ring-teal-400 focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
                aria-label={`Approve and send suggested scripture ${s.reference} to ProPresenter`}
              >
                <CheckCircle size={11} aria-hidden="true" /> Send
              </button>
              <button
                onClick={() => onDismiss(s.id)}
                className="btn-secondary py-1.5 px-2.5 text-xs"
                aria-label={`Dismiss suggested scripture ${s.reference}`}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Controls bar ─────────────────────────────────────────────────────────────

interface ControlsBarProps {
  isTranscribing: boolean
  devices: AudioDevice[]
  captureDeviceId: string
  selectedLanguage: string
  onToggle: () => void
  onDeviceChange: (id: string) => void
  onLanguageChange: (code: string) => void
  onClear: () => void
  onExport: (format: 'text' | 'markdown') => void
  disabled: boolean
}

function ControlsBar({
  isTranscribing,
  devices,
  captureDeviceId,
  selectedLanguage,
  onToggle,
  onDeviceChange,
  onLanguageChange,
  onClear,
  onExport,
  disabled,
}: ControlsBarProps): React.ReactElement {
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!exportOpen) return
    const handler = (e: MouseEvent): void => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [exportOpen])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={onToggle}
        disabled={disabled}
        className={cn(
          'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40',
          isTranscribing
            ? 'bg-red-600/20 border border-red-500/40 text-red-400 hover:bg-red-600/30'
            : 'btn-primary'
        )}
      >
        {isTranscribing ? <MicOff size={15} /> : <Mic size={15} />}
        {isTranscribing ? 'Stop' : 'Start'}
      </button>

      <select
        value={captureDeviceId}
        onChange={(e) => onDeviceChange(e.target.value)}
        disabled={isTranscribing}
        className={cn(
          'input py-2 max-w-[200px] disabled:opacity-40 disabled:cursor-not-allowed',
          'appearance-none pr-8 bg-[length:16px] bg-no-repeat',
          '[background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%2364748b\' stroke-width=\'2\'%3E%3Cpath d=\'m6 9 6 6 6-6\'/%3E%3C/svg%3E")]',
          '[background-position:right_8px_center]'
        )}
        aria-label="Audio device"
      >
        {devices.length === 0 && (
          <option value="">No devices found</option>
        )}
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}{d.isDefault ? ' (Default)' : ''}
          </option>
        ))}
      </select>

      <select
        value={selectedLanguage}
        onChange={(e) => onLanguageChange(e.target.value)}
        disabled={isTranscribing}
        className={cn(
          'input py-2 w-[130px] disabled:opacity-40 disabled:cursor-not-allowed',
          'appearance-none pr-8',
          '[background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2020/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%2364748b\' stroke-width=\'2\'%3E%3Cpath d=\'m6 9 6 6 6-6\'/%3E%3C/svg%3E")]',
          '[background-position:right_8px_center]',
          'bg-no-repeat bg-[length:16px]'
        )}
        aria-label="Language"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>

      <div className="flex-1" />

      <button
        onClick={onClear}
        className="btn-secondary flex items-center gap-2"
      >
        <Trash2 size={14} /> Clear
      </button>

      <div className="relative" ref={exportRef}>
        <button
          onClick={() => setExportOpen((o) => !o)}
          className="btn-secondary flex items-center gap-1.5"
        >
          <Download size={14} />
          Export
          <ChevronDown size={13} className={cn('transition-transform', exportOpen && 'rotate-180')} />
        </button>
        {exportOpen && (
          <div className="absolute right-0 mt-1 w-40 rounded-lg bg-surface-elevated border border-surface-border shadow-xl z-20 overflow-hidden">
            <button
              className="w-full px-4 py-2.5 text-sm text-left text-slate-300 hover:bg-surface-tertiary hover:text-white transition-colors"
              onClick={() => { onExport('text'); setExportOpen(false) }}
            >
              Plain text (.txt)
            </button>
            <button
              className="w-full px-4 py-2.5 text-sm text-left text-slate-300 hover:bg-surface-tertiary hover:text-white transition-colors"
              onClick={() => { onExport('markdown'); setExportOpen(false) }}
            >
              Markdown (.md)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Stats footer ─────────────────────────────────────────────────────────────

function ConnectionDot({ active }: { active: boolean }): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium',
        active ? 'text-teal-400' : 'text-slate-500'
      )}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          active ? 'bg-teal-500 animate-pulse' : 'bg-slate-600'
        )}
      />
      {active ? 'Live' : 'Idle'}
    </span>
  )
}

interface StatsFooterProps {
  wordCount: number
  sessionMs: number
  averageConfidence: number
  isConnected: boolean
  sessionStats: SessionStats | null
}

function StatsFooter({ wordCount, sessionMs, averageConfidence, isConnected, sessionStats }: StatsFooterProps): React.ReactElement {
  const totalSec = Math.floor(sessionMs / 1_000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const duration = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`

  return (
    <div className="flex items-center gap-5 pt-3 border-t border-surface-border text-xs text-slate-500 flex-wrap">
      <Stat label="Words" value={wordCount.toLocaleString()} />
      <Stat label="Duration" value={duration} />
      <Stat
        label="Confidence"
        value={averageConfidence > 0 ? `${Math.round(averageConfidence * 100)}%` : '—'}
      />
      {sessionStats && (
        <>
          <Stat label="Detections" value={sessionStats.totalDetections.toString()} />
          <Stat label="Presented" value={sessionStats.totalPresentations.toString()} />
          <Stat
            label="AI Cost"
            value={sessionStats.estimatedCostUsd < 0.001 ? '<$0.001' : `$${sessionStats.estimatedCostUsd.toFixed(3)}`}
          />
        </>
      )}
      <div className="flex-1" />
      <ConnectionDot active={isConnected} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-slate-600">{label}</span>
      <span className="text-slate-300 font-medium tabular-nums">{value}</span>
    </span>
  )
}

// ─── Scroll-lock toggle ───────────────────────────────────────────────────────

function ScrollLockButton({
  locked,
  onClick,
}: {
  locked: boolean
  onClick: () => void
}): React.ReactElement {
  const Icon: Icon = locked ? Lock : Unlock
  return (
    <button
      onClick={onClick}
      title={locked ? 'Scroll locked — click to unlock' : 'Auto-scrolling — click to lock'}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border',
        locked
          ? 'bg-yellow-500/15 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/25'
          : 'bg-surface-elevated border-surface-border text-slate-400 hover:text-white hover:border-slate-500'
      )}
    >
      <Icon size={12} />
      {locked ? 'Locked' : 'Live'}
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Transcription(): React.ReactElement {
  const { isTranscribing, setIsTranscribing, addTranscriptLine, audioLevel, captureDeviceId, setCaptureDeviceId } = useAppStore()

  // Transcript state
  const [segments, setSegments] = useState<DisplaySegment[]>([])
  const [interimText, setInterimText] = useState<string>('')
  const interimTimestampRef = useRef<number>(Date.now())

  // Audio (level comes from store; capture happens in App.tsx AudioPipeline)
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [audioError, setAudioError] = useState<string | null>(null)

  // Settings
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en')

  // Orchestrator: suggestions + auto-present
  const [suggestions, setSuggestions] = useState<ScriptureSuggestion[]>([])
  const [pendingAuto, setPendingAuto] = useState<PendingAutoPresent[]>([])
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null)

  // Stats
  const [wordCount, setWordCount] = useState(0)
  const [confidenceSum, setConfidenceSum] = useState(0)
  const [confidenceCount, setConfidenceCount] = useState(0)
  const [sessionMs, setSessionMs] = useState(0)

  // UI
  const [scrollLocked, setScrollLocked] = useState(false)
  const scrollRef  = useRef<HTMLDivElement>(null)
  const bottomRef  = useRef<HTMLDivElement>(null)
  const isScrollingProgrammatically = useRef(false)
  const sessionStartRef = useRef<number>(Date.now())


  // ── Load devices and settings on mount ──────────────────────────────────────

  useEffect(() => {
    void listAudioInputDevices().then((inputs) => {
      setDevices(inputs)
      if (!captureDeviceId) {
        setCaptureDeviceId(resolveCaptureDeviceId(inputs))
      }
    })

    window.api.settings.get('stt').then((stt) => {
      if (stt?.language) setSelectedLanguage(stt.language)
    })

    window.api.transcription.getHistory().then((history) => {
      if (history.length === 0) return
      const loaded: DisplaySegment[] = history.map((r) => resultToSegment(r))
      setSegments(loaded)
      const wc = history.reduce((sum, r) => sum + r.text.split(/\s+/).filter(Boolean).length, 0)
      const cs = history.reduce((sum, r) => sum + (r.words[0]?.confidence ?? 0), 0)
      setWordCount(wc)
      setConfidenceSum(cs)
      setConfidenceCount(history.length)
    })
  }, [])

  // Audio capture is handled by AudioPipeline in App.tsx (persistent across routes).

  // ── IPC subscriptions ────────────────────────────────────────────────────────

  useEffect(() => {
    const unsubTranscript = window.api.transcription.onTranscript((result: TranscriptResult) => {
      const seg = resultToSegment(result)
      setSegments((prev) => [...prev, seg])
      setInterimText('')

      const words = result.text.split(/\s+/).filter(Boolean).length
      const conf  = result.words.length > 0
        ? result.words.reduce((s, w) => s + w.confidence, 0) / result.words.length
        : 0

      setWordCount((c) => c + words)
      setConfidenceSum((s) => s + conf)
      setConfidenceCount((c) => c + 1)

      addTranscriptLine(result.text)
    })

    const unsubInterim = window.api.transcription.onInterim((result: InterimResult) => {
      setInterimText(result.text)
      interimTimestampRef.current = result.timestamp
    })

    const unsubSuggestion = window.api.scripture.onSuggestion((suggestion: ScriptureSuggestion) => {
      applyScriptureHighlight(suggestion)
      setSuggestions((prev) => {
        if (prev.some((s) => s.id === suggestion.id)) return prev
        return [...prev, suggestion]
      })
    })

    const unsubStatus = window.api.orchestrator.onStatus((status: OrchestratorStatus) => {
      if (!status.running) {
        setIsTranscribing(false)
        setInterimText('')
      }
    })

    const unsubPendingAuto = window.api.orchestrator.onPendingAuto((pending: PendingAutoPresent) => {
      setPendingAuto((prev) => [
        ...prev.filter((p) => p.suggestionId !== pending.suggestionId),
        pending,
      ])
    })

    return () => {
      unsubTranscript()
      unsubInterim()
      unsubSuggestion()
      unsubStatus()
      unsubPendingAuto()
    }
  }, [addTranscriptLine, setIsTranscribing])

  // ── Session timer ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isTranscribing) return
    const t = setInterval(() => setSessionMs(Date.now() - sessionStartRef.current), 1_000)
    return () => clearInterval(t)
  }, [isTranscribing])

  // ── Session stats polling (every 30s while running) ──────────────────────────

  useEffect(() => {
    if (!isTranscribing) return
    const poll = setInterval(async () => {
      const stats = await window.api.orchestrator.getStats()
      if (stats) setSessionStats(stats)
    }, 30_000)
    return () => clearInterval(poll)
  }, [isTranscribing])

  // ── Auto-present cleanup (remove expired items from state) ───────────────────

  useEffect(() => {
    if (pendingAuto.length === 0) return
    const timers = pendingAuto.map((item) => {
      const delay = Math.max(0, item.expiresAt - Date.now()) + 600
      return setTimeout(() => {
        setPendingAuto((prev) => prev.filter((p) => p.suggestionId !== item.suggestionId))
        setSuggestions((prev) => prev.filter((s) => s.id !== item.suggestionId))
      }, delay)
    })
    return () => timers.forEach(clearTimeout)
  }, [pendingAuto.map((p) => p.suggestionId).join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (scrollLocked) return
    if (!bottomRef.current) return
    isScrollingProgrammatically.current = true
    bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    const t = setTimeout(() => { isScrollingProgrammatically.current = false }, 400)
    return () => clearTimeout(t)
  }, [segments, interimText, scrollLocked])

  const handleScroll = useCallback((): void => {
    if (isScrollingProgrammatically.current) return
    const el = scrollRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distFromBottom > 80) setScrollLocked(true)
  }, [])

  const handleUnlock = useCallback((): void => {
    setScrollLocked(false)
  }, [])

  // ── Scripture highlight application ─────────────────────────────────────────

  const applyScriptureHighlight = useCallback((suggestion: ScriptureSuggestion): void => {
    const highlight: ScriptureHighlight = {
      id:          suggestion.id,
      triggerText: suggestion.triggerText,
      reference:   suggestion.reference,
      confidence:  suggestion.confidence,
    }
    setSegments((prev) => {
      const lower = suggestion.triggerText.toLowerCase()
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].text.toLowerCase().includes(lower)) {
          const updated = [...prev]
          updated[i] = {
            ...prev[i],
            scriptureHighlights: [
              ...prev[i].scriptureHighlights.filter((h) => h.id !== suggestion.id),
              highlight,
            ],
          }
          return updated
        }
      }
      return prev
    })
  }, [])

  // ── Suggestion approve / dismiss ─────────────────────────────────────────────

  const handleApproveSuggestion = useCallback(async (id: string): Promise<void> => {
    try {
      await window.api.orchestrator.approveSuggestion(id)
      setSuggestions((prev) => prev.filter((s) => s.id !== id))
      setPendingAuto((prev) => prev.filter((p) => p.suggestionId !== id))
    } catch (err) {
      console.error('[Transcription] approveSuggestion error', err)
    }
  }, [])

  const handleDismissSuggestion = useCallback(async (id: string): Promise<void> => {
    try {
      await window.api.orchestrator.dismissSuggestion(id)
      setSuggestions((prev) => prev.filter((s) => s.id !== id))
      setPendingAuto((prev) => prev.filter((p) => p.suggestionId !== id))
    } catch (err) {
      console.error('[Transcription] dismissSuggestion error', err)
    }
  }, [])

  const handleDismissAuto = useCallback(async (id: string): Promise<void> => {
    try {
      await window.api.orchestrator.dismissAuto(id)
      setPendingAuto((prev) => prev.filter((p) => p.suggestionId !== id))
    } catch (err) {
      console.error('[Transcription] dismissAuto error', err)
    }
  }, [])

  // ── Toggle transcription ─────────────────────────────────────────────────────

  const handleToggle = useCallback(async (): Promise<void> => {
    setAudioError(null)
    if (isTranscribing) {
      try {
        await window.api.orchestrator.stop()
      } catch {
        // ignore stop errors — status push will reflect reality
      }
      setInterimText('')
    } else {
      if (!captureDeviceId) return
      try {
        const all = await window.api.settings.getAll()
        const llmProvider = all.stt.llmProvider ?? 'anthropic'
        const config: OrchestratorConfig = {
          audioDeviceId:       captureDeviceId,
          sttProvider:         all.secretsConfigured.deepgram ? 'deepgram' : all.stt.provider,
          sttApiKey:           '',
          sttLanguage:         selectedLanguage,
          llmProvider,
          llmApiKey:           '',
          scriptureTranslation: all.scripture.defaultTranslation,
          autoMode:            all.scripture.autoMode,
          confidenceThreshold: all.scripture.confidenceThreshold,
          autoPresentDelaySec: 3,
        }
        // Optimistic UI update
        setIsTranscribing(true)
        sessionStartRef.current = Date.now()
        setSessionMs(0)
        setScrollLocked(false)
        setSessionStats(null)
        setSuggestions([])
        setPendingAuto([])

        await window.api.orchestrator.start(config)

        // Persist updated settings
        await window.api.settings.set('stt', { ...all.stt, language: selectedLanguage })
        await window.api.settings.set('audio', { deviceId: captureDeviceId })
      } catch (err) {
        setAudioError((err as Error).message)
        setIsTranscribing(false)
      }
    }
  }, [isTranscribing, captureDeviceId, selectedLanguage, setIsTranscribing])

  // ── Clear ────────────────────────────────────────────────────────────────────

  const handleClear = useCallback(async (): Promise<void> => {
    setSegments([])
    setInterimText('')
    setWordCount(0)
    setConfidenceSum(0)
    setConfidenceCount(0)
    await window.api.transcription.clearHistory()
  }, [])

  // ── Export ───────────────────────────────────────────────────────────────────

  const handleExport = useCallback((format: 'text' | 'markdown'): void => {
    const allSegs = segments.filter((s) => s.isFinal)
    let content: string
    let filename: string
    let mime: string

    if (format === 'text') {
      content  = allSegs.map((s) => s.text).join(' ')
      filename = `transcript-${dateSlug()}.txt`
      mime     = 'text/plain'
    } else {
      const lines: string[] = ['# Transcript\n']
      let lastMinute = -1
      for (const seg of allSegs) {
        const d = new Date(seg.timestamp)
        const min = d.getHours() * 60 + d.getMinutes()
        if (min !== lastMinute) {
          const hh = String(d.getHours()).padStart(2, '0')
          const mm = String(d.getMinutes()).padStart(2, '0')
          lines.push(`\n## ${hh}:${mm}\n`)
          lastMinute = min
        }
        lines.push(seg.text)
      }
      content  = lines.join(' ').replace(/ \n/g, '\n').trim()
      filename = `transcript-${dateSlug()}.md`
      mime     = 'text/markdown'
    }

    downloadFile(content, filename, mime)
  }, [segments])

  // ── Derived ──────────────────────────────────────────────────────────────────

  const averageConfidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 0

  const interimSegment: DisplaySegment | null = interimText
    ? {
        id:                  '__interim__',
        text:                interimText,
        isFinal:             false,
        timestamp:           interimTimestampRef.current,
        confidence:          0,
        scriptureHighlights: [],
      }
    : null

  const displaySegments = interimSegment ? [...segments, interimSegment] : segments

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 flex flex-col h-full max-h-full gap-4">
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-shrink-0">
        <div>
          <h1 className="page-header">Transcription</h1>
          <p className="page-subtitle">Live speech-to-text · powered by Deepgram Nova-3</p>
        </div>
        {isTranscribing && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-500/15 border border-teal-500/30">
            <Circle size={8} className="text-teal-500 fill-teal-500 animate-pulse" />
            <span className="text-xs font-semibold text-teal-400 uppercase tracking-wide">Live</span>
          </div>
        )}
      </div>

      {/* ── Controls ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0">
        <ControlsBar
          isTranscribing={isTranscribing}
          devices={devices}
          captureDeviceId={captureDeviceId}
          selectedLanguage={selectedLanguage}
          onToggle={handleToggle}
          onDeviceChange={setCaptureDeviceId}
          onLanguageChange={setSelectedLanguage}
          onClear={handleClear}
          onExport={handleExport}
          disabled={devices.length === 0}
        />
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────────── */}
      {audioError && (
        <div className="flex-shrink-0 flex items-start gap-2 px-4 py-3 rounded-lg bg-red-600/15 border border-red-500/30 text-red-400 text-sm">
          <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
          <span>{audioError}</span>
        </div>
      )}

      {/* ── Transcript + Suggestions ──────────────────────────────────────────── */}
      <div className="flex-1 flex gap-3 min-h-0">
        {/* Transcript area */}
        <div className="flex-1 flex flex-col card gap-0 p-0 overflow-hidden relative min-w-0">
          {/* Audio level bar */}
          <div className="flex-shrink-0 px-4 pt-3 pb-2">
            <AudioLevelBar level={isTranscribing ? audioLevel : null} />
          </div>

          {/* Scroll-lock toggle */}
          <div className="flex-shrink-0 flex justify-end px-4 pb-2">
            <ScrollLockButton locked={scrollLocked} onClick={handleUnlock} />
          </div>

          {/* Scrollable transcript */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-4 pb-4 space-y-1"
          >
            {displaySegments.length === 0 ? (
              <p className="text-slate-600 italic font-mono text-sm py-4">
                {isTranscribing
                  ? 'Listening… speech will appear here'
                  : 'Press Start to begin transcription'}
              </p>
            ) : (
              displaySegments.map((seg, idx) => (
                <SegmentBlock key={seg.id} seg={seg} indexFromEnd={displaySegments.length - 1 - idx} />
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {/* Auto-present countdown toasts (floating overlay) */}
          <AutoPresentToast
            items={pendingAuto}
            onPresentNow={handleApproveSuggestion}
            onDismiss={handleDismissAuto}
          />
        </div>

        {/* Suggestions panel — shown when there are pending detections */}
        <SuggestionsPanel
          suggestions={suggestions}
          onApprove={handleApproveSuggestion}
          onDismiss={handleDismissSuggestion}
        />
      </div>

      {/* ── Stats footer ─────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0">
        <StatsFooter
          wordCount={wordCount}
          sessionMs={sessionMs}
          averageConfidence={averageConfidence}
          isConnected={isTranscribing}
          sessionStats={sessionStats}
        />
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resultToSegment(r: TranscriptResult): DisplaySegment {
  return {
    id:                  r.id,
    text:                r.text,
    isFinal:             true,
    timestamp:           r.timestamp,
    confidence:
      r.words.length > 0
        ? r.words.reduce((s, w) => s + w.confidence, 0) / r.words.length
        : 0,
    scriptureHighlights: [],
  }
}

function dateSlug(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
}
