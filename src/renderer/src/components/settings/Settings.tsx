import LicensePanel from '@/components/account/LicensePanel'
import KeyboardShortcutsSection from './KeyboardShortcutsSection'
import { MacTrafficLights } from '@/components/shared/MacTrafficLights'
import { Fragment, useState, useEffect, useRef, useCallback } from 'react'
import {
  Mic,
  Key,
  BookOpen,
  SlidersHorizontal,
  Save,
  CheckCircle,
  Loader,
  ChevronLeft,
  ChevronRight,
  MonitorPlay,
  Send,
  Trash2,
  CircleUser,
  Search,
  FolderOpen,
  type Icon,
} from '@/icons'
import { cn } from '@/lib/utils'
import AccountSection, { AccountAvatar } from './AccountSection'
import { requestCoachTour } from '@/components/onboarding/CoachTour'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { type SettingsSectionId } from '@/stores/useAppStore'
import { inputKindLabel, listAudioInputDevices, resolveCaptureDeviceId } from '@/audio/devices'
import { applyAppTheme } from '@/lib/appTheme'
import { normalizeOverlaySettings } from '@shared/overlay-defaults'
import { normalizeCaptureSettings } from '@shared/capture'
import { normalizeWebSettings } from '@shared/web'
import { normalizePresentationSettings } from '@shared/program'
import type {
  AppSettings,
  AudioDevice,
  MediaFolderMigration,
  WorkspaceInfo,
  AudioLevel,
  AutoPresentDelaySec,
  ScriptureTranslation,
} from '@shared/ipc'
import { LocalBiblePackManager } from './LocalBiblePackManager'
import { ScriptureLatencyPanel } from './ScriptureLatencyPanel'
import { DEFAULT_SETTINGS } from '@/lib/defaultSettings'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { useUpdates } from '@/hooks/useUpdates'
import { useAccountStore } from '@/stores/useAccountStore'

// ─── Types ────────────────────────────────────────────────────────────────────

type Section = SettingsSectionId
type TestStatus = 'idle' | 'testing' | 'ok' | 'fail'

type UpdateFn = <K extends keyof AppSettings>(section: K, partial: Partial<AppSettings[K]>) => void

// ─── Constants ────────────────────────────────────────────────────────────────

// Settings panes in sidebar order.
const SECTION_NAV: { id: Section; label: string; hint: string; icon?: Icon }[] = [
  { id: 'general', label: 'General', hint: 'Theme, fonts, lyrics color & storage', icon: SlidersHorizontal },
  { id: 'overlay', label: 'Verses on screen', hint: 'Translation & verse numbers', icon: MonitorPlay },
  { id: 'scripture', label: 'Scripture', hint: 'Detection & display', icon: BookOpen },
  { id: 'audio', label: 'Audio', hint: 'Input device & levels', icon: Mic },
  { id: 'apikeys', label: 'Licence & Devices', hint: 'Activation and managed cloud services', icon: Key },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', hint: 'Commands & key bindings', icon: SlidersHorizontal },
  { id: 'account', label: 'Account', hint: 'Sign in, team sync & setup', icon: CircleUser },
]

const INTEGRATION_SECTIONS: ReadonlySet<Section> = new Set([])

const NAV_ICON_BG: Record<Section, string> = {
  audio: 'bg-[#4F6888]',
  apikeys: 'bg-[#374151]',
  scripture: 'bg-[#5BA85A]',
  overlay: 'bg-[#4A9EBF]',
  shortcuts: 'bg-[#527C78]',
  general: 'bg-[#8E8E93]',
  account: 'bg-[#374151]',
}



// ─── Helper: Settings group (no heavy bezel frames) ───────────────────────────

function PrefGroup({
  title,
  description,
  children,
  plain = false,
}: {
  title?: string
  description?: string
  children: React.ReactNode
  plain?: boolean
}): React.ReactElement {
  return (
    <section className="space-y-2">
      {title ? (
        <div className="px-0.5">
          <h3 className="text-[13px] font-semibold tracking-tight text-white">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-[11px] leading-snug text-white/45">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div className={cn(
        'overflow-hidden',
        plain ? '' : 'pref-group rounded-xl bg-surface-tertiary',
      )}>
        {children}
      </div>
    </section>
  )
}

function PrefRow({
  label,
  hint,
  stacked = false,
  children,
}: {
  label: string
  hint?: string
  stacked?: boolean
  children: React.ReactNode
}): React.ReactElement {
  if (stacked) {
    return (
      <div className="space-y-2 px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="text-[13px] leading-none text-white">{label}</p>
          {hint ? <p className="mt-1 text-[11px] leading-snug text-white/40">{hint}</p> : null}
        </div>
        {children}
      </div>
    )
  }
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-3 px-3.5 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-none text-white">{label}</p>
        {hint ? <p className="mt-1 text-[11px] leading-snug text-white/40">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

const PREF_INPUT = 'input h-7 w-[148px] py-0 text-right font-mono text-[13px]'
const PREF_SELECT = 'input h-7 w-[168px] py-0 text-[13px]'

function SectionGlyph({
  section: _section,
  icon: Icon,
  size,
  className,
}: {
  section: Section
  icon?: Icon
  size: number
  className?: string
}): React.ReactElement {
  if (!Icon) return <span />
  return <Icon size={size} className={className} aria-hidden="true" />
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
      className="data-[state=checked]:bg-teal-500"
    />
  )
}

// ─── Helper: Level meter ──────────────────────────────────────────────────────

function LevelMeter({ level, active }: { level: AudioLevel | null; active: boolean }) {
  const SEGMENTS = 18
  const rms = active ? Math.min(level?.rms ?? 0, 1) : 0

  return (
    <div
      className="flex h-2 gap-[2px]"
      role="meter"
      aria-label="Input level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(rms * 100)}
    >
      {Array.from({ length: SEGMENTS }, (_, i) => {
        const lit = rms >= (i + 1) / SEGMENTS
        const warn = i >= 13 && i < 16
        const clip = i >= 16
        return (
          <div
            key={i}
            className={cn(
              'min-w-0 flex-1 rounded-sm',
              lit
                ? clip
                  ? 'bg-[#FF453A]'
                  : warn
                    ? 'bg-amber-400'
                    : 'bg-[#30D158]'
                : 'bg-surface-elevated',
            )}
          />
        )
      })}
    </div>
  )
}


const AUTO_PRESENT_DELAYS = [
  { value: 0, label: 'Instant' }, { value: 1, label: '1s' },
  { value: 2, label: '2s' }, { value: 3, label: '3s' },
] as const satisfies readonly { value: AutoPresentDelaySec; label: string }[]

function SaveBar({
  sectionId,
  savedSection,
  onSave,
  disabled = false,
}: {
  sectionId: string
  savedSection: string | null
  onSave: () => void
  disabled?: boolean
}) {
  const saved = savedSection === sectionId
  return (
    <div className="flex justify-end pt-1">
      <button
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md bg-surface-elevated px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-surface-border disabled:opacity-40 disabled:hover:bg-surface-elevated',
          saved && 'bg-[#2f6b3a] hover:bg-[#2f6b3a] disabled:opacity-100 disabled:hover:bg-[#2f6b3a]',
        )}
        disabled={disabled && !saved}
        onClick={onSave}
      >
        {saved ? <CheckCircle size={13} aria-hidden="true" /> : <Save size={13} aria-hidden="true" />}
        {saved ? 'Saved' : 'Save'}
      </button>
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
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([])
  const [listening, setListening] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [localLevel, setLocalLevel] = useState<import('@shared/ipc').AudioLevel | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)

  // Enumerate in the renderer: these IDs go straight into getUserMedia.
  useEffect(() => {
    let cancelled = false
    const refresh = (): void => {
      void listAudioInputDevices().then((inputs) => {
        if (cancelled) return
        setDevices(inputs)
        setDevicesLoading(false)
      })
    }
    const refreshOutputs = (): void => {
      void navigator.mediaDevices.enumerateDevices().then((all) => {
        if (!cancelled) setOutputs(all.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.label))
      }).catch(() => undefined)
    }
    refreshOutputs()
    navigator.mediaDevices.addEventListener('devicechange', refreshOutputs)
    refresh()
    // Labels and IDs fill in once permission is granted, and change when a
    // microphone is plugged in or removed.
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener('devicechange', refresh)
      navigator.mediaDevices.removeEventListener('devicechange', refreshOutputs)
    }
  }, [])

  const stopMonitor = useCallback(() => {
    processorRef.current?.disconnect()
    processorRef.current = null
    ctxRef.current?.close()
    ctxRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setListening(false)
    setLocalLevel(null)
  }, [])

  // Same resolution the capture path uses, so the meter never targets a
  // device the session has already resolved away from.
  const selectedId = devicesLoading ? '' : resolveCaptureDeviceId(devices, settings.audio.deviceId)

  // Live input meter while this pane is open — same idea as System Settings → Sound.
  useEffect(() => {
    if (devicesLoading || !selectedId) return
    let cancelled = false

    const start = async (): Promise<void> => {
      setCaptureError(null)
      try {
        const constraints: MediaTrackConstraints = {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
        if (selectedId !== 'default') {
          constraints.deviceId = { exact: selectedId }
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream

        const ctx = new AudioContext()
        ctxRef.current = ctx
        const source = ctx.createMediaStreamSource(stream)
        // Deprecated Web Audio API with no drop-in replacement for this tap;
        // kept until the AudioWorklet migration lands.
        const processor = ctx.createScriptProcessor(2048, 1, 1)
        processorRef.current = processor
        const mute = ctx.createGain()
        mute.gain.value = 0

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
        processor.connect(mute)
        mute.connect(ctx.destination)
        setListening(true)
      } catch (err) {
        if (!cancelled) {
          setCaptureError((err as Error).message)
          setListening(false)
        }
      }
    }

    void start()
    return () => {
      cancelled = true
      stopMonitor()
    }
  }, [devicesLoading, selectedId, stopMonitor])

  const displayLevel = localLevel

  return (
    <div className="space-y-3">
      <section className="space-y-2">
        <h3 className="px-0.5 text-xs font-semibold tracking-tight text-white/60">Input</h3>
        <div className="overflow-hidden rounded-xl bg-surface-tertiary">
          <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3 px-3.5 pb-1 pt-2.5">
            <p className="text-[11px] text-white/35">Name</p>
            <p className="text-[11px] text-white/35">Type</p>
          </div>

          {devicesLoading ? (
            <div className="flex items-center gap-2 px-3.5 py-6 text-[12px] text-white/40">
              <Loader size={13} className="animate-spin" aria-hidden="true" />
              Looking for microphones…
            </div>
          ) : devices.length === 0 ? (
            <p className="px-3.5 py-6 text-[12px] leading-snug text-white/40">
              No microphones found. Allow microphone access and reopen Settings.
            </p>
          ) : (
            <ul className="px-1.5 pb-1.5" role="listbox" aria-label="Audio input devices">
              {devices.map((device) => {
                const selected = device.id === selectedId
                return (
                  <li key={device.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => update('audio', { deviceId: device.id })}
                      className={cn(
                        'grid w-full grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-3 rounded-md px-2 py-[7px] text-left text-[13px]',
                        selected ? 'bg-surface-elevated text-white' : 'text-white/90 hover:bg-surface-tertiary',
                      )}
                    >
                      <span className="truncate">{device.label}</span>
                      <span className={cn('truncate', selected ? 'text-white/55' : 'text-white/35')}>
                        {inputKindLabel(device)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="px-3.5 py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[13px] text-white">Input level</p>
              {listening ? (
                <span className="text-[11px] text-white/35">Live</span>
              ) : null}
            </div>
            <LevelMeter level={displayLevel} active={listening} />
            {captureError ? (
              <p className="mt-2 text-[11px] leading-snug text-[#FF453A]">{captureError}</p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="px-0.5 text-xs font-semibold tracking-tight text-white/60">Output</h3>
        <div className="space-y-2 rounded-xl bg-surface-tertiary p-3.5">
          <label className="label" htmlFor="audio-output-device">Playback device</label>
          <select
            id="audio-output-device"
            className="input w-full"
            value={settings.presentation.audio.outputLabel}
            onChange={(event) => update('presentation', {
              audio: { ...settings.presentation.audio, outputLabel: event.target.value },
            })}
          >
            <option value="">System Default</option>
            {settings.presentation.audio.outputLabel && !outputs.some((d) => d.label === settings.presentation.audio.outputLabel) && (
              <option value={settings.presentation.audio.outputLabel}>{settings.presentation.audio.outputLabel} (unavailable)</option>
            )}
            {outputs.map((device) => <option key={device.deviceId} value={device.label}>{device.label}</option>)}
          </select>
          <p className="text-[11px] leading-snug text-white/40">Routes music, video and camera sound to this device.</p>
        </div>
      </section>

      <SaveBar sectionId="audio" savedSection={savedSection} onSave={onSave} />
    </div>
  )
}

// ─── Section: API Keys ────────────────────────────────────────────────────────

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
  const [downloadingTranslation, setDownloadingTranslation] = useState(false)

  const selectTranslation = async (translation: ScriptureTranslation): Promise<void> => {
    const option = translations.find((item) => item.id === translation)
    if (option?.downloadable && !option?.available) {
      const size = option.downloadApprox ?? 'a few megabytes'
      const confirmed = window.confirm(
        `Download and use ${option.id} (${option.name})?\n\n` +
          `Kairo will download ${size} once. ${option.id} will then work completely offline.`,
      )
      if (!confirmed) return
      setDownloadingTranslation(true)
      try {
        await window.api.scripture.downloadLocalBibleTranslation(option.id)
        const refreshed = await window.api.scripture.getTranslations()
        useBootstrapStore.getState().setTranslations(refreshed)
      } catch (error) {
        window.alert((error as Error).message)
        return
      } finally {
        setDownloadingTranslation(false)
      }
    }
    update('scripture', { defaultTranslation: translation })
  }

  // Only Bibles that work right now. Downloads live in the Bible library below;
  // a saved default that is no longer readable stays listed so the box is never blank.
  const readyTranslations = translations.filter((t) => t.available)
  const savedMissing = readyTranslations.some((t) => t.id === sc.defaultTranslation)
    ? null
    : translations.find((t) => t.id === sc.defaultTranslation) ?? null

  return (
    <div className="space-y-5">
      <PrefGroup title="Default Bible">
        <PrefRow label="Translation" hint={translationsLoading ? 'Checking available Bibles…' : 'Used for new searches and auto-detection. Add more in Bible library below.'}>
          <select
            className={PREF_SELECT}
            value={sc.defaultTranslation}
            disabled={downloadingTranslation}
            onChange={(e) => { void selectTranslation(e.target.value as ScriptureTranslation) }}
            aria-label="Default bible translation"
          >
            {savedMissing && (
              <option value={savedMissing.id} disabled>
                {savedMissing.id} — {savedMissing.name} (not installed)
              </option>
            )}
            {readyTranslations.map((translation) => (
              <option key={translation.id} value={translation.id}>
                {translation.id} — {translation.name}
              </option>
            ))}
          </select>
        </PrefRow>
        <PrefRow label="Verse numbers" hint="Include numbers on slides">
          <Toggle
            checked={sc.showVerseNumbers}
            onChange={(v) => update('scripture', { showVerseNumbers: v })}
          />
        </PrefRow>
      </PrefGroup>

      <PrefGroup
        title="Bible library"
        description="Installed Bibles work offline and need no API key."
      >
        <LocalBiblePackManager />
      </PrefGroup>

      <PrefGroup title="Auto-detection">
        <PrefRow label="Enabled" hint="Suggest verses from the live transcript">
          <Toggle checked={sc.autoMode} onChange={(v) => update('scripture', { autoMode: v })} />
        </PrefRow>
        <div className={cn(!sc.autoMode && 'pointer-events-none opacity-40')}>
          <PrefRow
            stacked
            label="Confidence"
            hint="Higher is stricter. 0.70–0.85 suits most sermons."
          >
            <div className="flex items-center gap-3">
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[sc.confidenceThreshold]}
                onValueChange={(next) => update('scripture', { confidenceThreshold: next[0] })}
                aria-label="Confidence threshold range slider"
                className="flex-1"
              />
              <span className="w-10 text-right text-[12px] font-mono tabular-nums text-white/50">
                {sc.confidenceThreshold.toFixed(2)}
              </span>
            </div>
          </PrefRow>
          <PrefRow
            label="Safety delay"
            hint="Time to cancel before a verse goes live. The largest part of the wait."
          >
            <div className="flex items-center gap-1" role="radiogroup" aria-label="Safety delay">
              {AUTO_PRESENT_DELAYS.map((option) => {
                const active = (sc.autoPresentDelaySec ?? 1) === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => update('scripture', { autoPresentDelaySec: option.value })}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                      active
                        ? 'bg-surface-elevated text-white'
                        : 'text-white/45 hover:bg-surface-tertiary hover:text-white/70',
                    )}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </PrefRow>
          <PrefRow label="Debounce" hint="Minimum gap between suggestions">
            <div className="flex items-center gap-1.5">
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
                className={cn(PREF_INPUT, 'w-[64px] text-center')}
                aria-label="Detection debounce duration in seconds"
              />
              <span className="text-[12px] text-white/40">sec</span>
            </div>
          </PrefRow>
          <PrefRow label="Context window" hint="Transcript sent for analysis">
            <div className="flex items-center gap-1.5">
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
                className={cn(PREF_INPUT, 'w-[64px] text-center')}
                aria-label="Context window size in seconds"
              />
              <span className="text-[12px] text-white/40">sec</span>
            </div>
          </PrefRow>
        </div>
      </PrefGroup>

      <PrefGroup
        title="Verse timing"
        description="How long each detected verse took to appear in Kairo this session, excluding the safety delay. Open a verse to see which step was slow."
      >
        <ScriptureLatencyPanel />
      </PrefGroup>

      <SaveBar sectionId="scripture" savedSection={savedSection} onSave={onSave} />
    </div>
  )
}

// ─── Section: Verses on screen ────────────────────────────────────────────────

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

  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMsg, setTestMsg] = useState('')

  const handleSendTest = async () => {
    setTestStatus('testing')
    setTestMsg('Sending…')
    try {
      const ok = await window.api.output.sendTest()
      setTestStatus(ok ? 'ok' : 'fail')
      setTestMsg(ok ? 'Sent' : 'Nothing took the test verse — check Screens')
    } catch (err) {
      setTestStatus('fail')
      setTestMsg(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const handleClear = async () => {
    setTestStatus('testing')
    setTestMsg('Clearing…')
    try {
      const ok = await window.api.output.clearAll()
      setTestStatus(ok ? 'ok' : 'fail')
      setTestMsg(ok ? 'Cleared' : 'Clear failed — check logs')
    } catch (err) {
      setTestStatus('fail')
      setTestMsg(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  return (
    <div className="space-y-5">
      <PrefGroup title="Verse text">
        <PrefRow label="Show translation" hint={'John 3:16 (KJV)'}>
          <Toggle
            checked={ov.showTranslation}
            onChange={(v) => update('overlay', { showTranslation: v })}
          />
        </PrefRow>
        <PrefRow label="Verse numbers" hint="On multi-verse pushes">
          <Toggle
            checked={ov.showVerseNumbers}
            onChange={(v) => update('overlay', { showVerseNumbers: v })}
          />
        </PrefRow>
        <PrefRow label="Max verses" hint="0 sends the whole passage">
          <input
            type="number"
            min={0}
            max={50}
            value={ov.maxVerses}
            onChange={(e) =>
              update('overlay', { maxVerses: Math.max(0, parseInt(e.target.value) || 0) })
            }
            className={cn(PREF_INPUT, 'w-[64px] text-center')}
            aria-label="Maximum verses per overlay push"
          />
        </PrefRow>
        <PrefRow label="Test" hint={testMsg || 'Sends John 3:16 to every screen that is on'}>
          <div className="flex items-center gap-1.5">
            <button
              className="btn-secondary inline-flex items-center gap-1.5 py-1 px-2.5 text-[12px]"
              onClick={() => void handleSendTest()}
              disabled={testStatus === 'testing'}
            >
              <Send size={12} aria-hidden="true" />
              Send
            </button>
            <button
              className="btn-secondary inline-flex items-center gap-1.5 py-1 px-2.5 text-[12px]"
              onClick={() => void handleClear()}
              disabled={testStatus === 'testing'}
            >
              <Trash2 size={12} aria-hidden="true" />
              Clear
            </button>
          </div>
        </PrefRow>
      </PrefGroup>

      <SaveBar sectionId="overlay" savedSection={savedSection} onSave={onSave} />
    </div>
  )
}

// ─── Section: General ─────────────────────────────────────────────────────────

// ─── Software update ──────────────────────────────────────────────────────────

const UPDATE_BTN =
  'inline-flex items-center gap-1.5 rounded-md bg-surface-elevated px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-surface-border disabled:cursor-default disabled:opacity-40'

/**
 * Reads 'idle' with no action in dev and in unpackaged builds, because the main
 * process refuses to check there — the row stays visible rather than vanishing,
 * so the version is always somewhere the operator can read it.
 */
function UpdateGroup(): React.ReactElement {
  const { status, busy, check, download, install } = useUpdates()

  const label = (() => {
    switch (status.state) {
      case 'checking':
        return 'Checking…'
      case 'available':
        return `Version ${status.version} is available`
      case 'downloading':
        return `Downloading${typeof status.percent === 'number' ? ` — ${status.percent}%` : '…'}`
      case 'downloaded':
        return `Version ${status.version} is ready — installs on the next quit`
      case 'error':
        return status.message
      default:
        return status.currentVersion ? `Kairo ${status.currentVersion} — up to date` : 'Up to date'
    }
  })()

  return (
    <PrefGroup title="Software update">
      <PrefRow label="Updates" hint={label}>
        {status.state === 'available' ? (
          <button className={UPDATE_BTN} onClick={() => void download()}>
            Download
          </button>
        ) : status.state === 'downloaded' ? (
          <button className={UPDATE_BTN} onClick={() => void install()}>
            Restart &amp; install
          </button>
        ) : (
          <button
            className={UPDATE_BTN}
            disabled={busy || status.state === 'checking' || status.state === 'downloading'}
            onClick={() => void check()}
          >
            Check now
          </button>
        )}
      </PrefRow>
    </PrefGroup>
  )
}

// ─── Section: General ─────────────────────────────────────────────────────────

/**
 * The Kairo workspace: one folder holding `Songs/` and `Media/`.
 *
 * Songs are files in that folder, so this panel is also where an operator
 * finds them in Finder, points the app at a different drive, or re-reads the
 * folder after editing files outside the app.
 */
function WorkspaceGroup(): React.ReactElement {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null)
  const [migration, setMigration] = useState<MediaFolderMigration | null>(null)
  const [busy, setBusy] = useState<null | 'change' | 'resync' | 'adopt'>(null)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const [next, media] = await Promise.all([
      window.api.workspace.get(),
      window.api.workspace.mediaMigration(),
    ])
    setInfo(next)
    setMigration(media)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const changeFolder = useCallback(async (move: boolean): Promise<void> => {
    setBusy('change')
    setNote(null)
    try {
      const next = await window.api.workspace.chooseFolder({ move })
      setInfo(next)
      await refresh()
      setNote(move ? 'Workspace moved.' : 'Workspace folder changed.')
    } catch (err) {
      setNote((err as Error).message)
    } finally {
      setBusy(null)
    }
  }, [refresh])

  const resync = useCallback(async (): Promise<void> => {
    setBusy('resync')
    try {
      const result = await window.api.workspace.resyncSongs()
      setNote(
        `Songs folder read — ${result.imported} in the library` +
        (result.removed ? `, ${result.removed} removed` : '') +
        (result.exported ? `, ${result.exported} written out` : '') + '.'
      )
    } catch (err) {
      setNote((err as Error).message)
    } finally {
      setBusy(null)
    }
  }, [])

  const adoptMedia = useCallback(async (move: boolean): Promise<void> => {
    setBusy('adopt')
    try {
      await window.api.workspace.adoptMedia({ move })
      await refresh()
      setNote(move ? 'Backgrounds moved into the workspace.' : 'Backgrounds folder switched to the workspace.')
    } catch (err) {
      setNote((err as Error).message)
    } finally {
      setBusy(null)
    }
  }, [refresh])

  return (
    <PrefGroup title="Storage">
      <PrefRow stacked label="Kairo folder" hint="Songs and backgrounds live here">
        <p className="break-all rounded-md bg-surface px-3 py-2 font-mono text-[11px] leading-snug text-white/70">
          {info?.root ?? 'Locating\u2026'}
        </p>
        {info && !info.ready && (
          <p className="text-[11px] text-red-400">
            This folder could not be created — {info.error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary flex items-center gap-1.5 text-[12px]"
            onClick={() => void window.api.workspace.reveal()}
          >
            <FolderOpen size={13} /> Show folder
          </button>
          <button
            type="button"
            className="btn-secondary text-[12px]"
            onClick={() => void window.api.workspace.revealSongs()}
          >
            Open Songs
          </button>
          <button
            type="button"
            className="btn-secondary text-[12px]"
            disabled={busy !== null}
            onClick={() => void changeFolder(true)}
          >
            {busy === 'change' ? 'Moving\u2026' : 'Move\u2026'}
          </button>
          <button
            type="button"
            className="btn-secondary text-[12px]"
            disabled={busy !== null}
            onClick={() => void changeFolder(false)}
          >
            Point elsewhere…
          </button>
        </div>
        <p className="text-[11px] leading-snug text-white/40">
          <span className="text-white/60">Move</span> takes the songs and backgrounds with it.{' '}
          <span className="text-white/60">Point elsewhere</span> leaves the files behind and reads
          whatever is already in the new folder.
        </p>
      </PrefRow>

      <PrefRow
        label="Re-read Songs folder"
        hint="After adding, editing or deleting song files outside Kairo"
      >
        <button
          type="button"
          className="btn-secondary text-[12px]"
          disabled={busy !== null}
          onClick={() => void resync()}
        >
          {busy === 'resync' ? 'Reading\u2026' : 'Rescan'}
        </button>
      </PrefRow>

      {migration?.needed && (
        <PrefRow
          stacked
          label="Backgrounds are outside the Kairo folder"
          hint={
            migration.fileCount >= 0
              ? `${migration.currentFolder} \u2014 ${migration.fileCount} file${migration.fileCount === 1 ? '' : 's'}`
              : migration.currentFolder
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary text-[12px]"
              disabled={busy !== null}
              onClick={() => void adoptMedia(true)}
            >
              {busy === 'adopt' ? 'Moving\u2026' : 'Move them in'}
            </button>
            <button
              type="button"
              className="btn-secondary text-[12px]"
              disabled={busy !== null}
              onClick={() => void adoptMedia(false)}
            >
              Use the Kairo folder anyway
            </button>
            <button
              type="button"
              className="btn-secondary text-[12px]"
              onClick={() => setMigration(null)}
            >
              Keep as is
            </button>
          </div>
        </PrefRow>
      )}

      {note && <p className="px-3.5 pb-2 text-[11px] text-teal-400/80">{note}</p>}
    </PrefGroup>
  )
}

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
    <div className="space-y-5">
      <PrefGroup title="Appearance">
        <PrefRow
          label="Dark mode"
          hint={isDark ? 'Dim room lighting' : 'Bright rooms — easier to see during a service'}
        >
          <Toggle
            checked={isDark}
            onChange={(v) => update('display', { theme: v ? 'dark' : 'light' })}
          />
        </PrefRow>
        <PrefRow stacked label="Interface size">
          <div className="flex items-center gap-3">
            <Slider
              min={12}
              max={24}
              step={1}
              value={[disp.fontSize]}
              onValueChange={(next) => update('display', { fontSize: next[0] })}
              aria-label="UI font size"
              className="flex-1"
            />
            <span className="w-9 text-right text-[12px] font-mono tabular-nums text-white/50">
              {disp.fontSize}
            </span>
          </div>
        </PrefRow>
        <PrefRow stacked label="Transcription size" hint="Live transcript during a service">
          <div className="flex items-center gap-3">
            <Slider
              min={12}
              max={48}
              step={1}
              value={[disp.transcriptionFontSize]}
              onValueChange={(next) => update('display', { transcriptionFontSize: next[0] })}
              aria-label="Transcription display size"
              className="flex-1"
            />
            <span className="w-9 text-right text-[12px] font-mono tabular-nums text-white/50">
              {disp.transcriptionFontSize}
            </span>
          </div>
        </PrefRow>
      </PrefGroup>

      <PrefGroup title="Lyrics">
        <PrefRow stacked label="Gloss color" hint="Parenthetical translation lines">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={
                /^#[0-9a-fA-F]{6}$/.test(settings.lyrics?.glossColor || '')
                  ? settings.lyrics.glossColor
                  : '#AABED7'
              }
              onChange={(e) => update('lyrics', { glossColor: e.target.value.toUpperCase() })}
              className="h-7 w-9 cursor-pointer rounded bg-transparent p-0.5"
              aria-label="Gloss color"
            />
            <input
              type="text"
              value={settings.lyrics?.glossColor || '#AABED7'}
              onChange={(e) => update('lyrics', { glossColor: e.target.value })}
              placeholder="#AABED7"
              className={cn(PREF_INPUT, 'flex-1 text-left')}
              aria-label="Gloss color hex"
            />
          </div>
          <div className="rounded-md bg-black px-3 py-3 text-center">
            <p className="text-[13px] font-medium leading-snug text-white">
              Onye nke di ike n&apos;aka Ya
            </p>
            <p
              className="mt-1 text-[12px] italic leading-snug"
              style={{
                color: /^#[0-9a-fA-F]{6}$/.test(settings.lyrics?.glossColor || '')
                  ? settings.lyrics.glossColor
                  : '#AABED7',
              }}
            >
              (The arm of the Lord does great things)
            </p>
          </div>
        </PrefRow>
      </PrefGroup>

      <WorkspaceGroup />

      <PrefGroup title="Privacy">
        <PrefRow
          label="Share usage statistics"
          hint="Counts of the features you use and basic system info, so we can improve Kairo. Never your songs, sermons, verses or files."
        >
          <Toggle
            checked={settings.usage?.shareStats !== false}
            onChange={(on) => update('usage', { shareStats: on })}
          />
        </PrefRow>
        <PrefRow
          label="Send crash reports"
          hint="If Kairo crashes, send what failed and the end of its log so we can fix it. The log can name songs and files."
        >
          <Toggle
            checked={settings.usage?.sendCrashReports !== false}
            onChange={(on) => update('usage', { sendCrashReports: on })}
          />
        </PrefRow>
      </PrefGroup>

      <UpdateGroup />

      <SaveBar sectionId="general" savedSection={savedSection} onSave={onSave} />
    </div>
  )
}

// ─── Main Settings export ─────────────────────────────────────────────────────

export default function Settings({
  onClose,
  initialSection = 'general',
}: { onClose?: () => void; initialSection?: Section } = {}): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<Section>(initialSection)
  const [savedSection, setSavedSection] = useState<string | null>(null)
  const [navQuery, setNavQuery] = useState('')
  const [, setAudioLevel] = useState<AudioLevel | null>(null)
  const [histIndex, setHistIndex] = useState(0)
  const historyRef = useRef<Section[]>([initialSection])
  const session = useAccountStore((s) => s.session)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Settings arrive with the startup snapshot; refresh from main so secret
  // configured-flags are current (vault pull / saves may have landed since boot).
  useEffect(() => {
    let cancelled = false
    const apply = (stored: typeof DEFAULT_SETTINGS) => {
      if (cancelled) return
      useBootstrapStore.getState().setSettings(stored)
      setSettings((prev) => ({
        audio: { ...prev.audio, ...stored.audio },
        stt: { ...prev.stt, ...stored.stt },
        scripture: { ...prev.scripture, ...stored.scripture },
        lyrics: { ...prev.lyrics, ...stored.lyrics },
        display: { ...prev.display, ...stored.display },
        overlay: normalizeOverlaySettings({ ...prev.overlay, ...stored.overlay }),
        themeLibrary: stored.themeLibrary ?? prev.themeLibrary,
        workspace: { ...prev.workspace, ...stored.workspace },
        capture: normalizeCaptureSettings(stored.capture),
        web: normalizeWebSettings(stored.web),
        media: { ...prev.media, ...stored.media },
        tracks: { ...prev.tracks, ...stored.tracks },
        church: { ...prev.church, ...stored.church },
        documents: { ...prev.documents, ...stored.documents },
        presentation: normalizePresentationSettings(stored.presentation ?? prev.presentation),
        usage: { ...prev.usage, ...stored.usage },
        themeDefaults: stored.themeDefaults ?? prev.themeDefaults,
      }))
      setLoading(false)
    }

    apply(useBootstrapStore.getState().settings)
    return () => {
      cancelled = true
    }
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

      // A privacy choice takes effect the moment it is made, not on Save.
      if (section === 'usage') {
        useBootstrapStore.getState().patchSettings('usage', nextSection as AppSettings['usage'])
        void window.api.settings.set('usage', nextSection as AppSettings['usage'])
      }

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

  // Per-section save handlers. Account has none: it writes through the cloud
  // service as things happen, so there is nothing to batch behind a Save.
  const saves: Record<Section, () => void> = {
    account: () => {},
    shortcuts: () => {},
    audio: () => {
      publish('audio', settings.audio)
      Promise.all([
        window.api.settings.set('audio', settings.audio),
        window.api.settings.get('presentation').then((current) =>
          window.api.settings.set('presentation', { ...current, audio: { ...current.audio, outputLabel: settings.presentation.audio.outputLabel } }),
        ),
      ]).then(() => {
        const current = useBootstrapStore.getState().settings.presentation
        publish('presentation', { ...current, audio: { ...current.audio, outputLabel: settings.presentation.audio.outputLabel } })
        showSaved('audio')
      })
    },
    apikeys: () => {
      // ApiKeysSection owns save (drafts + clearKeys). Keep a no-op for the map.
    },
    scripture: () => {
      publish('scripture', settings.scripture)
      window.api.settings.set('scripture', settings.scripture).then(() => showSaved('scripture'))
    },
    overlay: () => {
      // Send only the phase-1 fields this modal edits — main merges onto the
      // freshly-read stored overlay, so this stale copy can't clobber the Theme
      // page's theme and routing choices.
      const o = settings.overlay
      publish('overlay', settings.overlay)
      window.api.settings
        .set('overlay', {
          template: o.template,
          showTranslation: o.showTranslation,
          showVerseNumbers: o.showVerseNumbers,
          maxVerses: o.maxVerses,
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

  const selectSection = useCallback((id: Section) => {
    setActiveSection(id)
    const hist = historyRef.current
    if (hist[histIndex] === id) return
    const next = [...hist.slice(0, histIndex + 1), id]
    historyRef.current = next
    setHistIndex(next.length - 1)
  }, [histIndex])

  const goHistory = (delta: -1 | 1): void => {
    const next = histIndex + delta
    if (next < 0 || next >= historyRef.current.length) return
    setHistIndex(next)
    setActiveSection(historyRef.current[next])
  }

  const query = navQuery.trim().toLowerCase()
  const navItems = SECTION_NAV.filter((item) => {
    if (item.id === 'account' && !query) return false
    if (!query) return true
    return `${item.label} ${item.hint}`.toLowerCase().includes(query)
  })
  const currentNav = SECTION_NAV.find((s) => s.id === activeSection) ?? SECTION_NAV[0]
  const firstIntegration = navItems.find((item) => INTEGRATION_SECTIONS.has(item.id))?.id
  const displayName = session.user?.name?.trim() || session.user?.email || 'Account'
  const displayMeta =
    session.state === 'stale' ? 'Offline' : session.org?.name || session.user?.email || 'Signed in'
  const canBack = histIndex > 0
  const canForward = histIndex < historyRef.current.length - 1

  return (
    <div className="kairo-pp-settings flex h-full w-full overflow-hidden rounded-xl text-white">
      <aside data-settings-drag className="glass hairline-r flex w-[220px] shrink-0 flex-col">
        <MacTrafficLights onClose={onClose} className="px-[18px] pb-3 pt-[18px]" />

        <div className="px-3 pb-2.5">
          <label className="flex h-7 items-center gap-1.5 rounded-lg bg-surface-tertiary px-2">
            <Search size={12} className="shrink-0 text-white/40" aria-hidden="true" />
            <input
              value={navQuery}
              onChange={(e) => setNavQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search settings"
              className="w-full bg-transparent text-[13px] text-white outline-none placeholder:text-white/40"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => selectSection('account')}
          className={cn(
            'mx-2 mb-3 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left',
            activeSection === 'account' ? 'row-selected' : 'hover:bg-surface-tertiary',
          )}
        >
          <AccountAvatar session={session} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-tight text-white">
              {displayName}
            </span>
            <span className="block truncate text-[11px] leading-tight text-white/45">
              {displayMeta}
            </span>
          </span>
        </button>

        <nav className="min-h-0 flex-1 space-y-[1px] overflow-y-auto px-2 pb-3">
          {navItems.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-white/35">No matches</p>
          ) : (
            navItems.map(({ id, label, hint, icon }) => {
              const active = activeSection === id
              return (
                <Fragment key={id}>
                {id === firstIntegration && (
                  <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/35">
                    Integrations
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => selectSection(id)}
                  className={cn(
                    // System Settings: a blue pill for the open pane, the badge keeps its colour.
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-[5px] text-left text-[13px] text-white',
                    active ? 'bg-teal-500 text-on-accent' : 'hover:bg-surface-tertiary',
                  )}
                  aria-current={active ? 'page' : undefined}
                  aria-label={`${label} settings: ${hint}`}
                >
                  <span
                    className={cn(
                      'grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[6px] text-white',
                      NAV_ICON_BG[id],
                    )}
                  >
                    <SectionGlyph section={id} icon={icon} size={13} className="text-white" />
                  </span>
                  <span className="min-w-0 truncate">{label}</span>
                </button>
                </Fragment>
              )
            })
          )}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-surface-secondary">
        <header data-settings-drag className="flex shrink-0 items-center gap-3 px-5 pb-2 pt-3.5">
          {/* Back and forward share one capsule, as in System Settings. */}
          <div className="flex h-7 items-center rounded-full bg-surface-tertiary">
            <button
              type="button"
              aria-label="Back"
              disabled={!canBack}
              onClick={() => goHistory(-1)}
              className="grid h-7 w-8 place-items-center rounded-l-full text-white/70 hover:bg-surface-elevated disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft size={15} aria-hidden="true" />
            </button>
            <span className="h-4 w-px bg-surface-elevated" aria-hidden="true" />
            <button
              type="button"
              aria-label="Forward"
              disabled={!canForward}
              onClick={() => goHistory(1)}
              className="grid h-7 w-8 place-items-center rounded-r-full text-white/70 hover:bg-surface-elevated disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>
          <h1 className="text-[15px] font-semibold tracking-tight text-white">{currentNav.label}</h1>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-3">
          <div className="space-y-5">
            {loading ? (
              <div className="flex items-center gap-3 pt-8 text-white/40">
                <Loader size={16} className="animate-spin" />
                <span className="text-sm">Loading settings…</span>
              </div>
            ) : (
              <>
                {activeSection === 'audio' && (
                  <AudioSection
                    settings={settings}
                    update={update}
                    onSave={saves.audio}
                    savedSection={savedSection}
                  />
                )}
                {activeSection === 'shortcuts' && <KeyboardShortcutsSection bindings={settings.display.shortcuts ?? {}} onSave={async (shortcuts) => {
                  const display = { ...settings.display, shortcuts }
                  await window.api.settings.set('display', display)
                  update('display', { shortcuts })
                  publish('display', display)
                }} />}
                {activeSection === 'apikeys' && (
                  <LicensePanel />
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
                {activeSection === 'account' && (
                  <AccountSection
                    onRunSetup={() => {
                      void window.api.onboarding.reset().then((state) => {
                        useBootstrapStore.getState().setOnboarding(state)
                        onClose?.()
                      })
                    }}
                    onShowTips={() => {
                      onClose?.()
                      requestCoachTour()
                    }}
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
