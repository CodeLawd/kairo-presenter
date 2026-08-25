import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Server,
  Mic,
  Key,
  BookOpen,
  SlidersHorizontal,
  Eye,
  EyeOff,
  Save,
  CheckCircle,
  XCircle,
  Loader,
  Wifi,
  Volume2,
  RefreshCw,
  Sun,
  Moon,
  AlertCircle,
  ChevronRight,
  MonitorPlay,
  Send,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { useAppStore } from '@/stores/useAppStore'
import { applyAppTheme } from '@/lib/appTheme'
import { DEFAULT_OVERLAY_SETTINGS, normalizeOverlaySettings } from '@shared/overlay-defaults'
import type { AppSettings, AudioDevice, AudioLevel, ScriptureTranslation, ScriptureTranslationOption } from '@shared/ipc'
import { OfflineBibleManager } from './OfflineBibleManager'
import { DEFAULT_SETTINGS } from '@/lib/defaultSettings'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'

// ─── Types ────────────────────────────────────────────────────────────────────

type Section = 'propresenter' | 'audio' | 'apikeys' | 'scripture' | 'overlay' | 'general'
type TestStatus = 'idle' | 'testing' | 'ok' | 'fail'

type UpdateFn = <K extends keyof AppSettings>(section: K, partial: Partial<AppSettings[K]>) => void

// ─── Constants ────────────────────────────────────────────────────────────────

const SECTION_NAV: { id: Section; label: string; hint: string; icon: LucideIcon }[] = [
  { id: 'propresenter', label: 'ProPresenter', hint: 'Connection & API', icon: Server },
  { id: 'audio', label: 'Audio', hint: 'Input device & levels', icon: Mic },
  { id: 'apikeys', label: 'API Keys', hint: 'Deepgram, Claude, Bible, Brave', icon: Key },
  { id: 'scripture', label: 'Scripture', hint: 'Detection & display', icon: BookOpen },
  { id: 'overlay', label: 'Overlay', hint: 'Message template & styling', icon: MonitorPlay },
  { id: 'general', label: 'General', hint: 'Theme, fonts & lyrics color', icon: SlidersHorizontal },
]


// ─── Helper: Settings group (no heavy bezel frames) ───────────────────────────

function SettingsGroup({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  return (
    <div className={cn('space-y-5', className)}>
      {children}
    </div>
  )
}

function SettingsDivider(): React.ReactElement {
  return <div className="border-t border-surface-border/40" />
}

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <Switch
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
    />
  )
}

// ─── Helper: Level meter ──────────────────────────────────────────────────────

function LevelMeter({ level, active }: { level: AudioLevel | null; active: boolean }) {
  const SEGMENTS = 32
  const rms = active ? (level?.rms ?? 0) : 0
  const peak = active ? (level?.peak ?? 0) : 0

  return (
    <div className="relative">
      <div className="flex gap-px h-3.5">
        {Array.from({ length: SEGMENTS }).map((_, i) => {
          const threshold = (i + 1) / SEGMENTS
          const lit = rms >= threshold
          const isRed = i >= 28
          const isYellow = i >= 24 && i < 28

          return (
            <div
              key={i}
              className={cn(
                'flex-1 rounded-[1px]',
                lit
                  ? isRed
                    ? 'bg-red-500'
                    : isYellow
                    ? 'bg-yellow-400'
                    : 'bg-teal-500'
                  : 'bg-surface-border/50'
              )}
              style={{ transitionDuration: lit ? '40ms' : '300ms', transitionProperty: 'background-color' }}
            />
          )
        })}
      </div>
      {active && peak > 0.04 && (
        <div
          className="absolute top-0 w-px h-3.5 bg-white/40 rounded-full"
          style={{ left: `${Math.min(peak * 100, 99)}%`, transform: 'translateX(-50%)' }}
        />
      )}
    </div>
  )
}

// ─── Helper: Status badge ─────────────────────────────────────────────────────

function StatusBadge({
  status,
  msg,
}: {
  status: TestStatus
  msg?: string
}) {
  if (status === 'idle') return null

  const map: Record<Exclude<TestStatus, 'idle'>, { icon: React.ReactNode; cls: string; fallback: string }> = {
    testing: { icon: <Loader size={11} className="animate-spin" />, cls: 'text-yellow-400', fallback: 'Testing…' },
    ok: { icon: <CheckCircle size={11} />, cls: 'text-teal-400', fallback: 'Valid' },
    fail: { icon: <XCircle size={11} />, cls: 'text-red-400', fallback: 'Failed' },
  }
  const { icon, cls, fallback } = map[status as Exclude<TestStatus, 'idle'>]

  return (
    <span className={cn('flex items-center gap-1.5 text-xs font-semibold', cls)}>
      {icon}
      <span className="truncate max-w-32">{msg || fallback}</span>
    </span>
  )
}

// ─── Helper: Connection dot ───────────────────────────────────────────────────

function ConnectionDot({ status }: { status: TestStatus }) {
  const map: Record<TestStatus, string> = {
    idle: 'bg-slate-600',
    testing: 'bg-yellow-500 animate-pulse shadow-glow-yellow/30',
    ok: 'bg-teal-400 shadow-glow-teal/40',
    fail: 'bg-red-500 shadow-glow-red/30',
  }
  return <span className={cn('inline-block w-2.5 h-2.5 rounded-full shrink-0 transition-all duration-300', map[status])} />
}

// ─── Helper: Save bar ─────────────────────────────────────────────────────────

function SaveBar({
  sectionId,
  savedSection,
  onSave,
}: {
  sectionId: string
  savedSection: string | null
  onSave: () => void
}) {
  const saved = savedSection === sectionId
  return (
    <div className="flex items-center gap-3 pt-5 mt-1 border-t border-surface-border/50">
      <button
        className={cn(
          'btn-primary flex items-center gap-2 px-5 py-2.5 justify-center font-semibold transition-all duration-200',
          saved && 'bg-teal-600 border-teal-500/35 text-white hover:bg-teal-600 shadow-glow-teal/10'
        )}
        onClick={onSave}
      >
        {saved ? <CheckCircle size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
        {saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  )
}

// ─── Section: ProPresenter Connection ────────────────────────────────────────

function ConnectionSection({
  settings,
  update,
  onSave,
  savedSection,
}: {
  settings: AppSettings
  update: UpdateFn
  onSave: () => void
  savedSection: string | null
}) {
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMsg, setTestMsg] = useState('')
  const pp = settings.propresenter

  const testConnection = async () => {
    setTestStatus('testing')
    setTestMsg('Connecting…')
    try {
      await window.api.propresenter.connect({ host: pp.host, port: pp.port, password: pp.password })
      await new Promise((r) => setTimeout(r, 2000))
      const s = await window.api.propresenter.getStatus()
      if (s.state === 'connected') {
        setTestStatus('ok')
        setTestMsg(`Connected · ${s.host}:${s.port}`)
      } else if (s.state === 'connecting') {
        setTestStatus('fail')
        setTestMsg('Timed out — check IP and port')
      } else {
        setTestStatus('fail')
        setTestMsg(`State: ${s.state}`)
      }
    } catch (err) {
      setTestStatus('fail')
      setTestMsg(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  return (
    <div className="space-y-6">
      <SettingsGroup>
          {/* Status bar */}
          <div className="flex items-center gap-3 p-3.5 rounded-xl bg-surface-secondary/40">
            <ConnectionDot status={testStatus} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-300 leading-none">
                {testStatus === 'idle' && 'Not tested'}
                {testStatus === 'testing' && 'Connecting…'}
                {testStatus === 'ok' && 'Connected'}
                {testStatus === 'fail' && 'Connection failed'}
              </p>
              {testMsg && (
                <p className="text-[10px] text-slate-500 mt-1 truncate">{testMsg}</p>
              )}
            </div>
            <button
              className="btn-secondary flex items-center gap-1.5 py-1.5 px-3 text-xs shrink-0 font-semibold"
              onClick={testConnection}
              disabled={testStatus === 'testing'}
            >
              {testStatus === 'testing' ? (
                <Loader size={12} className="animate-spin" aria-hidden="true" />
              ) : (
                <Wifi size={12} aria-hidden="true" />
              )}
              {testStatus === 'testing' ? 'Testing…' : 'Test Connection'}
            </button>
          </div>

          {/* IP + Port */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="label">IP Address</label>
              <input
                className="input font-mono"
                value={pp.host}
                onChange={(e) => update('propresenter', { host: e.target.value })}
                placeholder="192.168.1.100"
                spellCheck={false}
                name="pp-host"
                aria-label="ProPresenter IP Address"
              />
            </div>
            <div>
              <label className="label">Port</label>
              <input
                className="input font-mono text-center"
                type="number"
                value={pp.port}
                onChange={(e) => update('propresenter', { port: parseInt(e.target.value) || 50000 })}
                min={1}
                max={65535}
                name="pp-port"
                aria-label="ProPresenter Port"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="label">Stage Display Password</label>
            <input
              className="input"
              type="password"
              value={pp.password}
              onChange={(e) => update('propresenter', { password: e.target.value })}
              placeholder="Leave blank if no password is set"
              autoComplete="off"
              name="pp-password"
              aria-label="Stage Display Password"
            />
            <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
              Configure this in ProPresenter → Preferences → Stage Display. Leave blank if unused.
            </p>
          </div>
      </SettingsGroup>

      <SaveBar sectionId="propresenter" savedSection={savedSection} onSave={onSave} />
    </div>
  )
}

// ─── Section: Audio Configuration ────────────────────────────────────────────

function AudioSection({
  settings,
  update,
  onSave,
  savedSection,
}: {
  settings: AppSettings
  update: UpdateFn
  onSave: () => void
  savedSection: string | null
}) {
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [devicesLoading, setDevicesLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [testTimeLeft, setTestTimeLeft] = useState(5)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [localLevel, setLocalLevel] = useState<import('@shared/ipc').AudioLevel | null>(null)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)

  // Enumerate devices using Web Audio API — works natively in Electron renderer
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((all) => {
      const inputs = all
        .filter((d) => d.kind === 'audioinput')
        .map((d, idx) => ({
          id: d.deviceId || `device-${idx}`,
          label: d.label || `Microphone ${idx + 1}`,
          kind: 'audioinput' as const,
          isDefault: d.deviceId === 'default' || idx === 0,
        }))
      if (inputs.length > 0) {
        setDevices(inputs)
      } else {
        // Fall back to main process enumeration if Web API returns nothing
        window.api.audio.getDevices().then((ipcDevices) => setDevices(ipcDevices))
      }
      setDevicesLoading(false)
    }).catch(() => {
      window.api.audio.getDevices().then((ipcDevices) => {
        setDevices(ipcDevices)
        setDevicesLoading(false)
      })
    })
  }, [])

  const stopTest = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    processorRef.current?.disconnect()
    processorRef.current = null
    ctxRef.current?.close()
    ctxRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setTesting(false)
    setTestTimeLeft(5)
    setLocalLevel(null)
  }

  useEffect(() => () => stopTest(), [])

  const startTest = async () => {
    setCaptureError(null)
    setTesting(true)
    setTestTimeLeft(5)

    try {
      const selectedId = settings.audio.deviceId || devices[0]?.id
      const constraints: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
      if (selectedId && selectedId !== 'default') {
        constraints.deviceId = { exact: selectedId }
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
      streamRef.current = stream

      const ctx = new AudioContext()
      ctxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      // eslint-disable-next-line deprecation/deprecation
      const processor = ctx.createScriptProcessor(2048, 1, 1)
      processorRef.current = processor

      let peak = 0
      processor.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0)
        let sum = 0
        let chunkPeak = 0
        for (let i = 0; i < data.length; i++) {
          sum += data[i] * data[i]
          const abs = Math.abs(data[i])
          if (abs > chunkPeak) chunkPeak = abs
        }
        const rms = Math.sqrt(sum / data.length)
        peak = Math.max(chunkPeak, peak * 0.94)
        setLocalLevel({ rms, peak, clipping: peak > 0.99, timestamp: Date.now() })
      }

      source.connect(processor)
      processor.connect(ctx.destination)

      timerRef.current = setInterval(() => {
        setTestTimeLeft((t) => {
          if (t <= 1) {
            stopTest()
            return 5
          }
          return t - 1
        })
      }, 1000)
    } catch (err) {
      setCaptureError((err as Error).message)
      setTesting(false)
    }
  }

  const displayLevel = localLevel

  return (
    <div className="space-y-6">
      <SettingsGroup>
          {/* Device selector */}
          <div>
            <label className="label">Audio Input Device</label>
            {devicesLoading ? (
              <div className="input flex items-center gap-2 text-slate-500 cursor-default">
                <Loader size={13} className="animate-spin shrink-0" aria-hidden="true" />
                <span>Enumerating devices…</span>
              </div>
            ) : devices.length === 0 ? (
              <div className="flex items-center gap-2.5 text-xs text-yellow-400 border border-yellow-500/15 bg-yellow-500/5 px-3 py-2.5 rounded-lg">
                <AlertCircle size={14} className="text-yellow-400 shrink-0" aria-hidden="true" />
                <span>No audio inputs detected. Grant microphone permission and re-open settings.</span>
              </div>
            ) : (
              <select
                className="input"
                value={settings.audio.deviceId || devices[0]?.id}
                onChange={(e) => update('audio', { deviceId: e.target.value })}
                aria-label="Select audio input device"
              >
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.isDefault ? `${d.label} (Default)` : d.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Level meter */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Input Level</label>
              <div className="flex items-center gap-2">
                {testing && displayLevel && (
                  <span className="text-[10px] font-bold font-mono text-slate-500 tabular-nums">
                    {(displayLevel.rms * 100).toFixed(0)}%
                    {displayLevel.clipping && (
                      <span className="text-red-400 ml-1.5 font-bold text-[9px] uppercase tracking-wider">
                        Clip
                      </span>
                    )}
                  </span>
                )}
                <Volume2
                  size={13}
                  className={testing ? 'text-teal-400' : 'text-slate-600'}
                  aria-hidden="true"
                />
              </div>
            </div>
            <div className="bg-surface-secondary/50 p-4 rounded-lg space-y-2">
              <LevelMeter level={displayLevel} active={testing} />
              {!testing && (
                <p className="text-center text-[10px] text-slate-500 font-medium">
                  Start test capture to see live input levels
                </p>
              )}
              {testing && (
                <p className="text-center text-[10px] text-teal-400 font-semibold">
                  Listening… {testTimeLeft}s remaining
                </p>
              )}
            </div>
          </div>

          {captureError && (
            <div className="flex items-start gap-2.5 text-xs text-red-400 border border-red-500/15 bg-red-500/5 px-3 py-2.5 rounded-lg">
              <AlertCircle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>{captureError}</span>
            </div>
          )}

          {/* Test button */}
          <div className="flex items-center gap-3">
            <button
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold border transition-all',
                testing
                  ? 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
                  : 'btn-secondary',
                devices.length === 0 ? 'opacity-40 cursor-not-allowed' : ''
              )}
              onClick={testing ? stopTest : startTest}
              disabled={devices.length === 0}
              aria-label={testing ? `Stop audio test capture, ${testTimeLeft} seconds remaining` : 'Start 5 second audio capture test'}
            >
              <Mic size={13} aria-hidden="true" />
              {testing ? `Stop Test (${testTimeLeft}s)` : 'Start 5s Capture Test'}
            </button>
            {testing && (
              <span className="flex items-center gap-1.5 text-xs text-teal-400 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse shadow-glow-teal/50" aria-hidden="true" />
                Capturing
              </span>
            )}
          </div>
      </SettingsGroup>

      <SaveBar sectionId="audio" savedSection={savedSection} onSave={onSave} />
    </div>
  )
}

// ─── Section: API Keys ────────────────────────────────────────────────────────

function ApiKeysSection({
  settings,
  update,
  onSave,
  savedSection,
}: {
  settings: AppSettings
  update: UpdateFn
  onSave: () => void
  savedSection: string | null
}) {
  const [show, setShow] = useState({ deepgram: false, anthropic: false, deepseek: false })
  const [deepgramStatus, setDeepgramStatus] = useState<TestStatus>('idle')
  const [deepgramMsg, setDeepgramMsg] = useState('')
  const [anthropicStatus, setAnthropicStatus] = useState<TestStatus>('idle')
  const [anthropicMsg, setAnthropicMsg] = useState('')
  const [bibleStatus, setBibleStatus] = useState<TestStatus>('idle')
  const [bibleMsg, setBibleMsg] = useState('')

  const testDeepgram = async () => {
    const key = settings.stt.apiKey
    if (!key) { setDeepgramStatus('fail'); setDeepgramMsg('No key entered'); return }
    setDeepgramStatus('testing')
    setDeepgramMsg('')
    try {
      const res = await fetch('https://api.deepgram.com/v1/projects', {
        headers: { Authorization: `Token ${key}` },
      })
      if (res.ok) {
        setDeepgramStatus('ok')
        setDeepgramMsg('Key valid')
      } else if (res.status === 401) {
        setDeepgramStatus('fail')
        setDeepgramMsg('Unauthorized — invalid key')
      } else {
        setDeepgramStatus('fail')
        setDeepgramMsg(`HTTP ${res.status}`)
      }
    } catch {
      // Network blocked (CSP or CORS) — fall back to format check
      const valid = key.length >= 20 && !/\s/.test(key)
      setDeepgramStatus(valid ? 'ok' : 'fail')
      setDeepgramMsg(valid ? 'Format valid (network check blocked)' : 'Key format invalid')
    }
  }

  const testAnthropic = async () => {
    const key = settings.stt.anthropicApiKey
    if (!key) { setAnthropicStatus('fail'); setAnthropicMsg('No key entered'); return }
    setAnthropicStatus('testing')
    setAnthropicMsg('')
    if (!key.startsWith('sk-ant-') || key.length < 30) {
      setAnthropicStatus('fail')
      setAnthropicMsg('Must start with sk-ant-')
      return
    }
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      })
      if (res.ok || res.status === 200) {
        setAnthropicStatus('ok')
        setAnthropicMsg('Key valid')
      } else if (res.status === 401) {
        setAnthropicStatus('fail')
        setAnthropicMsg('Unauthorized — check key')
      } else {
        // 403, 429, 500 etc — key reached the API
        setAnthropicStatus('ok')
        setAnthropicMsg(`Accepted (HTTP ${res.status})`)
      }
    } catch {
      setAnthropicStatus('ok')
      setAnthropicMsg('Format valid (network check blocked)')
    }
  }

  const testBible = async () => {
    const key = settings.stt.bibleApiKey
    if (!key) { setBibleStatus('fail'); setBibleMsg('No key entered'); return }
    setBibleStatus('testing')
    setBibleMsg('')
    try {
      const translations = await window.api.scripture.getTranslations(key)
      const available = translations.filter((item) => item.available)
      // Publish the fresh result so Scripture stops treating the key as unknown.
      const store = useBootstrapStore.getState()
      store.setTranslations(translations)
      store.setApiBibleAuth('authorized')
      setBibleStatus('ok')
      setBibleMsg(`${available.length} translations available`)
    } catch (error) {
      useBootstrapStore.getState().setApiBibleAuth('unauthorized')
      setBibleStatus('fail')
      setBibleMsg(error instanceof Error ? error.message : 'Unable to validate key')
    }
  }

  return (
    <div className="space-y-6">
      <SettingsGroup>
          {/* Deepgram */}
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-bold text-white tracking-tight">Deepgram API Key</p>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                  Real-time speech-to-text transcription (Nova-2 model)
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={deepgramStatus} msg={deepgramMsg} />
                <button
                  className="btn-secondary py-1 px-2.5 text-xs font-semibold"
                  onClick={testDeepgram}
                  disabled={deepgramStatus === 'testing'}
                  aria-label="Test Deepgram API Key"
                >
                  {deepgramStatus === 'testing' ? (
                    <Loader size={11} className="animate-spin" aria-hidden="true" />
                  ) : (
                    'Test'
                  )}
                </button>
              </div>
            </div>
            <div className="relative">
              <input
                type={show.deepgram ? 'text' : 'password'}
                value={settings.stt.apiKey}
                onChange={(e) => update('stt', { apiKey: e.target.value })}
                placeholder="Token xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="input font-mono text-sm pr-10"
                autoComplete="off"
                spellCheck={false}
                aria-label="Deepgram API Token"
                name="deepgram-key"
              />
              <button
                type="button"
                onClick={() => setShow((p) => ({ ...p, deepgram: !p.deepgram }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:text-slate-200"
                aria-label={show.deepgram ? "Hide Deepgram Key" : "Show Deepgram Key"}
              >
                {show.deepgram ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
              </button>
            </div>
          </div>

          <div className="border-t border-surface-border/50" />

          {/* Scripture Detection LLM */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-bold text-white tracking-tight">Scripture Detection LLM</p>
              <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                Identifies scripture references from sermon transcript context
              </p>
            </div>
            {/* Provider toggle */}
            <div className="flex items-center gap-2">
              {(['anthropic', 'deepseek'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => update('stt', { llmProvider: p })}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-bold border transition-all',
                    settings.stt.llmProvider === p
                      ? 'bg-teal-500/15 border-teal-500/40 text-teal-300'
                      : 'btn-secondary'
                  )}
                >
                  {p === 'anthropic' ? 'Claude (Anthropic)' : 'DeepSeek'}
                </button>
              ))}
            </div>

            {settings.stt.llmProvider === 'anthropic' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Anthropic API Key</span>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={anthropicStatus} msg={anthropicMsg} />
                    <button className="btn-secondary py-1 px-2.5 text-xs font-semibold" onClick={testAnthropic} disabled={anthropicStatus === 'testing'} aria-label="Test Anthropic API Key">
                      {anthropicStatus === 'testing' ? <Loader size={11} className="animate-spin" aria-hidden="true" /> : 'Test'}
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <input
                    type={show.anthropic ? 'text' : 'password'}
                    value={settings.stt.anthropicApiKey}
                    onChange={(e) => update('stt', { anthropicApiKey: e.target.value })}
                    placeholder="sk-ant-api03-xxxxxxxxxxxxxxxxxx"
                    className="input font-mono text-sm pr-10"
                    autoComplete="off" spellCheck={false}
                    aria-label="Anthropic API Key" name="anthropic-key"
                  />
                  <button type="button" onClick={() => setShow((p) => ({ ...p, anthropic: !p.anthropic }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 transition-colors focus-visible:outline-none" aria-label={show.anthropic ? 'Hide key' : 'Show key'}>
                    {show.anthropic ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                  </button>
                </div>
              </div>
            )}

            {settings.stt.llmProvider === 'deepseek' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">DeepSeek API Key</span>
                  <span className="text-[10px] text-slate-500">model: deepseek-v4-flash</span>
                </div>
                <div className="relative">
                  <input
                    type={show.deepseek ? 'text' : 'password'}
                    value={settings.stt.deepseekApiKey}
                    onChange={(e) => update('stt', { deepseekApiKey: e.target.value })}
                    placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="input font-mono text-sm pr-10"
                    autoComplete="off" spellCheck={false}
                    aria-label="DeepSeek API Key" name="deepseek-key"
                  />
                  <button type="button" onClick={() => setShow((p) => ({ ...p, deepseek: !p.deepseek }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 transition-colors focus-visible:outline-none" aria-label={show.deepseek ? 'Hide key' : 'Show key'}>
                    {show.deepseek ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-surface-border/50" />

          {/* Bible API */}
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                  Bible API Key
                  <span className="text-[9px] font-bold text-slate-400 bg-surface-secondary border border-surface-border/50 px-1.5 py-0.5 rounded uppercase tracking-wider">
                    optional
                  </span>
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                  scripture.api.bible — verse lookup. Falls back to public KJV/WEB if omitted.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={bibleStatus} msg={bibleMsg} />
                <button
                  className="btn-secondary py-1 px-2.5 text-xs font-semibold"
                  onClick={testBible}
                  disabled={bibleStatus === 'testing'}
                  aria-label="Test Bible API Key"
                >
                  {bibleStatus === 'testing' ? (
                    <Loader size={11} className="animate-spin" aria-hidden="true" />
                  ) : (
                    'Test'
                  )}
                </button>
              </div>
            </div>
            <input
              type="text"
              value={settings.stt.bibleApiKey || ''}
              onChange={(e) => update('stt', { bibleApiKey: e.target.value })}
              placeholder="api.bible API key (optional)"
              className="input font-mono text-sm"
              autoComplete="off"
              spellCheck={false}
              aria-label="Bible API Key"
              name="bible-key"
            />
          </div>

          <div className="border-t border-surface-border/50" />

          {/* Brave Search API — lyric snippet lookup */}
          <div className="space-y-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                Brave Search API Key
                <span className="text-[9px] font-bold text-slate-400 bg-surface-secondary border border-surface-border/50 px-1.5 py-0.5 rounded uppercase tracking-wider">
                  optional
                </span>
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                Optional upgrade for online lyrics search. Without it, the app still
                searches the web for gospel songs Genius/LRCLIB miss. A key makes
                those lookups a bit more reliable.
              </p>
            </div>
            <input
              type="text"
              value={settings.lyrics?.braveApiKey || ''}
              onChange={(e) => update('lyrics', { braveApiKey: e.target.value })}
              placeholder="Brave Search API key (optional)"
              className="input font-mono text-sm"
              autoComplete="off"
              spellCheck={false}
              aria-label="Brave Search API Key"
              name="brave-key"
            />
          </div>

          <div className="border-t border-surface-border/50" />

          {/* Google Translate — bilingual lyric glosses */}
          <div className="space-y-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                Google Translate API Key
                <span className="text-[9px] font-bold text-slate-400 bg-surface-secondary border border-surface-border/50 px-1.5 py-0.5 rounded uppercase tracking-wider">
                  optional
                </span>
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                Cloud Translation API key for bilingual lyrics. Keeps the original
                language and adds an English gloss in parentheses under each line.
              </p>
            </div>
            <input
              type="text"
              value={settings.lyrics?.googleTranslateApiKey || ''}
              onChange={(e) => update('lyrics', { googleTranslateApiKey: e.target.value })}
              placeholder="Google Translate API key (optional)"
              className="input font-mono text-sm"
              autoComplete="off"
              spellCheck={false}
              aria-label="Google Translate API Key"
              name="google-translate-key"
            />
          </div>
      </SettingsGroup>

      <SaveBar sectionId="apikeys" savedSection={savedSection} onSave={onSave} />
    </div>
  )
}

// ─── Section: Scripture Settings ──────────────────────────────────────────────

function ScriptureSection({
  settings,
  update,
  onSave,
  savedSection,
}: {
  settings: AppSettings
  update: UpdateFn
  onSave: () => void
  savedSection: string | null
}) {
  const sc = settings.scripture
  // Availability comes from the shared snapshot, refreshed in the background
  // once the saved API.Bible key has been validated.
  const translations = useBootstrapStore((state) => state.translations)
  const translationsLoading = useBootstrapStore((state) => state.apiBibleAuth === 'checking')

  return (
    <div className="space-y-6">
      <SettingsGroup>
          {/* Default translation */}
          <div>
            <label className="label">Default Bible Translation</label>
            <select
              className="input"
              value={sc.defaultTranslation}
              onChange={(e) =>
                update('scripture', { defaultTranslation: e.target.value as ScriptureTranslation })
              }
              aria-label="Default bible translation"
            >
              {translations.map((translation) => (
                <option key={translation.id} value={translation.id} disabled={!translation.available}>
                  {translation.id} — {translation.name}{translation.available ? '' : ' (not available)'}
                </option>
              ))}
            </select>
            <p className="mt-2 text-[10px] text-slate-500">
              {translationsLoading
                ? 'Checking available Bible translations…'
                : 'Local translations are always available. API translations reflect the Bibles enabled for your saved API.Bible key.'}
            </p>
          </div>

          <div className="border-t border-surface-border/50" />

          {/* Offline API.Bible cache */}
          <OfflineBibleManager />

          <div className="border-t border-surface-border/50" />

          {/* Show verse numbers */}
          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm font-bold text-white tracking-tight">Show Verse Numbers</p>
              <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                Include verse numbers in ProPresenter slide output
              </p>
            </div>
            <Toggle
              checked={sc.showVerseNumbers}
              onChange={(v) => update('scripture', { showVerseNumbers: v })}
            />
          </div>

          <div className="border-t border-surface-border/50" />

          {/* Auto-detection */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-white tracking-tight">Auto-Detection Mode</p>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                  Detect scripture references in live transcript and suggest them for display
                </p>
              </div>
              <Toggle
                checked={sc.autoMode}
                onChange={(v) => update('scripture', { autoMode: v })}
              />
            </div>

            {/* Sub-settings gated on autoMode */}
            <div
              className={cn(
                'space-y-4 transition-all duration-300 ease-out-expo',
                sc.autoMode ? 'opacity-100' : 'opacity-30 pointer-events-none'
              )}
            >
              <div className="border-t border-surface-border/50" />

              {/* Confidence threshold */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Confidence Threshold</label>
                  <span className="text-xs font-bold font-mono text-teal-400 tabular-nums">
                    {sc.confidenceThreshold.toFixed(2)}
                  </span>
                </div>
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={[sc.confidenceThreshold]}
                  onValueChange={(next) => update('scripture', { confidenceThreshold: next[0] })}
                  aria-label="Confidence threshold range slider"
                />
                <div className="flex justify-between text-[9px] font-bold text-slate-600 mt-2 font-sans tracking-wide uppercase">
                  <span>0.0 — Permissive</span>
                  <span>1.0 — Strict</span>
                </div>
                <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
                  Recommended: 0.70–0.85 for sermon environments
                </p>
              </div>

              {/* Debounce + Context window */}
              <div className="grid grid-cols-2 gap-4 pt-1">
                <div>
                  <label className="label">Detection Debounce</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={sc.debounceInterval}
                      onChange={(e) =>
                        update('scripture', {
                          debounceInterval: Math.max(1, parseInt(e.target.value) || 8),
                        })
                      }
                      className="input w-20 font-mono text-center"
                      aria-label="Detection debounce duration in seconds"
                    />
                    <span className="text-xs text-slate-400 font-bold shrink-0">sec</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
                    Minimum gap between consecutive auto-suggestions
                  </p>
                </div>
                <div>
                  <label className="label">Context Window</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={10}
                      max={300}
                      value={sc.contextWindowSize}
                      onChange={(e) =>
                        update('scripture', {
                          contextWindowSize: Math.max(10, parseInt(e.target.value) || 90),
                        })
                      }
                      className="input w-20 font-mono text-center"
                      aria-label="Context window size in seconds"
                    />
                    <span className="text-xs text-slate-400 font-bold shrink-0">sec</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
                    Rolling transcript window sent to Claude for analysis
                  </p>
                </div>
              </div>
            </div>
          </div>
      </SettingsGroup>

      <SaveBar sectionId="scripture" savedSection={savedSection} onSave={onSave} />
    </div>
  )
}

// ─── Section: Overlay ─────────────────────────────────────────────────────────

const OVERLAY_SAMPLE = {
  reference: 'John 3:16',
  translation: 'KJV' as ScriptureTranslation,
  text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
}

function renderOverlayPreview(template: string, showTranslation: boolean): string {
  const reference = showTranslation
    ? `${OVERLAY_SAMPLE.reference} (${OVERLAY_SAMPLE.translation})`
    : OVERLAY_SAMPLE.reference
  return template
    .replaceAll('{Reference}', reference)
    .replaceAll('{Text}', OVERLAY_SAMPLE.text)
}

function OverlaySection({
  settings,
  update,
  onSave,
  savedSection,
}: {
  settings: AppSettings
  update: UpdateFn
  onSave: () => void
  savedSection: string | null
}) {
  const ov = settings.overlay
  const ppState = useAppStore((s) => s.ppState)
  const ppConnected = ppState === 'connected'

  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMsg, setTestMsg] = useState('')

  const missingTextToken = !ov.template.includes('{Text}')

  const handleSendTest = async () => {
    setTestStatus('testing')
    setTestMsg('Sending…')
    try {
      const ok = await window.api.propresenter.testOverlay()
      setTestStatus(ok ? 'ok' : 'fail')
      setTestMsg(ok ? 'Sent to ProPresenter' : 'Push failed — check logs')
    } catch (err) {
      setTestStatus('fail')
      setTestMsg(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const handleClear = async () => {
    setTestStatus('testing')
    setTestMsg('Clearing…')
    try {
      const ok = await window.api.propresenter.clearOverlay()
      setTestStatus(ok ? 'ok' : 'fail')
      setTestMsg(ok ? 'Cleared' : 'Clear failed — check logs')
    } catch (err) {
      setTestStatus('fail')
      setTestMsg(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  return (
    <div className="space-y-6">
      <SettingsGroup>
          {/* Template editor */}
          <div>
            <label className="label">Message Template</label>
            <textarea
              value={ov.template}
              onChange={(e) => update('overlay', { template: e.target.value })}
              rows={3}
              className="input font-mono resize-none"
              aria-label="ProPresenter message template"
              aria-invalid={missingTextToken}
            />
            <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
              Available tokens: <span className="font-mono text-slate-400">{'{Reference}'}</span>{' '}
              and <span className="font-mono text-slate-400">{'{Text}'}</span>. This is pushed to
              the "ProAutomate Scripture" message in ProPresenter — it does not control fonts,
              color, or position (see theme setup below).
            </p>
            {missingTextToken && (
              <p className="flex items-center gap-1.5 text-[10px] text-yellow-400 mt-2">
                <AlertCircle size={11} className="shrink-0" aria-hidden="true" />
                Template does not contain {'{Text}'} — the verse text will not be shown.
              </p>
            )}
          </div>

          <div className="border-t border-surface-border/50" />

          {/* Toggles */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-white tracking-tight">Show Translation</p>
              <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                Append the translation abbreviation to the reference: "John 3:16 (KJV)"
              </p>
            </div>
            <Toggle
              checked={ov.showTranslation}
              onChange={(v) => update('overlay', { showTranslation: v })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-white tracking-tight">Show Verse Numbers</p>
              <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                Include verse numbers when pushing multi-verse passages
              </p>
            </div>
            <Toggle
              checked={ov.showVerseNumbers}
              onChange={(v) => update('overlay', { showVerseNumbers: v })}
            />
          </div>

          <div className="border-t border-surface-border/50" />

          {/* Numeric settings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Max Verses Per Push</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={ov.maxVerses}
                  onChange={(e) =>
                    update('overlay', { maxVerses: Math.max(0, parseInt(e.target.value) || 0) })
                  }
                  className="input w-20 font-mono text-center"
                  aria-label="Maximum verses per overlay push"
                />
                <span className="text-xs text-slate-400 font-bold shrink-0">0 = all</span>
              </div>
            </div>
            <div>
              <label className="label">Auto-Clear</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={600}
                  value={ov.autoClearSec}
                  onChange={(e) =>
                    update('overlay', { autoClearSec: Math.max(0, parseInt(e.target.value) || 0) })
                  }
                  className="input w-20 font-mono text-center"
                  aria-label="Auto-clear overlay after N seconds"
                />
                <span className="text-xs text-slate-400 font-bold shrink-0">sec · 0 = manual</span>
              </div>
            </div>
          </div>

          <div className="border-t border-surface-border/50" />

          {/* Approximate preview */}
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-sans mb-2">
              Approximate preview
            </p>
            <div className="relative w-full aspect-video rounded-lg bg-black/90 flex items-center justify-center overflow-hidden px-6">
              <p className="text-white text-center whitespace-pre-line leading-snug text-pretty font-medium">
                {renderOverlayPreview(ov.template, ov.showTranslation)}
              </p>
            </div>
            <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
              Approximate preview only — actual look (font, size, color, position) is controlled
              by the ProPresenter message theme, not by ProAutomate.
            </p>
          </div>

          <div className="border-t border-surface-border/50" />

          {/* Live test buttons */}
          <div>
            <div className="flex items-center gap-3">
              <button
                className="btn-primary flex items-center gap-2"
                onClick={handleSendTest}
                disabled={!ppConnected || testStatus === 'testing'}
              >
                <Send size={14} aria-hidden="true" />
                Send test verse
              </button>
              <button
                className="btn-secondary flex items-center gap-2"
                onClick={handleClear}
                disabled={!ppConnected || testStatus === 'testing'}
              >
                <Trash2 size={14} aria-hidden="true" />
                Clear
              </button>
              <StatusBadge status={testStatus} msg={testMsg} />
            </div>
            {!ppConnected && (
              <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
                Connect to ProPresenter (Settings → ProPresenter) to test the overlay live.
              </p>
            )}
          </div>
      </SettingsGroup>

      {/* Guided PP theme setup */}
      <SettingsGroup className="space-y-3">
          <div className="flex items-center gap-2.5">
            <MonitorPlay size={15} className="text-teal-400 shrink-0" aria-hidden="true" />
            <p className="text-sm font-bold text-white tracking-tight">
              One-time ProPresenter theme setup
            </p>
          </div>
          <ol className="space-y-2 text-xs text-slate-400 leading-relaxed list-decimal list-inside">
            <li>In ProPresenter, open the Messages panel (speech-bubble icon).</li>
            <li>
              Edit the message "ProAutomate Scripture" → Theme → Edit Theme (or create a new
              message theme).
            </li>
            <li>
              Use one full-width text box, ~48–60pt, lower-third or centered, with a dark backdrop
              box. Remove unused placeholder boxes.
            </li>
            <li>Click "Send test verse" above while styling to see your changes live.</li>
          </ol>
      </SettingsGroup>

      <SaveBar sectionId="overlay" savedSection={savedSection} onSave={onSave} />
    </div>
  )
}

// ─── Section: General ─────────────────────────────────────────────────────────

function GeneralSection({
  settings,
  update,
  onSave,
  savedSection,
}: {
  settings: AppSettings
  update: UpdateFn
  onSave: () => void
  savedSection: string | null
}) {
  const disp = settings.display
  const isDark = disp.theme === 'dark'

  return (
    <div className="space-y-6">
      <SettingsGroup>
          {/* Theme */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isDark ? (
                <Moon size={18} className="text-teal-400" aria-hidden="true" />
              ) : (
                <Sun size={18} className="text-yellow-400" aria-hidden="true" />
              )}
              <div>
                <p className="text-sm font-bold text-white tracking-tight">
                  {isDark ? 'Dark Mode' : 'Light Mode'}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                  {isDark
                    ? 'Optimised for dimly lit booth environments'
                    : 'High-contrast for bright rooms'}
                </p>
              </div>
            </div>
            <Toggle
              checked={isDark}
              onChange={(v) => update('display', { theme: v ? 'dark' : 'light' })}
            />
          </div>

          {!isDark && (
            <div
              className="flex items-start gap-2.5 text-xs text-yellow-400 bg-yellow-500/5 border border-yellow-500/15 rounded-lg px-3 py-2.5 shadow-glow-yellow/5 animate-slide-in"
              role="alert"
              aria-live="polite"
            >
              <AlertCircle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>Light mode may reduce readability during live production. Dark mode is recommended for booth operation.</span>
            </div>
          )}

          <SettingsDivider />

          {/* Font sizes — Theme-style compact sliders */}
          <div className="space-y-4 rounded-xl bg-surface-secondary/35 p-4">
            <h2 className="text-sm font-semibold tracking-tight text-white">Font sizes</h2>

            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] font-medium text-slate-400">UI</p>
                  <span className="text-xs font-bold font-mono text-teal-400 tabular-nums">
                    {disp.fontSize}px
                  </span>
                </div>
                <Slider
                  min={12}
                  max={24}
                  step={1}
                  value={[disp.fontSize]}
                  onValueChange={(next) => update('display', { fontSize: next[0] })}
                  aria-label="UI font size"
                />
                <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                  Base interface text size
                </p>
              </div>

              <div className="h-px bg-surface-border/40" />

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] font-medium text-slate-400">Transcription</p>
                  <span className="text-xs font-bold font-mono text-teal-400 tabular-nums">
                    {disp.transcriptionFontSize}px
                  </span>
                </div>
                <Slider
                  min={12}
                  max={48}
                  step={1}
                  value={[disp.transcriptionFontSize]}
                  onValueChange={(next) => update('display', { transcriptionFontSize: next[0] })}
                  aria-label="Transcription display size"
                />
                <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                  Live transcription view — larger for booth readability
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-surface/60 px-4 py-3.5">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                Preview
              </p>
              <p
                className="font-light leading-relaxed text-pretty text-white"
                style={{ fontSize: disp.transcriptionFontSize }}
              >
                “For God so loved the world that he gave his one and only Son…”
              </p>
            </div>
          </div>

          <SettingsDivider />

          {/* Lyrics gloss color */}
          <div className="space-y-3">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-sans">
              Lyrics
            </p>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white tracking-tight">Translation gloss color</p>
              <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                Lines in parentheses <span className="text-slate-400">(like English glosses)</span> use
                this color in the lyrics editor and slide preview. Default is a darker yellow.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={
                  /^#[0-9a-fA-F]{6}$/.test(settings.lyrics?.glossColor || '')
                    ? settings.lyrics.glossColor
                    : '#D4A017'
                }
                onChange={(e) => update('lyrics', { glossColor: e.target.value.toUpperCase() })}
                className="h-9 w-12 cursor-pointer rounded-md border border-surface-border/60 bg-transparent p-0.5"
                aria-label="Gloss color"
              />
              <input
                type="text"
                value={settings.lyrics?.glossColor || '#D4A017'}
                onChange={(e) => update('lyrics', { glossColor: e.target.value })}
                placeholder="#D4A017"
                className="input font-mono text-sm flex-1"
                aria-label="Gloss color hex"
              />
            </div>
            {/* Mini slide preview: original + gloss as on stage */}
            <div
              className="rounded-lg overflow-hidden"
              style={{
                background:
                  'radial-gradient(120% 80% at 50% 20%, #1a1f2e 0%, #0c0e14 55%, #07080c 100%)',
              }}
              aria-label="Gloss color slide preview"
            >
              <div className="px-5 py-6 text-center space-y-2.5">
                <p className="text-[15px] font-semibold text-white leading-snug tracking-tight">
                  Onye nke di ike n&apos;aka Ya
                </p>
                <p
                  className="text-[13px] font-medium italic leading-snug"
                  style={{
                    color: /^#[0-9a-fA-F]{6}$/.test(settings.lyrics?.glossColor || '')
                      ? settings.lyrics.glossColor
                      : '#D4A017',
                  }}
                >
                  (The arm of the Lord does great things)
                </p>
              </div>
              <p className="px-4 pb-3 text-[9px] text-slate-500 text-center uppercase tracking-wider font-sans">
                Slide preview
              </p>
            </div>
          </div>
      </SettingsGroup>

      <SaveBar sectionId="general" savedSection={savedSection} onSave={onSave} />
    </div>
  )
}

// ─── Main Settings export ─────────────────────────────────────────────────────

export default function Settings(): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<Section>('propresenter')
  const [savedSection, setSavedSection] = useState<string | null>(null)
  const [audioLevel, setAudioLevel] = useState<AudioLevel | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Settings arrive with the startup snapshot, so this modal opens populated.
  useEffect(() => {
    const stored = useBootstrapStore.getState().settings
    setSettings((prev) => ({
      propresenter: { ...prev.propresenter, ...stored.propresenter },
      audio: { ...prev.audio, ...stored.audio },
      stt: { ...prev.stt, ...stored.stt },
      scripture: { ...prev.scripture, ...stored.scripture },
      lyrics: { ...prev.lyrics, ...stored.lyrics },
      display: { ...prev.display, ...stored.display },
      overlay: normalizeOverlaySettings({ ...prev.overlay, ...stored.overlay }),
      themeLibrary: stored.themeLibrary ?? prev.themeLibrary,
    }))
    setLoading(false)
  }, [])

  // Every save publishes to the shared snapshot so other screens (and a later
  // remount of this one) never fall back to startup values.
  const publish = useCallback(<K extends keyof AppSettings>(section: K, value: AppSettings[K]) => {
    useBootstrapStore.getState().patchSettings(section, value)
  }, [])

  // Subscribe to audio level push events
  useEffect(() => {
    const unsub = window.api.audio.onLevel((level) => setAudioLevel(level))
    return unsub
  }, [])

  // Generic updater — merges partial into a section of settings
  const update = useCallback(<K extends keyof AppSettings>(
    section: K,
    partial: Partial<AppSettings[K]>
  ) => {
    if (section === 'display' && 'theme' in partial && partial.theme) {
      applyAppTheme(partial.theme as AppSettings['display']['theme'])
    }

    setSettings((prev) => {
      const nextSection = { ...prev[section], ...partial }

      // Theme + gloss color apply immediately (persist + publish), like a live control.
      if (section === 'display' && 'theme' in partial && partial.theme) {
        void window.api.settings.set('display', nextSection as AppSettings['display'])
      }
      if (section === 'lyrics' && 'glossColor' in (partial as object)) {
        const gloss = (nextSection as AppSettings['lyrics']).glossColor
        if (typeof gloss === 'string' && /^#[0-9a-fA-F]{6}$/.test(gloss.trim())) {
          useBootstrapStore.getState().patchSettings('lyrics', nextSection as AppSettings['lyrics'])
          void window.api.settings.set('lyrics', nextSection as AppSettings['lyrics'])
        }
      }

      return {
        ...prev,
        [section]: nextSection,
      }
    })
  }, [])

  // Show saved feedback for 2s
  const showSaved = useCallback((id: string) => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    setSavedSection(id)
    savedTimerRef.current = setTimeout(() => setSavedSection(null), 2000)
  }, [])

  // Per-section save handlers
  const saves: Record<Section, () => void> = {
    propresenter: () => {
      publish('propresenter', settings.propresenter)
      window.api.settings.set('propresenter', settings.propresenter).then(() => showSaved('propresenter'))
    },
    audio: () => {
      publish('audio', settings.audio)
      window.api.settings.set('audio', settings.audio).then(() => showSaved('audio'))
    },
    apikeys: () => {
      publish('stt', settings.stt)
      publish('lyrics', settings.lyrics)
      Promise.all([
        window.api.settings.set('stt', settings.stt),
        window.api.settings.set('lyrics', settings.lyrics),
      ]).then(() => showSaved('apikeys'))
    },
    scripture: () => {
      publish('scripture', settings.scripture)
      window.api.settings.set('scripture', settings.scripture).then(() => showSaved('scripture'))
    },
    overlay: () => {
      // Send only the phase-1 fields this modal edits — main merges onto the
      // freshly-read stored overlay, so this stale copy can't clobber the Theme
      // page's mode/theme or the ppVideoInputUuid the orchestrator persists.
      const o = settings.overlay
      publish('overlay', settings.overlay)
      window.api.settings
        .set('overlay', {
          template: o.template,
          showTranslation: o.showTranslation,
          showVerseNumbers: o.showVerseNumbers,
          maxVerses: o.maxVerses,
          autoClearSec: o.autoClearSec,
        })
        .then(() => showSaved('overlay'))
    },
    general: () => {
      publish('display', settings.display)
      publish('lyrics', settings.lyrics)
      Promise.all([
        window.api.settings.set('display', settings.display),
        window.api.settings.set('lyrics', settings.lyrics),
      ]).then(() => showSaved('general'))
    },
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-3 text-slate-500">
          <Loader size={16} className="animate-spin" />
          <span className="text-sm">Loading settings…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Section sidebar */}
      <nav className="w-52 shrink-0 border-r border-surface-border/50 bg-surface-secondary py-6 px-3.5 space-y-1">
        <p className="px-3 pb-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest font-sans">
          Settings
        </p>
        {SECTION_NAV.map(({ id, label, hint, icon: Icon }) => {
          const active = activeSection === id
          return (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={cn(
                'w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-all duration-200 group',
                active
                  ? 'bg-surface text-white shadow-sm'
                  : 'text-slate-400 hover:bg-surface/40 hover:text-slate-200'
              )}
              aria-label={`${label} Settings: ${hint}`}
            >
              <Icon
                size={15}
                className={active ? 'text-slate-200 shrink-0' : 'shrink-0 text-slate-500 group-hover:text-slate-300'}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold leading-none truncate font-sans">{label}</p>
                <p className="text-[10px] text-slate-500 mt-1 truncate leading-none font-sans">{hint}</p>
              </div>
              {active && <ChevronRight size={11} className="text-slate-400 shrink-0" aria-hidden="true" />}
            </button>
          )
        })}
      </nav>

      {/* Section content */}
      <div className="flex-1 overflow-y-auto bg-surface/10">
        <div className="max-w-xl p-8 space-y-6">
          {/* Section header */}
          {(() => {
            const nav = SECTION_NAV.find((s) => s.id === activeSection)!
            const Icon = nav.icon
            return (
              <div className="flex items-center gap-3.5 mb-6">
                <div className="w-9 h-9 rounded-xl bg-surface-secondary/80 flex items-center justify-center shrink-0">
                  <Icon size={16} className="text-slate-200" aria-hidden="true" />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-white leading-none tracking-tight font-sans">{nav.label}</h1>
                  <p className="text-xs text-slate-500 mt-1.5 leading-none font-sans">{nav.hint}</p>
                </div>
              </div>
            )
          })()}

          {/* Active section */}
          {activeSection === 'propresenter' && (
            <ConnectionSection
              settings={settings}
              update={update}
              onSave={saves.propresenter}
              savedSection={savedSection}
            />
          )}
          {activeSection === 'audio' && (
            <AudioSection
              settings={settings}
              update={update}
              onSave={saves.audio}
              savedSection={savedSection}
            />
          )}
          {activeSection === 'apikeys' && (
            <ApiKeysSection
              settings={settings}
              update={update}
              onSave={saves.apikeys}
              savedSection={savedSection}
            />
          )}
          {activeSection === 'scripture' && (
            <ScriptureSection
              settings={settings}
              update={update}
              onSave={saves.scripture}
              savedSection={savedSection}
            />
          )}
          {activeSection === 'overlay' && (
            <OverlaySection
              settings={settings}
              update={update}
              onSave={saves.overlay}
              savedSection={savedSection}
            />
          )}
          {activeSection === 'general' && (
            <GeneralSection
              settings={settings}
              update={update}
              onSave={saves.general}
              savedSection={savedSection}
            />
          )}
        </div>
      </div>
    </div>
  )
}
