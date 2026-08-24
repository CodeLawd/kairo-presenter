import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  BookOpen,
  X,
  Play,
  Pause,
  Search,
  Activity,
  Trash2,
  Volume2,
  AlertTriangle,
  RotateCcw,
  BookOpenCheck,
} from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { cn } from '@/lib/utils'
import {
  normalizeOperatorPanelWidth,
  resizeOperatorPanel,
} from '@shared/operator-layout'
import type { OperatorPanelSide } from '@shared/operator-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { VerseThemePreview } from '@/components/scripture/VerseThemePreview'
import { CARD_BASE_HEIGHT, CARD_BASE_WIDTH } from '@/components/scripture/types'
import { DEFAULT_OVERLAY_SETTINGS, normalizeOverlaySettings } from '@shared/overlay-defaults'
import {
  applyOperatorSuggestionSent,
  findReadingProgress,
  groupScriptureSuggestions,
  mergeScriptureSuggestion,
  updatePassageFollow,
} from '@shared/scripture-live-progress'
import type { PassageFollowState } from '@shared/scripture-live-progress'
import type {
  AppSettings,
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
  const suggestionsRef = useRef<ScriptureSuggestion[]>([])
  const recentReadingTextRef = useRef('')
  const verseCardRefs = useRef(new Map<string, HTMLButtonElement>())
  const [readingProgress, setReadingProgress] = useState<{
    matchedId: string
    nextId: string
  } | null>(null)
  const [sentSuggestionIds, setSentSuggestionIds] = useState<Set<string>>(
    () => new Set()
  )
  const sentSuggestionIdsRef = useRef(new Set<string>())
  const followStateRef = useRef<PassageFollowState | null>(null)
  const [overlay, setOverlay] = useState<AppSettings['overlay']>(DEFAULT_OVERLAY_SETTINGS)
  const [defaultTranslation, setDefaultTranslation] = useState<AppSettings['scripture']['defaultTranslation']>('NKJV')
  const [pendingAuto, setPendingAuto] = useState<PendingAutoPresent[]>([])
  const [transcriptWidth, setTranscriptWidth] = useState(() =>
    normalizeOperatorPanelWidth('left', localStorage.getItem('operator-transcript-width'), 240)
  )
  const [previewWidth, setPreviewWidth] = useState(() =>
    normalizeOperatorPanelWidth('right', localStorage.getItem('operator-preview-width'), 320)
  )
  const liveOutputPreviewWidth = Math.min(CARD_BASE_WIDTH, previewWidth - 32)
  const liveOutputPreviewHeight = Math.round((liveOutputPreviewWidth * 9) / 16)
  const [activeProjection, setActiveProjection] = useState<{
    reference: string
    text: string
  } | null>(null)
  const suggestionGroups = useMemo(
    () => groupScriptureSuggestions(suggestions),
    [suggestions]
  )

  const startPanelResize = useCallback((side: OperatorPanelSide, event: React.PointerEvent): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = side === 'left' ? transcriptWidth : previewWidth
    let finalWidth = startWidth
    const setWidth = side === 'left' ? setTranscriptWidth : setPreviewWidth
    const storageKey = side === 'left' ? 'operator-transcript-width' : 'operator-preview-width'

    const handlePointerMove = (pointerEvent: PointerEvent): void => {
      finalWidth = resizeOperatorPanel(side, startWidth, pointerEvent.clientX - startX)
      setWidth(finalWidth)
    }
    const handlePointerUp = (): void => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      localStorage.setItem(storageKey, String(finalWidth))
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
  }, [previewWidth, transcriptWidth])

  const resizePanelByKeyboard = useCallback((side: OperatorPanelSide, deltaX: number): void => {
    const currentWidth = side === 'left' ? transcriptWidth : previewWidth
    const nextWidth = resizeOperatorPanel(side, currentWidth, deltaX)
    if (side === 'left') setTranscriptWidth(nextWidth)
    else setPreviewWidth(nextWidth)
    localStorage.setItem(
      side === 'left' ? 'operator-transcript-width' : 'operator-preview-width',
      String(nextWidth)
    )
  }, [previewWidth, transcriptWidth])
  const livePreviewResult = useMemo(() => {
    if (!activeProjection) return null
    const detected = suggestions.find((item) => item.reference === activeProjection.reference)
    if (detected) {
      return {
        reference: detected.reference,
        translation: detected.translation,
        verses: detected.verses,
      }
    }
    const parsed = activeProjection.reference.match(/^(.+?)\s+(\d+):(\d+)/)
    return {
      reference: activeProjection.reference,
      translation: defaultTranslation,
      verses: [{
        book: parsed?.[1] ?? '',
        chapter: Number(parsed?.[2] ?? 0),
        verse: Number(parsed?.[3] ?? 0),
        text: activeProjection.text,
      }],
    }
  }, [activeProjection, defaultTranslation, suggestions])

  useEffect(() => {
    suggestionsRef.current = suggestions
  }, [suggestions])

  useEffect(() => {
    Promise.all([
      window.api.settings.get('overlay'),
      window.api.settings.get('scripture'),
    ])
      .then(([storedOverlay, storedScripture]) => {
        setOverlay(normalizeOverlaySettings(storedOverlay))
        setDefaultTranslation(storedScripture.defaultTranslation)
      })
      .catch(console.error)
  }, [])

  const advanceAutoFollowFromText = useCallback((text: string): void => {
    const current = followStateRef.current
    if (!current || !text.trim()) return
    const update = updatePassageFollow(current, text, suggestionsRef.current)
    followStateRef.current = update.state
    if (!update.nextSuggestionId || sentSuggestionIdsRef.current.has(update.nextSuggestionId)) return
    const candidate = suggestionsRef.current.find((item) => item.id === update.nextSuggestionId)
    if (!candidate) return

    const sent = new Set(sentSuggestionIdsRef.current).add(candidate.id)
    sentSuggestionIdsRef.current = sent
    setSentSuggestionIds(sent)
    setActiveProjection({
      reference: candidate.reference,
      text: candidate.verses.map((verse) => verse.text).join(' '),
    })
    window.api.scripture.register(candidate)
      .then(() => window.api.orchestrator.approveSuggestion(candidate.id))
      .catch((err) => {
        console.error(err)
        followStateRef.current = current
        const reverted = new Set(sentSuggestionIdsRef.current)
        reverted.delete(candidate.id)
        sentSuggestionIdsRef.current = reverted
        setSentSuggestionIds(reverted)
      })
  }, [])

  useEffect(() => {
    if (!readingProgress) return
    verseCardRefs.current.get(readingProgress.nextId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    })
  }, [readingProgress])

  // Quick actions search input
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

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
      advanceAutoFollowFromText(result.text)

      recentReadingTextRef.current = `${recentReadingTextRef.current} ${result.text}`.slice(-650)
      const progress = findReadingProgress(
        recentReadingTextRef.current,
        suggestionsRef.current
      )
      if (progress) {
        setReadingProgress({
          matchedId: suggestionsRef.current[progress.matchedIndex]?.id ?? progress.activeSuggestionId,
          nextId: progress.activeSuggestionId,
        })
      }
    })

    const unsubInterim = window.api.transcription.onInterim((result) => {
      setInterimText(result.text)
      advanceAutoFollowFromText(result.text)
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
        const next = mergeScriptureSuggestion(prev, suggestion)
        suggestionsRef.current = next
        const progress = findReadingProgress(recentReadingTextRef.current, next)
        if (progress) {
          setReadingProgress({
            matchedId: next[progress.matchedIndex]?.id ?? progress.activeSuggestionId,
            nextId: progress.activeSuggestionId,
          })
        }
        return next
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
  }, [setIsTranscribing, setAutoMode, confidenceThreshold, advanceAutoFollowFromText])

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
          if (sug.passageId && (sug.passageLength ?? 1) > 1) {
            followStateRef.current = {
              passageId: sug.passageId,
              currentIndex: sug.passageIndex ?? 0,
              matchedTokenIndexes: [],
            }
          }
          setActiveProjection({
            reference: sug.reference,
            text: sug.verses.map((v) => v.text).join(' '),
          })
        }
        const sentState = applyOperatorSuggestionSent(
          suggestions,
          sentSuggestionIdsRef.current,
          id
        )
        sentSuggestionIdsRef.current = sentState.sentSuggestionIds
        setSentSuggestionIds(sentState.sentSuggestionIds)
        setSuggestions(sentState.suggestions)
        await window.api.orchestrator.approveSuggestion(id)
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

  const handleClearProjection = useCallback(async (): Promise<void> => {
    try {
      await window.api.propresenter.clearAll()
      setActiveProjection(null)
      useAppStore.getState().clearScriptureLiveOutput()
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
      {/* Workspace command bar */}
      <header className="flex h-10 items-center justify-between border-b border-surface-border bg-surface-secondary/40 px-4 shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold text-zinc-300">Live workspace</span>
          <span className="text-[10px] font-mono tabular-nums text-zinc-600">{formatTime(elapsedSeconds)}</span>
        </div>
        <div className="flex items-center gap-4">
          {/* Key shortcut helper */}
          <div className="hidden lg:flex items-center gap-2.5 px-3 py-1 bg-surface border border-surface-border rounded-lg text-[10px] text-slate-500 font-medium">
            <span><kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-slate-400 font-mono text-[9px]">Space</kbd> Send</span>
            <span><kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-slate-400 font-mono text-[9px]">Esc</kbd> Dismiss</span>
            <span><kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-slate-400 font-mono text-[9px]">Backspace</kbd> Clear</span>
            <span><kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-slate-400 font-mono text-[9px]">Ctrl+F</kbd> Search</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground" title="Press Ctrl+A to toggle">
            <span>Automation</span>
            <Switch checked={autoModeEnabled} onCheckedChange={handleToggleAutoMode} aria-label="Toggle automation" />
          </div>
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
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await window.api.resilience.discardSession()
                } catch (e) {
                  console.error(e)
                }
              }}
            >
              Discard
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                try {
                  await window.api.resilience.restoreSession()
                } catch (e) {
                  console.error(e)
                }
              }}
            >
              Restore Session
            </Button>
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
        {/* LEFT COLUMN: compact live transcript */}
        <section
          className="shrink-0 flex flex-col bg-surface-secondary/15"
          style={{ width: transcriptWidth }}
        >
          <div className="px-4 py-3.5 border-b border-surface-border flex items-center justify-between bg-surface-secondary/40 shrink-0">
            <span className="font-narrow text-xs font-semibold text-slate-400 uppercase tracking-[0.08em]">Live transcript</span>
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
            className="flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth font-sans text-zinc-300 leading-relaxed text-sm antialiased select-text"
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

        <button
          type="button"
          aria-label="Resize live transcript panel"
          title="Drag to resize live transcript"
          className="group relative w-1.5 shrink-0 cursor-col-resize border-x border-surface-border/60 bg-surface-secondary/30 outline-none transition-colors hover:bg-teal-500/20 focus-visible:bg-teal-500/25"
          onPointerDown={(event) => startPanelResize('left', event)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') resizePanelByKeyboard('left', -16)
            if (event.key === 'ArrowRight') resizePanelByKeyboard('left', 16)
          }}
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-teal-400/70" />
        </button>

        {/* CENTER COLUMN: scripture detection workspace */}
        <section className="min-w-0 flex-1 flex flex-col">
          {resilienceStatus && resilienceStatus.claudeFallbackActive && (
            <div className="bg-amber-950/10 border-b border-amber-500/20 px-5 py-2 text-[10px] font-bold text-amber-400/90 flex items-center justify-between shrink-0 animate-pulse">
              <span>CLAUDE OFFLINE — LOCAL REGEX DETECTION ACTIVE</span>
              <span className="text-[9px] uppercase tracking-wider text-slate-500 font-mono">FALLBACK ACTIVE</span>
            </div>
          )}
          {/* SUGGESTION QUEUE */}
          <div className="px-5 py-3.5 border-b border-surface-border bg-surface-secondary/40 shrink-0">
            <span className="font-narrow text-xs font-semibold text-zinc-500 uppercase tracking-[0.08em]">Detected content</span>
          </div>
          <div className="flex-1 overflow-y-auto bg-surface-secondary/5 p-4">
            <div className="space-y-5">
              {suggestionGroups.map((group) => {
                const followState = followStateRef.current
                return (
                <section key={group.id} className="space-y-2.5">
                  <div className="flex items-end justify-between gap-3 px-0.5">
                    <div>
                      <p className="text-sm font-semibold text-slate-200">{group.reference}</p>
                      <p className="mt-0.5 text-[10px] text-slate-500">
                        {group.suggestions.length} verse{group.suggestions.length !== 1 ? 's' : ''} · selected theme preview
                      </p>
                    </div>
                    {followStateRef.current?.passageId === group.id && (
                      <span className="text-[10px] font-semibold text-teal-300">Auto-follow armed</span>
                    )}
                  </div>
                  <div
                    className="grid justify-start gap-3"
                    style={{
                      gridTemplateColumns: `repeat(auto-fill, ${CARD_BASE_WIDTH}px)`,
                    }}
                  >
                    {group.suggestions.map((s) => {
                      const isReading =
                        followState !== null &&
                        followState.passageId === s.passageId &&
                        followState.currentIndex === s.passageIndex
                      const isUpNext =
                        followState !== null &&
                        followState.passageId === s.passageId &&
                        followState.currentIndex + 1 === s.passageIndex
                      const isSent = sentSuggestionIds.has(s.id)
                      const isLive = activeProjection?.reference === s.reference
                      return (
                        <article key={s.id} className="min-w-0 space-y-1.5">
                          <VerseThemePreview
                            result={{
                              reference: s.reference,
                              translation: s.translation,
                              verses: s.verses,
                            }}
                            theme={overlay.theme}
                            showTranslation={overlay.showTranslation}
                            showVerseNumbers={overlay.showVerseNumbers}
                            maxVerses={1}
                            width={CARD_BASE_WIDTH}
                            height={CARD_BASE_HEIGHT}
                            isFocused={isReading || isUpNext}
                            isLive={isLive}
                            sendStatus={isLive ? 'sent' : 'idle'}
                            onSelect={() => void handleApproveSuggestion(s.id)}
                            cardRef={(element) => {
                              if (element) verseCardRefs.current.set(s.id, element)
                              else verseCardRefs.current.delete(s.id)
                            }}
                          />
                          <div className="flex items-center justify-between gap-2 px-0.5">
                            <div className="min-w-0">
                              <p className="truncate text-[11px] font-semibold text-slate-300">{s.reference}</p>
                              <p className={cn(
                                'text-[9px] font-semibold',
                                isLive ? 'text-teal-300' : isReading ? 'text-amber-300' : isUpNext ? 'text-slate-400' : 'text-slate-600'
                              )}>
                                {isLive ? 'Live · following reading' : isReading ? 'Reading now' : isUpNext ? 'Up next' : isSent ? 'Shown' : `${Math.round(s.confidence * 100)}% confidence`}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleDismissSuggestion(s.id)}
                              className="flex size-7 shrink-0 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-rose-500/10 hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50"
                              title={`Dismiss ${s.reference}`}
                              aria-label={`Dismiss ${s.reference}`}
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </section>
                )
              })}
            </div>

            {suggestions.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-slate-600 border border-dashed border-zinc-800 rounded-xl">
                <Activity size={24} className="mb-2 text-slate-700 animate-pulse" />
                <p className="text-xs font-semibold">Listening for scriptures...</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Read scripture quotes to trigger automatic cards</p>
              </div>
            )}
          </div>
        </section>

        <button
          type="button"
          aria-label="Resize live output preview panel"
          title="Drag to resize live output preview"
          className="group relative w-1.5 shrink-0 cursor-col-resize border-x border-surface-border/60 bg-surface-secondary/30 outline-none transition-colors hover:bg-teal-500/20 focus-visible:bg-teal-500/25"
          onPointerDown={(event) => startPanelResize('right', event)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') resizePanelByKeyboard('right', -16)
            if (event.key === 'ArrowRight') resizePanelByKeyboard('right', 16)
          }}
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-teal-400/70" />
        </button>

        {/* RIGHT COLUMN: live output preview and essential controls */}
        <aside
          className="shrink-0 flex flex-col bg-surface-secondary/10"
          style={{ width: previewWidth }}
        >
          <div className="border-b border-surface-border p-4 space-y-3 shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-300">Live output</p>
                <p className="text-[10px] text-slate-500">Selected theme · ProPresenter</p>
              </div>
              <span className="font-mono text-[11px] font-semibold tabular-nums text-slate-400">
                {formatTime(elapsedSeconds)}
              </span>
            </div>
            {livePreviewResult ? (
              <VerseThemePreview
                result={livePreviewResult}
                theme={overlay.theme}
                showTranslation={overlay.showTranslation}
                showVerseNumbers={overlay.showVerseNumbers}
                maxVerses={1}
                width={liveOutputPreviewWidth}
                height={liveOutputPreviewHeight}
                isFocused={false}
                isLive
                sendStatus="sent"
                onSelect={() => undefined}
                cardRef={() => undefined}
              />
            ) : (
              <div
                className="flex flex-col items-center justify-center rounded-xl border border-dashed border-surface-border bg-surface text-slate-500"
                style={{ width: liveOutputPreviewWidth, height: liveOutputPreviewHeight }}
              >
                <BookOpenCheck size={20} className="mb-2 text-slate-600" />
                <p className="text-xs font-semibold">Nothing is live</p>
                <p className="mt-0.5 text-[10px] text-slate-600">Send a verse to preview it here</p>
              </div>
            )}
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { label: 'PP', status: ppStatus, error: ppError },
                { label: 'STT', status: sttStatus, error: sttError },
                { label: 'AI', status: claudeStatusMapped, error: claudeErrorMapped },
              ].map((service) => (
                <div
                  key={service.label}
                  title={service.error}
                  className="flex items-center justify-center gap-1.5 rounded-md border border-surface-border bg-surface px-2 py-1.5"
                >
                  <span className={cn(
                    'size-1.5 rounded-full',
                    service.status === 'ok' ? 'bg-emerald-500' :
                      service.status === 'degraded' ? 'bg-amber-500' :
                        service.status === 'error' ? 'bg-rose-500' : 'bg-zinc-600'
                  )} />
                  <span className="text-[9px] font-semibold text-slate-400">{service.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1 p-4 space-y-2.5 min-h-0">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Manual scripture search</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  ref={searchInputRef}
                  type="text"
                  placeholder="e.g. John 3:16 or Psalm 23"
                  className="pr-8"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                />
                <Search size={14} className="absolute right-3 top-2.5 text-slate-500" />
              </div>
              <Button
                onClick={handleManualSearch}
                className="shrink-0"
              >
                Go
              </Button>
            </div>
            <p className="text-[10px] leading-relaxed text-slate-600">
              Explicit references appear instantly. Quoted verses are matched from the rolling transcript.
            </p>
          </div>

          {/* Compact pipeline controls */}
          <div className="shrink-0 border-t border-surface-border bg-surface-secondary/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">Pipeline controls</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {isTranscribing ? 'Listening and detecting scripture' : 'Audio capture is stopped'}
                </p>
              </div>
              <span className={cn('size-2 shrink-0 rounded-full', isTranscribing ? 'bg-emerald-500' : 'bg-muted-foreground/40')} aria-hidden="true" />
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Button
                variant={isTranscribing ? 'secondary' : 'default'}
                onClick={handleTogglePipeline}
              >
                {isTranscribing ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
                {isTranscribing ? 'Pause' : 'Start pipeline'}
              </Button>
              <Button
                variant="destructive"
                onClick={handleClearProjection}
                disabled={!activeProjection}
                title="Clear the current ProPresenter output"
              >
                <Trash2 data-icon="inline-start" />
                Clear output
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
