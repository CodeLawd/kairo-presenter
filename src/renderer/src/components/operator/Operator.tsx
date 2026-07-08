import { useState, useEffect, useRef, useCallback } from 'react'
import {
  BookOpen,
  X,
  Check,
  Play,
  Pause,
  Search,
  Activity,
  Trash2,
  Edit2,
  Save,
  Volume2,
  AlertTriangle,
  RotateCcw,
  BookOpenCheck,
} from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { cn } from '@/lib/utils'
import type {
  ScriptureSuggestion,
  PendingAutoPresent,
  ServiceHealth,
  TranscriptResult,
  ResilienceStatus,
} from '@shared/ipc'

// ─── Constants for Live Highlight Parsing ─────────────────────────────────────

const TRIGGER_PHRASES = [
  'turn your bibles to',
  'turn to',
  "let's read",
  'the scripture says',
  'the bible says',
  'it is written',
  'as it says in',
  'chapter',
  'verse',
]

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

function buildRuns(text: string, scriptureHighlights: ScriptureHighlight[]): TextRun[] {
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
            <mark key={idx} className="bg-transparent text-teal-300 font-bold not-italic">
              {run.text}
            </mark>
          )
        }
        if (run.type === 'scripture') {
          return (
            <span key={idx} className="relative inline">
              <mark className="bg-teal-500/10 text-teal-200 border-b border-teal-500/30 pb-0.5 not-italic">
                {run.text}
              </mark>
              <span className="ml-1 inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-300 border border-zinc-700 align-middle leading-none">
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

function resultToSegment(r: TranscriptResult): DisplaySegment {
  return {
    id: r.id,
    text: r.text,
    isFinal: true,
    timestamp: r.timestamp,
    confidence:
      r.words.length > 0 ? r.words.reduce((s, w) => s + w.confidence, 0) / r.words.length : 0,
    scriptureHighlights: [],
  }
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Operator(): React.ReactElement {
  const {
    isTranscribing,
    setIsTranscribing,
    autoModeEnabled,
    setAutoMode,
    confidenceThreshold,
    sessionStartTime,
    audioLevel,
  } = useAppStore()

  // Transcript states
  const [segments, setSegments] = useState<DisplaySegment[]>([])
  const [interimText, setInterimText] = useState('')
  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const isAutoScrolling = useRef(true)

  // Scripture suggestions queue
  const [suggestions, setSuggestions] = useState<ScriptureSuggestion[]>([])
  const [pendingAuto, setPendingAuto] = useState<PendingAutoPresent[]>([])
  const [activeProjection, setActiveProjection] = useState<{
    reference: string
    text: string
  } | null>(null)

  // Quick actions search input
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Common scriptures quick grid
  const [quickAccess, setQuickAccess] = useState<string[]>(() => {
    const saved = localStorage.getItem('proautomate_quick_access')
    return saved
      ? JSON.parse(saved)
      : ['John 3:16', 'Psalm 23:1', 'Romans 8:28', 'Genesis 1:1', 'Isaiah 40:31', 'Philippians 4:13']
  })
  const [isEditingGrid, setIsEditingGrid] = useState(false)
  const [tempQuickAccess, setTempQuickAccess] = useState<string[]>([...quickAccess])

  // System Health state
  const [health, setHealth] = useState<ServiceHealth[]>([])

  // Resilience Status state
  const [resilienceStatus, setResilienceStatus] = useState<ResilienceStatus | null>(null)
  const prevPpStateRef = useRef<boolean>(true)

  // play beep function using Web Audio API
  const playBeep = useCallback(() => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const oscillator = audioCtx.createOscillator()
      const gainNode = audioCtx.createGain()

      oscillator.connect(gainNode)
      gainNode.connect(audioCtx.destination)

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime) // 880Hz
      gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3)

      oscillator.start()
      oscillator.stop(audioCtx.currentTime + 0.3)
    } catch (err) {
      console.error('Failed to play beep sound:', err)
    }
  }, [])

  useEffect(() => {
    // 1. Get initial status
    window.api.resilience.getStatus().then((status) => {
      setResilienceStatus(status)
      prevPpStateRef.current = (status.ppReconnectCountdown ?? 0) === 0
    }).catch(console.error)

    // 2. Subscribe to status changes
    const unsubResilience = window.api.resilience.onStatusChange((status) => {
      setResilienceStatus(status)
      const wasConnected = prevPpStateRef.current
      const isConnected = (status.ppReconnectCountdown ?? 0) === 0 && status.overallHealth !== 'CRITICAL'
      if (wasConnected && !isConnected && (status.ppReconnectCountdown ?? 0) > 0) {
        playBeep()
      }
      prevPpStateRef.current = isConnected
    })

    return () => {
      unsubResilience()
    }
  }, [playBeep])

  // Session duration timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  // Time ticker state for Auto-present countdown progress
  const [now, setNow] = useState(Date.now())

  // ── Setup Tick Tickers ──────────────────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 50)
    return () => clearInterval(interval)
  }, [])

  // ── Sync Active Projection with Store's Current Slide ──────────────────────

  const currentSlide = useAppStore((state) => state.currentSlide)
  useEffect(() => {
    if (currentSlide) {
      // Split reference and verse if stored together, or default back
      const match = currentSlide.match(/^(.*?\d+:\d+)\s*[\r\n]+([\s\S]+)$/)
      if (match) {
        setActiveProjection({ reference: match[1], text: match[2] })
      } else {
        setActiveProjection({ reference: 'Projected', text: currentSlide })
      }
    } else {
      setActiveProjection(null)
    }
  }, [currentSlide])

  // ── Load Init History & Health On Mount ──────────────────────────────────────

  useEffect(() => {
    window.api.transcription.getHistory().then((history) => {
      if (history && history.length > 0) {
        setSegments(history.map((r) => resultToSegment(r)))
      }
    })

    window.api.orchestrator.getStatus().then((status) => {
      setHealth(status.health)
      setIsTranscribing(status.running)
      setAutoMode(status.autoMode, confidenceThreshold)
    })
  }, [setIsTranscribing, setAutoMode, confidenceThreshold])

  // ── IPC subscriptions for live speech and Claude suggestions ───────────────

  useEffect(() => {
    const unsubTranscript = window.api.transcription.onTranscript((result) => {
      const seg = resultToSegment(result)
      setSegments((prev) => [...prev, seg].slice(-50))
      setInterimText('')
    })

    const unsubInterim = window.api.transcription.onInterim((result) => {
      setInterimText(result.text)
    })

    const unsubSuggestion = window.api.scripture.onSuggestion((suggestion) => {
      // 1. Apply visual highlight to the transcript segment containing the trigger
      const highlight: ScriptureHighlight = {
        id: suggestion.id,
        triggerText: suggestion.triggerText,
        reference: suggestion.reference,
        confidence: suggestion.confidence,
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

      // 2. Insert into the visual queue
      setSuggestions((prev) => {
        if (prev.some((s) => s.id === suggestion.id)) return prev
        return [...prev, suggestion]
      })
    })

    const unsubPendingAuto = window.api.orchestrator.onPendingAuto((pending) => {
      setPendingAuto((prev) => [
        ...prev.filter((p) => p.suggestionId !== pending.suggestionId),
        pending,
      ])
    })

    const unsubStatus = window.api.orchestrator.onStatus((status) => {
      setHealth(status.health)
      setIsTranscribing(status.running)
      setAutoMode(status.autoMode, confidenceThreshold)
    })

    return () => {
      unsubTranscript()
      unsubInterim()
      unsubSuggestion()
      unsubPendingAuto()
      unsubStatus()
    }
  }, [setIsTranscribing, setAutoMode, confidenceThreshold])

  // ── Auto-present Cleanup and Projection Trigger ─────────────────────────────

  useEffect(() => {
    if (pendingAuto.length === 0) return
    const timers = pendingAuto.map((item) => {
      const delay = Math.max(0, item.expiresAt - Date.now())
      return setTimeout(() => {
        const sug = suggestions.find((s) => s.id === item.suggestionId)
        if (sug) {
          setActiveProjection({
            reference: sug.reference,
            text: sug.verses.map((v) => v.text).join(' '),
          })
        }
        setPendingAuto((prev) => prev.filter((p) => p.suggestionId !== item.suggestionId))
        setSuggestions((prev) => prev.filter((s) => s.id !== item.suggestionId))
      }, delay)
    })
    return () => timers.forEach(clearTimeout)
  }, [pendingAuto, suggestions])

  // ── Session Ticker ──────────────────────────────────────────────────────────

  useEffect(() => {
    let interval: NodeJS.Timeout
    if (isTranscribing) {
      interval = setInterval(() => {
        const diff = Math.floor((Date.now() - sessionStartTime) / 1000)
        setElapsedSeconds(diff >= 0 ? diff : 0)
      }, 1000)
    } else {
      setElapsedSeconds(0)
    }
    return () => clearInterval(interval)
  }, [isTranscribing, sessionStartTime])

  // ── Auto-scroll Transcript ──────────────────────────────────────────────────

  useEffect(() => {
    if (isAutoScrolling.current) {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [segments, interimText])

  const handleTranscriptScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 20
    isAutoScrolling.current = isAtBottom
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleApproveSuggestion = useCallback(
    async (id: string): Promise<void> => {
      try {
        const sug = suggestions.find((s) => s.id === id)
        if (sug) {
          setActiveProjection({
            reference: sug.reference,
            text: sug.verses.map((v) => v.text).join(' '),
          })
        }
        await window.api.orchestrator.approveSuggestion(id)
        setSuggestions((prev) => prev.filter((s) => s.id !== id))
        setPendingAuto((prev) => prev.filter((p) => p.suggestionId !== id))
      } catch (err) {
        console.error(err)
      }
    },
    [suggestions]
  )

  const handleDismissSuggestion = useCallback(async (id: string): Promise<void> => {
    try {
      await window.api.orchestrator.dismissSuggestion(id)
      setSuggestions((prev) => prev.filter((s) => s.id !== id))
      setPendingAuto((prev) => prev.filter((p) => p.suggestionId !== id))
    } catch (err) {
      console.error(err)
    }
  }, [])

  const handleDismissAuto = useCallback(async (id: string): Promise<void> => {
    try {
      await window.api.orchestrator.dismissAuto(id)
      setPendingAuto((prev) => prev.filter((p) => p.suggestionId !== id))
    } catch (err) {
      console.error(err)
    }
  }, [])

  const handleClearProjection = useCallback(async (): Promise<void> => {
    try {
      await window.api.propresenter.clearAll()
      setActiveProjection(null)
    } catch (err) {
      console.error(err)
    }
  }, [])

  const handleManualSearch = async () => {
    if (!searchQuery.trim()) return
    try {
      const results = await window.api.scripture.search(searchQuery)
      if (results && results.length > 0) {
        const res = results[0]
        const suggestion: ScriptureSuggestion = {
          id: `manual-${Date.now()}`,
          reference: res.reference,
          verses: res.verses,
          translation: res.translation,
          confidence: 1.0,
          source: 'manual',
          triggerText: searchQuery,
        }
        await window.api.scripture.register(suggestion)
        await window.api.orchestrator.approveSuggestion(suggestion.id)
        setActiveProjection({
          reference: res.reference,
          text: res.verses.map((v) => v.text).join(' '),
        })
        setSearchQuery('')
      }
    } catch (err) {
      console.error(err)
    }
  }

  const handleQuickGridSelect = async (ref: string) => {
    try {
      const results = await window.api.scripture.search(ref)
      if (results && results.length > 0) {
        const res = results[0]
        const suggestion: ScriptureSuggestion = {
          id: `manual-grid-${Date.now()}`,
          reference: res.reference,
          verses: res.verses,
          translation: res.translation,
          confidence: 1.0,
          source: 'manual',
          triggerText: ref,
        }
        await window.api.scripture.register(suggestion)
        await window.api.orchestrator.approveSuggestion(suggestion.id)
        setActiveProjection({
          reference: res.reference,
          text: res.verses.map((v) => v.text).join(' '),
        })
      }
    } catch (err) {
      console.error(err)
    }
  }

  const handleToggleAutoMode = async () => {
    const nextVal = !autoModeEnabled
    try {
      await window.api.scripture.setAutoMode(nextVal)
      setAutoMode(nextVal, confidenceThreshold)
    } catch (err) {
      console.error(err)
    }
  }

  const handleTogglePipeline = async () => {
    if (isTranscribing) {
      try {
        await window.api.orchestrator.stop()
        setIsTranscribing(false)
      } catch (err) {
        console.error(err)
      }
    } else {
      try {
        const all = await window.api.settings.getAll()
        const devs = await window.api.audio.getDevices()
        const defaultDev = devs.find((d) => d.isDefault) || devs[0]
        const config = {
          audioDeviceId: all.audio.deviceId || defaultDev?.id || '',
          sttProvider: all.stt.apiKey ? 'deepgram' : all.stt.provider,
          sttApiKey: all.stt.apiKey,
          sttLanguage: all.stt.language || 'en',
          llmProvider: all.stt.llmProvider ?? 'anthropic',
          llmApiKey: (all.stt.llmProvider ?? 'anthropic') === 'deepseek' ? all.stt.deepseekApiKey : all.stt.anthropicApiKey,
          scriptureTranslation: all.scripture.defaultTranslation,
          autoMode: autoModeEnabled,
          confidenceThreshold: all.scripture.confidenceThreshold,
          autoPresentDelaySec: 3,
        }
        await window.api.orchestrator.start(config)
        setIsTranscribing(true)
      } catch (err) {
        console.error(err)
      }
    }
  }

  const handleSaveGrid = () => {
    setQuickAccess(tempQuickAccess)
    localStorage.setItem('proautomate_quick_access', JSON.stringify(tempQuickAccess))
    setIsEditingGrid(false)
  }

  // ── Keyboard Shortcuts Listener ─────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+F: Focus search
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
      // Ctrl+A: Toggle auto mode
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        handleToggleAutoMode()
      }
      // Backspace / Delete: Clear current projection (if not in an input)
      if (
        (e.key === 'Backspace' || e.key === 'Delete') &&
        document.activeElement?.tagName !== 'INPUT'
      ) {
        e.preventDefault()
        handleClearProjection()
      }
      // Space / Enter: Approve top suggestion (if not in input/button)
      if (
        (e.key === ' ' || e.key === 'Enter') &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'BUTTON'
      ) {
        e.preventDefault()
        if (suggestions.length > 0) {
          handleApproveSuggestion(suggestions[0].id)
        }
      }
      // Escape: Dismiss top suggestion (if not in input)
      if (e.key === 'Escape' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        if (suggestions.length > 0) {
          handleDismissSuggestion(suggestions[0].id)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [suggestions, autoModeEnabled, handleApproveSuggestion, handleDismissSuggestion, handleClearProjection])

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const getServiceStatus = (serviceName: string): 'ok' | 'degraded' | 'error' | 'unknown' => {
    const service = health.find((h) => h.service === serviceName)
    return service ? service.status : 'unknown'
  }

  const getServiceError = (serviceName: string): string | undefined => {
    const service = health.find((h) => h.service === serviceName)
    return service ? service.lastError : undefined
  }

  const ppReconnectCountdown = resilienceStatus?.ppReconnectCountdown ?? 0

  const ppStatus = resilienceStatus
    ? (ppReconnectCountdown > 0 ? 'error' : (resilienceStatus.overallHealth === 'CRITICAL' ? 'error' : 'ok'))
    : getServiceStatus('propresenter')

  const ppError = resilienceStatus
    ? (ppReconnectCountdown > 0
        ? `Disconnected. Reconnecting... (Queue: ${resilienceStatus.ppQueueSize} items)`
        : getServiceError('propresenter'))
    : getServiceError('propresenter')

  const sttHealth = resilienceStatus?.health.find((h) => h.service === 'stt')

  const sttStatus = sttHealth
    ? (sttHealth.status === 'degraded' ? 'degraded' : sttHealth.status === 'error' ? 'error' : 'ok')
    : getServiceStatus('stt')

  const sttError = sttHealth?.lastError ?? getServiceError('stt')

  const claudeStatusMapped = resilienceStatus
    ? (resilienceStatus.claudeFallbackActive ? 'degraded' : 'ok')
    : getServiceStatus('detector')

  const claudeErrorMapped = resilienceStatus
    ? (resilienceStatus.claudeFallbackActive ? 'Claude offline. Local Regex fallback active.' : getServiceError('detector'))
    : getServiceError('detector')

  return (
    <div className="h-full w-full flex flex-col bg-surface overflow-hidden">
      {/* Header bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-surface-border bg-surface-secondary/40 shrink-0">
        <div>
          <h1 className="text-base font-bold text-white leading-none tracking-tight">Operator Dashboard</h1>
          <p className="text-[10px] text-slate-500 mt-1 leading-none">Live church presentation telemetry & override panel</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Key shortcut helper */}
          <div className="hidden lg:flex items-center gap-2.5 px-3 py-1 bg-surface border border-surface-border rounded-lg text-[10px] text-slate-500 font-medium">
            <span><kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-slate-400 font-mono text-[9px]">Space</kbd> Send</span>
            <span><kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-slate-400 font-mono text-[9px]">Esc</kbd> Dismiss</span>
            <span><kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-slate-400 font-mono text-[9px]">Backspace</kbd> Clear</span>
            <span><kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-slate-400 font-mono text-[9px]">Ctrl+F</kbd> Search</span>
          </div>
          <button
            onClick={handleToggleAutoMode}
            className={cn(
              'px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 border',
              autoModeEnabled
                ? 'bg-teal-500/10 border-teal-500/30 text-teal-400 shadow-sm'
                : 'bg-zinc-900 border-zinc-800 text-slate-400 hover:text-slate-200'
            )}
            title="Press Ctrl+A to toggle"
          >
            Auto-Mode: {autoModeEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </header>

      {resilienceStatus?.recoverySessionAvailable && (
        <div className="bg-teal-950/40 border-b border-teal-500/30 px-6 py-3 flex items-center justify-between text-xs text-teal-300">
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={15} className="text-teal-400 animate-pulse" />
            <div>
              <span className="font-bold">Active Recovery State Detected.</span>
              <span className="text-slate-400 ml-1">Would you like to restore your previous session transcription, settings, and queue?</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={async () => {
                try {
                  await window.api.resilience.discardSession()
                } catch (e) {
                  console.error(e)
                }
              }}
              className="px-3 py-1 bg-zinc-900 border border-zinc-800 rounded-none uppercase font-mono text-[10px] text-slate-400 hover:text-slate-200"
            >
              Discard
            </button>
            <button
              onClick={async () => {
                try {
                  await window.api.resilience.restoreSession()
                } catch (e) {
                  console.error(e)
                }
              }}
              className="px-3 py-1 bg-teal-600 border border-teal-500/30 rounded-none uppercase font-mono text-[10px] text-white hover:bg-teal-500"
            >
              Restore Session
            </button>
          </div>
        </div>
      )}

      {resilienceStatus && ppReconnectCountdown > 0 && (
        <div className="bg-rose-950/20 border-b border-rose-500/30 px-6 py-2.5 flex items-center justify-between text-xs font-bold text-rose-400 animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            <span>PP DISCONNECTED — RETRYING IN {ppReconnectCountdown}s</span>
            {resilienceStatus.ppQueueSize > 0 && (
              <span className="bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded text-[10px]">
                {resilienceStatus.ppQueueSize} projection(s) queued
              </span>
            )}
          </div>
          <span className="text-[10px] uppercase font-mono tracking-widest text-rose-500/80">Queue active</span>
        </div>
      )}

      {/* Main columns */}
      <div className="flex-1 min-h-0 w-full flex">
        {/* LEFT COLUMN: Live Transcript (25%) */}
        <section className="w-1/4 min-w-[240px] border-r border-surface-border flex flex-col bg-surface-secondary/15">
          <div className="px-4 py-3.5 border-b border-surface-border flex items-center justify-between bg-surface-secondary/40 shrink-0">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Live Transcript</span>
            {isTranscribing && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] text-emerald-400 font-bold tracking-wider uppercase animate-pulse">
                <span className="w-1 h-1 rounded-full bg-emerald-400" />
                Live
              </span>
            )}
          </div>
          {resilienceStatus && (sttHealth?.status === 'degraded' || sttHealth?.status === 'error') && (
            <div className="bg-amber-950/20 border-b border-amber-500/30 px-4 py-2 text-[10px] font-bold text-amber-400 flex items-center justify-between animate-pulse shrink-0">
              <span>TRANSCRIPTION PAUSED — RECONNECTING</span>
              <span className="bg-amber-500/10 px-1.5 py-0.5 rounded text-[9px]">BUFFERING AUDIO</span>
            </div>
          )}
          <div
            onScroll={handleTranscriptScroll}
            className="flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth font-serif text-slate-300 leading-relaxed text-sm antialiased select-text"
          >
            {segments.map((seg) => (
              <p key={seg.id} className="transition-all duration-300 opacity-90 hover:opacity-100">
                <HighlightedText text={seg.text} scriptureHighlights={seg.scriptureHighlights} />
              </p>
            ))}
            {interimText && (
              <p className="text-slate-500 italic opacity-80 animate-pulse">
                {interimText}
              </p>
            )}
            {segments.length === 0 && !interimText && (
              <p className="text-xs text-slate-600 italic font-mono">
                {isTranscribing ? 'Listening for speech…' : 'Speech pipeline offline.'}
              </p>
            )}
            <div ref={transcriptEndRef} />
          </div>

          {/* Audio Signal Level Indicator */}
          <div className="p-3 border-t border-surface-border bg-surface shrink-0 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Volume2 size={11} className={isTranscribing ? 'text-teal-400' : 'text-slate-500'} />
                Audio Input Signal
              </span>
              <span className="text-[9px] font-mono text-slate-600">
                {Math.round((audioLevel?.rms ?? 0) * 100)}% RMS
              </span>
            </div>
            <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden relative border border-zinc-800/40">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-75 ease-out',
                  (audioLevel?.clipping ?? false) ? 'bg-rose-500 animate-pulse' : 'bg-teal-500'
                )}
                style={{ width: `${Math.min(100, (audioLevel?.rms ?? 0) * 100 * 3.5)}%` }}
              />
            </div>
          </div>
        </section>

        {/* CENTER COLUMN: Scripture Suggestion Queue & Projected Content (50%) */}
        <section className="flex-1 border-r border-surface-border flex flex-col">
          {resilienceStatus && resilienceStatus.claudeFallbackActive && (
            <div className="bg-amber-950/10 border-b border-amber-500/20 px-5 py-2 text-[10px] font-bold text-amber-400/90 flex items-center justify-between shrink-0 animate-pulse">
              <span>CLAUDE OFFLINE — LOCAL REGEX DETECTION ACTIVE</span>
              <span className="text-[9px] uppercase tracking-wider text-slate-500 font-mono">FALLBACK ACTIVE</span>
            </div>
          )}
          {/* NOW PROJECTING */}
          <div className="p-5 border-b border-surface-border bg-surface-secondary/20 shrink-0 space-y-3">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">Now Projecting</span>
            <div className="flex gap-4 items-stretch min-h-[96px] bg-surface border border-surface-border rounded-xl overflow-hidden p-4 shadow-sm">
              <div className="flex-1 flex flex-col justify-center min-w-0">
                {activeProjection ? (
                  <>
                    <p className="text-[11px] font-bold text-teal-400 uppercase tracking-wider font-sans leading-none mb-1">
                      {activeProjection.reference}
                    </p>
                    <p className="text-sm text-white font-serif leading-relaxed line-clamp-3 italic">
                      “{activeProjection.text}”
                    </p>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500 py-3">
                    <BookOpenCheck size={18} className="text-slate-600 mb-1" />
                    <p className="text-xs font-semibold">No scripture active on screen</p>
                  </div>
                )}
              </div>
              <button
                onClick={handleClearProjection}
                disabled={!activeProjection}
                className={cn(
                  'w-28 flex flex-col items-center justify-center gap-1.5 rounded-lg border text-xs font-bold transition-all duration-200 uppercase tracking-wider',
                  activeProjection
                    ? 'bg-rose-600/10 border-rose-500/30 text-rose-400 hover:bg-rose-600/20 active:bg-rose-600/35 cursor-pointer'
                    : 'bg-zinc-900/50 border-zinc-800 text-slate-600 cursor-not-allowed'
                )}
                aria-label="Clear ProPresenter output (Backspace)"
              >
                <X size={15} />
                Clear
              </button>
            </div>
          </div>

          {/* SUGGESTION QUEUE */}
          <div className="px-5 py-3.5 border-b border-surface-border bg-surface-secondary/40 shrink-0">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Detections & Suggestions Queue</span>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-surface-secondary/5">
            {suggestions.map((s) => {
              const pending = pendingAuto.find((p) => p.suggestionId === s.id)
              const msLeft = pending ? pending.expiresAt - now : 0
              const pct = pending ? Math.max(0, Math.min(100, (msLeft / 3000) * 100)) : 0
              const secsLeft = Math.ceil(msLeft / 1000)

              return (
                <div
                  key={s.id}
                  className={cn(
                    'relative overflow-hidden border bg-surface rounded-xl p-4 shadow-sm transition-all duration-200 group',
                    pending ? 'border-teal-500/30 bg-teal-950/5' : 'border-surface-border'
                  )}
                >
                  {/* Countdown progress line on top edge if auto presenting */}
                  {pending && (
                    <div
                      onClick={() => handleDismissAuto(s.id)}
                      className="absolute top-0 left-0 h-1 bg-teal-400 transition-all duration-100 ease-linear cursor-pointer"
                      style={{ width: `${pct}%` }}
                      title="Click countdown line to pause auto-present"
                    />
                  )}

                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white tracking-tight">{s.reference}</span>
                        <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[9px] text-slate-500 font-bold uppercase border border-zinc-700">
                          {s.translation}
                        </span>
                        {pending && (
                          <span
                            onClick={() => handleDismissAuto(s.id)}
                            className="px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-[9px] text-teal-400 font-extrabold cursor-pointer hover:bg-teal-500/20"
                            title="Click to cancel timer"
                          >
                            AUTO-SEND IN {secsLeft}s (CANCEL)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider shrink-0">Confidence:</span>
                        <div className="w-24 bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all duration-300',
                              s.confidence >= 0.8 ? 'bg-emerald-500' : s.confidence >= 0.6 ? 'bg-amber-500' : 'bg-rose-500'
                            )}
                            style={{ width: `${Math.round(s.confidence * 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-slate-400">{Math.round(s.confidence * 100)}%</span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDismissSuggestion(s.id)}
                        className="w-10 h-10 flex items-center justify-center rounded-lg bg-zinc-900 border border-zinc-800 text-slate-400 hover:text-rose-400 hover:bg-rose-950/20 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50"
                        title="Dismiss Suggestion (Esc)"
                      >
                        <X size={16} />
                      </button>
                      <button
                        onClick={() => handleApproveSuggestion(s.id)}
                        className="flex items-center gap-1.5 px-4 h-10 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold uppercase tracking-wider transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                        title="Project Now (Space / Enter)"
                      >
                        <Check size={14} />
                        Send
                      </button>
                    </div>
                  </div>

                  {s.verses.length > 0 && (
                    <div className="mt-3 bg-surface-secondary/40 border border-surface-border/50 rounded-lg p-3">
                      <p className="text-xs text-slate-400 font-serif leading-relaxed italic">
                        “{s.verses.map((v) => v.text).join(' ')}”
                      </p>
                    </div>
                  )}
                </div>
              )
            })}

            {suggestions.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-slate-600 border border-dashed border-zinc-800 rounded-xl">
                <Activity size={24} className="mb-2 text-slate-700 animate-pulse" />
                <p className="text-xs font-semibold">Listening for scriptures...</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Read scripture quotes to trigger automatic cards</p>
              </div>
            )}
          </div>
        </section>

        {/* RIGHT COLUMN: Quick Actions & Pipeline Controller (25%) */}
        <section className="w-1/4 min-w-[260px] flex flex-col">
          {/* Status Panel */}
          <div className="p-4 border-b border-surface-border bg-surface-secondary/40 space-y-3 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">System Health</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-slate-500">Session Timer:</span>
                <span className="text-xs font-mono font-bold text-white tracking-tight tabular-nums">
                  {formatTime(elapsedSeconds)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <HealthIndicator
                label="ProPresenter"
                status={ppStatus}
                error={ppError}
              />
              <HealthIndicator
                label="STT Pipeline"
                status={sttStatus}
                error={sttError}
              />
              <HealthIndicator
                label="Claude AI"
                status={claudeStatusMapped}
                error={claudeErrorMapped}
              />
            </div>
          </div>

          {/* Manual Search */}
          <div className="p-4 border-b border-surface-border space-y-2.5 shrink-0">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Manual scripture search</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="e.g. John 3:16 or Psalm 23"
                  className="input pr-8"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                />
                <Search size={14} className="absolute right-3 top-2.5 text-slate-500" />
              </div>
              <button
                onClick={handleManualSearch}
                className="px-3.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition-colors shrink-0"
              >
                Go
              </button>
            </div>
          </div>

          {/* Quick-Access Scriptures Grid */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[180px]">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Common Scriptures</span>
              <button
                onClick={() => {
                  if (isEditingGrid) {
                    handleSaveGrid()
                  } else {
                    setTempQuickAccess([...quickAccess])
                    setIsEditingGrid(true)
                  }
                }}
                className="text-[10px] font-bold text-teal-400 hover:text-teal-300 flex items-center gap-1 transition-colors"
              >
                {isEditingGrid ? (
                  <>
                    <Save size={10} /> Save Grid
                  </>
                ) : (
                  <>
                    <Edit2 size={10} /> Edit Grid
                  </>
                )}
              </button>
            </div>

            {isEditingGrid ? (
              <div className="grid grid-cols-2 gap-2">
                {tempQuickAccess.map((ref, idx) => (
                  <input
                    key={idx}
                    type="text"
                    className="input text-center text-xs font-semibold py-1.5 px-2 bg-surface-secondary border-surface-border text-white"
                    value={ref}
                    onChange={(e) => {
                      const updated = [...tempQuickAccess]
                      updated[idx] = e.target.value
                      setTempQuickAccess(updated)
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {quickAccess.map((ref) => (
                  <button
                    key={ref}
                    onClick={() => handleQuickGridSelect(ref)}
                    className="py-3 px-2 rounded-xl bg-surface border border-surface-border hover:border-teal-500/40 text-xs font-semibold text-slate-300 hover:text-white hover:bg-surface-secondary/30 transition-all text-center truncate shadow-sm active:bg-zinc-800"
                  >
                    {ref}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Bottom Pipeline stop & Emergency buttons */}
          <div className="p-4 border-t border-surface-border bg-surface-secondary/10 shrink-0 space-y-3">
            <button
              onClick={handleTogglePipeline}
              className={cn(
                'w-full py-3.5 rounded-xl border text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.99]',
                isTranscribing
                  ? 'bg-amber-600/10 border-amber-500/20 text-amber-400 hover:bg-amber-600/20 shadow-glow-amber/5'
                  : 'bg-emerald-600/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-600/20 shadow-glow-emerald/5'
              )}
            >
              {isTranscribing ? (
                <>
                  <Pause size={14} /> Pause Pipeline
                </>
              ) : (
                <>
                  <Play size={14} /> Start Pipeline
                </>
              )}
            </button>

            <button
              onClick={handleClearProjection}
              className="w-full py-4.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold uppercase tracking-widest text-xs transition-all duration-200 shadow-glow-rose/10 flex items-center justify-center gap-2 border border-rose-500/20 active:scale-[0.99]"
            >
              <Trash2 size={15} />
              Emergency Clear
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

// ─── Health Indicator Sub-Component ──────────────────────────────────────────

function HealthIndicator({
  label,
  status,
  error,
}: {
  label: string
  status: 'ok' | 'degraded' | 'error' | 'unknown'
  error?: string
}): React.ReactElement {
  const statusColorMap = {
    ok: 'bg-emerald-500 shadow-glow-emerald/50',
    degraded: 'bg-amber-500 shadow-glow-amber/50 animate-pulse',
    error: 'bg-rose-500 shadow-glow-rose/50 animate-pulse',
    unknown: 'bg-zinc-600',
  }

  const borderColors = {
    ok: 'border-surface-border/50',
    degraded: 'border-amber-500/20',
    error: 'border-rose-500/20',
    unknown: 'border-surface-border/50',
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between p-2.5 bg-surface border rounded-xl shadow-sm transition-all',
        borderColors[status]
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={cn('w-2 h-2 rounded-full shrink-0', statusColorMap[status])} />
        <span className="text-xs font-bold text-white truncate tracking-tight">{label}</span>
      </div>
      {error ? (
        <span
          className="text-[10px] text-rose-400 font-medium truncate max-w-[120px] ml-2"
          title={error}
        >
          {error}
        </span>
      ) : (
        <span className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider">
          {status === 'ok' ? 'Online' : status === 'unknown' ? 'Offline' : 'Error'}
        </span>
      )}
    </div>
  )
}
