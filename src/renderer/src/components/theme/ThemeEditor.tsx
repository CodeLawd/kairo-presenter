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
  Plus,
  Copy,
  Save,
  RotateCcw,
  MoreHorizontal,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Slider as SliderPrimitive } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { useAppStore } from '@/stores/useAppStore'
import { renderOverlayHTML } from '@shared/overlay-template'
import { DEFAULT_OVERLAY_SETTINGS, normalizeOverlaySettings } from '@shared/overlay-defaults'
import type { AppSettings, CustomOverlayTheme, OverlayTheme, NdiStatus, PPVideoInputInfo } from '@shared/ipc'
import { createCustomTheme } from '@shared/theme-library'
import { clampPaneWidth, scaleToFit } from '@/lib/paneSizing'

// ─── Sample content for the WYSIWYG preview ────────────────────────────────────

const SAMPLE_REFERENCE = 'John 3:16 (KJV)'
const SAMPLE_TEXT =
  'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.'

type TestStatus = 'idle' | 'testing' | 'ok' | 'fail'
type InspectorTab = 'style' | 'type' | 'layout' | 'output'
const LIBRARY_MIN = 160
const LIBRARY_MAX = 280
const INSPECTOR_MIN = 300
const INSPECTOR_MAX = 480
const PREVIEW_MIN = 300

function storedPaneWidth(key: string, fallback: number, min: number, max: number): number {
  const stored = Number(window.localStorage.getItem(key))
  return clampPaneWidth(Number.isFinite(stored) && stored > 0 ? stored : fallback, min, max)
}

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
    <Switch
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
    />
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
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="label mb-0">{label}</label>
        <span className="text-xs font-bold font-mono text-teal-400 tabular-nums">
          {format ? format(value) : value}
          {unit}
        </span>
      </div>
      <SliderPrimitive
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(next) => onChange(next[0])}
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
      <div className="relative">
        <input
          type="color"
          value={isHex6 ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="absolute left-2 top-1/2 z-10 h-6 w-6 -translate-y-1/2 cursor-pointer rounded-md border border-surface-border bg-surface p-0.5"
          aria-label={`${label} color swatch`}
          title={isHex6 ? undefined : 'Swatch only supports 6-digit hex — edit the text field for rgba()'}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="input h-9 pl-11 font-mono text-xs"
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
  const columns = options.length >= 5
    ? 'grid-cols-3'
    : options.length === 4
      ? 'grid-cols-2'
      : options.length === 3
        ? 'grid-cols-3'
        : 'grid-cols-2'
  return (
    <div>
      <label className="label">{label}</label>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(next) => next && onChange(next as T)}
        variant="outline"
        className={cn('grid w-full gap-1 rounded-lg bg-surface p-1', columns)}
      >
        {options.map((opt) => (
          <ToggleGroupItem
            key={opt.value}
            value={opt.value}
            className="min-h-8 w-full px-2 py-1.5 text-xs font-semibold leading-tight data-[state=on]:border-primary/50 data-[state=on]:bg-primary/15 data-[state=on]:text-orange-300"
          >
            {opt.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
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
    <section className="space-y-4 rounded-xl bg-surface-secondary/35 p-4">
      <div className="flex items-center gap-2">
        <Icon size={14} className="shrink-0 text-orange-400" aria-hidden="true" />
        <h2 className="text-sm font-semibold tracking-tight text-white">{title}</h2>
      </div>
      {children}
    </section>
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

const BUILT_IN_THEMES: Array<{ id: string; name: string; theme: OverlayTheme }> = [
  { id: 'broadcast', name: 'Broadcast', theme: DEFAULT_OVERLAY_SETTINGS.theme },
  {
    id: 'warm-paper',
    name: 'Warm paper',
    theme: {
      ...DEFAULT_OVERLAY_SETTINGS.theme,
      background: { ...DEFAULT_OVERLAY_SETTINGS.theme.background, type: 'color', color: '#e8dfcf' },
      verse: { ...DEFAULT_OVERLAY_SETTINGS.theme.verse, fontFamily: "Georgia, 'Times New Roman', serif", color: '#201d19', shadow: false, align: 'left' },
      reference: { ...DEFAULT_OVERLAY_SETTINGS.theme.reference, color: '#8b4b32', position: 'above' },
      layout: { ...DEFAULT_OVERLAY_SETTINGS.theme.layout, position: 'center', backdropBox: false, maxWidthPct: 72 },
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    theme: {
      ...DEFAULT_OVERLAY_SETTINGS.theme,
      background: { ...DEFAULT_OVERLAY_SETTINGS.theme.background, type: 'gradient', color: '#07111f', color2: '#18324b', angleDeg: 135 },
      reference: { ...DEFAULT_OVERLAY_SETTINGS.theme.reference, color: '#f2a36f' },
      layout: { ...DEFAULT_OVERLAY_SETTINGS.theme.layout, position: 'center', backdropBox: false, maxWidthPct: 76 },
    },
  },
]

// ─── Main page ──────────────────────────────────────────────────────────────────

export default function ThemeEditor(): React.ReactElement {
  const libraryWidth = storedPaneWidth('theme-library-width', 192, LIBRARY_MIN, LIBRARY_MAX)
  const inspectorWidth = storedPaneWidth('theme-inspector-width', 330, INSPECTOR_MIN, INSPECTOR_MAX)
  const [overlay, setOverlay] = useState<AppSettings['overlay']>(DEFAULT_OVERLAY_SETTINGS)
  const [draftTheme, setDraftTheme] = useState<OverlayTheme>(DEFAULT_OVERLAY_SETTINGS.theme)
  const [themeLibrary, setThemeLibrary] = useState<CustomOverlayTheme[]>([])
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null)
  const [themeName, setThemeName] = useState('')
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('style')
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
    Promise.all([window.api.settings.get('overlay'), window.api.settings.get('themeLibrary')]).then(([stored, library]) => {
      const normalized = normalizeOverlaySettings(stored)
      setOverlay(normalized)
      setDraftTheme(structuredClone(normalized.theme))
      setThemeLibrary(library)
      const matching = library.find((item) => JSON.stringify(item.theme) === JSON.stringify(normalized.theme))
      if (matching) {
        setSelectedThemeId(matching.id)
        setThemeName(matching.name)
      }
      setLoading(false)
    })
  }, [])

  // Preview renders a real 1920×1080 frame scaled down to the panel width, so
  // proportions (font px vs frame) match the NDI output exactly.
  const previewFrameRef = useRef<HTMLDivElement>(null)
  const [previewScale, setPreviewScale] = useState(0.2)
  useEffect(() => {
    const el = previewFrameRef.current
    if (!el) return
    const update = (): void => setPreviewScale(scaleToFit(el.clientWidth, 1920))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading])

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

  const flashSaved = useCallback(() => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    setSaved(true)
    savedTimerRef.current = setTimeout(() => setSaved(false), 1500)
  }, [])

  // Persist only the fields this page owns — main merges onto the freshly-read
  // stored overlay, so a stale copy here can never clobber the phase-1 fields
  // the Settings modal owns (template, showTranslation, …).
  const persist = useCallback(
    (next: AppSettings['overlay']) => {
      setOverlay(next)
      window.api.settings
        .set('overlay', {
          mode: next.mode,
          ppVideoInputUuid: next.ppVideoInputUuid,
          theme: next.theme,
        })
        .then(flashSaved)
    },
    [flashSaved]
  )

  const updateTheme = useCallback(
    <K extends keyof OverlayTheme>(section: K, partial: Partial<OverlayTheme[K]>) => {
      setDraftTheme((current) => ({
        ...current,
        [section]: { ...current[section], ...partial },
      }))
    },
    []
  )

  const setMode = (mode: AppSettings['overlay']['mode']): void => persist({ ...overlay, mode })

  const handlePickMedia = useCallback(
    async (kind: 'image' | 'video'): Promise<void> => {
      const picked = await window.api.ndi.pickOverlayMedia(kind)
      if (!picked) return
      setDraftTheme((current) => ({
        ...current,
        background: { ...current.background, mediaPath: picked },
      }))
    },
    []
  )

  const persistLibrary = useCallback((next: CustomOverlayTheme[]) => {
    setThemeLibrary(next)
    void window.api.settings.set('themeLibrary', next)
  }, [])

  const selectTheme = (id: string, name: string, theme: OverlayTheme): void => {
    setSelectedThemeId(id)
    setThemeName(name)
    setDraftTheme(structuredClone(theme))
  }

  const saveAsTheme = (): void => {
    const savedTheme = createCustomTheme(themeName || 'Untitled theme', draftTheme)
    persistLibrary([...themeLibrary, savedTheme])
    setSelectedThemeId(savedTheme.id)
    setThemeName(savedTheme.name)
  }

  const saveThemeChanges = (): void => {
    if (!selectedThemeId || selectedThemeId.startsWith('builtin:')) return
    const next = themeLibrary.map((item) => item.id === selectedThemeId
      ? { ...item, name: themeName.trim() || item.name, updatedAt: Date.now(), theme: structuredClone(draftTheme) }
      : item)
    persistLibrary(next)
  }

  const duplicateTheme = (): void => {
    const copy = createCustomTheme(`${themeName || 'Theme'} copy`, draftTheme)
    persistLibrary([...themeLibrary, copy])
    setSelectedThemeId(copy.id)
    setThemeName(copy.name)
  }

  const deleteTheme = (): void => {
    if (!selectedThemeId || selectedThemeId.startsWith('builtin:')) return
    if (!window.confirm(`Delete “${themeName || 'Untitled theme'}”? This cannot be undone.`)) return
    persistLibrary(themeLibrary.filter((item) => item.id !== selectedThemeId))
    setSelectedThemeId(null)
    setThemeName('')
  }

  const applyToOutput = (): void => persist({ ...overlay, theme: structuredClone(draftTheme) })

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

  const theme = draftTheme
  const hasDraftChanges = JSON.stringify(draftTheme) !== JSON.stringify(overlay.theme)
  const previewHtml = renderOverlayHTML(theme, SAMPLE_REFERENCE, SAMPLE_TEXT)

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full overflow-hidden">
      {/* Theme library */}
      <ResizablePanel
        id="theme-library"
        data-pane="library"
        defaultSize={libraryWidth}
        minSize={LIBRARY_MIN}
        maxSize={LIBRARY_MAX}
        onResize={({ inPixels }, _id, previous) => {
          if (previous) window.localStorage.setItem('theme-library-width', String(Math.round(inPixels)))
        }}
      >
      <aside className="h-full bg-surface-secondary/30 overflow-y-auto p-3">
        <div className="mb-4 flex items-center justify-between gap-2 px-1">
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.16em]">Themes</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Select to preview</p>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 text-slate-400 hover:text-teal-300"
            onClick={saveAsTheme}
            aria-label="Save draft as a new theme"
            title="Save as new theme"
          >
            <Plus size={14} aria-hidden="true" />
          </Button>
        </div>
        <div className="space-y-6">
          <div>
            <p className="label">Built in</p>
            <div className="space-y-2">
              {BUILT_IN_THEMES.map((item) => (
                <ThemeTile
                  key={item.id}
                  name={item.name}
                  theme={item.theme}
                  selected={selectedThemeId === `builtin:${item.id}`}
                  onClick={() => selectTheme(`builtin:${item.id}`, item.name, item.theme)}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="label mb-0">My themes</p>
              <span className="text-[10px] text-slate-500 tabular-nums">{themeLibrary.length}</span>
            </div>
            <div className="space-y-2">
              {themeLibrary.map((item) => (
                <ThemeTile
                  key={item.id}
                  name={item.name}
                  theme={item.theme}
                  selected={selectedThemeId === item.id}
                  onClick={() => selectTheme(item.id, item.name, item.theme)}
                />
              ))}
              {themeLibrary.length === 0 && <p className="text-xs text-slate-500 py-3">No saved themes yet.</p>}
            </div>
          </div>
        </div>
      </aside>
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize theme library" />
      <ResizablePanel id="theme-workspace" minSize={PREVIEW_MIN + INSPECTOR_MIN}>
      <ResizablePanelGroup orientation="horizontal" className="flex-row-reverse">

      {/* Controls column */}
      <ResizablePanel
        id="theme-inspector"
        data-pane="inspector"
        defaultSize={inspectorWidth}
        minSize={INSPECTOR_MIN}
        maxSize={INSPECTOR_MAX}
        onResize={({ inPixels }, _id, previous) => {
          if (previous) window.localStorage.setItem('theme-inspector-width', String(Math.round(inPixels)))
        }}
        className="theme-inspector"
      >
      <div className="h-full overflow-y-auto">
        <div className="w-full p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Editing theme</p>
              <div className="mt-1 flex items-center gap-1">
                <input
                  id="theme-name"
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-base font-semibold text-white outline-none placeholder:text-slate-600 disabled:text-slate-300"
                  value={themeName}
                  placeholder="Unsaved theme"
                  disabled={!selectedThemeId || selectedThemeId.startsWith('builtin:')}
                  onChange={(event) => setThemeName(event.target.value)}
                  aria-label="Theme name"
                />
                {selectedThemeId && !selectedThemeId.startsWith('builtin:') && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-slate-500 hover:text-teal-300"
                    onClick={saveThemeChanges}
                    aria-label="Save theme changes"
                    title="Save theme changes"
                  >
                    <Save size={14} aria-hidden="true" />
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-slate-500 hover:text-white" aria-label="Theme actions">
                    <MoreHorizontal size={15} aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onSelect={duplicateTheme}>
                      <Copy size={13} /> Duplicate
                    </DropdownMenuItem>
                    {selectedThemeId && !selectedThemeId.startsWith('builtin:') && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={deleteTheme}>
                          <Trash2 size={13} /> Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">Adjustments preview privately</p>
            </div>
            {saved && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-teal-400 animate-fade-in">
                <CheckCircle size={13} aria-hidden="true" />
                Saved
              </span>
            )}
          </div>

          <Tabs value={inspectorTab} onValueChange={(value) => setInspectorTab(value as InspectorTab)}>
          <TabsList className="grid h-9 w-full grid-cols-4" aria-label="Theme controls">
            {([
              ['style', 'Style'],
              ['type', 'Type'],
              ['layout', 'Layout'],
              ['output', 'Output'],
            ] as const).map(([id, label]) => (
              <TabsTrigger
                key={id}
                value={id}
                className="text-[11px]"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          </Tabs>

          {/* ── Output mode ─────────────────────────────────────────────────── */}
          {inspectorTab === 'output' && <SectionCard icon={Radio} title="Output mode">
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { value: 'auto', label: 'Auto' },
                  { value: 'ndi', label: 'NDI' },
                  { value: 'message', label: 'Message' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMode(opt.value)}
                  className={cn(
                    'px-2 py-2 rounded-lg border text-center transition-all',
                    overlay.mode === opt.value
                      ? 'bg-teal-500/15 border-teal-500/40 text-teal-300'
                      : 'btn-secondary'
                  )}
                  aria-pressed={overlay.mode === opt.value}
                >
                  <span className="text-xs font-bold">{opt.label}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">
              {overlay.mode === 'auto' && 'Uses NDI when available, then falls back to a ProPresenter message.'}
              {overlay.mode === 'ndi' && 'Always uses the custom rendered NDI output.'}
              {overlay.mode === 'message' && 'Uses ProPresenter’s native message layer.'}
            </p>

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
          </SectionCard>}

          {/* ── Background ───────────────────────────────────────────────────── */}
          {inspectorTab === 'style' && <SectionCard icon={Layers} title="Background">
            <SegmentedControl
              label="Type"
              value={theme.background.type}
              options={[
                { value: 'transparent', label: 'Transparent' },
                { value: 'color', label: 'Solid color' },
                { value: 'gradient', label: 'Gradient' },
                { value: 'image', label: 'Image' },
                { value: 'video', label: 'Video' },
              ]}
              onChange={(type) => updateTheme('background', { type })}
            />

            {(theme.background.type === 'color' || theme.background.type === 'gradient') && (
              <>
                <div className="border-t border-surface-border/50" />
                <div className={cn('grid gap-4', theme.background.type === 'gradient' ? 'grid-cols-2' : 'grid-cols-1')}>
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
              </>
            )}

            {(theme.background.type === 'image' || theme.background.type === 'video') && (
              <>
                <div className="border-t border-surface-border/50" />
                <div>
                  <label className="label">
                    {theme.background.type === 'video' ? 'Video file' : 'Image file'}
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="btn-secondary px-3 py-2 text-xs shrink-0"
                      onClick={() => handlePickMedia(theme.background.type as 'image' | 'video')}
                    >
                      Choose file…
                    </button>
                    <span
                      className="text-xs text-slate-400 font-mono truncate min-w-0"
                      title={theme.background.mediaPath}
                    >
                      {theme.background.mediaPath
                        ? theme.background.mediaPath.split('/').pop()
                        : 'No file selected'}
                    </span>
                  </div>
                  {theme.background.type === 'video' && (
                    <p className="text-[10px] text-slate-500 mt-1.5 leading-snug">
                      Plays muted on a loop behind the text. Keep clips short and lightweight —
                      the NDI output repaints every frame.
                    </p>
                  )}
                </div>
                <SegmentedControl
                  label="Fit"
                  value={theme.background.mediaFit ?? 'cover'}
                  options={[
                    { value: 'cover', label: 'Cover' },
                    { value: 'contain', label: 'Contain' },
                    { value: 'fill', label: 'Stretch' },
                  ]}
                  onChange={(mediaFit) => updateTheme('background', { mediaFit })}
                />
              </>
            )}

            {theme.background.type !== 'transparent' && (
              <Slider
                label="Opacity"
                value={theme.background.opacity}
                onChange={(opacity) => updateTheme('background', { opacity })}
                min={0}
                max={1}
                step={0.05}
                format={(v) => v.toFixed(2)}
              />
            )}
          </SectionCard>}

          {/* ── Verse text ───────────────────────────────────────────────────── */}
          {inspectorTab === 'type' && <>
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
            <div className={cn('grid gap-4', theme.layout.position === 'full' && theme.layout.autoFitText ? 'grid-cols-1' : 'grid-cols-2')}>
              {!(theme.layout.position === 'full' && theme.layout.autoFitText) && (
                <Slider
                  label="Size"
                  value={theme.verse.fontSizePx}
                  onChange={(fontSizePx) => updateTheme('verse', { fontSizePx })}
                  min={12}
                  max={200}
                  unit="px"
                />
              )}
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

            {theme.reference.show && <div className="space-y-4">
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
            </div>}
          </SectionCard>
          </>}

          {/* ── Layout ───────────────────────────────────────────────────────── */}
          {inspectorTab === 'layout' && <SectionCard icon={LayoutTemplate} title="Layout">
            <SegmentedControl
              label="Position preset"
              value={theme.layout.position}
              options={[
                { value: 'lower-third', label: 'Lower third' },
                { value: 'center', label: 'Center' },
                { value: 'top', label: 'Top' },
                { value: 'full', label: 'Fullscreen' },
              ]}
              onChange={(position) => updateTheme('layout', { position })}
            />
            {theme.layout.position === 'full' && (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-white tracking-tight">Auto-fit text</p>
                  <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                    Size the verse automatically to fill the screen — longer passages shrink,
                    short ones grow. Overrides the verse Size slider.
                  </p>
                </div>
                <Toggle
                  checked={theme.layout.autoFitText}
                  onChange={(autoFitText) => updateTheme('layout', { autoFitText })}
                />
              </div>
            )}
            <div className={cn('grid gap-4', theme.layout.position === 'full' ? 'grid-cols-1' : 'grid-cols-2')}>
              {theme.layout.position !== 'full' && (
                <Slider
                  label="Max width"
                  value={theme.layout.maxWidthPct}
                  onChange={(maxWidthPct) => updateTheme('layout', { maxWidthPct })}
                  min={20}
                  max={100}
                  unit="%"
                />
              )}
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
            {theme.layout.backdropBox && <div className="grid grid-cols-2 gap-4">
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
            </div>}
          </SectionCard>}
        </div>
      </div>
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize theme inspector" />

      {/* Preview + status column */}
      <ResizablePanel id="theme-preview" minSize={PREVIEW_MIN}>
      <div className="h-full bg-surface-secondary/25 overflow-y-auto">
        <div className="flex min-h-full flex-col gap-5 p-5">
          {/* NDI / PP status line */}
          <div className="double-bezel-outer order-3">
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
          <div className="order-1">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-sans">Preview</p>
                <p className="text-xs text-slate-400 mt-1">John 3:16 · 1920 × 1080</p>
              </div>
              {hasDraftChanges && <span className="text-[10px] font-semibold text-orange-300 bg-orange-400/10 px-2 py-1 rounded-md">Unapplied changes</span>}
            </div>
            <div
              ref={previewFrameRef}
              className="relative w-full aspect-video rounded-xl bg-[repeating-conic-gradient(#1a1a1a_0%_25%,#0d0d0d_0%_50%)] bg-[length:16px_16px] border border-surface-border/50 overflow-hidden"
            >
              <div
                style={{
                  width: 1920,
                  height: 1080,
                  transform: `scale(${previewScale})`,
                  transformOrigin: 'top left',
                }}
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
              Pixel-exact preview. Changes remain private until applied to output.
            </p>
          </div>

          <div className="order-2 flex items-center gap-2">
            <button className="btn-primary flex-1 flex items-center justify-center gap-2" onClick={applyToOutput} disabled={!hasDraftChanges}>
              <MonitorPlay size={14} /> Apply to output
            </button>
            <button
              className="btn-secondary flex items-center gap-2"
              onClick={() => setDraftTheme(structuredClone(overlay.theme))}
              disabled={!hasDraftChanges}
            >
              <RotateCcw size={13} /> Discard
            </button>
          </div>

          {/* Test / clear */}
          <div className="order-4 space-y-2">
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
      </ResizablePanel>
      </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
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

function ThemeTile({
  name,
  theme,
  selected,
  onClick,
}: {
  name: string
  theme: OverlayTheme
  selected: boolean
  onClick: () => void
}): React.ReactElement {
  const html = renderOverlayHTML(theme, 'John 3:16', 'For God so loved the world…')
  const frameRef = useRef<HTMLSpanElement>(null)
  const [scale, setScale] = useState(0.08)
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const update = (): void => setScale(scaleToFit(frame.clientWidth, 1920))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'w-full rounded-lg p-1 text-left border transition-all duration-200',
        selected
          ? 'bg-teal-500/10 border-teal-500/50 shadow-[0_0_0_1px_rgb(var(--control-accent)/0.12)]'
          : 'bg-surface border-surface-border/60 hover:border-slate-500'
      )}
    >
      <span ref={frameRef} className="block relative w-full aspect-video rounded-md overflow-hidden bg-surface-tertiary">
        <span
          className="block absolute left-0 top-0"
          style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </span>
      <span className={cn('block truncate px-1.5 pb-1 pt-1.5 text-[11px] font-semibold', selected ? 'text-orange-300' : 'text-slate-300')}>
        {name}
      </span>
    </button>
  )
}
