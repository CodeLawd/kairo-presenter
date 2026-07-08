import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Layers,
  Type,
  BookOpen,
  LayoutTemplate,
  Radio,
  Send,
  Trash2,
  Loader,
  CheckCircle,
  XCircle,
  AlertCircle,
  MonitorPlay,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'
import { renderOverlayHTML } from '@shared/overlay-template'
import { DEFAULT_OVERLAY_SETTINGS, normalizeOverlaySettings } from '@shared/overlay-defaults'
import type { AppSettings, OverlayTheme, NdiStatus, PPVideoInputInfo } from '@shared/ipc'

// ─── Sample content for the WYSIWYG preview ────────────────────────────────────

const SAMPLE_REFERENCE = 'John 3:16 (KJV)'
const SAMPLE_TEXT =
  'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.'

type TestStatus = 'idle' | 'testing' | 'ok' | 'fail'

// ─── Small reusable atoms (local to this page, mirrors Settings.tsx style) ────

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex w-10 h-5 rounded-full transition-all duration-300 ease-out-expo shrink-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        checked ? 'bg-teal-500 shadow-glow-teal/20' : 'bg-surface-secondary border border-surface-border/50'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-300 ease-out-expo shadow-sm',
          checked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  )
}

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = '',
  format,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  unit?: string
  format?: (v: number) => string
}): React.ReactElement {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="label mb-0">{label}</label>
        <span className="text-xs font-bold font-mono text-teal-400 tabular-nums">
          {format ? format(value) : value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 appearance-none rounded-full cursor-pointer bg-surface-secondary accent-teal-500"
        style={{ background: `linear-gradient(to right, #009f9f ${pct}%, #243d5c ${pct}%)` }}
        aria-label={label}
      />
    </div>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}): React.ReactElement {
  const isHex6 = /^#[0-9a-fA-F]{6}$/.test(value)
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={isHex6 ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="w-9 h-9 shrink-0 rounded-lg border border-surface-border bg-surface cursor-pointer p-0.5"
          aria-label={`${label} color swatch`}
          title={isHex6 ? undefined : 'Swatch only supports 6-digit hex — edit the text field for rgba()'}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="input font-mono text-xs"
          placeholder="#rrggbb or rgba(...)"
          aria-label={`${label} value`}
        />
      </div>
    </div>
  )
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}): React.ReactElement {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-1.5 flex-wrap">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-bold border transition-all',
              value === opt.value ? 'bg-teal-500/15 border-teal-500/40 text-teal-300' : 'btn-secondary'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function SectionCard({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="double-bezel-outer">
      <div className="double-bezel-inner p-5 space-y-5">
        <div className="flex items-center gap-2.5">
          <Icon size={15} className="text-teal-400 shrink-0" aria-hidden="true" />
          <p className="text-sm font-bold text-white tracking-tight">{title}</p>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Font stacks offered in the picker (theme.verse/reference.fontFamily is free text) ─

const FONT_STACKS = [
  { label: 'Helvetica Neue', value: "'Helvetica Neue', Arial, sans-serif" },
  { label: 'Georgia (serif)', value: "Georgia, 'Times New Roman', serif" },
  { label: 'Avenir Next', value: "'Avenir Next', Avenir, sans-serif" },
  { label: 'Futura', value: "Futura, 'Trebuchet MS', sans-serif" },
  { label: 'Courier (mono)', value: "'Courier New', Courier, monospace" },
]

// ─── Main page ──────────────────────────────────────────────────────────────────

export default function ThemeEditor(): React.ReactElement {
  const [overlay, setOverlay] = useState<AppSettings['overlay']>(DEFAULT_OVERLAY_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [ndiStatus, setNdiStatus] = useState<NdiStatus>({ available: false, sending: false, ppInputConfigured: false })
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMsg, setTestMsg] = useState('')
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const ppState = useAppStore((s) => s.ppState)
  const ppConnected = ppState === 'connected'

  // Load overlay settings on mount.
  useEffect(() => {
    window.api.settings.get('overlay').then((stored) => {
      setOverlay(normalizeOverlaySettings(stored))
      setLoading(false)
    })
  }, [])

  // Poll NDI status (availability + sender + PP video-input binding).
  useEffect(() => {
    let cancelled = false
    const poll = (): void => {
      window.api.ndi
        .getStatus()
        .then((s) => {
          if (!cancelled) setNdiStatus(s)
        })
        .catch(() => {})
    }
    poll()
    const id = setInterval(poll, 4000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const persist = useCallback((next: AppSettings['overlay']) => {
    setOverlay(next)
    window.api.settings.set('overlay', next).then(() => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      setSaved(true)
      savedTimerRef.current = setTimeout(() => setSaved(false), 1500)
    })
  }, [])

  const updateTheme = useCallback(
    <K extends keyof OverlayTheme>(section: K, partial: Partial<OverlayTheme[K]>) => {
      persist({
        ...overlay,
        theme: { ...overlay.theme, [section]: { ...overlay.theme[section], ...partial } },
      })
    },
    [overlay, persist]
  )

  const setMode = (mode: AppSettings['overlay']['mode']): void => persist({ ...overlay, mode })

  // PP video inputs for the manual NDI binding picker. PP names inputs
  // "Input N" and never exposes the NDI source name, so auto-discovery can't
  // identify ours — the user picks it once and we persist the uuid.
  const [videoInputs, setVideoInputs] = useState<PPVideoInputInfo[]>([])
  const refreshVideoInputs = useCallback((): void => {
    window.api.ndi
      .getVideoInputs()
      .then(setVideoInputs)
      .catch(() => setVideoInputs([]))
  }, [])
  useEffect(() => {
    refreshVideoInputs()
  }, [refreshVideoInputs])

  const handleSendTest = async (): Promise<void> => {
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

  const handleClear = async (): Promise<void> => {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-3 text-slate-500">
          <Loader size={16} className="animate-spin" />
          <span className="text-sm">Loading theme…</span>
        </div>
      </div>
    )
  }

  const theme = overlay.theme
  const previewHtml = renderOverlayHTML(theme, SAMPLE_REFERENCE, SAMPLE_TEXT)

  return (
    <div className="h-full w-full flex overflow-hidden">
      {/* Controls column */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="page-header text-3xl">Theme</h1>
              <p className="page-subtitle">In-app scripture renderer — background, font, size, color, position</p>
            </div>
            {saved && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-teal-400 animate-fade-in">
                <CheckCircle size={13} aria-hidden="true" />
                Saved
              </span>
            )}
          </div>

          {/* ── Output mode ─────────────────────────────────────────────────── */}
          <SectionCard icon={Radio} title="Output mode">
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { value: 'auto', label: 'Auto', hint: 'Library → NDI → message' },
                  { value: 'ndi', label: 'NDI', hint: 'Custom theme only' },
                  { value: 'message', label: 'PP Message', hint: 'Library → message' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMode(opt.value)}
                  className={cn(
                    'flex flex-col items-start gap-1 px-3.5 py-3 rounded-xl border text-left transition-all',
                    overlay.mode === opt.value
                      ? 'bg-teal-500/15 border-teal-500/40 text-teal-300'
                      : 'btn-secondary'
                  )}
                  aria-pressed={overlay.mode === opt.value}
                >
                  <span className="text-xs font-bold">{opt.label}</span>
                  <span className="text-[10px] text-slate-500 leading-snug">{opt.hint}</span>
                </button>
              ))}
            </div>

            {/* NDI video-input binding — PP hides NDI source names, so the user picks manually */}
            {overlay.mode !== 'message' && (
              <div className="mt-3">
                <label className="label" htmlFor="pa-video-input-picker">ProPresenter video input (NDI)</label>
                <div className="flex items-center gap-2">
                  <select
                    id="pa-video-input-picker"
                    className="input flex-1"
                    value={overlay.ppVideoInputUuid}
                    onChange={(e) => persist({ ...overlay, ppVideoInputUuid: e.target.value })}
                  >
                    <option value="">— not bound —</option>
                    {videoInputs.map((vi) => (
                      <option key={vi.uuid} value={vi.uuid}>{vi.name}</option>
                    ))}
                  </select>
                  <button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={refreshVideoInputs}>
                    Refresh
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5 leading-snug">
                  Pick the PP Video Input you created for the "ProAutomate Scripture" NDI source.
                  PP labels inputs "Input N" — check PP's Video Inputs list if unsure.
                </p>
              </div>
            )}
          </SectionCard>

          {/* ── Background ───────────────────────────────────────────────────── */}
          <SectionCard icon={Layers} title="Background">
            <SegmentedControl
              label="Type"
              value={theme.background.type}
              options={[
                { value: 'transparent', label: 'Transparent' },
                { value: 'color', label: 'Solid color' },
                { value: 'gradient', label: 'Gradient' },
              ]}
              onChange={(type) => updateTheme('background', { type })}
            />

            {theme.background.type !== 'transparent' && (
              <>
                <div className="border-t border-surface-border/50" />
                <div className="grid grid-cols-2 gap-4">
                  <ColorField
                    label={theme.background.type === 'gradient' ? 'Start color' : 'Color'}
                    value={theme.background.color}
                    onChange={(color) => updateTheme('background', { color })}
                  />
                  {theme.background.type === 'gradient' && (
                    <ColorField
                      label="End color"
                      value={theme.background.color2 ?? theme.background.color}
                      onChange={(color2) => updateTheme('background', { color2 })}
                    />
                  )}
                </div>
                {theme.background.type === 'gradient' && (
                  <Slider
                    label="Gradient angle"
                    value={theme.background.angleDeg ?? 0}
                    onChange={(angleDeg) => updateTheme('background', { angleDeg })}
                    min={0}
                    max={360}
                    unit="°"
                  />
                )}
                <Slider
                  label="Opacity"
                  value={theme.background.opacity}
                  onChange={(opacity) => updateTheme('background', { opacity })}
                  min={0}
                  max={1}
                  step={0.05}
                  format={(v) => v.toFixed(2)}
                />
              </>
            )}
          </SectionCard>

          {/* ── Verse text ───────────────────────────────────────────────────── */}
          <SectionCard icon={Type} title="Verse text">
            <div>
              <label className="label">Font</label>
              <select
                className="input"
                value={theme.verse.fontFamily}
                onChange={(e) => updateTheme('verse', { fontFamily: e.target.value })}
              >
                {FONT_STACKS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Slider
                label="Size"
                value={theme.verse.fontSizePx}
                onChange={(fontSizePx) => updateTheme('verse', { fontSizePx })}
                min={12}
                max={200}
                unit="px"
              />
              <Slider
                label="Weight"
                value={theme.verse.fontWeight}
                onChange={(fontWeight) => updateTheme('verse', { fontWeight })}
                min={100}
                max={900}
                step={100}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <ColorField label="Color" value={theme.verse.color} onChange={(color) => updateTheme('verse', { color })} />
              <Slider
                label="Line height"
                value={theme.verse.lineHeight}
                onChange={(lineHeight) => updateTheme('verse', { lineHeight })}
                min={0.9}
                max={2.5}
                step={0.05}
                format={(v) => v.toFixed(2)}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <SegmentedControl
                label="Alignment"
                value={theme.verse.align}
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'center', label: 'Center' },
                  { value: 'right', label: 'Right' },
                ]}
                onChange={(align) => updateTheme('verse', { align })}
              />
              <div>
                <label className="label">Drop shadow</label>
                <Toggle checked={theme.verse.shadow} onChange={(shadow) => updateTheme('verse', { shadow })} />
              </div>
            </div>
          </SectionCard>

          {/* ── Reference ────────────────────────────────────────────────────── */}
          <SectionCard icon={BookOpen} title="Reference">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-white tracking-tight">Show reference</p>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                  Display the book/chapter/verse label alongside the verse text
                </p>
              </div>
              <Toggle checked={theme.reference.show} onChange={(show) => updateTheme('reference', { show })} />
            </div>

            <div
              className={cn(
                'space-y-5 transition-opacity duration-200',
                theme.reference.show ? 'opacity-100' : 'opacity-30 pointer-events-none'
              )}
            >
              <div className="border-t border-surface-border/50" />
              <SegmentedControl
                label="Position"
                value={theme.reference.position}
                options={[
                  { value: 'above', label: 'Above verse' },
                  { value: 'below', label: 'Below verse' },
                ]}
                onChange={(position) => updateTheme('reference', { position })}
              />
              <div>
                <label className="label">Font</label>
                <select
                  className="input"
                  value={theme.reference.fontFamily}
                  onChange={(e) => updateTheme('reference', { fontFamily: e.target.value })}
                >
                  {FONT_STACKS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Slider
                  label="Size"
                  value={theme.reference.fontSizePx}
                  onChange={(fontSizePx) => updateTheme('reference', { fontSizePx })}
                  min={12}
                  max={200}
                  unit="px"
                />
                <Slider
                  label="Weight"
                  value={theme.reference.fontWeight}
                  onChange={(fontWeight) => updateTheme('reference', { fontWeight })}
                  min={100}
                  max={900}
                  step={100}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <ColorField
                  label="Color"
                  value={theme.reference.color}
                  onChange={(color) => updateTheme('reference', { color })}
                />
                <div>
                  <label className="label">Uppercase</label>
                  <Toggle
                    checked={theme.reference.uppercase}
                    onChange={(uppercase) => updateTheme('reference', { uppercase })}
                  />
                </div>
              </div>
            </div>
          </SectionCard>

          {/* ── Layout ───────────────────────────────────────────────────────── */}
          <SectionCard icon={LayoutTemplate} title="Layout">
            <SegmentedControl
              label="Position preset"
              value={theme.layout.position}
              options={[
                { value: 'lower-third', label: 'Lower third' },
                { value: 'center', label: 'Center' },
                { value: 'top', label: 'Top' },
                { value: 'full', label: 'Full' },
              ]}
              onChange={(position) => updateTheme('layout', { position })}
            />
            <div className="grid grid-cols-2 gap-4">
              <Slider
                label="Max width"
                value={theme.layout.maxWidthPct}
                onChange={(maxWidthPct) => updateTheme('layout', { maxWidthPct })}
                min={20}
                max={100}
                unit="%"
              />
              <Slider
                label="Padding"
                value={theme.layout.paddingPx}
                onChange={(paddingPx) => updateTheme('layout', { paddingPx })}
                min={0}
                max={200}
                unit="px"
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-white tracking-tight">Backdrop box</p>
              <Toggle
                checked={theme.layout.backdropBox}
                onChange={(backdropBox) => updateTheme('layout', { backdropBox })}
              />
            </div>
            <div
              className={cn(
                'grid grid-cols-2 gap-4 transition-opacity duration-200',
                theme.layout.backdropBox ? 'opacity-100' : 'opacity-30 pointer-events-none'
              )}
            >
              <ColorField
                label="Backdrop color"
                value={theme.layout.backdropColor}
                onChange={(backdropColor) => updateTheme('layout', { backdropColor })}
              />
              <Slider
                label="Corner radius"
                value={theme.layout.backdropRadiusPx}
                onChange={(backdropRadiusPx) => updateTheme('layout', { backdropRadiusPx })}
                min={0}
                max={64}
                unit="px"
              />
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Preview + status column */}
      <div className="w-[440px] shrink-0 border-l border-surface-border/50 bg-surface-secondary/20 overflow-y-auto">
        <div className="p-6 space-y-5">
          {/* NDI / PP status line */}
          <div className="double-bezel-outer">
            <div className="double-bezel-inner p-4 space-y-3">
              <div className="flex items-center gap-2">
                <MonitorPlay size={14} className="text-teal-400 shrink-0" aria-hidden="true" />
                <p className="text-xs font-bold text-white tracking-tight uppercase tracking-wider">NDI status</p>
              </div>
              <div className="space-y-2 text-xs">
                <StatusRow label="Sender available" ok={ndiStatus.available} />
                <StatusRow label="Sending frames" ok={ndiStatus.sending} />
                <StatusRow label="PP video input bound" ok={ndiStatus.ppInputConfigured} />
              </div>
              {!ndiStatus.available && (
                <p className="text-[10px] text-yellow-400 flex items-start gap-1.5 leading-relaxed">
                  <AlertCircle size={11} className="shrink-0 mt-0.5" aria-hidden="true" />
                  NDI sender unavailable — falling back to message overlay when selected in auto/ndi mode.
                </p>
              )}
              {ndiStatus.available && !ndiStatus.ppInputConfigured && (
                <p className="text-[10px] text-yellow-400 flex items-start gap-1.5 leading-relaxed">
                  <AlertCircle size={11} className="shrink-0 mt-0.5" aria-hidden="true" />
                  In ProPresenter: Video Inputs → add NDI source named "ProAutomate Scripture".
                </p>
              )}
            </div>
          </div>

          {/* WYSIWYG preview */}
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-sans mb-2">
              Live preview
            </p>
            <div className="relative w-full aspect-video rounded-xl bg-[repeating-conic-gradient(#1a1a1a_0%_25%,#0d0d0d_0%_50%)] bg-[length:16px_16px] border border-surface-border/50 overflow-hidden">
              <div
                className="absolute inset-0"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
              Same renderer used for the live NDI output — pixel-exact, not an approximation.
            </p>
          </div>

          {/* Test / clear */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                className="btn-primary flex items-center gap-2 flex-1 justify-center"
                onClick={handleSendTest}
                disabled={!ppConnected || testStatus === 'testing'}
              >
                <Send size={13} aria-hidden="true" />
                Send test verse
              </button>
              <button
                className="btn-secondary flex items-center gap-2 justify-center"
                onClick={handleClear}
                disabled={!ppConnected || testStatus === 'testing'}
              >
                <Trash2 size={13} aria-hidden="true" />
                Clear
              </button>
            </div>
            {testStatus !== 'idle' && (
              <div
                className={cn(
                  'flex items-center gap-1.5 text-xs font-semibold',
                  testStatus === 'testing' && 'text-yellow-400',
                  testStatus === 'ok' && 'text-teal-400',
                  testStatus === 'fail' && 'text-red-400'
                )}
              >
                {testStatus === 'testing' && <Loader size={11} className="animate-spin" aria-hidden="true" />}
                {testStatus === 'ok' && <CheckCircle size={11} aria-hidden="true" />}
                {testStatus === 'fail' && <XCircle size={11} aria-hidden="true" />}
                <span>{testMsg}</span>
              </div>
            )}
            {!ppConnected && (
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Connect to ProPresenter (Settings → ProPresenter) to test live.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusRow({ label, ok }: { label: string; ok: boolean }): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <span className={cn('flex items-center gap-1.5 font-semibold', ok ? 'text-teal-400' : 'text-slate-500')}>
        <span className={cn('w-1.5 h-1.5 rounded-full', ok ? 'bg-teal-400 shadow-glow-teal/40' : 'bg-slate-600')} />
        {ok ? 'Ready' : 'Not ready'}
      </span>
    </div>
  )
}
